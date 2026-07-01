import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, BookMarked, BookOpen, Check, FileText, Layers, Lightbulb, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import {
  libraryStore,
  projectStore,
  referenceStore,
  sectionStore,
  type CitationEvidencePack,
  type CitationEvidencePoint,
  type CitationEvidenceSource,
  type LibraryItem,
  type ReferenceSelection,
  type WorkflowStage,
} from '../lib/storage'
import { referencesAPI, scholarAPI, type ScholarPaper } from '../lib/api'
import { isFrontMatterTitle } from '../lib/academicFormat'
import { parsePaperBlocks } from '../lib/documentFormat'

type ClaimType = 'definition' | 'literature' | 'method' | 'comparison' | 'trend' | 'assertion'
type CitationFormat = 'footnote' | 'gbt7714' | 'apa' | 'mla' | 'chicago'
type EnhancementStatus = 'idle' | 'running' | 'done'

export interface CitationPatchDraft {
  id: string
  sectionId: string
  sectionTitle: string
  claimType: ClaimType
  originalText: string
  revisedText: string
  source: {
    id: string
    title: string
    authors: string[]
    year?: number
    journal?: string
    doi?: string
    url?: string
    noteText: string
  }
  reason: string
  problem?: string
  enhancementType?: string
  applyMode?: 'rewrite_with_citation' | 'citation_only' | string
  confidence: number
}

export interface EvidenceCardAction {
  id: string
  claim: string
  writingUse: string
  usableFor: ClaimType
  source: {
    id: string
    title: string
    noteText: string
  }
}

interface ReferencePanelProps {
  projectId: string
  stage: WorkflowStage
  open: boolean
  onClose: () => void
  onChange?: (selection: ReferenceSelection) => void
  onApplyToActiveSection?: () => void
  onApplyCitationPatches?: (patches: CitationPatchDraft[]) => void
  onInsertEvidenceCard?: (evidence: EvidenceCardAction) => void
  onUseEvidenceForRewrite?: (evidence: EvidenceCardAction) => void
  autoStartEnhancementKey?: number
}

interface ScholarCandidate extends ScholarPaper {
  provider?: string
  savedItemId?: string
}

interface SourceCard {
  id: string
  title: string
  authors: string[]
  year?: number
  source?: string
  doi?: string
  url?: string
  abstract?: string
  provider?: string
  citedByCount?: number
  relevanceReason?: string
  noteText: string
  origin: 'auto' | 'manual'
}

interface EvidenceCard {
  id: string
  sourceId: string
  claim: string
  writingUse: string
  usableFor: ClaimType
  chapterTitle?: string
  confidence: number
}

function normalizeDoi(value: string | undefined) {
  return String(value ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
}

function sourceExternalUrl(source: { doi?: string; url?: string }) {
  const doi = normalizeDoi(source.doi)
  if (doi) return `https://doi.org/${doi}`
  const url = String(source.url ?? '').trim()
  return /^https?:\/\//i.test(url) ? url : ''
}

function hasVerifiableCitationSource(source: { title?: string; authors?: string[]; doi?: string; url?: string }) {
  return Boolean(source.title?.trim() && source.authors?.length && sourceExternalUrl(source))
}

const claimTypeLabels: Record<ClaimType, string> = {
  definition: '概念定义',
  literature: '研究现状',
  method: '方法依据',
  comparison: '比较判断',
  trend: '趋势判断',
  assertion: '观点判断',
}

const citationFormatLabels: Record<CitationFormat, string> = {
  footnote: '脚注说明',
  gbt7714: 'GB/T 7714',
  apa: 'APA',
  mla: 'MLA',
  chicago: 'Chicago',
}

function uid(prefix = 'citation_patch') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function buildScholarQuery(
  projectTitle: string,
  context: { researchObject?: string; coreArguments?: string[] } | null
): string {
  return [
    projectTitle,
    context?.researchObject,
    context?.coreArguments?.slice(0, 3).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/[《》“”'【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function scholarPaperToLibraryText(paper: ScholarPaper): string {
  return [
    `标题：${paper.title}`,
    paper.authors.length ? `作者：${paper.authors.join('、')}` : '',
    paper.year ? `年份：${paper.year}` : '',
    paper.source ? `来源：${paper.source}` : '',
    paper.doi ? `DOI：${paper.doi}` : '',
    paper.url ? `链接：${paper.url}` : '',
    paper.citedByCount !== undefined ? `OpenAlex引用次数：${paper.citedByCount}` : '',
    '',
    paper.abstract ? `摘要：\n${paper.abstract}` : '摘要：暂无公开摘要。',
    '',
    '使用提醒：该条目来自论文搜索结果，写作前建议用户核对原文、页码与最终参考文献格式。',
  ].filter(Boolean).join('\n')
}

function noteTextFromLibraryItem(item: LibraryItem) {
  const title = item.title.trim()
  const fileHint = item.fileName ? ` ${item.fileName.replace(/\.[^.]+$/, '')}` : ''
  if (item.summary?.trim()) return `${title}${fileHint}. ${item.summary.trim().slice(0, 180)}`
  if (item.text?.trim()) return `${title}${fileHint}. ${item.text.trim().slice(0, 180)}`
  return `${title}${fileHint}.`
}

function noteTextFromSource(source: CitationEvidenceSource) {
  const authors = source.authors?.length ? `${source.authors.slice(0, 3).join('、')}. ` : ''
  const year = source.year ? `${source.year}` : '年份未详'
  const publication = source.source ? ` ${source.source}` : ''
  const doi = source.doi ? ` DOI：${source.doi}` : ''
  const url = source.url && !source.doi ? ` ${source.url}` : ''
  return `${authors}${source.title}. ${year}.${publication}${doi || url}`.replace(/\s+/g, ' ').trim()
}

function formatAuthorList(authors: string[], fallback = '作者未详') {
  if (authors.length === 0) return fallback
  if (authors.length <= 3) return authors.join('、')
  return `${authors.slice(0, 3).join('、')}等`
}

function formatCitationNote(source: CitationPatchDraft['source'], format: CitationFormat) {
  const authors = formatAuthorList(source.authors)
  const year = source.year ? `${source.year}` : '年份未详'
  const journal = source.journal ? ` ${source.journal}` : ''
  const doi = source.doi ? ` DOI：${source.doi}` : ''
  const url = source.url && !source.doi ? ` ${source.url}` : ''

  if (format === 'gbt7714') {
    return `${authors}. ${source.title}[J].${journal ? journal.trim() : '出版物未详'}, ${year}.${doi || url}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'apa') {
    return `${authors}. (${year}). ${source.title}.${journal ? journal : ' Publication unavailable.'}${source.doi ? ` https://doi.org/${source.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : url}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'mla') {
    return `${authors}. "${source.title}."${journal ? journal : ' Publication unavailable'}, ${year}.${doi || url}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'chicago') {
    return `${authors}. "${source.title}."${journal ? journal : ' Publication unavailable'} (${year}).${doi || url}`.replace(/\s+/g, ' ').trim()
  }
  return source.noteText
}

void formatCitationNote

function withCitationFormat(patches: CitationPatchDraft[], format: CitationFormat): CitationPatchDraft[] {
  return patches.map(patch => ({
    ...patch,
    source: {
      ...patch.source,
      noteText: formatCitationNoteStrict(patch.source, format),
    },
  }))
}

function formatCitationNoteStrict(source: CitationPatchDraft['source'], format: CitationFormat) {
  const authors = formatAuthorsStrict(source.authors)
  const year = source.year ? `${source.year}` : '年份未详'
  const journal = source.journal ? ` ${source.journal}` : ''
  const link = sourceExternalUrl(source)
  const suffix = link ? ` ${link}` : ''

  if (format === 'gbt7714') {
    return `${authors}. ${source.title}[J].${journal ? journal.trim() : '出版物未详'}, ${year}.${suffix}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'apa') {
    return `${authors}. (${year}). ${source.title}.${journal ? journal : ' Publication unavailable.'}${suffix}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'mla') {
    return `${authors}. "${source.title}."${journal ? journal : ' Publication unavailable'}, ${year}.${suffix}`.replace(/\s+/g, ' ').trim()
  }
  if (format === 'chicago') {
    return `${authors}. "${source.title}."${journal ? journal : ' Publication unavailable'} (${year}).${suffix}`.replace(/\s+/g, ' ').trim()
  }
  return `${authors}. ${source.title}. ${year}.${journal}${suffix}`.replace(/\s+/g, ' ').trim()
}

function formatAuthorsStrict(authors: string[]) {
  const cleanAuthors = authors.map(author => author.trim()).filter(Boolean)
  if (cleanAuthors.length === 0) return ''
  if (cleanAuthors.length <= 3) return cleanAuthors.join('、')
  return `${cleanAuthors.slice(0, 3).join('、')}等`
}

function isClaimType(value: unknown): value is ClaimType {
  return typeof value === 'string' && value in claimTypeLabels
}

function normalizeAICitationPatch(
  value: unknown,
  sections: ReturnType<typeof sectionStore.getByProject>,
  index: number
): CitationPatchDraft | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const source = row.source && typeof row.source === 'object'
    ? row.source as Record<string, unknown>
    : null
  const sectionId = String(row.sectionId ?? '').trim()
  const originalText = String(row.originalText ?? '').trim()
  const revisedText = String(row.revisedText ?? originalText).trim()
  const sourceId = String(source?.id ?? row.sourceId ?? '').trim()
  const title = String(source?.title ?? '').trim()
  if (!sectionId || !originalText || !revisedText || !sourceId || !title) return null

  const section = sections.find(item => item.id === sectionId)
  const sourcePayload = {
    id: sourceId,
    title,
    authors: Array.isArray(source?.authors) ? source.authors.map(String).map(author => author.trim()).filter(Boolean) : [],
    year: Number.isFinite(Number(source?.year)) ? Number(source?.year) : undefined,
    journal: String(source?.journal ?? '').trim() || undefined,
    doi: String(source?.doi ?? '').trim() || undefined,
    url: String(source?.url ?? '').trim() || undefined,
    noteText: String(source?.noteText ?? '').trim() || title,
  }
  if (!hasVerifiableCitationSource(sourcePayload)) return null

  return {
    id: String(row.id ?? `ai_citation_patch_${Date.now()}_${index}`),
    sectionId,
    sectionTitle: String(row.sectionTitle ?? section?.title ?? '正文段落'),
    claimType: isClaimType(row.claimType) ? row.claimType : 'assertion',
    originalText,
    revisedText,
    problem: String(row.problem ?? '').trim() || undefined,
    enhancementType: String(row.enhancementType ?? '').trim() || undefined,
    applyMode: String(row.applyMode ?? 'rewrite_with_citation'),
    source: sourcePayload,
    reason: String(row.reason ?? '').trim(),
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.82,
  }
}

function sourceCardsFromSelection(selection: ReferenceSelection): SourceCard[] {
  const autoCards: SourceCard[] = (selection.autoCitationEnabled === false ? [] : selection.autoSources ?? [])
    .filter(source => source.title?.trim())
    .filter(hasVerifiableCitationSource)
    .map(source => ({
      id: source.id,
      title: source.title,
      authors: source.authors ?? [],
      year: source.year,
      source: source.source,
      doi: source.doi,
      url: source.url,
      abstract: source.abstract,
      provider: source.provider,
      citedByCount: source.citedByCount,
      relevanceReason: source.relevanceReason,
      noteText: noteTextFromSource(source),
      origin: 'auto' as const,
    }))

  const manualCards: SourceCard[] = selection.libraryItemIds
    .map(id => libraryStore.get(id))
    .filter((item): item is LibraryItem => Boolean(item && item.type !== 'style' && item.type !== 'background'))
    .map(item => ({
      id: item.id,
      title: item.title,
      authors: [],
      source: item.fileName,
      url: item.fileUrl,
      abstract: item.text,
      relevanceReason: item.viewpointsExtract || item.summary,
      noteText: noteTextFromLibraryItem(item),
      origin: 'manual' as const,
    }))

  const seen = new Set<string>()
  return [...autoCards, ...manualCards].filter(source => {
    if (!hasVerifiableCitationSource(source)) return false
    const key = `${source.id}:${source.title}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function scholarPaperToEvidenceSource(paper: ScholarPaper, provider?: string): CitationEvidenceSource {
  return {
    id: paper.id || paper.doi || paper.url || `${paper.title}-${paper.year ?? ''}`,
    title: paper.title,
    authors: paper.authors ?? [],
    year: paper.year,
    source: paper.source,
    doi: paper.doi,
    url: paper.url,
    abstract: paper.abstract,
    provider,
    citedByCount: paper.citedByCount,
    relevanceReason: paper.relevanceReason,
  }
}

function normalizeSourceKey(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:/, '')
    .replace(/^https?:\/\/openalex\.org\//, '')
}

function sourceKeys(source: SourceCard) {
  return Array.from(new Set([
    source.id,
    source.doi,
    source.url,
    source.title,
    source.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
  ].map(normalizeSourceKey).filter(Boolean)))
}

function sourceLookup(sourceCards: SourceCard[]) {
  const lookup = new Map<string, SourceCard>()
  sourceCards.forEach(source => {
    sourceKeys(source).forEach(key => lookup.set(key, source))
  })
  return lookup
}

function findSourceForEvidence(lookup: Map<string, SourceCard>, sourceId: string) {
  return lookup.get(normalizeSourceKey(sourceId))
}

function classifyEvidence(title: string, point: CitationEvidencePoint): ClaimType {
  const text = `${title} ${point.claim} ${point.writingUse}`
  if (/定义|概念|内涵|理论/.test(text)) return 'definition'
  if (/现状|已有研究|综述|学界|相关研究/.test(text)) return 'literature'
  if (/方法|模型|量表|AHP|KANO|统计|分析/.test(text)) return 'method'
  if (/比较|差异|相较|对比|中西/.test(text)) return 'comparison'
  if (/趋势|发展|未来|演变|变化/.test(text)) return 'trend'
  return 'assertion'
}

function evidenceCardsFromPack(pack: CitationEvidencePack | undefined): EvidenceCard[] {
  if (!pack) return []
  const cards: EvidenceCard[] = []
  const pushPoint = (groupTitle: string, point: CitationEvidencePoint, index: number, chapterTitle?: string) => {
    const sourceId = point.sourceIds?.[0]
    if (!sourceId || !point.claim) return
    cards.push({
      id: `${groupTitle}-${chapterTitle ?? 'global'}-${index}-${sourceId}`,
      sourceId,
      claim: point.claim,
      writingUse: point.writingUse,
      usableFor: classifyEvidence(groupTitle, point),
      chapterTitle,
      confidence: chapterTitle ? 0.82 : 0.74,
    })
  }

  pack.theoryConcepts.forEach((point, index) => pushPoint('核心理论/概念定义', point, index))
  pack.literatureReview.forEach((point, index) => pushPoint('研究现状/已有观点', point, index))
  pack.methodSupport.forEach((point, index) => pushPoint('方法依据', point, index))
  pack.caseEvidence.forEach((point, index) => pushPoint('案例或对象分析依据', point, index))
  pack.chapterEvidence.forEach(chapter => {
    chapter.keyPoints.forEach((point, index) => pushPoint('章节证据', point, index, chapter.chapterTitle))
    chapter.sourceIds.forEach((sourceId, index) => {
      if (chapter.keyPoints.length > 0) return
      cards.push({
        id: `chapter-${chapter.chapterTitle}-${index}-${sourceId}`,
        sourceId,
        claim: chapter.writingPlan || `${chapter.chapterTitle} 可结合该来源补充依据。`,
        writingUse: `适合用于「${chapter.chapterTitle}」`,
        usableFor: classifyEvidence(chapter.chapterTitle, { claim: chapter.writingPlan, writingUse: '' , sourceIds: [] }),
        chapterTitle: chapter.chapterTitle,
        confidence: 0.68,
      })
    })
  })
  return cards.slice(0, 80)
}

function splitCandidateSentences(content: string) {
  return content
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？；;.!?])\s*/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 18 && sentence.length <= 180)
}

function isNonCitationSectionTitle(title: string) {
  const clean = title.trim()
  return isFrontMatterTitle(clean) || /^(?:关键词|关键字|目录|参考文献|致谢|附录|题目|标题|论文题目)$/i.test(clean)
}

function looksLikeCitationHeading(text: string) {
  const clean = text.trim()
  if (!clean) return true
  if (/^(?:摘要|abstract|关键词|关键字|目录|参考文献|致谢|附录)$/i.test(clean)) return true
  if (/^(?:第[一二三四五六七八九十百千万\d]+[章节篇部]|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+(?:\.\d+)*[.、\s])/.test(clean)) return true
  return clean.length <= 40 && !/[。！？；;.!?]/.test(clean)
}

function citationCandidateSentences(section: ReturnType<typeof sectionStore.getByProject>[number]) {
  if (isNonCitationSectionTitle(section.title)) return []
  return parsePaperBlocks(section.content)
    .filter(block => block.type === 'paragraph')
    .flatMap(block => splitCandidateSentences(block.text))
    .filter(sentence => !looksLikeCitationHeading(sentence))
}

function classifyClaim(sentence: string): ClaimType | null {
  if (/是指|定义为|所谓|内涵|概念|理论/.test(sentence)) return 'definition'
  if (/已有研究|相关研究|学界|研究表明|研究指出|普遍认为|文献/.test(sentence)) return 'literature'
  if (/方法|模型|量表|层次分析|AHP|KANO|统计|回归|相关|方差|信度|效度/.test(sentence)) return 'method'
  if (/相比|相较|差异|比较|不同于|一方面|另一方面|中西/.test(sentence)) return 'comparison'
  if (/趋势|未来|发展|逐渐|日益|演变|转向/.test(sentence)) return 'trend'
  if (/说明|体现|反映|意味着|具有|需要|应当|价值|影响/.test(sentence)) return 'assertion'
  return null
}

function scoreEvidenceForSentence(sentence: string, sectionTitle: string, card: EvidenceCard, source?: SourceCard) {
  const haystack = `${card.claim} ${card.writingUse} ${card.chapterTitle ?? ''} ${source?.title ?? ''} ${source?.abstract ?? ''}`
  const seed = `${sentence} ${sectionTitle}`
  const wordTokens = seed
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 2 && token.length <= 24)
  const cjk = seed.replace(/[^\u4e00-\u9fff]/g, '')
  const cjkTokens: string[] = []
  for (let index = 0; index < cjk.length - 1; index += 1) {
    cjkTokens.push(cjk.slice(index, index + 2))
  }
  const tokens = Array.from(new Set([...wordTokens, ...cjkTokens])).slice(0, 80)
  return tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
}

function buildCitationSuggestions(input: {
  sections: ReturnType<typeof sectionStore.getByProject>
  evidenceCards: EvidenceCard[]
  sourceCards: SourceCard[]
}): CitationPatchDraft[] {
  const sourceById = sourceLookup(input.sourceCards)
  const suggestions: CitationPatchDraft[] = []

  input.sections.forEach(section => {
    citationCandidateSentences(section).forEach(sentence => {
      const claimType = classifyClaim(sentence)
      if (!claimType) return
      const scored = input.evidenceCards
        .map(card => ({ card, source: findSourceForEvidence(sourceById, card.sourceId) }))
        .map(card => ({
          card: card.card,
          source: card.source,
          score: (card.card.usableFor === claimType ? 4 : 0) + scoreEvidenceForSentence(sentence, section.title, card.card, card.source),
        }))
        .filter(item => item.source && item.score > 0)
        .sort((a, b) => b.score - a.score || b.card.confidence - a.card.confidence)
      const best = scored[0]
      if (!best?.source) return
      suggestions.push({
        id: uid(),
        sectionId: section.id,
        sectionTitle: section.title,
        claimType,
        originalText: sentence,
        revisedText: sentence,
        source: {
          id: best.source.id,
          title: best.source.title,
          authors: best.source.authors,
          year: best.source.year,
          journal: best.source.source,
          doi: best.source.doi,
          url: best.source.url,
          noteText: best.source.noteText,
        },
        reason: best.card.claim,
        confidence: Math.min(0.96, best.card.confidence + Math.min(best.score, 8) / 40),
      })
    })
  })

  const seen = new Set<string>()
  return suggestions
    .filter(item => {
      const key = `${item.sectionId}:${item.originalText}:${item.source.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 18)
}

export default function ReferencePanel({
  projectId,
  stage,
  open,
  onClose,
  onChange,
  onApplyToActiveSection,
  onApplyCitationPatches,
  onInsertEvidenceCard,
  onUseEvidenceForRewrite,
  autoStartEnhancementKey = 0,
}: ReferencePanelProps) {
  const project = projectStore.ensure(projectId)
  const [selection, setSelection] = useState<ReferenceSelection>(() => referenceStore.get(projectId, stage))
  const [query, setQuery] = useState('')
  const [scholarQuery, setScholarQuery] = useState(() => buildScholarQuery(project.title, project.context))
  const [scholarResults, setScholarResults] = useState<ScholarCandidate[]>([])
  const [isSearchingScholar, setIsSearchingScholar] = useState(false)
  const [scholarNotice, setScholarNotice] = useState('')
  const [scanVersion, setScanVersion] = useState(0)
  const [scanNotice, setScanNotice] = useState('')
  const [acceptedPatchIds, setAcceptedPatchIds] = useState<Set<string>>(() => new Set())
  const [rejectedPatchIds, setRejectedPatchIds] = useState<Set<string>>(() => new Set())
  const [aiPatches, setAiPatches] = useState<CitationPatchDraft[]>([])
  const [citationFormat, setCitationFormat] = useState<CitationFormat>('gbt7714')
  const [enhancementStatus, setEnhancementStatus] = useState<EnhancementStatus>('idle')
  const [enhancementStep, setEnhancementStep] = useState(0)
  const lastAutoStartKeyRef = useRef(0)
  const showScholarSearch = stage === 'stage3'

  const libraryItems = libraryStore.getAll()
  const sections = sectionStore.getByProject(projectId)
  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return libraryItems
    return libraryItems.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }, [libraryItems, query])

  const filteredReferenceItems = filteredLibrary.filter(item => item.type !== 'style' && item.type !== 'case')
  const filteredStyleItems = filteredLibrary.filter(item => item.type === 'style')
  const filteredCaseItems = filteredLibrary.filter(item => item.type === 'case')
  const selectedReferenceCount = selection.libraryItemIds.filter(id => {
    const item = libraryStore.get(id)
    return item && item.type !== 'style' && item.type !== 'case'
  }).length
  const selectedStyleCount = selection.libraryItemIds.filter(id => libraryStore.get(id)?.type === 'style').length
  const selectedCaseCount = selection.libraryItemIds.filter(id => libraryStore.get(id)?.type === 'case').length
  const autoSources = selection.autoSources ?? []
  const evidencePack = selection.evidencePack
  const sourceCards = useMemo(() => sourceCardsFromSelection(selection), [selection])
  const evidenceCards = useMemo(() => evidenceCardsFromPack(evidencePack), [evidencePack])
  const suggestions = useMemo(() => {
    void scanVersion
    return aiPatches
  }, [aiPatches, scanVersion])
  const visibleSuggestions = suggestions.filter(item => !rejectedPatchIds.has(item.id))
  const acceptedPatches = suggestions.filter(item => acceptedPatchIds.has(item.id))
  const highConfidenceCount = suggestions.filter(item => item.confidence >= 0.82).length
  const riskItems = useMemo(() => buildRiskItems({
    sourceCards,
    evidenceCards,
    suggestions,
    sections,
    autoCitationEnabled: selection.autoCitationEnabled !== false,
  }), [evidenceCards, sections, selection.autoCitationEnabled, sourceCards, suggestions])

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      const latest = referenceStore.get(projectId, stage)
      setSelection(latest)
      setAcceptedPatchIds(new Set())
      setRejectedPatchIds(new Set())
      setAiPatches([])
      setEnhancementStatus('idle')
      setEnhancementStep(0)
    })
  }, [open, projectId, stage])

  const saveSelection = (next: ReferenceSelection) => {
    setSelection(next)
    referenceStore.save(next)
    onChange?.(next)
  }

  const toggleLibrary = (id: string) => {
    const exists = selection.libraryItemIds.includes(id)
    saveSelection({
      ...selection,
      libraryItemIds: exists
        ? selection.libraryItemIds.filter(itemId => itemId !== id)
        : [id, ...selection.libraryItemIds],
    })
  }

  const toggleSection = (id: string) => {
    const exists = selection.sectionIds.includes(id)
    saveSelection({
      ...selection,
      sectionIds: exists
        ? selection.sectionIds.filter(sectionId => sectionId !== id)
        : [...selection.sectionIds, id],
    })
  }

  const toggleFlag = (key: 'includeProjectContext' | 'includeConversationSummary') => {
    saveSelection({ ...selection, [key]: !selection[key] })
  }

  const toggleAutoCitation = () => {
    saveSelection({ ...selection, autoCitationEnabled: selection.autoCitationEnabled === false })
  }

  const rejectPatch = (id: string) => {
    setRejectedPatchIds(prev => new Set([...prev, id]))
    setAcceptedPatchIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const acceptHighConfidence = () => {
    setAcceptedPatchIds(new Set(suggestions.filter(item => item.confidence >= 0.82).map(item => item.id)))
  }

  const applyAccepted = () => {
    if (acceptedPatches.length === 0) return
    onApplyCitationPatches?.(withCitationFormat(acceptedPatches, citationFormat))
    const appliedIds = new Set(acceptedPatches.map(item => item.id))
    setAiPatches(prev => prev.filter(item => !appliedIds.has(item.id)))
    setAcceptedPatchIds(new Set())
    setRejectedPatchIds(new Set())
    setScanVersion(value => value + 1)
  }

  const applyOnePatch = (id: string) => {
    const patch = suggestions.find(item => item.id === id)
    if (!patch) return
    onApplyCitationPatches?.(withCitationFormat([patch], citationFormat))
    setAcceptedPatchIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setRejectedPatchIds(prev => new Set([...prev, id]))
    setAiPatches(prev => prev.filter(item => item.id !== id))
    setScanNotice(`已尝试插入 1 条引用建议：${patch.source.title}`)
  }

  const scanCitationPoints = async () => {
    if (enhancementStatus === 'running') return
    const targetSections = sections
      .filter(section => !isNonCitationSectionTitle(section.title))
      .filter(section => section.content.trim().length > 0)

    setScanVersion(value => value + 1)
    setAcceptedPatchIds(new Set())
    setRejectedPatchIds(new Set())
    setAiPatches([])
    setScanNotice('')
    setEnhancementStatus('running')
    setEnhancementStep(0)

    if (targetSections.length === 0) {
      setEnhancementStatus('done')
      setEnhancementStep(4)
      setScanNotice('当前没有可增强的正文段落。摘要、题目、关键词、标题和参考文献不会进入引用增强。')
      return
    }

    const progressTimers = [1, 2, 3].map((step, index) =>
      window.setTimeout(() => setEnhancementStep(step), 520 * (index + 1))
    )

    try {
      let workingSelection = selection
      let workingSourceCards = sourceCards
      let workingEvidencePack = evidencePack
      if (workingSourceCards.length < 25) {
        setEnhancementStep(1)
        setScanNotice('正在为引用增强补充检索文献，目标形成 30 篇左右的可用引用池。')
        const prepared = await scholarAPI.prepare({
          title: project.title,
          outline: targetSections.map(section => `${section.title}\n${section.content.slice(0, 500)}`).join('\n\n'),
          researchObject: project.context?.researchObject,
          academicLevel: project.context?.academicLevel,
          limit: 40,
          targetFinalCitationCount: 30,
          firstDraftCitationCount: 16,
        })
        const autoSources = prepared.autoSources.map(source => scholarPaperToEvidenceSource(source, prepared.provider))
        workingSelection = {
          ...selection,
          autoCitationEnabled: true,
          autoSources,
          evidencePack: prepared.evidencePack,
          lastAutoRunAt: Date.now(),
        }
        saveSelection(workingSelection)
        workingSourceCards = sourceCardsFromSelection(workingSelection)
        workingEvidencePack = prepared.evidencePack
      }

      if (workingSourceCards.length === 0) {
        setEnhancementStatus('done')
        setEnhancementStep(4)
        setScanNotice('暂时没有可引用来源，系统无法安全补引用。请稍后重试文献检索，或先补充文献来源。')
        return
      }

      const response = await referencesAPI.enhance({
        projectId,
        projectTitle: project.title,
        researchObject: project.context?.researchObject,
        citationFormat,
        targetFinalCitationCount: 30,
        minPatchCount: 8,
        idealPatchCount: 12,
        sections: targetSections.map(section => ({
          id: section.id,
          title: section.title,
          content: section.content,
        })),
        sources: workingSourceCards.map(source => ({
          id: source.id,
          title: source.title,
          authors: source.authors,
          year: source.year,
          journal: source.source,
          source: source.source,
          doi: source.doi,
          url: source.url,
          abstract: source.abstract,
          relevanceReason: source.relevanceReason,
          noteText: source.noteText,
        })),
        evidencePack: workingEvidencePack,
      })
      const nextPatches = response.patches
        .map((patch, index) => normalizeAICitationPatch(patch, targetSections, index))
        .filter((patch): patch is CitationPatchDraft => Boolean(patch))
      setAiPatches(nextPatches)
      setEnhancementStep(4)
      setEnhancementStatus('done')
      setScanNotice(nextPatches.length > 0
        ? (response.auditNote || `引用增强完成：AI 找到 ${nextPatches.length} 条可审查建议，已自动跳过摘要、题目和大小标题。`)
        : (response.auditNote || '引用增强完成：本轮没有找到可安全插入的引用建议。系统不会为了数量强行补引用。')
      )
    } catch (error) {
      setEnhancementStep(4)
      setEnhancementStatus('done')
      setScanNotice(`引用增强 API 调用失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      progressTimers.forEach(timer => window.clearTimeout(timer))
    }
  }

  useEffect(() => {
    if (!open || autoStartEnhancementKey <= 0 || lastAutoStartKeyRef.current === autoStartEnhancementKey) return
    lastAutoStartKeyRef.current = autoStartEnhancementKey
    const timer = window.setTimeout(() => {
      void scanCitationPoints()
    }, 120)
    return () => window.clearTimeout(timer)
    // Intentionally token-driven: the latest click increments autoStartEnhancementKey,
    // while scanCitationPoints reads the panel state active for that open cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartEnhancementKey, open])

  const saveAutoSourceToLibrary = (source: CitationEvidenceSource) => {
    const existing = libraryStore.getAll().find(item =>
      item.fileUrl === source.url ||
      (source.doi && item.summary.includes(source.doi)) ||
      item.title.trim() === source.title.trim()
    )
    const item = existing ?? libraryStore.add({
      title: source.title,
      type: 'other',
      fileName: source.doi || source.id,
      fileUrl: source.url,
      text: scholarPaperToLibraryText({
        id: source.id,
        title: source.title,
        authors: source.authors,
        year: source.year,
        source: source.source,
        doi: source.doi,
        url: source.url,
        citedByCount: source.citedByCount,
        abstract: source.abstract,
      }),
      summary: [
        source.authors.length ? source.authors.join('、') : '作者未详',
        source.year ? `${source.year}` : '',
        source.source || '',
        source.doi ? `DOI：${source.doi}` : '',
      ].filter(Boolean).join('；'),
      tags: ['自动文献增强', source.provider || '外部检索', ...(source.year ? [String(source.year)] : [])],
      extractStatus: 'done',
      structureExtract: 'Stage3 自动文献增强检索结果。',
      viewpointsExtract: source.relevanceReason || (source.abstract ? `摘要要点：${source.abstract.slice(0, 800)}` : ''),
    })
    projectStore.bindLibraryItem(projectId, item.id)
    if (!selection.libraryItemIds.includes(item.id)) {
      saveSelection({ ...selection, libraryItemIds: [item.id, ...selection.libraryItemIds] })
    }
  }

  const handleScholarSearch = async () => {
    const searchText = scholarQuery.trim() || buildScholarQuery(project.title, project.context)
    if (!searchText || isSearchingScholar) return

    setScholarQuery(searchText)
    setIsSearchingScholar(true)
    setScholarNotice('')

    try {
      const response = await scholarAPI.search(searchText, 8)
      setScholarResults(response.results.map(paper => ({ ...paper, provider: response.provider })))
      setScholarNotice(response.results.length
        ? `已找到 ${response.results.length} 条候选文献。加入文献库后，可进入证据卡和引用建议流程。`
        : '暂未搜到合适文献，可以换成英文关键词或更具体的研究对象。'
      )
    } catch (error) {
      setScholarNotice(`论文搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSearchingScholar(false)
    }
  }

  const saveScholarPaper = (paper: ScholarCandidate) => {
    if (paper.savedItemId) return
    const existing = libraryStore.getAll().find(item =>
      item.fileUrl === paper.url ||
      (paper.doi && item.summary.includes(paper.doi)) ||
      item.title.trim() === paper.title.trim()
    )
    const item = existing ?? libraryStore.add({
      title: paper.title,
      type: 'other',
      fileName: paper.doi || paper.id,
      fileUrl: paper.url,
      text: scholarPaperToLibraryText(paper),
      summary: [
        paper.authors.length ? paper.authors.join('、') : '作者未知',
        paper.year ? `${paper.year}` : '',
        paper.source || '',
        paper.doi ? `DOI：${paper.doi}` : '',
      ].filter(Boolean).join('；'),
      tags: ['论文搜索', paper.provider || '外部检索', ...(paper.year ? [String(paper.year)] : [])],
      extractStatus: 'done',
      structureExtract: '外部论文检索结果：用于建立论文搜索候选文献池。',
      viewpointsExtract: paper.abstract ? `摘要要点：${paper.abstract.slice(0, 800)}` : '',
    })

    projectStore.bindLibraryItem(projectId, item.id)
    if (!selection.libraryItemIds.includes(item.id)) {
      saveSelection({ ...selection, libraryItemIds: [item.id, ...selection.libraryItemIds] })
    }
    setScholarResults(results => results.map(result =>
      result.id === paper.id ? { ...result, savedItemId: item.id } : result
    ))
    setScholarNotice(`已加入文献库：${paper.title}`)
  }

  void onApplyToActiveSection
  void onInsertEvidenceCard
  void onUseEvidenceForRewrite
  void setQuery
  void scholarResults
  void scholarNotice
  void showScholarSearch
  void filteredReferenceItems
  void filteredStyleItems
  void filteredCaseItems
  void selectedReferenceCount
  void selectedStyleCount
  void selectedCaseCount
  void autoSources
  void toggleLibrary
  void toggleSection
  void toggleFlag
  void toggleAutoCitation
  void saveAutoSourceToLibrary
  void handleScholarSearch
  void saveScholarPaper
  void buildCitationSuggestions
  void EvidenceTab
  void LibraryTab
  void RiskTab
  void tabBarStyle
  void tabButtonStyle
  void supportGridStyle
  void supportCardStyle
  void selectStyle
  void actionGridStyle
  void applyButtonStyle

  if (!open) return null

  const riskIssueCount = riskItems.filter(item => item.tone !== 'ok').length

  return (
    <aside style={drawerStyle}>
      <div style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850, color: 'var(--color-ink)' }}>
            <BookMarked size={14} />
            文献与引用中心
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</div>
        </div>
        <button onClick={onClose} style={iconButtonStyle} title="关闭文献与引用中心">
          <X size={15} />
        </button>
      </div>

      <div style={workflowStyle}>
        <WorkflowStep active={enhancementStatus !== 'idle'} label="引用增强" value={enhancementStatus === 'done' ? '已完成' : enhancementStatus === 'running' ? '处理中' : '待开始'} />
        <WorkflowStep active={sourceCards.length > 0} label="后台来源" value={`${sourceCards.length} 条`} />
        <WorkflowStep active={suggestions.length > 0} label="可插入建议" value={`${suggestions.length} 条`} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <SuggestionsTab
          suggestions={visibleSuggestions}
          acceptedIds={acceptedPatchIds}
          highConfidenceCount={highConfidenceCount}
          canApply={Boolean(onApplyCitationPatches)}
          scanNotice={scanNotice}
          citationFormat={citationFormat}
          sourceCount={sourceCards.length}
          evidenceCount={evidenceCards.length}
          riskIssueCount={riskIssueCount}
          enhancementStatus={enhancementStatus}
          enhancementStep={enhancementStep}
          onScan={scanCitationPoints}
          onAccept={applyOnePatch}
          onReject={rejectPatch}
          onAcceptHighConfidence={acceptHighConfidence}
          onApplyAccepted={applyAccepted}
          acceptedCount={acceptedPatches.length}
          onCitationFormatChange={setCitationFormat}
        />
      </div>

      <div style={footerStyle}>
        后台已准备 {sourceCards.length} 条来源 · 已跳过摘要和标题
      </div>
    </aside>
  )
}

function SuggestionsTab({
  suggestions,
  acceptedIds,
  highConfidenceCount,
  canApply,
  acceptedCount,
  scanNotice,
  citationFormat,
  sourceCount,
  evidenceCount,
  riskIssueCount,
  enhancementStatus,
  enhancementStep,
  onScan,
  onAccept,
  onReject,
  onAcceptHighConfidence,
  onApplyAccepted,
  onCitationFormatChange,
}: {
  suggestions: CitationPatchDraft[]
  acceptedIds: Set<string>
  highConfidenceCount: number
  canApply: boolean
  acceptedCount: number
  scanNotice: string
  citationFormat: CitationFormat
  sourceCount: number
  evidenceCount: number
  riskIssueCount: number
  enhancementStatus: EnhancementStatus
  enhancementStep: number
  onScan: () => void
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onAcceptHighConfidence: () => void
  onApplyAccepted: () => void
  onCitationFormatChange: (format: CitationFormat) => void
}) {
  const hasRun = enhancementStatus !== 'idle'
  const isRunning = enhancementStatus === 'running'
  const flowSteps = [
    { label: '扫描正文引用点', value: '跳过摘要、题目和大小标题' },
    { label: '读取可用文献', value: `${sourceCount} 条来源进入后台匹配` },
    { label: '核对来源支撑关系', value: `${evidenceCount} 条依据用于判断是否能支撑原句` },
    { label: '生成引用补全建议', value: suggestions.length > 0 ? `${suggestions.length} 条可审查` : '避免强行插入不稳引用' },
    { label: '等待确认写入', value: riskIssueCount > 0 ? `${riskIssueCount} 个质量提醒` : '可逐条接受或批量应用' },
  ]

  return (
    <div>
      <PanelIntro
        icon={<Sparkles size={14} />}
        title="引用增强"
        text="让系统读取正文、匹配来源、判断引用点并补好脚注。中间检查都在后台完成，用户只需要审查最终建议。"
      />
      <section style={enhancementHeroStyle}>
        <button onClick={onScan} disabled={isRunning} style={heroActionStyle(!isRunning)}>
          <Sparkles size={15} />
          {isRunning ? '正在增强引用' : hasRun ? '重新引用增强' : '开始引用增强'}
        </button>
        <select
          value={citationFormat}
          onChange={event => onCitationFormatChange(event.target.value as CitationFormat)}
          style={heroSelectStyle}
          title="引用格式"
        >
          {(Object.keys(citationFormatLabels) as CitationFormat[]).filter(format => format !== 'footnote').map(format => (
            <option key={format} value={format}>{citationFormatLabels[format]}</option>
          ))}
        </select>
      </section>

      <section style={flowPanelStyle}>
        {flowSteps.map((step, index) => {
          const state = !hasRun ? 'pending' : enhancementStep > index ? 'done' : enhancementStep === index ? 'active' : 'pending'
          return <FlowStep key={step.label} state={state} label={step.label} value={step.value} />
        })}
      </section>

      {scanNotice && <Notice tone={suggestions.length > 0 ? 'info' : 'warn'} text={scanNotice} />}
      {!canApply && <Notice tone="warn" text="当前页面未接入脚注写入回调，只能预览建议。" />}
      {!hasRun ? (
        <EmptyState text="点击“开始引用增强”，系统会自动扫描正文并生成可审查的补引用建议。" />
      ) : suggestions.length === 0 ? (
        <EmptyState text={isRunning ? '正在生成引用建议…' : '本轮没有找到可安全插入的引用建议。系统不会为了数量强行补引用。'} />
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <div style={resultSummaryStyle}>
            <div>
              <strong>引用增强结果</strong>
              <span>建议插入 {suggestions.length} 条引用，已跳过摘要、题目和大小标题。</span>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={onAcceptHighConfidence} disabled={highConfidenceCount === 0} style={secondaryActionStyle(highConfidenceCount > 0)}>
                接受高置信度
              </button>
              <button onClick={onApplyAccepted} disabled={!canApply || acceptedCount === 0} style={smallApplyButtonStyle(canApply && acceptedCount > 0)}>
                应用已接受{acceptedCount > 0 ? `（${acceptedCount}）` : ''}
              </button>
            </div>
          </div>
          {suggestions.map(item => {
            const accepted = acceptedIds.has(item.id)
            const rewritesText = item.revisedText.trim() !== item.originalText.trim()
            const sourceUrl = sourceExternalUrl(item.source)
            return (
              <div key={item.id} style={suggestionCardStyle(accepted)}>
                <div style={cardMetaStyle}>
                  <span>{item.sectionTitle}</span>
                  <span>{claimTypeLabels[item.claimType]}</span>
                  <span>{Math.round(item.confidence * 100)}%</span>
                </div>
                {item.problem && <div style={reasonStyle}>当前问题：{item.problem}</div>}
                <div style={reasonStyle}>原文</div>
                <div style={quoteStyle}>{item.originalText}</div>
                {rewritesText && (
                  <>
                    <div style={reasonStyle}>建议改写</div>
                    <div style={rewriteStyle}>{item.revisedText}</div>
                  </>
                )}
                <div style={sourceLineStyle}>
                  推荐来源：{item.source.title}
                  {[formatAuthorsStrict(item.source.authors), item.source.year, item.source.journal].filter(Boolean).join(' · ') ? ` · ${[formatAuthorsStrict(item.source.authors), item.source.year, item.source.journal].filter(Boolean).join(' · ')}` : ''}
                  {sourceUrl && (
                    <>
                      {' · '}
                      <a href={sourceUrl} target="_blank" rel="noreferrer" style={sourceLinkStyle}>查看出处</a>
                    </>
                  )}
                </div>
                <div style={reasonStyle}>增强方式：{rewritesText ? '局部改写并插入脚注' : '保留原句并插入脚注'} · {item.enhancementType || claimTypeLabels[item.claimType]}</div>
                <div style={reasonStyle}>来源依据：{item.reason || '该来源与句子主题和章节语境相近，可作为候选支撑。'}</div>
                <details style={evidenceDetailsStyle}>
                  <summary style={detailsSummaryStyle}>查看依据与格式预览</summary>
                  <div style={citationPreviewStyle}>
                    <div style={{ fontSize: 10, fontWeight: 850, color: 'var(--color-accent)', marginBottom: 4 }}>
                      {citationFormatLabels[citationFormat]} 预览
                    </div>
                    {formatCitationNoteStrict(item.source, citationFormat)}
                  </div>
                </details>
                <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                  <button onClick={() => onAccept(item.id)} style={smallPrimaryStyle}>
                    {accepted ? '已接受' : rewritesText ? '应用改写' : '只插引用'}
                  </button>
                  <button onClick={() => onReject(item.id)} style={smallSecondaryStyle}>
                    忽略
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EvidenceTab({
  evidenceCards,
  sourceCards,
  evidencePack,
  onInsertEvidenceCard,
  onUseEvidenceForRewrite,
}: {
  evidenceCards: EvidenceCard[]
  sourceCards: SourceCard[]
  evidencePack?: CitationEvidencePack
  onInsertEvidenceCard?: (evidence: EvidenceCardAction) => void
  onUseEvidenceForRewrite?: (evidence: EvidenceCardAction) => void
}) {
  const sourceById = sourceLookup(sourceCards)
  const toAction = (card: EvidenceCard, source: SourceCard): EvidenceCardAction => ({
    id: card.id,
    claim: card.claim,
    writingUse: card.writingUse,
    usableFor: card.usableFor,
    source: {
      id: source.id,
      title: source.title,
      noteText: source.noteText,
    },
  })
  return (
    <div>
      <PanelIntro
        icon={<Lightbulb size={14} />}
        title="证据卡"
        text="证据卡把文献转换成可写入论文的观点依据。引用增强会优先从这里匹配。"
      />
      {evidencePack?.summary && <Notice tone="info" text={evidencePack.summary} />}
      {evidenceCards.length === 0 ? (
        <EmptyState text="还没有证据卡。生成全文前的自动检索会生成证据包；也可以先在文献库手动补充文献。" />
      ) : (
        <div style={{ display: 'grid', gap: 9 }}>
          {evidenceCards.slice(0, 24).map(card => {
            const source = findSourceForEvidence(sourceById, card.sourceId)
            return (
              <div key={card.id} style={evidenceCardStyle}>
                <div style={cardMetaStyle}>
                  <span>{claimTypeLabels[card.usableFor]}</span>
                  {card.chapterTitle && <span>{card.chapterTitle}</span>}
                  <span>{Math.round(card.confidence * 100)}%</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-ink)', lineHeight: 1.55 }}>{card.claim}</div>
                {card.writingUse && <div style={reasonStyle}>写作位置：{card.writingUse}</div>}
                <div style={sourceLineStyle}>来源：{source?.title ?? card.sourceId}</div>
                {source && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 9 }}>
                    <button
                      onClick={() => onInsertEvidenceCard?.(toAction(card, source))}
                      disabled={!onInsertEvidenceCard}
                      style={secondaryActionStyle(Boolean(onInsertEvidenceCard))}
                    >
                      插入当前章节
                    </button>
                    <button
                      onClick={() => onUseEvidenceForRewrite?.(toAction(card, source))}
                      disabled={!onUseEvidenceForRewrite}
                      style={secondaryActionStyle(Boolean(onUseEvidenceForRewrite))}
                    >
                      用于改写
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LibraryTab({
  query,
  setQuery,
  showScholarSearch,
  scholarQuery,
  setScholarQuery,
  scholarResults,
  scholarNotice,
  isSearchingScholar,
  onScholarSearch,
  onSaveScholarPaper,
  sourceCards,
  autoSources,
  onSaveAutoSource,
  filteredReferenceItems,
  filteredStyleItems,
  filteredCaseItems,
  sections,
  selection,
  selectedReferenceCount,
  onToggleLibrary,
  onToggleSection,
  onToggleFlag,
  onToggleAutoCitation,
  onApplyToActiveSection,
}: {
  query: string
  setQuery: (value: string) => void
  showScholarSearch: boolean
  scholarQuery: string
  setScholarQuery: (value: string) => void
  scholarResults: ScholarCandidate[]
  scholarNotice: string
  isSearchingScholar: boolean
  onScholarSearch: () => void
  onSaveScholarPaper: (paper: ScholarCandidate) => void
  sourceCards: SourceCard[]
  autoSources: CitationEvidenceSource[]
  onSaveAutoSource: (source: CitationEvidenceSource) => void
  filteredReferenceItems: LibraryItem[]
  filteredStyleItems: LibraryItem[]
  filteredCaseItems: LibraryItem[]
  sections: ReturnType<typeof sectionStore.getByProject>
  selection: ReferenceSelection
  selectedReferenceCount: number
  onToggleLibrary: (id: string) => void
  onToggleSection: (id: string) => void
  onToggleFlag: (key: 'includeProjectContext' | 'includeConversationSummary') => void
  onToggleAutoCitation: () => void
  onApplyToActiveSection?: () => void
}) {
  return (
    <div>
      <PanelIntro
        icon={<BookOpen size={14} />}
        title="文献库"
        text="这里管理所有可引用来源。背景资料和风格标签可以进入写作上下文，但不会直接当作正式脚注。"
      />
      <SearchBox value={query} onChange={setQuery} placeholder="搜索资料库" />

      {showScholarSearch && (
        <section style={panelStyle}>
          <SectionTitle icon={<Search size={13} />} label="检索文献" />
          <ToggleRow
            checked={selection.autoCitationEnabled !== false}
            title="生成全文时自动检索学术来源"
            subtitle="保留为辅助能力；正式引用质量以后以“引用增强”审查为主。"
            onClick={onToggleAutoCitation}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <input
              value={scholarQuery}
              onChange={event => setScholarQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onScholarSearch()
                }
              }}
              placeholder="输入关键词或题目"
              style={inputStyle}
            />
            <button onClick={onScholarSearch} disabled={isSearchingScholar} style={searchButtonStyle(isSearchingScholar)}>
              {isSearchingScholar ? '搜索中' : '搜索'}
            </button>
          </div>
          {scholarNotice && <Notice tone={scholarNotice.includes('失败') ? 'error' : 'info'} text={scholarNotice} />}
          {scholarResults.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {scholarResults.map(paper => (
                <SourceResultCard key={paper.id} paper={paper} onSave={() => onSaveScholarPaper(paper)} />
              ))}
            </div>
          )}
        </section>
      )}

      <section style={panelStyle}>
        <SectionTitle icon={<BookMarked size={13} />} label={`当前可引用来源（${sourceCards.length}）`} />
        {sourceCards.length === 0 ? (
          <EmptyState text="还没有可引用来源。可以先自动检索，或从资料库选择文献。" />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sourceCards.slice(0, 10).map(source => (
              <div key={`${source.origin}-${source.id}`} style={sourceCardStyle}>
                <div style={{ fontSize: 12, fontWeight: 850, color: 'var(--color-ink)', lineHeight: 1.45 }}>{source.title}</div>
                <div style={sourceLineStyle}>
                  {[source.authors.slice(0, 2).join('、'), source.year, source.source, source.origin === 'auto' ? '自动来源' : '资料库'].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
        {autoSources.length > 0 && (
          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
            {autoSources.slice(0, 4).map(source => (
              <button key={source.id} onClick={() => onSaveAutoSource(source)} style={secondaryFullButtonStyle}>
                保存「{source.title.slice(0, 18)}{source.title.length > 18 ? '…' : ''}」到资料库
              </button>
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <SectionTitle icon={<Layers size={13} />} label="项目上下文" />
        <ToggleRow
          checked={selection.includeProjectContext}
          title="项目理解模型"
          subtitle={selection.includeProjectContext ? '写作时会带入题目、研究对象、边界和学段。' : '已关闭项目背景。'}
          onClick={() => onToggleFlag('includeProjectContext')}
        />
        <ToggleRow
          checked={selection.includeConversationSummary}
          title="阶段对话摘要"
          subtitle="将最近对话作为本次 AI 的背景。"
          onClick={() => onToggleFlag('includeConversationSummary')}
        />
      </section>

      <section style={panelStyle}>
        <SectionTitle icon={<BookOpen size={13} />} label="资料库文献" />
        {filteredReferenceItems.length === 0 ? <EmptyState text="资料库里还没有匹配文献。" /> : filteredReferenceItems.map(item => (
          <ToggleRow key={item.id} checked={selection.libraryItemIds.includes(item.id)} title={item.title} subtitle={item.summary || item.text.slice(0, 80)} onClick={() => onToggleLibrary(item.id)} />
        ))}
      </section>

      <section style={panelStyle}>
        <SectionTitle icon={<TagLabel />} label="风格与案例上下文" />
        {[...filteredStyleItems, ...filteredCaseItems].length === 0 ? <EmptyState text="暂无风格或案例资料。" /> : [...filteredStyleItems, ...filteredCaseItems].map(item => (
          <ToggleRow key={item.id} checked={selection.libraryItemIds.includes(item.id)} title={item.title} subtitle={item.summary || item.text.slice(0, 80)} onClick={() => onToggleLibrary(item.id)} />
        ))}
      </section>

      <section style={panelStyle}>
        <SectionTitle icon={<FileText size={13} />} label="项目章节" />
        {sections.length === 0 ? <EmptyState text="项目里还没有章节。" /> : sections.map(section => (
          <ToggleRow key={section.id} checked={selection.sectionIds.includes(section.id)} title={section.title} subtitle={section.content || '暂无正文'} onClick={() => onToggleSection(section.id)} />
        ))}
        {onApplyToActiveSection && selectedReferenceCount > 0 && (
          <button onClick={onApplyToActiveSection} style={secondaryFullButtonStyle}>
            用已选来源重写当前小节
          </button>
        )}
      </section>
    </div>
  )
}

function RiskTab({
  riskItems,
  sourceCount,
  evidenceCount,
  suggestionCount,
  selectedStyleCount,
  selectedCaseCount,
}: {
  riskItems: Array<{ tone: 'ok' | 'warn' | 'error'; title: string; text: string }>
  sourceCount: number
  evidenceCount: number
  suggestionCount: number
  selectedStyleCount: number
  selectedCaseCount: number
}) {
  return (
    <div>
      <PanelIntro
        icon={<ShieldCheck size={14} />}
        title="引用风险检查"
        text="正式交付时，系统应该提醒哪些内容可以引用、哪些只是背景或风格参考，避免伪造来源。"
      />
      <div style={metricsGridStyle}>
        <Metric label="可引用来源" value={sourceCount} />
        <Metric label="证据卡" value={evidenceCount} />
        <Metric label="引用建议" value={suggestionCount} />
        <Metric label="非正式上下文" value={selectedStyleCount + selectedCaseCount} />
      </div>
      <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
        {riskItems.map((item, index) => (
          <div key={`${item.title}-${index}`} style={riskCardStyle(item.tone)}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, fontWeight: 850 }}>
              {item.tone === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
              {item.title}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.6 }}>{item.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildRiskItems(input: {
  sourceCards: SourceCard[]
  evidenceCards: EvidenceCard[]
  suggestions: CitationPatchDraft[]
  sections: ReturnType<typeof sectionStore.getByProject>
  autoCitationEnabled: boolean
}) {
  const items: Array<{ tone: 'ok' | 'warn' | 'error'; title: string; text: string }> = []
  if (input.sourceCards.length === 0) {
    items.push({ tone: 'error', title: '缺少可引用来源', text: '当前没有正式文献来源。生成或增强引用时不应编造作者、年份、题名或 DOI。' })
  } else {
    items.push({ tone: 'ok', title: '已有可引用来源', text: `当前共有 ${input.sourceCards.length} 条来源，可用于证据卡和引用建议。` })
  }
  if (input.evidenceCards.length === 0) {
    items.push({ tone: 'warn', title: '证据卡不足', text: '只有文献题名还不够，建议生成证据卡，明确每篇文献能支撑哪些观点。' })
  }
  if (input.sections.some(section => section.content && !section.footnotes?.length) && input.sourceCards.length > 0) {
    items.push({ tone: 'warn', title: '正文有待引用增强', text: '已有正文和文献，但部分章节还没有脚注。建议进入“引用建议”扫描正文。' })
  }
  if (!input.autoCitationEnabled) {
    items.push({ tone: 'warn', title: '生成时自动引用已关闭', text: '这不会影响生成后引用增强；只是第一版正文不会自动检索来源。' })
  }
  if (input.suggestions.length > 0) {
    items.push({ tone: 'ok', title: '已生成引用建议', text: `当前有 ${input.suggestions.length} 条候选引用点，建议逐条确认后再应用。` })
  }
  return items
}

function PanelIntro({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div style={introStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 850, color: 'var(--color-ink)' }}>
        {icon}
        {title}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.65, color: 'var(--color-ink-3)' }}>{text}</div>
    </div>
  )
}

function WorkflowStep({ active, label, value }: { active: boolean; label: string; value: string }) {
  return (
    <div style={{ ...workflowStepStyle, opacity: active ? 1 : 0.58 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: active ? 'var(--color-accent)' : 'var(--color-border-strong)' }} />
      <div>
        <div style={{ fontSize: 11, fontWeight: 850, color: 'var(--color-ink)' }}>{label}</div>
        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)' }}>{value}</div>
      </div>
    </div>
  )
}

function FlowStep({ state, label, value }: { state: 'pending' | 'active' | 'done'; label: string; value: string }) {
  const active = state === 'active'
  const done = state === 'done'
  return (
    <div style={flowStepStyle(active, done)}>
      <span style={flowDotStyle(active, done)}>{done ? <Check size={10} /> : active ? <Sparkles size={10} /> : null}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 850, color: active || done ? 'var(--color-ink)' : 'var(--color-ink-3)' }}>{label}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)', lineHeight: 1.45 }}>{value}</span>
      </span>
    </div>
  )
}

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, fontWeight: 850, color: 'var(--color-ink)' }}>
      {icon}
      {label}
    </div>
  )
}

function TagLabel() {
  return <BookMarked size={13} />
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div style={searchBoxStyle}>
      <Search size={13} color="var(--color-ink-3)" />
      <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} style={searchInputStyle} />
    </div>
  )
}

function ToggleRow({ checked, title, subtitle, onClick }: { checked: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={toggleRowStyle(checked)}>
      <span style={checkBoxStyle(checked)}>{checked && <Check size={11} />}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--color-ink)' }}>{title}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 10, lineHeight: 1.45, color: 'var(--color-ink-3)', maxHeight: 32, overflow: 'hidden' }}>{subtitle}</span>
      </span>
    </button>
  )
}

function SourceResultCard({ paper, onSave }: { paper: ScholarCandidate; onSave: () => void }) {
  return (
    <div style={sourceCardStyle}>
      <div style={{ fontSize: 12, fontWeight: 850, color: 'var(--color-ink)', lineHeight: 1.45 }}>{paper.title}</div>
      <div style={sourceLineStyle}>{[paper.authors.slice(0, 2).join('、'), paper.year, paper.source].filter(Boolean).join(' · ')}</div>
      {paper.abstract && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--color-ink-2)', lineHeight: 1.5, maxHeight: 52, overflow: 'hidden' }}>{paper.abstract}</div>}
      <button onClick={onSave} disabled={Boolean(paper.savedItemId)} style={secondaryFullButtonStyle}>
        {paper.savedItemId ? '已在文献库' : '加入文献库'}
      </button>
    </div>
  )
}

function Notice({ text, tone }: { text: string; tone: 'info' | 'warn' | 'error' }) {
  const color = tone === 'error' ? '#A13B2D' : tone === 'warn' ? '#8A5A16' : 'var(--color-accent)'
  const background = tone === 'error' ? '#FFF1EF' : tone === 'warn' ? '#FFF7E8' : '#F4FAF5'
  return <div style={{ marginTop: 8, border: `1px solid ${color}22`, borderRadius: 8, background, color, padding: 9, fontSize: 11, lineHeight: 1.6 }}>{text}</div>
}

function EmptyState({ text }: { text: string }) {
  return <div style={emptyStyle}>{text}</div>
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={metricStyle}>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--color-accent)' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)' }}>{label}</div>
    </div>
  )
}

const drawerStyle = {
  width: 420,
  flexShrink: 0,
  borderLeft: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  display: 'flex',
  flexDirection: 'column' as const,
  boxShadow: 'var(--shadow-lg)',
  zIndex: 200,
}

const headerStyle = {
  height: 50,
  padding: '0 12px',
  borderBottom: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const iconButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-ink-3)',
  cursor: 'pointer',
  padding: 4,
}

const workflowStyle = {
  padding: 10,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 7,
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
}

const workflowStepStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '7px 8px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--color-surface)',
}

const tabBarStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 6,
  padding: '9px 10px',
  borderBottom: '1px solid var(--color-border)',
}

const tabButtonStyle = (active: boolean) => ({
  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
  borderRadius: 7,
  background: active ? 'var(--color-accent-light)' : 'transparent',
  color: active ? 'var(--color-accent)' : 'var(--color-ink-3)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '6px 4px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
})

const introStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 11,
  background: 'var(--color-bg)',
  marginBottom: 12,
}

const panelStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 11,
  background: 'var(--color-bg)',
  marginTop: 10,
}

const enhancementHeroStyle = {
  border: '1px solid rgba(45, 90, 61, 0.18)',
  borderRadius: 8,
  background: '#F8FBF8',
  padding: 10,
  display: 'grid',
  gridTemplateColumns: '1fr 130px',
  gap: 8,
  marginBottom: 10,
}

const heroActionStyle = (enabled: boolean) => ({
  ...primaryActionStyle,
  minHeight: 38,
  cursor: enabled ? 'pointer' : 'wait',
  opacity: enabled ? 1 : 0.78,
})

const heroSelectStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: 'var(--color-surface)',
  color: 'var(--color-ink)',
  padding: '0 8px',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const flowPanelStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-bg)',
  padding: 10,
  display: 'grid',
  gap: 8,
}

const flowStepStyle = (active: boolean, done: boolean) => ({
  border: `1px solid ${active || done ? 'rgba(45, 90, 61, 0.22)' : 'var(--color-border)'}`,
  borderRadius: 8,
  background: active || done ? 'var(--color-surface)' : 'transparent',
  padding: 9,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
})

const flowDotStyle = (active: boolean, done: boolean) => ({
  width: 19,
  height: 19,
  borderRadius: 999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background: done ? 'var(--color-accent)' : active ? 'var(--color-accent-light)' : 'var(--color-border)',
  color: done ? '#fff' : 'var(--color-accent)',
})

const resultSummaryStyle = {
  border: '1px solid rgba(45, 90, 61, 0.18)',
  borderRadius: 8,
  background: '#F8FBF8',
  padding: 10,
  display: 'grid',
  gap: 9,
}

const supportGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 7,
}

const supportCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  color: 'var(--color-ink)',
  padding: 8,
  display: 'grid',
  gap: 5,
  justifyItems: 'start',
  cursor: 'pointer',
  textAlign: 'left' as const,
  fontFamily: 'var(--font-sans)',
  minHeight: 70,
}

const selectStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: 'var(--color-surface)',
  padding: '8px 9px',
  color: 'var(--color-ink)',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const actionGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
}

const primaryActionStyle = {
  border: 'none',
  borderRadius: 7,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 800,
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const secondaryActionStyle = (enabled: boolean) => ({
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: enabled ? 'var(--color-surface)' : 'var(--color-bg)',
  color: enabled ? 'var(--color-accent)' : 'var(--color-ink-3)',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 800,
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 6,
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontFamily: 'var(--font-sans)',
})

const applyButtonStyle = (enabled: boolean) => ({
  ...primaryActionStyle,
  width: '100%',
  marginTop: 8,
  background: enabled ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: enabled ? 'pointer' : 'not-allowed',
})

const suggestionCardStyle = (accepted: boolean) => ({
  border: `1px solid ${accepted ? 'var(--color-accent)' : 'var(--color-border)'}`,
  borderRadius: 8,
  padding: 10,
  background: accepted ? 'var(--color-accent-light)' : 'var(--color-bg)',
})

const evidenceCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--color-bg)',
}

const cardMetaStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 5,
  marginBottom: 7,
  fontSize: 10,
  color: 'var(--color-accent)',
}

const quoteStyle = {
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-serif)',
}

const rewriteStyle = {
  marginTop: 4,
  borderLeft: '3px solid rgba(45, 90, 61, 0.42)',
  background: 'rgba(45, 90, 61, 0.055)',
  padding: '7px 9px',
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-serif)',
}

const sourceLineStyle = {
  marginTop: 6,
  fontSize: 10,
  color: 'var(--color-ink-3)',
  lineHeight: 1.45,
}

const sourceLinkStyle = {
  color: 'var(--color-accent)',
  fontWeight: 800,
  textDecoration: 'none',
}

const reasonStyle = {
  marginTop: 6,
  fontSize: 11,
  color: 'var(--color-ink-2)',
  lineHeight: 1.55,
}

const citationPreviewStyle = {
  marginTop: 7,
  border: '1px solid rgba(45, 90, 61, 0.16)',
  borderRadius: 7,
  background: '#F8FBF8',
  padding: 8,
  color: 'var(--color-ink-2)',
  fontSize: 11,
  lineHeight: 1.55,
}

const evidenceDetailsStyle = {
  marginTop: 7,
}

const detailsSummaryStyle = {
  fontSize: 11,
  color: 'var(--color-accent)',
  cursor: 'pointer',
  fontWeight: 800,
}

const smallApplyButtonStyle = (enabled: boolean) => ({
  ...smallPrimaryStyle,
  background: enabled ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: enabled ? 'pointer' : 'not-allowed',
})

const smallPrimaryStyle = {
  border: 'none',
  borderRadius: 6,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '5px 10px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const smallSecondaryStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-ink-3)',
  padding: '5px 10px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const sourceCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 9,
  background: 'var(--color-surface)',
}

const searchBoxStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '7px 9px',
  background: 'var(--color-bg)',
}

const searchInputStyle = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
}

const inputStyle = {
  minWidth: 0,
  flex: 1,
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: 'var(--color-surface)',
  padding: '7px 8px',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const searchButtonStyle = (loading: boolean) => ({
  border: '1px solid var(--color-accent)',
  borderRadius: 7,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '0 10px',
  fontSize: 12,
  cursor: loading ? 'wait' : 'pointer',
  opacity: loading ? 0.7 : 1,
  fontFamily: 'var(--font-sans)',
  whiteSpace: 'nowrap' as const,
})

const toggleRowStyle = (checked: boolean) => ({
  width: '100%',
  border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
  borderRadius: 8,
  background: checked ? 'var(--color-accent-light)' : 'var(--color-surface)',
  padding: 9,
  marginBottom: 7,
  display: 'flex',
  gap: 8,
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
})

const checkBoxStyle = (checked: boolean) => ({
  width: 17,
  height: 17,
  borderRadius: 4,
  border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
  background: checked ? 'var(--color-accent)' : 'transparent',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  marginTop: 1,
})

const secondaryFullButtonStyle = {
  width: '100%',
  marginTop: 7,
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: 'transparent',
  color: 'var(--color-accent)',
  padding: '6px 8px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const emptyStyle = {
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 8,
  padding: 12,
  color: 'var(--color-ink-3)',
  fontSize: 11,
  lineHeight: 1.65,
  background: 'var(--color-bg)',
}

const metricsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
}

const metricStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--color-bg)',
}

const riskCardStyle = (tone: 'ok' | 'warn' | 'error') => ({
  border: `1px solid ${tone === 'ok' ? 'rgba(45, 90, 61, 0.22)' : tone === 'warn' ? 'rgba(138, 90, 22, 0.25)' : 'rgba(161, 59, 45, 0.25)'}`,
  borderRadius: 8,
  padding: 10,
  background: tone === 'ok' ? '#F4FAF5' : tone === 'warn' ? '#FFF7E8' : '#FFF1EF',
  color: tone === 'ok' ? 'var(--color-accent)' : tone === 'warn' ? '#8A5A16' : '#A13B2D',
}
)

const footerStyle = {
  padding: '9px 12px',
  borderTop: '1px solid var(--color-border)',
  fontSize: 11,
  color: 'var(--color-ink-3)',
  lineHeight: 1.6,
}
