import type { PaperEditorMark, PaperEditorNode } from './editorDocument'
import type { SectionFootnote } from './storage'

export interface PaperPageSettings {
  width: number
  height: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  gap: number
  minHeadingFollowHeight: number
  footnoteGap: number
}

export interface PaperLayoutBlock {
  key: string
  sourceKey: string
  type: 'title' | 'paragraph' | 'heading' | 'research' | 'image' | 'table'
  node?: PaperEditorNode
  text?: string
  level?: number
  sectionId?: string
  sourcePos?: number
  fragmentIndex?: number
  continuation?: boolean
  footnoteIds: string[]
}

export interface PaperPage {
  number: number
  blocks: PaperLayoutBlock[]
  footnotes: SectionFootnote[]
}

export interface PaginatedDocument {
  pages: PaperPage[]
  overflowWarnings: string[]
}

export const DEFAULT_PAPER_PAGE_SETTINGS: PaperPageSettings = {
  width: 794,
  height: 1123,
  marginTop: 76,
  marginRight: 86,
  marginBottom: 76,
  marginLeft: 86,
  gap: 28,
  minHeadingFollowHeight: 92,
  footnoteGap: 16,
}

export function editorNodeText(node: PaperEditorNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'researchBlock') return typeof node.attrs?.previewText === 'string' ? node.attrs.previewText : ''
  if (node.type === 'researchImage') return typeof node.attrs?.caption === 'string' ? node.attrs.caption : ''
  if (node.type === 'researchTable') {
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : ''
    const rows = Array.isArray(node.attrs?.rows) ? node.attrs.rows : []
    const columns = Array.isArray(node.attrs?.columns) ? node.attrs.columns : []
    return [title, `${rows.length}行${columns.length}列表格`].filter(Boolean).join('\n')
  }
  return (node.content ?? []).map(editorNodeText).join('')
}

export function footnoteIdsInNode(node: PaperEditorNode | undefined): string[] {
  const ids = new Set<string>()
  const walk = (item: PaperEditorNode | undefined, inheritedMarks: PaperEditorMark[] = []) => {
    if (!item) return
    const marks = [...inheritedMarks, ...(item.marks ?? [])]
    marks.forEach(mark => {
      if (mark.type === 'footnote' && typeof mark.attrs?.footnoteId === 'string') {
        ids.add(mark.attrs.footnoteId)
      }
    })
    ;(item.content ?? []).forEach(child => walk(child, marks))
  }
  walk(node)
  return Array.from(ids)
}

export function buildPaperLayoutBlocks(
  paperTitle: string,
  nodes: PaperEditorNode[],
  sourcePositions: Record<string, number> = {}
): PaperLayoutBlock[] {
  const blocks: PaperLayoutBlock[] = []
  if (paperTitle.trim()) {
    blocks.push({
      key: 'paper-title',
      sourceKey: 'paper-title',
      type: 'title',
      text: paperTitle.trim(),
      footnoteIds: [],
    })
  }

  nodes.forEach((node, index) => {
    if (node.type !== 'paragraph' && node.type !== 'heading' && node.type !== 'researchBlock' && node.type !== 'researchImage' && node.type !== 'researchTable') return
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : undefined
    const sectionId = typeof node.attrs?.sectionId === 'string' ? node.attrs.sectionId : undefined
    const sourceKey = blockSourceKey(node, index)
    blocks.push({
      key: sourceKey,
      sourceKey,
      type: node.type === 'researchBlock' ? 'research' : node.type === 'researchImage' ? 'image' : node.type === 'researchTable' ? 'table' : node.type,
      node,
      level,
      sectionId,
      sourcePos: sourcePositions[sourceKey],
      footnoteIds: footnoteIdsInNode(node),
    })
  })

  return blocks
}

export function blockSourceKey(node: PaperEditorNode, index: number): string {
  const sectionId = typeof node.attrs?.sectionId === 'string' ? node.attrs.sectionId : ''
  const outlineNodeId = typeof node.attrs?.outlineNodeId === 'string' ? node.attrs.outlineNodeId : ''
  return `${node.type}-${sectionId || outlineNodeId || index}-${index}`
}

function fallbackBlockHeight(block: PaperLayoutBlock, settings: PaperPageSettings): number {
  const textLength = (block.text ?? editorNodeText(block.node)).length
  const contentWidth = settings.width - settings.marginLeft - settings.marginRight
  const charsPerLine = Math.max(18, Math.floor(contentWidth / 15))
  if (block.type === 'title') return 112
  if (block.type === 'heading') {
    const base = block.level === 2 ? 62 : 42
    return base + Math.max(0, Math.ceil(textLength / charsPerLine) - 1) * 26
  }
  if (block.type === 'image') return 360
  if (block.type === 'table') {
    const rows = Array.isArray(block.node?.attrs?.rows) ? block.node.attrs.rows.length : 1
    return Math.max(120, 72 + rows * 34)
  }
  if (block.type === 'research') return Math.max(84, Math.ceil(Math.max(1, textLength) / charsPerLine) * 24 + 54)
  return Math.max(34, Math.ceil(Math.max(1, textLength) / charsPerLine) * 30 + 10)
}

function footnoteHeight(footnotes: SectionFootnote[], measuredFootnotes: Record<string, number>): number {
  if (footnotes.length === 0) return 0
  return 12 + footnotes.reduce((sum, footnote) => {
    return sum + (measuredFootnotes[footnote.id] ?? Math.max(18, Math.ceil(footnote.noteText.length / 52) * 15))
  }, 0)
}

function cloneParagraphFragment(block: PaperLayoutBlock, text: string, fragmentIndex: number, continuation: boolean): PaperLayoutBlock {
  return {
    ...block,
    key: `${block.sourceKey}-fragment-${fragmentIndex}`,
    node: undefined,
    text,
    fragmentIndex,
    continuation,
    footnoteIds: continuation ? [] : block.footnoteIds,
  }
}

function splitLongParagraph(
  block: PaperLayoutBlock,
  availableHeight: number,
  measuredHeight: number,
  settings: PaperPageSettings
): PaperLayoutBlock[] {
  const text = editorNodeText(block.node).trim()
  if (!text || measuredHeight <= availableHeight) return [block]
  const fullBodyHeight = settings.height - settings.marginTop - settings.marginBottom
  const effectiveHeight = Math.max(90, Math.min(fullBodyHeight, availableHeight))
  const ratio = Math.max(0.12, Math.min(0.9, effectiveHeight / measuredHeight))
  const chunkSize = Math.max(90, Math.floor(text.length * ratio))
  const fragments: PaperLayoutBlock[] = []
  let cursor = 0
  let fragmentIndex = 0
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + chunkSize)
    if (end < text.length) {
      const punctuation = Math.max(
        text.lastIndexOf('。', end),
        text.lastIndexOf('；', end),
        text.lastIndexOf('.', end),
        text.lastIndexOf(';', end)
      )
      if (punctuation > cursor + 45) end = punctuation + 1
    }
    fragments.push(cloneParagraphFragment(block, text.slice(cursor, end).trim(), fragmentIndex, fragmentIndex > 0))
    cursor = end
    fragmentIndex += 1
  }
  return fragments
}

export function paginatePaperBlocks(
  blocks: PaperLayoutBlock[],
  footnotes: SectionFootnote[],
  measuredBlocks: Record<string, number>,
  measuredFootnotes: Record<string, number>,
  settings: PaperPageSettings = DEFAULT_PAPER_PAGE_SETTINGS
): PaginatedDocument {
  const footnotesById = new Map(footnotes.map(footnote => [footnote.id, footnote]))
  const bodyHeight = settings.height - settings.marginTop - settings.marginBottom
  const pages: PaperPage[] = []
  const overflowWarnings: string[] = []

  let page: PaperPage = { number: 1, blocks: [], footnotes: [] }
  let usedHeight = 0

  const currentFootnoteReserve = (candidateIds: string[] = []) => {
    const nextFootnotes = new Map(page.footnotes.map(footnote => [footnote.id, footnote]))
    candidateIds.forEach(id => {
      const footnote = footnotesById.get(id)
      if (footnote) nextFootnotes.set(id, footnote)
    })
    const height = footnoteHeight(Array.from(nextFootnotes.values()), measuredFootnotes)
    return height > 0 ? height + settings.footnoteGap : 0
  }

  const availableForPage = (candidateIds: string[] = []) => bodyHeight - currentFootnoteReserve(candidateIds)
  const finishPage = () => {
    pages.push(page)
    page = { number: pages.length + 1, blocks: [], footnotes: [] }
    usedHeight = 0
  }

  const addFootnotes = (ids: string[]) => {
    ids.forEach(id => {
      const footnote = footnotesById.get(id)
      if (footnote && !page.footnotes.some(item => item.id === id)) {
        page.footnotes.push(footnote)
      }
    })
    page.footnotes.sort((a, b) => a.number - b.number)
  }

  const queue = [...blocks]
  while (queue.length > 0) {
    const block = queue.shift()!
    const rawHeight = measuredBlocks[block.key] ?? measuredBlocks[block.sourceKey] ?? fallbackBlockHeight(block, settings)
    const blockHeight = Math.max(12, Math.ceil(rawHeight))
    const nextBlock = queue[0]
    const nextHeight = nextBlock
      ? measuredBlocks[nextBlock.key] ?? measuredBlocks[nextBlock.sourceKey] ?? fallbackBlockHeight(nextBlock, settings)
      : 0
    const headingNeedsMove = block.type === 'heading' && nextBlock && usedHeight + blockHeight + Math.min(nextHeight, settings.minHeadingFollowHeight) > availableForPage(block.footnoteIds)
    const wouldOverflow = usedHeight + blockHeight > availableForPage(block.footnoteIds)

    if ((headingNeedsMove || wouldOverflow) && page.blocks.length > 0) {
      finishPage()
      queue.unshift(block)
      continue
    }

    if (wouldOverflow && page.blocks.length === 0 && block.type === 'paragraph' && editorNodeText(block.node).length > 180) {
      const fragments = splitLongParagraph(block, availableForPage(block.footnoteIds), blockHeight, settings)
      if (fragments.length > 1) {
        queue.unshift(...fragments)
        continue
      }
    }

    if (wouldOverflow && page.blocks.length === 0) {
      overflowWarnings.push(`${block.type === 'heading' ? '标题' : block.type === 'research' ? '研究结果块' : '段落'}内容超过单页可用高度，已临时整块放置。`)
    }

    page.blocks.push(block)
    addFootnotes(block.footnoteIds)
    usedHeight += blockHeight
  }

  if (page.blocks.length > 0 || pages.length === 0) pages.push(page)
  return { pages, overflowWarnings }
}
