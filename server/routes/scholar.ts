import { Router } from 'express'
import { callAIOnce, type Message } from '../lib/ai.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

interface OpenAlexWork {
  id?: string
  doi?: string
  title?: string
  display_name?: string
  publication_year?: number
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]>
  authorships?: Array<{
    author?: {
      display_name?: string
    }
  }>
  primary_location?: {
    source?: {
      display_name?: string
    }
    landing_page_url?: string
  }
  locations?: Array<{
    landing_page_url?: string
  }>
}

interface CrossrefWork {
  DOI?: string
  URL?: string
  title?: string[]
  author?: Array<{
    given?: string
    family?: string
  }>
  issued?: {
    'date-parts'?: number[][]
  }
  'container-title'?: string[]
  abstract?: string
  'is-referenced-by-count'?: number
}

function abstractFromInvertedIndex(index?: Record<string, number[]>): string {
  if (!index) return ''
  const words: Array<{ word: string; position: number }> = []
  Object.entries(index).forEach(([word, positions]) => {
    positions.forEach(position => words.push({ word, position }))
  })
  return words
    .sort((a, b) => a.position - b.position)
    .map(item => item.word)
    .join(' ')
}

function normalizeOpenAlexWork(work: OpenAlexWork) {
  const authors = work.authorships
    ?.map(item => item.author?.display_name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 5) ?? []
  const url = work.primary_location?.landing_page_url || work.locations?.find(item => item.landing_page_url)?.landing_page_url || work.id || ''
  return {
    id: work.id ?? work.doi ?? work.title ?? '',
    title: work.title || work.display_name || 'Untitled',
    authors,
    year: work.publication_year,
    source: work.primary_location?.source?.display_name ?? '',
    doi: work.doi ?? '',
    url,
    citedByCount: work.cited_by_count ?? 0,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
  }
}

function normalizeCrossrefWork(work: CrossrefWork) {
  const authors = work.author
    ?.map(author => [author.given, author.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 5) ?? []
  const year = work.issued?.['date-parts']?.[0]?.[0]
  return {
    id: work.DOI ? `https://doi.org/${work.DOI}` : work.URL ?? work.title?.[0] ?? '',
    title: work.title?.[0] ?? 'Untitled',
    authors,
    year,
    source: work['container-title']?.[0] ?? '',
    doi: work.DOI ? `https://doi.org/${work.DOI}` : '',
    url: work.URL ?? (work.DOI ? `https://doi.org/${work.DOI}` : ''),
    citedByCount: work['is-referenced-by-count'] ?? 0,
    abstract: work.abstract?.replace(/<[^>]+>/g, '').trim() ?? '',
  }
}

type ScholarPaper = ReturnType<typeof normalizeOpenAlexWork> & {
  relevanceReason?: string
}

interface CitationEvidencePoint {
  claim: string
  sourceIds: string[]
  writingUse: string
}

interface CitationChapterEvidence {
  chapterTitle: string
  sourceIds: string[]
  writingPlan: string
  keyPoints: CitationEvidencePoint[]
}

interface CitationGoal {
  targetFinalCitationCount: number
  minAcceptableCitationCount: number
  maxCitationCount: number
  firstDraftCitationCount: number
  usableSourceCount: number
}

interface CitationChapterPlan {
  sectionTitle: string
  targetCitationCount: number
  firstDraftCitationCount: number
  theorySourceIds: string[]
  literatureSourceIds: string[]
  methodSourceIds: string[]
  caseSourceIds: string[]
  mustUseSourceIds: string[]
  avoidSourceIds: string[]
  writingGuidance: string
}

interface CitationEvidencePack {
  citationGoal?: CitationGoal
  theoryConcepts: CitationEvidencePoint[]
  literatureReview: CitationEvidencePoint[]
  methodSupport: CitationEvidencePoint[]
  caseEvidence: CitationEvidencePoint[]
  chapterEvidence: CitationChapterEvidence[]
  chapterCitationPlans?: CitationChapterPlan[]
  rejectedSourceIds: string[]
  cautions: string[]
  summary: string
}

function stableSourceId(source: ScholarPaper) {
  return source.doi || source.id || source.url || source.title
}

function dedupePapers(papers: ScholarPaper[]) {
  const seen = new Set<string>()
  return papers.filter(paper => {
    const key = stableSourceId(paper).toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function interleavePaperBatches(batches: ScholarPaper[][]) {
  const results: ScholarPaper[] = []
  const maxLength = Math.max(0, ...batches.map(batch => batch.length))
  for (let index = 0; index < maxLength; index += 1) {
    batches.forEach(batch => {
      if (batch[index]) results.push(batch[index])
    })
  }
  return results
}

function scoreCandidateForFallback(paper: ScholarPaper, queryText: string) {
  const haystack = `${paper.title} ${paper.source ?? ''} ${paper.abstract ?? ''}`.toLowerCase()
  const tokens = queryText
    .toLowerCase()
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .filter(token => token.length >= 2)
    .slice(0, 60)
  const relevance = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
  const citationWeight = Math.log10((paper.citedByCount ?? 0) + 1)
  const abstractWeight = paper.abstract?.trim() ? 2 : 0
  return relevance * 4 + citationWeight + abstractWeight
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function fallbackQueries(title: string, outline: string, researchObject = '') {
  const outlineHeadings = outline
    .split('\n')
    .map(line => line.replace(/^[\s\d.、（()一二三四五六七八九十章节]+/, '').trim())
    .filter(Boolean)
    .slice(0, 12)
  const seed = [title, researchObject, outlineHeadings.slice(0, 3).join(' ')].filter(Boolean).join(' ')
  const objectOrTitle = researchObject || title
  return Array.from(new Set([
    seed,
    objectOrTitle,
    `${objectOrTitle} 美学 艺术 研究`,
    `${objectOrTitle} 中国 西方 绘画 美学`,
    `${title} literature review`,
    `${objectOrTitle} art aesthetics painting research`,
    ...outlineHeadings.slice(0, 4).map(heading => `${objectOrTitle} ${heading}`),
  ].map(item => item.trim()).filter(Boolean))).slice(0, 12)
}

async function generateSearchQueries(title: string, outline: string, researchObject: string, academicLevel: string) {
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是学术论文检索策略助手。请根据论文题目、大纲和研究对象生成 6 个适合 OpenAlex/Crossref 的检索式。
要求：
- 优先使用核心概念、研究对象、学科关键词；
- 覆盖不同角度：理论概念、研究对象、章节主题、方法/案例、中文关键词、英文关键词；
- 不要 6 条都只改同义词，避免检索结果集中在同几篇文献；
- 可以中英混合，但每条不要太长；
- 只输出 JSON：{"queries":["...","...","...","...","...","..."]}`,
    },
    {
      role: 'user',
      content: `题目：${title}\n学段：${academicLevel || '未指定'}\n研究对象：${researchObject || '未指定'}\n大纲：\n${outline.slice(0, 3000)}`,
    },
  ]

  try {
    const response = await callAIOnce(messages, 'gpt')
    const parsed = extractJsonObject(response)
    const queries = Array.isArray(parsed?.queries) ? parsed.queries.map(String).filter(Boolean) : []
    return queries.length > 0 ? Array.from(new Set([...queries, ...fallbackQueries(title, outline, researchObject)])).slice(0, 12) : fallbackQueries(title, outline, researchObject)
  } catch {
    return fallbackQueries(title, outline, researchObject)
  }
}

async function selectSourcesWithAI(params: {
  title: string
  outline: string
  researchObject: string
  academicLevel: string
  candidates: ScholarPaper[]
  limit: number
}): Promise<{ autoSources: ScholarPaper[]; auditNote: string }> {
  const candidateText = params.candidates.map((paper, index) => [
    `C${index + 1}. ${paper.title}`,
    paper.authors.length ? `作者：${paper.authors.join('、')}` : '',
    paper.year ? `年份：${paper.year}` : '',
    paper.source ? `来源：${paper.source}` : '',
    paper.citedByCount ? `引用数：${paper.citedByCount}` : '',
    paper.abstract ? `摘要：${paper.abstract.slice(0, 600)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是论文文献筛选助手。请从候选文献中选出最适合支撑论文正文的文献。
筛选规则：
- 只允许选择候选编号，不要编造新文献；
- 优先选择与题目/研究对象/章节逻辑直接相关的文献；
- 兼顾理论背景、研究现状、案例/对象分析、方法支持；
- 输出 JSON：{"selected":[{"candidateId":"C1","relevanceReason":"一句话说明可用于哪里"}],"auditNote":"整体引用策略一句话"}`,
    },
    {
      role: 'user',
      content: `题目：${params.title}\n学段：${params.academicLevel || '未指定'}\n研究对象：${params.researchObject || '未指定'}\n大纲：\n${params.outline.slice(0, 3000)}\n\n候选文献：\n${candidateText}`,
    },
  ]

  try {
    const response = await callAIOnce(messages, 'gpt')
    const parsed = extractJsonObject(response)
    const selected = Array.isArray(parsed?.selected) ? parsed.selected : []
    const sourceByCandidateId = new Map(params.candidates.map((paper, index) => [`C${index + 1}`, paper]))
    const autoSources: ScholarPaper[] = selected
      .map<ScholarPaper | null>(item => {
        if (!item || typeof item !== 'object') return null
        const selection = item as Record<string, unknown>
        const source = sourceByCandidateId.get(String(selection.candidateId))
        if (!source) return null
        return {
          ...source,
          relevanceReason: String(selection.relevanceReason ?? '').slice(0, 180),
        }
      })
      .filter((item: ScholarPaper | null): item is ScholarPaper => Boolean(item))
      .slice(0, params.limit)
    if (autoSources.length > 0) {
      return { autoSources, auditNote: String(parsed?.auditNote ?? '') }
    }
  } catch {
    // Fall through to deterministic ranking.
  }

  return {
    autoSources: params.candidates
      .slice()
      .sort((a, b) =>
        scoreCandidateForFallback(b, `${params.title} ${params.researchObject} ${params.outline}`)
        - scoreCandidateForFallback(a, `${params.title} ${params.researchObject} ${params.outline}`)
      )
      .slice(0, params.limit)
      .map(source => ({ ...source, relevanceReason: '系统根据检索相关性和引用信息自动选入。' })),
    auditNote: 'AI筛选不可用，已使用检索相关性与引用量排序作为降级策略。',
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : []
}

function citationGoal(input?: Partial<CitationGoal>): CitationGoal {
  const targetFinalCitationCount = Math.min(Math.max(Number(input?.targetFinalCitationCount ?? 30), 15), 60)
  const firstDraftCitationCount = Math.min(
    Math.max(Number(input?.firstDraftCitationCount ?? Math.round(targetFinalCitationCount * 0.55)), 8),
    targetFinalCitationCount
  )
  return {
    targetFinalCitationCount,
    minAcceptableCitationCount: Math.min(Math.max(Number(input?.minAcceptableCitationCount ?? 25), 10), targetFinalCitationCount),
    maxCitationCount: Math.max(Number(input?.maxCitationCount ?? 40), targetFinalCitationCount),
    firstDraftCitationCount,
    usableSourceCount: Math.min(Math.max(Number(input?.usableSourceCount ?? 40), targetFinalCitationCount), 60),
  }
}

function outlineChapterTitles(outline: string): string[] {
  return outline
    .split('\n')
    .map(line => line.replace(/^[\s\d.、（）()一二三四五六七八九十章节篇部]+/, '').trim())
    .filter(Boolean)
    .filter(line => line.length <= 80)
    .slice(0, 16)
}

function buildFallbackChapterPlans(
  outline: string,
  autoSources: ScholarPaper[],
  goal: CitationGoal
): CitationChapterPlan[] {
  const titles = outlineChapterTitles(outline)
  const sourceIds = autoSources.map(stableSourceId).filter(Boolean)
  if (titles.length === 0) return []
  const weights: number[] = titles.map((title, index) => {
    if (/摘要|关键词|题目|目录|参考文献|致谢|附录/i.test(title)) return 0
    if (/绪论|引言|文献|综述|理论|方法|模型/i.test(title)) return 2
    return index === titles.length - 1 ? 1 : 1.5
  })
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1

  return titles.map((title, index) => {
    const weight = weights[index] ?? 0
    const targetCitationCount = weight === 0 ? 0 : Math.max(1, Math.round((goal.targetFinalCitationCount * weight) / totalWeight))
    const firstDraftCitationCount = weight === 0 ? 0 : Math.max(1, Math.round((goal.firstDraftCitationCount * weight) / totalWeight))
    const rotated = sourceIds.slice(index).concat(sourceIds.slice(0, index))
    return {
      sectionTitle: title,
      targetCitationCount,
      firstDraftCitationCount,
      theorySourceIds: rotated.slice(0, 4),
      literatureSourceIds: rotated.slice(2, 8),
      methodSourceIds: /方法|模型|分析|评价|量化|统计|问卷|访谈/i.test(title) ? rotated.slice(0, 6) : [],
      caseSourceIds: /案例|对象|分析|实践|作品|图像|设计/i.test(title) ? rotated.slice(4, 10) : [],
      mustUseSourceIds: rotated.slice(0, Math.min(3, firstDraftCitationCount)),
      avoidSourceIds: [],
      writingGuidance: targetCitationCount > 0
        ? `本章最终建议约 ${targetCitationCount} 处引用，第一版正文先稳定使用 ${firstDraftCitationCount} 处左右，优先放在理论定义、研究现状、方法依据和关键判断后。`
        : '本部分不建议插入正文引用。',
    }
  })
}

function normalizeEvidencePoints(value: unknown, allowedIds: Set<string>): CitationEvidencePoint[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map(item => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const sourceIds = normalizeStringArray(raw.sourceIds).filter(id => allowedIds.has(id)).slice(0, 4)
    return {
      claim: String(raw.claim ?? '').trim().slice(0, 220),
      sourceIds,
      writingUse: String(raw.writingUse ?? '').trim().slice(0, 220),
    }
  }).filter(point => point.claim)
}

function normalizeCitationGoal(value: unknown): CitationGoal | undefined {
  if (!value || typeof value !== 'object') return undefined
  return citationGoal(value as Partial<CitationGoal>)
}

function normalizeChapterPlans(value: unknown, allowedIds: Set<string>, fallbackPlans: CitationChapterPlan[]): CitationChapterPlan[] {
  if (!Array.isArray(value)) return fallbackPlans
  const plans = value.slice(0, 24).map(item => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const sectionTitle = String(raw.sectionTitle ?? raw.chapterTitle ?? '').trim().slice(0, 120)
    if (!sectionTitle) return null
    return {
      sectionTitle,
      targetCitationCount: Math.max(0, Math.min(12, Number(raw.targetCitationCount ?? 3))),
      firstDraftCitationCount: Math.max(0, Math.min(6, Number(raw.firstDraftCitationCount ?? 2))),
      theorySourceIds: normalizeStringArray(raw.theorySourceIds).filter(id => allowedIds.has(id)).slice(0, 8),
      literatureSourceIds: normalizeStringArray(raw.literatureSourceIds).filter(id => allowedIds.has(id)).slice(0, 8),
      methodSourceIds: normalizeStringArray(raw.methodSourceIds).filter(id => allowedIds.has(id)).slice(0, 8),
      caseSourceIds: normalizeStringArray(raw.caseSourceIds).filter(id => allowedIds.has(id)).slice(0, 8),
      mustUseSourceIds: normalizeStringArray(raw.mustUseSourceIds).filter(id => allowedIds.has(id)).slice(0, 6),
      avoidSourceIds: normalizeStringArray(raw.avoidSourceIds).filter(id => allowedIds.has(id)).slice(0, 8),
      writingGuidance: String(raw.writingGuidance ?? '').trim().slice(0, 360),
    }
  }).filter((item): item is CitationChapterPlan => Boolean(item))
  return plans.length > 0 ? plans : fallbackPlans
}

function normalizeEvidencePack(value: unknown, allowedIds: Set<string>): CitationEvidencePack | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const normalizedGoal = normalizeCitationGoal(raw.citationGoal) ?? citationGoal()
  const chapterEvidence = Array.isArray(raw.chapterEvidence)
    ? raw.chapterEvidence.slice(0, 16).map(item => {
        const chapter = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return {
          chapterTitle: String(chapter.chapterTitle ?? '').trim().slice(0, 120),
          sourceIds: normalizeStringArray(chapter.sourceIds).filter(id => allowedIds.has(id)).slice(0, 6),
          writingPlan: String(chapter.writingPlan ?? '').trim().slice(0, 260),
          keyPoints: normalizeEvidencePoints(chapter.keyPoints, allowedIds).slice(0, 6),
        }
      }).filter(item => item.chapterTitle || item.keyPoints.length)
    : []

  return {
    citationGoal: normalizedGoal,
    theoryConcepts: normalizeEvidencePoints(raw.theoryConcepts, allowedIds),
    literatureReview: normalizeEvidencePoints(raw.literatureReview, allowedIds),
    methodSupport: normalizeEvidencePoints(raw.methodSupport, allowedIds),
    caseEvidence: normalizeEvidencePoints(raw.caseEvidence, allowedIds),
    chapterEvidence,
    chapterCitationPlans: normalizeChapterPlans(raw.chapterCitationPlans, allowedIds, []),
    rejectedSourceIds: normalizeStringArray(raw.rejectedSourceIds).filter(id => allowedIds.has(id)).slice(0, 20),
    cautions: normalizeStringArray(raw.cautions).slice(0, 8),
    summary: String(raw.summary ?? '').trim().slice(0, 420),
  }
}

function fallbackEvidencePack(autoSources: ScholarPaper[], outline: string, inputGoal?: Partial<CitationGoal>): CitationEvidencePack {
  const goal = citationGoal(inputGoal)
  const sourceIds = autoSources.map(stableSourceId).filter(Boolean)
  const chapterTitles = outline
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8)

  return {
    citationGoal: goal,
    theoryConcepts: autoSources.slice(0, 3).map(source => ({
      claim: source.abstract ? source.abstract.slice(0, 160) : `${source.title} 可作为概念、理论或研究背景参考。`,
      sourceIds: [stableSourceId(source)],
      writingUse: '用于概念界定、理论背景或研究现状铺垫。',
    })),
    literatureReview: autoSources.slice(0, 5).map(source => ({
      claim: `${source.title} 可用于说明相关研究基础与已有讨论。`,
      sourceIds: [stableSourceId(source)],
      writingUse: '用于引言、文献综述或章节开头的研究现状说明。',
    })),
    methodSupport: [],
    caseEvidence: [],
    chapterEvidence: chapterTitles.map(title => ({
      chapterTitle: title,
      sourceIds: sourceIds.slice(0, 5),
      writingPlan: '结合本章标题选择相关文献，先交代已有研究，再落到论文对象分析。',
      keyPoints: [],
    })),
    chapterCitationPlans: buildFallbackChapterPlans(outline, autoSources, goal),
    rejectedSourceIds: [],
    cautions: ['部分开放文献只有题录或摘要信息，正式提交前建议人工核对原文、页码与参考文献格式。'],
    summary: autoSources.length
      ? `系统已整理 ${autoSources.length} 条候选来源，可作为全文初稿的理论、现状和分析依据。`
      : '未形成可靠证据包。',
  }
}

async function buildEvidencePackWithAI(params: {
  title: string
  outline: string
  researchObject: string
  academicLevel: string
  autoSources: ScholarPaper[]
  citationGoal: CitationGoal
}): Promise<CitationEvidencePack> {
  if (params.autoSources.length === 0) return fallbackEvidencePack([], params.outline, params.citationGoal)
  const allowedIds = new Set(params.autoSources.map(stableSourceId).filter(Boolean))
  const sourceText = params.autoSources.map((source, index) => [
    `S${index + 1}`,
    `sourceId: ${stableSourceId(source)}`,
    `题名: ${source.title}`,
    source.authors.length ? `作者: ${source.authors.join('、')}` : '',
    source.year ? `年份: ${source.year}` : '',
    source.source ? `来源: ${source.source}` : '',
    source.relevanceReason ? `筛选理由: ${source.relevanceReason}` : '',
    source.abstract ? `摘要: ${source.abstract.slice(0, 900)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是论文文献预研助手。请把已筛选文献整理成“论文证据包”，用于先读文献再生成正文。
要求：
- 只能使用用户给出的 sourceId，不要编造新文献；
- 不要写正文，只提炼可服务写作的证据、观点、章节用途；
- 如果来源只适合背景理解或相关性较弱，放入 cautions 或 rejectedSourceIds；
- 输出严格 JSON，不要代码块。
JSON 格式：
{
  "theoryConcepts":[{"claim":"可用于概念/理论界定的证据点","sourceIds":["sourceId"],"writingUse":"适合放在哪类段落"}],
  "literatureReview":[{"claim":"可用于研究现状的证据点","sourceIds":["sourceId"],"writingUse":"适合放在哪类段落"}],
  "methodSupport":[{"claim":"可用于方法依据的证据点","sourceIds":["sourceId"],"writingUse":"适合放在哪类段落"}],
  "caseEvidence":[{"claim":"可用于案例/对象分析的证据点","sourceIds":["sourceId"],"writingUse":"适合放在哪类段落"}],
  "chapterEvidence":[{"chapterTitle":"大纲章节名","sourceIds":["sourceId"],"writingPlan":"本章如何用证据组织论证","keyPoints":[{"claim":"本章可写证据点","sourceIds":["sourceId"],"writingUse":"写作位置"}]}],
  "rejectedSourceIds":["sourceId"],
  "cautions":["引用风险或核对提醒"],
  "summary":"整体证据包摘要"
}`,
    },
    {
      role: 'user',
      content: `题目：${params.title}
学段：${params.academicLevel || '未指定'}
研究对象：${params.researchObject || '未指定'}
大纲：
${params.outline.slice(0, 4000)}

已筛选文献：
${sourceText}`,
    },
  ]

  try {
    const response = await callAIOnce(messages, 'gpt')
    const parsed = extractJsonObject(response)
    const normalized = normalizeEvidencePack(parsed, allowedIds)
    return normalized
      ? {
          ...normalized,
          citationGoal: normalized.citationGoal ?? params.citationGoal,
          chapterCitationPlans: normalized.chapterCitationPlans?.length
            ? normalized.chapterCitationPlans
            : buildFallbackChapterPlans(params.outline, params.autoSources, params.citationGoal),
        }
      : fallbackEvidencePack(params.autoSources, params.outline, params.citationGoal)
  } catch {
    return fallbackEvidencePack(params.autoSources, params.outline, params.citationGoal)
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function searchOpenAlex(query: string, limit: number) {
  const params = new URLSearchParams({
    search: query,
    'per-page': String(limit),
    sort: 'relevance_score:desc',
  })
  const response = await fetchWithTimeout(`https://api.openalex.org/works?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'paper-ai-tool/1.0 (mailto:demo@example.com)',
    },
  }, 6000)
  if (!response.ok) {
    throw new Error(`OpenAlex search failed: ${response.statusText}`)
  }
  const data = await response.json() as { results?: OpenAlexWork[] }
  return (data.results ?? []).map(normalizeOpenAlexWork)
}

async function searchCrossref(query: string, limit: number) {
  const params = new URLSearchParams({
    'query.bibliographic': query,
    rows: String(limit),
  })
  const response = await fetchWithTimeout(`https://api.crossref.org/works?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'paper-ai-tool/1.0 (mailto:demo@example.com)',
    },
  }, 10000)
  if (!response.ok) {
    throw new Error(`Crossref search failed: ${response.statusText}`)
  }
  const data = await response.json() as { message?: { items?: CrossrefWork[] } }
  return (data.message?.items ?? []).map(normalizeCrossrefWork)
}

router.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const limit = Math.min(Math.max(Number(req.query.limit ?? 12), 1), 25)

  if (!query) {
    res.status(400).json({ error: 'Missing search query' })
    return
  }

  try {
    const results = await searchOpenAlex(query, limit)
    if (results.length > 0) {
      res.json({ provider: 'OpenAlex', query, results })
      return
    }
    const fallbackResults = await searchCrossref(query, limit)
    res.json({ provider: 'Crossref', query, results: fallbackResults })
  } catch (error) {
    try {
      const fallbackResults = await searchCrossref(query, limit)
      res.json({ provider: 'Crossref', query, results: fallbackResults })
    } catch (fallbackError) {
      res.status(500).json({
        error: [
          error instanceof Error ? error.message : 'OpenAlex search failed',
          fallbackError instanceof Error ? fallbackError.message : 'Crossref search failed',
        ].join('；'),
      })
    }
  }
})

router.post('/prepare', requireAuth, async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
  const outline = typeof req.body.outline === 'string' ? req.body.outline.trim() : ''
  const researchObject = typeof req.body.researchObject === 'string' ? req.body.researchObject.trim() : ''
  const academicLevel = typeof req.body.academicLevel === 'string' ? req.body.academicLevel.trim() : ''
  const goal = citationGoal({
    targetFinalCitationCount: Number(req.body.targetFinalCitationCount ?? 30),
    firstDraftCitationCount: Number(req.body.firstDraftCitationCount ?? 16),
    usableSourceCount: Number(req.body.limit ?? 40),
  })
  const limit = Math.min(Math.max(Number(req.body.limit ?? goal.usableSourceCount), 12), 50)

  if (!title && !outline) {
    res.status(400).json({ error: 'Missing title or outline' })
    return
  }

  const queries = await generateSearchQueries(title, outline, researchObject, academicLevel)
  const batches = await Promise.all(queries.map(async query => {
    try {
      const openAlex = await searchOpenAlex(query, 12)
      if (openAlex.length > 0) return openAlex
      return searchCrossref(query, 12)
    } catch {
      try {
        return await searchCrossref(query, 12)
      } catch {
        return []
      }
    }
  }))

  const candidates = dedupePapers(interleavePaperBatches(batches)).slice(0, 100)
  if (candidates.length === 0) {
    res.json({
      provider: 'OpenAlex/Crossref',
      queries,
      candidates: [],
      autoSources: [],
      evidencePack: fallbackEvidencePack([], outline, goal),
      auditNote: '未检索到可靠候选文献，本次生成不会自动插入引用。',
    })
    return
  }

  const { autoSources, auditNote } = await selectSourcesWithAI({
    title,
    outline,
    researchObject,
    academicLevel,
    candidates,
    limit,
  })
  const evidencePack = await buildEvidencePackWithAI({
    title,
    outline,
    researchObject,
    academicLevel,
    autoSources,
    citationGoal: goal,
  })

  res.json({
    provider: 'OpenAlex/Crossref',
    queries,
    candidates: candidates.slice(0, 12),
    autoSources,
    evidencePack,
    auditNote,
  })
})

export default router
