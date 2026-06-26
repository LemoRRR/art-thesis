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

type CitationCandidate = {
  id: string
  sectionId: string
  sectionTitle: string
  text: string
  score: number
}

const CLAIM_TYPES = new Set(['definition', 'literature', 'method', 'comparison', 'trend', 'assertion'])

function clip(value: unknown, max = 2400) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}...` : text
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
  const authors = Array.isArray(row.authors) ? row.authors.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8) : []
  const doi = String(row.doi ?? '').trim() || undefined
  const url = String(row.url ?? '').trim() || (doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : undefined)
  if (authors.length === 0 || !url) return null
  const year = Number(row.year)
  return {
    id,
    title,
    authors,
    year: Number.isFinite(year) ? year : undefined,
    journal: String(row.journal ?? row.source ?? '').trim() || undefined,
    source: String(row.source ?? row.journal ?? '').trim() || undefined,
    doi,
    url,
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
  const authors = source.authors?.slice(0, 3).join('、') || ''
  const year = source.year ? `${source.year}` : '年份未详'
  const journal = source.journal || source.source || ''
  const link = source.doi
    ? ` https://doi.org/${source.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`
    : source.url ? ` ${source.url}` : ''
  return `${authors}. ${source.title}. ${year}.${journal ? ` ${journal}.` : ''}${link}`.replace(/\s+/g, ' ').trim()
}

function sourceBrief(source: SourceInput, index: number) {
  return [
    `${index + 1}. sourceId: ${source.id}`,
    `Title: ${source.title}`,
    `Authors: ${source.authors?.join('、') || ''}`,
    `Year/source: ${[source.year, source.journal || source.source].filter(Boolean).join('；') || '未详'}`,
    source.doi ? `DOI: ${source.doi}` : '',
    source.abstract ? `Abstract: ${source.abstract}` : '',
    source.relevanceReason ? `Usable evidence: ${source.relevanceReason}` : '',
    source.noteText ? `Footnote text: ${source.noteText}` : '',
  ].filter(Boolean).join('\n')
}

function sectionBrief(section: SectionInput, index: number) {
  return [
    `[Section ${index + 1}]`,
    `sectionId: ${section.id}`,
    `Title: ${section.title}`,
    `Content:\n${section.content}`,
  ].join('\n')
}

function scoreCitationCandidate(text: string) {
  let score = 0
  if (/(本段为系统|生成服务异常|保底初稿|请稍后重试|单独生成当前章节|正式完善时|建议继续补入|根据硕士论文要求调整|从论证层次看)/.test(text)) {
    return -10
  }
  const rules: Array<[RegExp, number]> = [
    [/(理论|模型|框架|机制|路径|定义|概念|内涵|特征)/, 5],
    [/(KANO|卡诺|熵权|权重|耦合|评价指标|优先级|满意度|需求)/i, 5],
    [/(非遗|纹样|文创|视觉|创新|文化符号|用户|问卷|实证)/, 4],
    [/(已有研究|相关研究|学界|研究表明|研究认为|指出|发现)/, 4],
    [/(方法|数据|样本|量表|信度|效度|统计|分析|测度)/, 4],
    [/(因此|说明|表明|可见|进一步|相较|相比|趋势|影响|关系)/, 2],
  ]
  rules.forEach(([pattern, weight]) => {
    if (pattern.test(text)) score += weight
  })
  const readableRules: Array<[RegExp, number]> = [
    [/(理论|模型|框架|机制|路径|定义|概念|内涵|特征|method|model|framework|definition)/i, 5],
    [/(KANO|卡诺|熵权|权重|耦合|评价指标|优先级|满意度|需求|entropy|weight|indicator|satisfaction)/i, 5],
    [/(非遗|纹样|文创|视觉|创新|文化符号|用户|问卷|实证|intangible|heritage|visual|symbol|questionnaire|empirical)/i, 4],
    [/(已有研究|相关研究|学界|研究表明|研究认为|指出|发现|literature|research|study|shows|suggests)/i, 4],
    [/(方法|数据|样本|量表|信度|效度|统计|分析|测度|analysis|sample|scale|reliability|validity|statistics)/i, 4],
    [/(因此|说明|表明|可见|进一步|相较|相比|趋势|影响|关系|therefore|indicates|relationship|effect|trend)/i, 2],
  ]
  readableRules.forEach(([pattern, weight]) => {
    if (pattern.test(text)) score += weight
  })
  if (text.length >= 35 && text.length <= 180) score += 2
  if (text.length > 240) score -= 3
  return score
}

function extractCitationCandidates(sections: SectionInput[], limit = 100): CitationCandidate[] {
  const candidates: CitationCandidate[] = []
  sections.forEach(section => {
    const paragraphs = section.content
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean)

    paragraphs.forEach(paragraph => {
      if (/^(摘要|关键词|目录|参考文献|致谢|附录|第[一二三四五六七八九十\d]+[章节]|[一二三四五六七八九十\d]+[、.．])/.test(paragraph)) return
      const sentences = paragraph
        .split(/(?<=[。！？!?；;])\s*/)
        .map(item => item.trim())
        .filter(Boolean)

      sentences.forEach(sentence => {
        const text = sentence.replace(/\s+/g, ' ').trim()
        if (text.length < 18 || text.length > 320) return
        if (/^\s*[-*#]/.test(text)) return
        const score = scoreCitationCandidate(text)
        if (score <= 0) return
        candidates.push({
          id: `c${candidates.length + 1}`,
          sectionId: section.id,
          sectionTitle: section.title,
          text,
          score,
        })
      })
    })
  })

  return candidates.sort((a, b) => b.score - a.score).slice(0, limit)
}

function candidateBrief(candidate: CitationCandidate) {
  return [
    `candidateId: ${candidate.id}`,
    `sectionId: ${candidate.sectionId}`,
    `sectionTitle: ${candidate.sectionTitle}`,
    `exactText: ${candidate.text}`,
  ].join('\n')
}

function hasInlineCitationLeak(text: string) {
  return /\{\{cite:[^}]+}}|\[[\d,\s]+\]|(?:^|[^\w])S\d+(?:[^\w]|$)/i.test(text)
}

function normalizePatch(
  value: unknown,
  sections: SectionInput[],
  sources: SourceInput[],
  candidates: CitationCandidate[],
  index: number
) {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const candidateId = String(row.candidateId ?? row.originalCandidateId ?? '').trim()
  const candidate = candidateId ? candidates.find(item => item.id === candidateId) : null
  const sectionId = String(row.sectionId ?? candidate?.sectionId ?? '').trim()
  const section = sections.find(item => item.id === sectionId)
  if (!section) return null

  const nestedSource = row.source && typeof row.source === 'object'
    ? row.source as Record<string, unknown>
    : null
  const sourceId = String(row.sourceId ?? nestedSource?.id ?? '').trim()
  const source = sources.find(item => item.id === sourceId)
  if (!source) return null

  const originalText = candidate?.text ?? String(row.originalText ?? '').trim()
  const revisedText = String(row.revisedText ?? originalText).trim()
  if (!originalText || !revisedText || !section.content.includes(originalText)) return null
  if (hasInlineCitationLeak(revisedText)) return null
  if (revisedText.length > Math.max(originalText.length * 3, 520)) return null

  const rawClaimType = String(row.claimType ?? row.enhancementType ?? 'assertion')
  const claimType = CLAIM_TYPES.has(rawClaimType) ? rawClaimType : 'assertion'
  const confidence = Number(row.confidence)
  return {
    id: String(row.id ?? `ai_citation_${Date.now()}_${index}`),
    candidateId: candidate?.id,
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
      noteText: sourceNote(source),
    },
  }
}

type NormalizedPatch = NonNullable<ReturnType<typeof normalizePatch>>

function buildEnhancementPrompt(input: {
  projectTitle: string
  researchObject?: string
  citationFormat?: string
  targetFinalCitationCount: number
  minPatchCount: number
  idealPatchCount: number
  sections: SectionInput[]
  candidates: CitationCandidate[]
  sources: SourceInput[]
  evidencePack?: unknown
  existingCandidateIds?: string[]
  mode?: 'initial' | 'fill'
}): Message[] {
  const existing = new Set(input.existingCandidateIds ?? [])
  const candidates = input.candidates.filter(item => !existing.has(item.id))
  const fillInstruction = input.mode === 'fill'
    ? `This is a fill pass. Previous valid candidateIds were ${[...existing].join(', ') || 'none'}. Produce additional patches only; do not reuse those candidateIds.`
    : ''

  return [
    {
      role: 'system',
      content: `You are a senior academic citation editor for Chinese thesis writing. Your job is citation enhancement: understand the whole paper, identify places where theory, method, literature review, empirical reasoning, or key claims need stronger support, then rewrite locally and bind each change to a real source.

Rules:
1. Use only the provided sources. Never invent authors, years, titles, DOI, URL, journals, or findings.
2. Every source has author metadata and a resolvable DOI/URL. Do not output a patch if the source would need "author unknown" or has no clickable origin.
3. Do not enhance title, abstract, keywords, headings, table of contents, references, acknowledgements, or appendices.
4. Prefer choosing from the provided citationCandidates. If you use a candidate, return candidateId and copy exactText as originalText.
5. originalText must appear verbatim in its section so the product can safely replace it.
6. revisedText must be natural Chinese thesis prose that can directly replace originalText. Do not include footnote numbers, [1], or author-year marks; the product writes the note.
7. Prioritize high-value academic upgrades: theory grounding, method justification, literature positioning, construct definition, empirical interpretation, and key judgement support.
8. If the source cannot support the sentence after rewriting, skip it.
9. When sources and text are sufficient, produce at least ${input.minPatchCount} reviewable patches and ideally ${input.idealPatchCount}; do not stop at 1-2.
10. For topics like KANO, entropy weight method, coupling model, intangible heritage patterns, cultural-creative visual innovation, questionnaire/empirical analysis, cover these areas where present in the text: KANO model basis, entropy-weight/index weighting basis, coupling/priority model explanation, intangible heritage visual-symbol theory, cultural creative design literature, user demand/satisfaction theory, empirical result interpretation.
${fillInstruction}

Return JSON only, no Markdown. Schema:
{
  "auditNote": "one-sentence summary",
  "skipped": ["reason"],
  "patches": [
    {
      "candidateId": "candidate id when available",
      "sectionId": "section id",
      "enhancementType": "theory | literature | method | claim | rewrite",
      "claimType": "definition | literature | method | comparison | trend | assertion",
      "originalText": "exact text from the section",
      "revisedText": "rewritten text",
      "problem": "current weakness",
      "reason": "why this rewrite/source supports the claim",
      "sourceId": "must match a provided sourceId",
      "applyMode": "rewrite_with_citation | citation_only",
      "confidence": 0.0
    }
  ]
}`,
    },
    {
      role: 'system',
      content: `Quantity and coverage:
- Use different paragraphs, sections, sources, and rhetorical functions when possible.
- If you cannot reach ${input.minPatchCount}, explain the exact reason in skipped.
- Do not sacrifice truthfulness for quantity.
- Prefer candidateId anchors because they prevent invalid patches from being discarded.`,
    },
    {
      role: 'user',
      content: [
        `Paper title: ${input.projectTitle}`,
        input.researchObject ? `Research object: ${input.researchObject}` : '',
        `Citation format preference: ${input.citationFormat || 'footnote'}`,
        `Final citation target: about ${input.targetFinalCitationCount}; this run should produce high-value reviewable patches.`,
        '',
        '[Citation candidates: choose these candidateIds when possible]',
        candidates.map(candidateBrief).join('\n\n'),
        '',
        '[Available sources]',
        input.sources.map(sourceBrief).join('\n\n'),
        '',
        '[Full sections]',
        input.sections.map(sectionBrief).join('\n\n'),
        '',
        input.evidencePack ? `[Existing evidence pack]\n${clip(JSON.stringify(input.evidencePack), 5000)}` : '',
      ].filter(Boolean).join('\n'),
    },
  ]
}

function mergePatches<T extends { candidateId?: string; originalText?: string; source?: { id?: string } }>(patches: T[]) {
  const seen = new Set<string>()
  const merged: T[] = []
  patches.forEach(patch => {
    const key = [patch.candidateId, patch.originalText, patch.source?.id].filter(Boolean).join('|')
    if (!key || seen.has(key)) return
    seen.add(key)
    merged.push(patch)
  })
  return merged
}

function citationMatchTokens(text: unknown) {
  const normalized = String(text ?? '').toLowerCase()
  const latin = normalized.match(/[a-z][a-z0-9-]{2,}/g) ?? []
  const cjk = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/g))
    .flatMap(match => {
      const word = match[0]
      const grams: string[] = []
      for (let index = 0; index < word.length - 1; index += 1) grams.push(word.slice(index, index + 2))
      return grams
    })
  const tokens = new Set([...latin, ...cjk].filter(token => token.length >= 2))
  const aliases: Array<[RegExp, string[]]> = [
    [/kano|卡诺/i, ['kano', 'model', '需求', '满意']],
    [/熵权|entropy/i, ['entropy', 'weight', '权重', '指标']],
    [/非遗|intangible|heritage/i, ['intangible', 'heritage', '非遗', '文化']],
    [/视觉|visual/i, ['visual', '视觉', '符号']],
    [/文创|cultural|creative/i, ['cultural', 'creative', '文创', '文化']],
    [/用户|user|customer/i, ['user', 'customer', '用户']],
    [/满意|satisfaction/i, ['satisfaction', '满意']],
    [/问卷|questionnaire|survey/i, ['questionnaire', 'survey', '问卷']],
  ]
  aliases.forEach(([pattern, additions]) => {
    if (pattern.test(normalized)) additions.forEach(token => tokens.add(token))
  })
  return tokens
}

function citationOverlapScore(left: unknown, right: unknown) {
  const leftTokens = citationMatchTokens(left)
  const rightTokens = citationMatchTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let overlap = 0
  leftTokens.forEach(token => {
    if (rightTokens.has(token)) overlap += 1
  })
  return overlap / Math.sqrt(leftTokens.size * rightTokens.size)
}

function citationSupportScore(candidateText: string, sourceEvidence: string) {
  const left = candidateText.toLowerCase()
  const right = sourceEvidence.toLowerCase()
  let score = citationOverlapScore(left, right)
  if (/kano|卡诺/i.test(left) && /kano|卡诺/i.test(right)) score += 0.5
  if (/熵权|entropy/i.test(left) && /熵权|entropy/i.test(right)) score += 0.5
  if (/(非遗|intangible|heritage)/i.test(left) && /(非遗|intangible|heritage)/i.test(right)) score += 0.08
  if (/(视觉|visual|符号|symbol)/i.test(left) && /(视觉|visual|符号|symbol)/i.test(right)) score += 0.08
  if (/(用户|user|customer)/i.test(left) && /(用户|user|customer)/i.test(right)) score += 0.05
  return score
}

function fallbackCitationPatches(
  sections: SectionInput[],
  sources: SourceInput[],
  candidates: CitationCandidate[],
  existing: NormalizedPatch[] = [],
  limit = 8
): NormalizedPatch[] {
  const usedCandidates = new Set(existing.map(patch => patch.candidateId).filter(Boolean))
  const usedPairs = new Set(existing.map(patch => `${patch.candidateId}:${patch.source.id}`))
  const patches: NormalizedPatch[] = []

  for (const candidate of candidates) {
    if (patches.length >= limit) break
    if (usedCandidates.has(candidate.id)) continue
    const section = sections.find(item => item.id === candidate.sectionId)
    if (!section) continue
    const best = sources
      .map(source => {
        const sourceEvidence = [
          source.title,
          source.abstract,
          source.relevanceReason,
          source.noteText,
          source.journal,
          source.source,
        ].filter(Boolean).join(' ')
        return {
          source,
          score: citationSupportScore(candidate.text, sourceEvidence),
        }
      })
      .filter(item => item.score >= 0.02)
      .sort((a, b) => b.score - a.score)[0]
    if (!best) continue
    const pairKey = `${candidate.id}:${best.source.id}`
    if (usedPairs.has(pairKey)) continue
    usedCandidates.add(candidate.id)
    usedPairs.add(pairKey)
    patches.push({
      id: `fallback_citation_${Date.now()}_${patches.length}`,
      candidateId: candidate.id,
      sectionId: section.id,
      sectionTitle: section.title,
      claimType: 'assertion',
      originalText: candidate.text,
      revisedText: candidate.text,
      problem: '该论述适合补充可核验文献来源。',
      reason: `本地校准根据正文关键词与来源题名、摘要或证据说明的重合度匹配；未改写原观点，仅补充脚注来源。`,
      enhancementType: 'claim',
      applyMode: 'citation_only',
      confidence: Math.max(0.55, Math.min(0.78, best.score)),
      source: {
        id: best.source.id,
        title: best.source.title,
        authors: best.source.authors ?? [],
        year: best.source.year,
        journal: best.source.journal || best.source.source,
        doi: best.source.doi,
        url: best.source.url,
        noteText: sourceNote(best.source),
      },
    })
  }

  return patches
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
    res.json({ ok: true, patches: [], auditNote: '当前没有同时具备作者信息和可打开 DOI/URL 的来源，未生成引用增强补丁。', skipped: ['缺少具备作者与可点击出处的来源'] })
    return
  }

  const targetFinalCitationCount = Math.min(Math.max(Number(req.body?.targetFinalCitationCount ?? 30), 12), 80)
  const minPatchCount = Math.min(Math.max(Number(req.body?.minPatchCount ?? 8), 1), 24)
  const idealPatchCount = Math.min(Math.max(Number(req.body?.idealPatchCount ?? 12), minPatchCount), 32)
  const candidates = extractCitationCandidates(sections, 100)

  if (candidates.length === 0) {
    res.json({
      ok: true,
      patches: [],
      auditNote: '正文中暂未识别到适合补引用的论证句。摘要、题目、关键词和标题已自动跳过。',
      skipped: ['未识别到理论、方法、研究现状或关键判断类候选句'],
    })
    return
  }

  if (req.body?.fallbackOnly === true && process.env.NODE_ENV !== 'production') {
    const fallbackPatches = fallbackCitationPatches(sections, sources, candidates, [], minPatchCount)
    res.json({
      ok: true,
      patches: fallbackPatches,
      auditNote: `本地引用校准生成 ${fallbackPatches.length} 条可审核建议；未改写观点，仅绑定真实来源。`,
      skipped: fallbackPatches.length < minPatchCount ? ['可匹配的正文观点或来源证据不足。'] : [],
    })
    return
  }

  try {
    const baseInput = {
      projectTitle: String(req.body?.projectTitle ?? ''),
      researchObject: String(req.body?.researchObject ?? ''),
      citationFormat: String(req.body?.citationFormat ?? ''),
      targetFinalCitationCount,
      minPatchCount,
      idealPatchCount,
      sections: sections.slice(0, 24),
      candidates,
      sources: sources.slice(0, 60),
      evidencePack: req.body?.evidencePack,
    }

    const raw = await callAIOnce(buildEnhancementPrompt(baseInput), 'gpt', 6500)
    const parsed = extractJsonObject(raw)
    let patches: NormalizedPatch[] = Array.isArray(parsed.patches)
      ? parsed.patches
        .map((patch, index) => normalizePatch(patch, sections, sources, candidates, index))
        .filter((patch): patch is NormalizedPatch => Boolean(patch))
      : []
    let skipped = Array.isArray(parsed.skipped) ? parsed.skipped.map(String).slice(0, 12) : []

    patches = mergePatches(patches)

    if (patches.length < minPatchCount && candidates.length >= minPatchCount && sources.length >= Math.min(8, minPatchCount)) {
      const existingCandidateIds = patches.map(patch => patch.candidateId).filter((id): id is string => Boolean(id))
      const fillInput = {
        ...baseInput,
        minPatchCount: minPatchCount - patches.length,
        idealPatchCount: Math.max(minPatchCount - patches.length, idealPatchCount - patches.length),
        existingCandidateIds,
        mode: 'fill' as const,
      }
      const fillRaw = await callAIOnce(buildEnhancementPrompt(fillInput), 'gpt', 4200)
      const fillParsed = extractJsonObject(fillRaw)
      const extraPatches = Array.isArray(fillParsed.patches)
        ? fillParsed.patches
          .map((patch, index) => normalizePatch(patch, sections, sources, candidates, patches.length + index))
          .filter((patch): patch is NormalizedPatch => Boolean(patch))
        : []
      patches = mergePatches([...patches, ...extraPatches])
      if (Array.isArray(fillParsed.skipped)) {
        skipped = [...skipped, ...fillParsed.skipped.map(String)].slice(0, 12)
      }
    }

    if (patches.length < minPatchCount) {
      patches = mergePatches([
        ...patches,
        ...fallbackCitationPatches(sections, sources, candidates, patches, minPatchCount - patches.length),
      ])
    }

    const finalPatches = patches.slice(0, 32)
    const shortfallNote = finalPatches.length < minPatchCount
      ? `本轮仅形成 ${finalPatches.length} 条可安全落点的建议，低于目标 ${minPatchCount} 条；主要原因通常是正文候选句或可匹配来源不足。`
      : `已生成 ${finalPatches.length} 条引用增强建议，目标为至少 ${minPatchCount} 条、理想 ${idealPatchCount} 条。`

    res.json({
      ok: true,
      patches: finalPatches,
      auditNote: finalPatches.length < minPatchCount ? shortfallNote : String(parsed.auditNote ?? shortfallNote),
      skipped: finalPatches.length < minPatchCount ? [...skipped, shortfallNote].slice(0, 12) : skipped,
    })
  } catch (error) {
    const fallbackPatches = fallbackCitationPatches(sections, sources, candidates, [], minPatchCount)
    if (fallbackPatches.length > 0) {
      res.json({
        ok: true,
        patches: fallbackPatches,
        auditNote: `AI 引用校准暂时失败，已生成 ${fallbackPatches.length} 条保守引用建议；未改写观点，仅绑定真实来源。`,
        skipped: [error instanceof Error ? error.message : String(error)].slice(0, 1),
      })
      return
    }
    res.json({
      ok: true,
      patches: [],
      auditNote: 'AI 引用校准暂时失败，且没有找到可安全匹配的来源；未自动插入引用。',
      skipped: [error instanceof Error ? error.message : String(error)].slice(0, 1),
    })
  }
})

export default router
