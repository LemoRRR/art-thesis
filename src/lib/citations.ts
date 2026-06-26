import { formatSectionContent, parsePaperBlocks } from './documentFormat'
import { nextFootnoteNumber } from './footnotes'
import { libraryStore, referenceStore, type CitationEvidencePack, type CitationEvidenceSource, type DocSection, type LibraryItem, type SectionFootnote } from './storage'

export interface CitableSource {
  key: string
  libraryItemId?: string
  autoSourceId?: string
  title: string
  noteText: string
}

const CITATION_MARKER = /\{\{cite:([^}]+)\}\}/g

function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function buildNoteText(item: LibraryItem): string {
  const title = item.title.trim()
  const fileHint = item.fileName ? ` ${item.fileName.replace(/\.[^.]+$/, '')}` : ''
  if (item.summary?.trim()) return `${title}${fileHint}. ${item.summary.trim().slice(0, 120)}`
  if (item.text?.trim()) return `${title}${fileHint}. ${item.text.trim().slice(0, 100)}`
  return `${title}${fileHint}.`
}

export function buildCitableSources(libraryItemIds: string[]): CitableSource[] {
  const uniqueIds = Array.from(new Set(libraryItemIds))
  return uniqueIds
    .map(id => libraryStore.get(id))
    .filter((item): item is LibraryItem => item !== null)
    .filter(item => item.type !== 'style' && item.type !== 'background')
    .map((item, index) => ({
      key: `S${index + 1}`,
      libraryItemId: item.id,
      title: item.title,
      noteText: buildNoteText(item),
    }))
}

function buildAutoSourceNoteText(source: CitationEvidenceSource): string {
  const authors = source.authors?.length ? source.authors.slice(0, 3).join('、') : '作者未详'
  const year = source.year ? `${source.year}` : '年份未详'
  const publication = source.source ? ` ${source.source}` : ''
  const doi = source.doi ? ` DOI：${source.doi}` : ''
  const reason = source.relevanceReason?.trim() ? ` 可用依据：${source.relevanceReason.trim().slice(0, 180)}` : ''
  const abstract = source.abstract?.trim() ? ` 摘要依据：${source.abstract.trim().slice(0, 420)}` : ''
  return `${authors}. ${source.title}. ${year}.${publication}${doi}.${reason}${abstract}`.replace(/\s+/g, ' ').trim()
}

export function buildAutoCitableSources(autoSources: CitationEvidenceSource[], offset = 0): CitableSource[] {
  return autoSources
    .filter(source => source.title?.trim())
    .slice(0, 20)
    .map((source, index) => ({
      key: `S${offset + index + 1}`,
      autoSourceId: source.id,
      title: source.title,
      noteText: buildAutoSourceNoteText(source),
    }))
}

export function formatCitableSourcesForPrompt(sources: CitableSource[]): string {
  if (sources.length === 0) return ''
  const lines = sources.map(source => `[${source.key}] ${source.noteText}`)
  return `【可引用文献清单（只能从这里选用，不要编造来源）】\n${lines.join('\n')}`
}

function normalizeEvidenceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, ' ')
    .trim()
}

function evidenceTokens(text: string): string[] {
  const normalized = normalizeEvidenceText(text)
  const words = normalized.split(/\s+/).filter(word => word.length >= 2)
  const compactCjk = normalized.replace(/[^\u4e00-\u9fff]/g, '')
  const cjkTokens: string[] = []
  for (let index = 0; index < compactCjk.length - 1; index += 1) {
    cjkTokens.push(compactCjk.slice(index, index + 2))
  }
  return Array.from(new Set([...words, ...cjkTokens])).slice(0, 80)
}

export function selectCitableSourcesForTopic(
  sources: CitableSource[],
  topic: string,
  limit = 8
): CitableSource[] {
  if (sources.length <= limit) return sources
  const tokens = evidenceTokens(topic)
  if (tokens.length === 0) return sources.slice(0, limit)

  const scored = sources.map((source, index) => {
    const haystack = normalizeEvidenceText(`${source.title} ${source.noteText}`)
    const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
    return { source, index, score }
  })

  const relevant = scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.source)
    .slice(0, limit)

  if (relevant.length >= Math.min(3, limit)) return relevant
  const selectedKeys = new Set(relevant.map(source => source.key))
  const fallback = sources.filter(source => !selectedKeys.has(source.key)).slice(0, limit - relevant.length)
  return [...relevant, ...fallback]
}

export function formatEvidenceWritingRules(hasSources: boolean): string {
  if (!hasSources) {
    return [
      '【检索增强写作规则】',
      '- 本次未获得可靠学术来源：可以继续写作，但不得编造作者、年份、期刊、DOI、脚注或参考文献。',
      '- 对需要文献支撑的概念、理论、数据、研究现状和案例判断，用谨慎表述，避免伪装成已有研究结论。',
    ].join('\n')
  }

  return [
    '【检索增强写作规则】',
    '- 先阅读“可引用文献清单”，再组织本章论证；不要把来源当作末尾列表，而要把其概念、研究发现、方法背景或案例依据融入正文。',
    '- 引用是给“观点/判断句”提供依据，不是给普通描述、过渡句或关键词装饰；先写出可被文献支撑的判断，再在该完整判断句句末写 {{cite:S编号}}。',
    '- 定义概念、梳理研究现状、说明理论依据、比较已有观点、引用案例或数据时，优先使用来源支撑，并在对应完整句句末写 {{cite:S编号}}。',
    '- 引用必须“事实对齐”：只有当该句的核心判断能被该来源的题名、摘要依据或可用依据直接支撑时才加引用；如果只是主题相近但不能支撑句子事实，不要加引用。',
    '- 只能引用清单中真实存在的 S 编号；不得编造作者、年份、题名、期刊、页码、DOI 或不存在的研究。',
    '- 不要为了凑数量而密集堆引用；每个小节优先 1-3 处关键引用，放在最需要依据的判断之后。',
    '- 若来源与当前章节不匹配，应少用或不用引用，并用论文自身材料完成分析。',
  ].join('\n')
}

function sourceKeyForEvidenceId(sourceById: Map<string, CitableSource>, sourceId: string): string {
  return sourceById.get(sourceId)?.key ?? sourceId
}

function formatEvidencePoints(
  title: string,
  points: CitationEvidencePack[keyof Pick<CitationEvidencePack, 'theoryConcepts' | 'literatureReview' | 'methodSupport' | 'caseEvidence'>],
  sourceById: Map<string, CitableSource>
): string {
  if (!points?.length) return ''
  const lines = points.slice(0, 8).map(point => {
    const keys = (point.sourceIds ?? []).map(id => sourceKeyForEvidenceId(sourceById, id)).filter(Boolean).join(', ')
    return `- ${point.claim}${keys ? `（建议引用：${keys}）` : ''}${point.writingUse ? `；写作用法：${point.writingUse}` : ''}`
  })
  return `【${title}】\n${lines.join('\n')}`
}

export function formatEvidencePackForPrompt(pack: CitationEvidencePack | undefined, sources: CitableSource[]): string {
  if (!pack) return ''
  const sourceById = new Map<string, CitableSource>()
  sources.forEach(source => {
    if (source.autoSourceId) sourceById.set(source.autoSourceId, source)
    if (source.libraryItemId) sourceById.set(source.libraryItemId, source)
  })

  const chapterLines = (pack.chapterEvidence ?? []).slice(0, 12).map(chapter => {
    const keys = (chapter.sourceIds ?? []).map(id => sourceKeyForEvidenceId(sourceById, id)).filter(Boolean).join(', ')
    const points = (chapter.keyPoints ?? []).slice(0, 4).map(point => {
      const pointKeys = (point.sourceIds ?? []).map(id => sourceKeyForEvidenceId(sourceById, id)).filter(Boolean).join(', ')
      return `  - ${point.claim}${pointKeys ? `（${pointKeys}）` : ''}`
    }).join('\n')
    return [
      `- ${chapter.chapterTitle}${keys ? `（建议来源：${keys}）` : ''}`,
      chapter.writingPlan ? `  写作计划：${chapter.writingPlan}` : '',
      points,
    ].filter(Boolean).join('\n')
  })
  const planLines = (pack.chapterCitationPlans ?? []).slice(0, 16).map(plan => {
    const ids = [
      ...plan.mustUseSourceIds,
      ...plan.theorySourceIds,
      ...plan.literatureSourceIds,
      ...plan.methodSourceIds,
      ...plan.caseSourceIds,
    ]
    const keys = Array.from(new Set(ids))
      .map(id => sourceKeyForEvidenceId(sourceById, id))
      .filter(Boolean)
      .slice(0, 10)
      .join(', ')
    return [
      `- ${plan.sectionTitle}：最终目标约 ${plan.targetCitationCount} 处引用，第一版先写 ${plan.firstDraftCitationCount} 处关键引用。`,
      keys ? `  优先来源：${keys}` : '',
      plan.writingGuidance ? `  写作指引：${plan.writingGuidance}` : '',
    ].filter(Boolean).join('\n')
  })
  const goal = pack.citationGoal
  void planLines
  void goal

  return [
    '【论文证据包：先读文献再写正文】',
    pack.summary ? `整体证据判断：${pack.summary}` : '',
    formatEvidencePoints('核心理论/概念定义', pack.theoryConcepts, sourceById),
    formatEvidencePoints('研究现状/已有观点', pack.literatureReview, sourceById),
    formatEvidencePoints('方法依据', pack.methodSupport, sourceById),
    formatEvidencePoints('案例或对象分析依据', pack.caseEvidence, sourceById),
    chapterLines.length ? `【章节证据分配】\n${chapterLines.join('\n')}` : '',
    pack.cautions?.length ? `【引用风险提醒】\n${pack.cautions.map(item => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export function formatChapterEvidenceForPrompt(
  pack: CitationEvidencePack | undefined,
  sources: CitableSource[],
  chapterTitle: string
): string {
  if (!pack?.chapterEvidence?.length) return ''
  const normalizedTitle = normalizeEvidenceText(chapterTitle)
  const chapter = pack.chapterEvidence.find(item => {
    const candidate = normalizeEvidenceText(item.chapterTitle)
    return candidate && (normalizedTitle.includes(candidate) || candidate.includes(normalizedTitle))
  }) ?? pack.chapterEvidence.find(item =>
    evidenceTokens(chapterTitle).some(token => normalizeEvidenceText(item.chapterTitle).includes(token))
  )
  if (!chapter) return ''

  const sourceById = new Map<string, CitableSource>()
  sources.forEach(source => {
    if (source.autoSourceId) sourceById.set(source.autoSourceId, source)
    if (source.libraryItemId) sourceById.set(source.libraryItemId, source)
  })

  const keys = (chapter.sourceIds ?? []).map(id => sourceKeyForEvidenceId(sourceById, id)).filter(Boolean).join(', ')
  const points = (chapter.keyPoints ?? []).slice(0, 6).map(point => {
    const pointKeys = (point.sourceIds ?? []).map(id => sourceKeyForEvidenceId(sourceById, id)).filter(Boolean).join(', ')
    return `- ${point.claim}${pointKeys ? `（建议引用：${pointKeys}）` : ''}${point.writingUse ? `；写作用法：${point.writingUse}` : ''}`
  }).join('\n')

  return [
    '【本章证据写作卡】',
    `章节：${chapter.chapterTitle}`,
    keys ? `优先来源：${keys}` : '',
    chapter.writingPlan ? `写作计划：${chapter.writingPlan}` : '',
    points,
  ].filter(Boolean).join('\n')
}

export function formatCitationPlanForPrompt(pack: CitationEvidencePack | undefined, sources: CitableSource[]): string {
  if (!pack?.citationGoal && !pack?.chapterCitationPlans?.length) return ''
  const sourceById = new Map<string, CitableSource>()
  sources.forEach(source => {
    if (source.autoSourceId) sourceById.set(source.autoSourceId, source)
    if (source.libraryItemId) sourceById.set(source.libraryItemId, source)
  })
  const goal = pack.citationGoal
  const goalText = goal
    ? `最终正文目标约 ${goal.targetFinalCitationCount} 处/篇引用，最低不少于 ${goal.minAcceptableCitationCount}，最多不超过 ${goal.maxCitationCount}；第一版正文先稳定形成 ${goal.firstDraftCitationCount} 处关键引用，后续“引用增强”再补齐。`
    : ''
  const chapterText = (pack.chapterCitationPlans ?? []).slice(0, 16).map(plan => {
    const ids = [
      ...plan.mustUseSourceIds,
      ...plan.theorySourceIds,
      ...plan.literatureSourceIds,
      ...plan.methodSourceIds,
      ...plan.caseSourceIds,
    ]
    const keys = Array.from(new Set(ids))
      .map(id => sourceKeyForEvidenceId(sourceById, id))
      .filter(Boolean)
      .slice(0, 10)
      .join(', ')
    return [
      `- ${plan.sectionTitle}: 最终约 ${plan.targetCitationCount} 处引用；第一版先写 ${plan.firstDraftCitationCount} 处关键引用。`,
      keys ? `  优先来源: ${keys}` : '',
      plan.writingGuidance ? `  写作指引: ${plan.writingGuidance}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  return [
    '【引用完成版目标与章节证据地图】',
    goalText,
    chapterText,
  ].filter(Boolean).join('\n')
}

export function getCitationPromptRules(hasSources: boolean): string {
  if (!hasSources) {
    return '- 当前没有可引用文献清单，不要编造引用、文献或脚注标记。'
  }

  return `- 本次生成必须优先吸收“可引用文献清单”中的资料：如果清单与当前章节主题相关，至少使用 1-3 条文献支撑核心判断、概念界定、案例说明或研究背景。
- 引用是给“观点/判断句”提供依据，不是给普通描述、过渡句或关键词装饰；先写出可被文献支撑的判断，再在该完整判断句句末写 {{cite:S编号}}。
- 不要只在参考文献末尾列出文献，必须把文献观点自然写入正文论证中。
- 使用“可引用文献清单”中的观点、概念、数据或案例时，在对应完整句句末插入内部引用标记：{{cite:S1}}；同一句可引用多篇：{{cite:S1,S2}}。
- 引用必须“事实对齐”：被引用句子的核心判断，要能被该来源的题名、摘要依据或可用依据直接支撑；如果只是主题接近但不能证明该句，不要加引用。
- 只能使用清单里的 S 编号，不要编造作者、年份、页码或来源。
- 不要直接手写 [1]、[2]。系统会把 {{cite:S1}} 自动转换成正文可见的 [1]，并在参考文献中生成对应的 [1] 条目；同一份资料反复引用时始终使用同一个编号。
- 没有依据的句子不要加引用标记。
- 每段 1-3 处引用即可，优先放在核心判断、定义、案例或数据之后。`
}

export function stripCitationMarkers(content: string): string {
  return content.replace(CITATION_MARKER, '').replace(/[ \t]+$/gm, '').trim()
}

function findAnchorRange(textBeforeMarker: string): { start: number; end: number; anchorText: string } {
  const trimmed = textBeforeMarker.trimEnd()
  const end = trimmed.length
  if (end === 0) return { start: 0, end: 0, anchorText: '' }

  const sentenceBreaks = ['。', '；', ';', '！', '？', '!', '?', '\n']
  const sentenceStart = sentenceBreaks.reduce((latest, mark) => {
    const index = trimmed.lastIndexOf(mark)
    return index > latest ? index : latest
  }, -1)

  const rawStart = sentenceStart >= 0 ? sentenceStart + 1 : 0
  const sentence = trimmed.slice(rawStart, end).trim()
  const start = sentence.length > 0
    ? rawStart + trimmed.slice(rawStart, end).indexOf(sentence)
    : Math.max(0, end - 24)
  const anchorText = sentence || trimmed.slice(Math.max(0, end - 24), end).trim()
  return { start, end, anchorText }
}

function citationNumberForKey(key: string, fallbackNumber: number): number {
  const match = key.match(/^S(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : fallbackNumber
}

export function applyCitationsToContent(
  rawContent: string,
  sources: CitableSource[],
  startNumber: number
): { content: string; footnotes: SectionFootnote[] } {
  const sourceMap = new Map(sources.map(source => [source.key, source]))
  const footnotes: SectionFootnote[] = []
  let footnoteNumber = startNumber

  const blocks = parsePaperBlocks(rawContent)
  if (blocks.length === 0) {
    return { content: stripCitationMarkers(rawContent), footnotes: [] }
  }

  const cleanBlocks = blocks.map((block, blockIndex) => {
    let text = block.text
    const matches = [...text.matchAll(CITATION_MARKER)].reverse()

    matches.forEach(match => {
      const marker = match[0]
      const markerIndex = match.index ?? 0
      const keys = match[1].split(',').map(key => key.trim()).filter(Boolean)
      const { start, end, anchorText } = findAnchorRange(text.slice(0, markerIndex))

      keys.forEach(key => {
        const source = sourceMap.get(key)
        if (!source || !anchorText) return
        footnotes.push({
          id: uid(),
          number: citationNumberForKey(key, footnoteNumber),
          blockIndex,
          start,
          end,
          anchorText,
          noteText: source.noteText,
        })
        if (!/^S\d+$/.test(key)) footnoteNumber += 1
      })

      text = `${text.slice(0, markerIndex)}${text.slice(markerIndex + marker.length)}`.trimEnd()
    })

    return text.trim()
  })

  footnotes.sort((a, b) => a.number - b.number)

  return {
    content: formatSectionContent(cleanBlocks.join('\n\n')),
    footnotes,
  }
}

export function renumberAllFootnotes(sections: DocSection[]): DocSection[] {
  let number = 1
  return sections.map(section => ({
    ...section,
    footnotes: (section.footnotes ?? [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map(footnote => ({ ...footnote, number: number++ })),
  }))
}

export function finalizeSectionWithCitations(
  sections: DocSection[],
  sectionId: string,
  rawContent: string,
  sources: CitableSource[]
): DocSection[] {
  const cleared = sections.map(section =>
    section.id === sectionId ? { ...section, footnotes: [] } : section
  )
  const renumbered = sources.length > 0 ? cleared : renumberAllFootnotes(cleared)
  const startNumber = nextFootnoteNumber(renumbered)
  const { content, footnotes } = applyCitationsToContent(rawContent, sources, startNumber)

  return renumbered.map(section =>
    section.id === sectionId
      ? { ...section, content, footnotes, lastModified: Date.now() }
      : section
  )
}

export function getStageCitableSources(projectId: string, mentionItemIds: string[] = []): CitableSource[] {
  const selection = referenceStore.get(projectId, 'stage3')
  const ids = Array.from(new Set([...selection.libraryItemIds, ...mentionItemIds]))
  const autoSources = selection.autoCitationEnabled === false
    ? []
    : buildAutoCitableSources(selection.autoSources ?? [])
  const manualSources = buildCitableSources(ids).map((source, index) => ({
    ...source,
    key: `S${autoSources.length + index + 1}`,
  }))
  return [...autoSources, ...manualSources]
}
