import { formatSectionContent, parsePaperBlocks } from './documentFormat'
import { nextFootnoteNumber } from './footnotes'
import { libraryStore, referenceStore, type DocSection, type LibraryItem, type SectionFootnote } from './storage'

export interface CitableSource {
  key: string
  libraryItemId: string
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

export function formatCitableSourcesForPrompt(sources: CitableSource[]): string {
  if (sources.length === 0) return ''
  const lines = sources.map(source => `[${source.key}] ${source.noteText}`)
  return `【可引用文献清单（只能从这里选用，不要编造来源）】\n${lines.join('\n')}`
}

export function getCitationPromptRules(hasSources: boolean): string {
  if (!hasSources) {
    return '- 当前没有可引用文献清单，不要编造引用、文献或脚注标记。'
  }

  return `- 使用“可引用文献清单”中的观点、概念、数据或案例时，在对应句末插入内部引用标记：{{cite:S1}}；同一句可引用多篇：{{cite:S1,S2}}。
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

  const sentenceStart = Math.max(
    trimmed.lastIndexOf('。'),
    trimmed.lastIndexOf('；'),
    trimmed.lastIndexOf(';'),
    trimmed.lastIndexOf('，'),
    trimmed.lastIndexOf(','),
    trimmed.lastIndexOf('. '),
  )

  const start = sentenceStart >= 0 && sentenceStart > end - 36
    ? sentenceStart + 1
    : Math.max(0, end - 10)
  const anchorText = trimmed.slice(start, end).trim() || trimmed.slice(Math.max(0, end - 6), end)
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
  return buildCitableSources(ids)
}
