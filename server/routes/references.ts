import { Router } from 'express'
import { createUserClient } from '../lib/supabase.js'
import { ensureProjectForUser } from '../lib/ensureProject.js'
import { callAIOnce, type Message } from '../lib/ai.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

type SourceInput = {
  id: string
  title: string
  authors?: string[]
  year?: number
  journal?: string
  source?: string
  doi?: string
  url?: string
  abstract?: string
  relevanceReason?: string
  noteText?: string
}

type SectionInput = {
  id: string
  title: string
  content: string
}

const CLAIM_TYPES = new Set(['definition', 'literature', 'method', 'comparison', 'trend', 'assertion'])

function clip(value: unknown, max = 2400) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 未返回 JSON 对象')
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
}

function normalizeSource(value: unknown): SourceInput | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = String(row.id ?? row.doi ?? row.url ?? row.title ?? '').trim()
  const title = String(row.title ?? '').trim()
  if (!id || !title) return null
  const year = Number(row.year)
  return {
    id,
    title,
    authors: Array.isArray(row.authors) ? row.authors.map(String).filter(Boolean).slice(0, 8) : [],
    year: Number.isFinite(year) ? year : undefined,
    journal: String(row.journal ?? row.source ?? '').trim() || undefined,
    source: String(row.source ?? row.journal ?? '').trim() || undefined,
    doi: String(row.doi ?? '').trim() || undefined,
    url: String(row.url ?? '').trim() || undefined,
    abstract: clip(row.abstract, 1200),
    relevanceReason: clip(row.relevanceReason, 800),
    noteText: clip(row.noteText, 800),
  }
}

function normalizeSection(value: unknown): SectionInput | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = String(row.id ?? '').trim()
  const title = String(row.title ?? '').trim()
  const content = String(row.content ?? '').trim()
  if (!id || !title || !content) return null
  return { id, title, content: clip(content, 7000) }
}

function sourceNote(source: SourceInput) {
  const authors = source.authors?.length ? source.authors.slice(0, 3).join('、') : '作者未详'
  const year = source.year ? `${source.year}` : '年份未详'
  const journal = source.journal || source.source || ''
  const doi = source.doi ? ` DOI：${source.doi}` : ''
  return `${authors}. ${source.title}. ${year}.${journal ? ` ${journal}.` : ''}${doi}`.replace(/\s+/g, ' ').trim()
}

function sourceBrief(source: SourceInput, index: number) {
  return [
    `${index + 1}. sourceId: ${source.id}`,
    `题名: ${source.title}`,
    `作者: ${source.authors?.join('、') || '作者未详'}`,
    `年份/来源: ${[source.year, source.journal || source.source].filter(Boolean).join('；') || '未详'}`,
    source.doi ? `DOI: ${source.doi}` : '',
    source.abstract ? `摘要: ${source.abstract}` : '',
    source.relevanceReason ? `可用依据: ${source.relevanceReason}` : '',
  ].filter(Boolean).join('\n')
}

function sectionBrief(section: SectionInput, index: number) {
  return [
    `【章节 ${index + 1}】`,
    `sectionId: ${section.id}`,
    `标题: ${section.title}`,
    `正文:\n${section.content}`,
  ].join('\n')
}

function normalizePatch(value: unknown, sections: SectionInput[], sources: SourceInput[], index: number) {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const sectionId = String(row.sectionId ?? '').trim()
  const section = sections.find(item => item.id === sectionId)
  if (!section) return null
  const nestedSource = row.source && typeof row.source === 'object'
    ? row.source as Record<string, unknown>
    : null
  const sourceId = String(row.sourceId ?? nestedSource?.id ?? '').trim()
  const source = sources.find(item => item.id === sourceId)
  if (!source) return null
  const originalText = String(row.originalText ?? '').trim()
  const revisedText = String(row.revisedText ?? originalText).trim()
  if (!originalText || !revisedText || !section.content.includes(originalText)) return null
  const rawClaimType = String(row.claimType ?? row.enhancementType ?? 'assertion')
  const claimType = CLAIM_TYPES.has(rawClaimType) ? rawClaimType : 'assertion'
  const confidence = Number(row.confidence)
  return {
    id: String(row.id ?? `ai_citation_${Date.now()}_${index}`),
    sectionId,
    sectionTitle: section.title,
    claimType,
    originalText,
    revisedText,
    problem: clip(row.problem, 500),
    reason: clip(row.reason, 800) || 'AI 基于全文语境判断该来源能够支撑改写后的论述。',
    enhancementType: String(row.enhancementType ?? claimType),
    applyMode: String(row.applyMode ?? 'rewrite_with_citation'),
    confidence: Number.isFinite(confidence) ? Math.max(0.4, Math.min(0.98, confidence)) : 0.82,
    source: {
      id: source.id,
      title: source.title,
      authors: source.authors ?? [],
      year: source.year,
      journal: source.journal || source.source,
      doi: source.doi,
      url: source.url,
      noteText: source.noteText || sourceNote(source),
    },
  }
}

function buildEnhancementPrompt(input: {
  projectTitle: string
  researchObject?: string
  citationFormat?: string
  sections: SectionInput[]
  sources: SourceInput[]
  evidencePack?: unknown
}): Message[] {
  return [
    {
      role: 'system',
      content: `你是正式论文的引用增强编辑。你的任务不是机械补脚注，而是理解全文结构，找出理论、方法、研究现状和判断依据不足的位置，进行局部改写并绑定真实来源。

严格规则：
1. 只使用用户提供的 sources，不得编造作者、年份、题名、DOI、URL。
2. 不处理摘要、关键词、题目、目录、参考文献、致谢、附录和大小标题。
3. originalText 必须逐字出现在对应 section 正文中，方便系统定位替换。
4. revisedText 必须是可直接替换 originalText 的自然论文文本，引用应自然融入语义，不要只在句末硬塞来源。
5. revisedText 不要包含脚注编号、[1]、（作者，年份）等标记，系统会负责写脚注。
6. 优先输出高价值增强：理论补强、方法依据、研究现状、关键判断支撑。宁缺毋滥。
7. 如果来源不能支撑原句，跳过，不要强行匹配。

只返回 JSON，不要 Markdown。格式：
{
  "auditNote": "一句话总结",
  "skipped": ["跳过原因"],
  "patches": [
    {
      "sectionId": "章节ID",
      "enhancementType": "theory | literature | method | claim | rewrite",
      "claimType": "definition | literature | method | comparison | trend | assertion",
      "originalText": "正文中逐字存在的原文片段",
      "revisedText": "改写后的文本",
      "problem": "当前问题",
      "reason": "为什么这样改，以及来源如何支撑",
      "sourceId": "必须来自 sources 的 sourceId",
      "applyMode": "rewrite_with_citation | citation_only",
      "confidence": 0.0
    }
  ]
}`,
    },
    {
      role: 'user',
      content: [
        `论文题目：${input.projectTitle}`,
        input.researchObject ? `研究对象：${input.researchObject}` : '',
        `引用格式偏好：${input.citationFormat || 'footnote'}`,
        '',
        '【可用来源 sources】',
        input.sources.map(sourceBrief).join('\n\n'),
        '',
        '【全文章节】',
        input.sections.map(sectionBrief).join('\n\n'),
        '',
        input.evidencePack ? `【已有证据摘要】\n${clip(JSON.stringify(input.evidencePack), 5000)}` : '',
      ].filter(Boolean).join('\n'),
    },
  ]
}

router.get('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('reference_selections')
    .select('*')
    .eq('project_id', req.params.projectId)
    .eq('stage', req.params.stage)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const projectId = String(req.params.projectId)
  const ensured = await ensureProjectForUser(db, projectId, req.userId!)
  if (ensured.error) {
    res.status(500).json({ error: ensured.error.message })
    return
  }

  const {
    library_item_ids = [],
    section_ids = [],
    include_project_context = true,
    include_conversation_summary = false,
    auto_citation_enabled = true,
    auto_sources = [],
    evidence_pack = null,
    last_auto_run_at = null,
  } = req.body

  const payload = {
    project_id: projectId,
    stage: req.params.stage,
    library_item_ids,
    section_ids,
    include_project_context,
    include_conversation_summary,
    auto_citation_enabled,
    auto_sources,
    evidence_pack,
    last_auto_run_at,
  }

  let { data, error } = await db
    .from('reference_selections')
    .upsert(payload, { onConflict: 'project_id,stage' })
    .select()
    .single()

  if (error && /auto_citation_enabled|auto_sources|evidence_pack|last_auto_run_at/i.test(error.message)) {
    const fallback = {
      project_id: projectId,
      stage: req.params.stage,
      library_item_ids,
      section_ids,
      include_project_context,
      include_conversation_summary,
    }
    const fallbackResult = await db
      .from('reference_selections')
      .upsert(fallback, { onConflict: 'project_id,stage' })
      .select()
      .single()
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/enhance', async (req: AuthRequest, res) => {
  const sections = Array.isArray(req.body?.sections)
    ? (req.body.sections as unknown[]).map(normalizeSection).filter((item): item is SectionInput => Boolean(item))
    : []
  const sources = Array.isArray(req.body?.sources)
    ? (req.body.sources as unknown[]).map(normalizeSource).filter((item): item is SourceInput => Boolean(item))
    : []

  if (sections.length === 0) {
    res.status(400).json({ error: '缺少可增强的正文内容' })
    return
  }
  if (sources.length === 0) {
    res.json({ ok: true, patches: [], auditNote: '当前没有可引用来源，未生成引用增强补丁。', skipped: ['缺少可引用来源'] })
    return
  }

  try {
    const messages = buildEnhancementPrompt({
      projectTitle: String(req.body?.projectTitle ?? ''),
      researchObject: String(req.body?.researchObject ?? ''),
      citationFormat: String(req.body?.citationFormat ?? ''),
      sections: sections.slice(0, 24),
      sources: sources.slice(0, 40),
      evidencePack: req.body?.evidencePack,
    })
    const raw = await callAIOnce(messages, 'gpt')
    const parsed = extractJsonObject(raw)
    const patches = Array.isArray(parsed.patches)
      ? parsed.patches
        .map((patch, index) => normalizePatch(patch, sections, sources, index))
        .filter(Boolean)
        .slice(0, 24)
      : []
    const skipped = Array.isArray(parsed.skipped) ? parsed.skipped.map(String).slice(0, 12) : []
    res.json({
      ok: true,
      patches,
      auditNote: String(parsed.auditNote ?? `已生成 ${patches.length} 条引用增强建议。`),
      skipped,
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

export default router
