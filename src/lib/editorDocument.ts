import { isDuplicateSectionTitle, parsePaperBlocks, type PaperBlockType } from './documentFormat'
import type { DocSection, OutlineSection, SectionFootnote } from './storage'

export interface PaperEditorMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PaperEditorNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: PaperEditorMark[]
  content?: PaperEditorNode[]
}

export interface PaperEditorDoc {
  type: 'doc'
  attrs?: Record<string, unknown>
  content: PaperEditorNode[]
}

function blockTypeToNode(blockType: PaperBlockType): PaperEditorNode['type'] {
  return blockType === 'paragraph' ? 'paragraph' : 'heading'
}

function blockTypeToLevel(blockType: PaperBlockType): number | undefined {
  if (blockType === 'heading2') return 2
  if (blockType === 'heading3') return 3
  return undefined
}

function textNode(text: string): PaperEditorNode {
  return { type: 'text', text }
}

export function paperTextToEditorDoc(content: string): PaperEditorDoc {
  const blocks = parsePaperBlocks(content)
  if (blocks.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  return {
    type: 'doc',
    content: blocks.map(block => {
      const level = blockTypeToLevel(block.type)
      return {
        type: blockTypeToNode(block.type),
        attrs: level ? { level } : undefined,
        content: block.text ? [textNode(block.text)] : undefined,
      }
    }),
  }
}

export function isPaperEditorDoc(value: unknown): value is PaperEditorDoc {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as PaperEditorDoc).type === 'doc' &&
    Array.isArray((value as PaperEditorDoc).content)
  )
}

export function ensurePaperEditorDoc(content: string, editorDoc?: unknown): PaperEditorDoc {
  return isPaperEditorDoc(editorDoc) ? editorDoc : paperTextToEditorDoc(content)
}

function nodeText(node: PaperEditorNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'researchBlock') return typeof node.attrs?.previewText === 'string' ? node.attrs.previewText : ''
  if (node.type === 'researchImage') return typeof node.attrs?.caption === 'string' ? node.attrs.caption : ''
  return (node.content ?? []).map(nodeText).join('')
}

export function editorDocToPlainText(doc: PaperEditorDoc): string {
  return (doc.content ?? [])
    .map(node => nodeText(node).trim())
    .filter(Boolean)
    .join('\n\n')
}

function sectionNodeId(section: DocSection, index: number): string {
  return section.id || section.outlineNodeId || `section-${index + 1}`
}

function headingNodeForSection(section: DocSection, index: number): PaperEditorNode {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      textAlign: 'center',
      sectionTitle: true,
      lockedLevel: 2,
      sectionId: sectionNodeId(section, index),
      outlineNodeId: section.outlineNodeId,
    },
    content: section.title ? [{ type: 'text', text: section.title }] : undefined,
  }
}

function sectionBodyNodes(section: DocSection): PaperEditorNode[] {
  const sourceDoc = ensurePaperEditorDoc(section.content, section.editorDoc)
  const bodyNodes = (sourceDoc.content ?? []).filter((node, index) => {
    if (index !== 0 || node.type !== 'heading') return true
    return !isDuplicateSectionTitle(nodeText(node), section.title)
  })
  return applyFootnoteMarksToNodes(bodyNodes, section.footnotes ?? [])
}

function splitTextNodeWithFootnotes(node: PaperEditorNode, footnotes: SectionFootnote[]): PaperEditorNode[] {
  const text = node.text ?? ''
  if (!text || footnotes.length === 0) return [node]

  const boundaries = new Set([0, text.length])
  footnotes.forEach(footnote => {
    boundaries.add(Math.max(0, Math.min(text.length, footnote.start)))
    boundaries.add(Math.max(0, Math.min(text.length, footnote.end)))
  })

  const sorted = Array.from(boundaries).sort((a, b) => a - b)
  const result: PaperEditorNode[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    const chunk = text.slice(start, end)
    if (!chunk) continue
    const activeFootnotes = footnotes.filter(footnote => start >= footnote.start && end <= footnote.end)
    const footnoteMarks: PaperEditorMark[] = activeFootnotes.map(footnote => ({
      type: 'footnote',
      attrs: {
        footnoteId: footnote.id,
        footnoteNumber: footnote.number,
        noteText: footnote.noteText,
      },
    }))
    result.push({
      ...node,
      text: chunk,
      marks: [...(node.marks ?? []), ...footnoteMarks],
    })
  }
  return result.length > 0 ? result : [node]
}

function applyFootnoteMarksToNode(node: PaperEditorNode, footnotes: SectionFootnote[]): PaperEditorNode {
  if (node.type === 'text') return node
  if (!node.content?.length || footnotes.length === 0) return node

  let cursor = 0
  const content = node.content.flatMap(child => {
    if (child.type !== 'text') return [applyFootnoteMarksToNode(child, footnotes)]
    const text = child.text ?? ''
    const childStart = cursor
    const childEnd = cursor + text.length
    cursor = childEnd
    const childFootnotes = footnotes
      .filter(footnote => footnote.end > childStart && footnote.start < childEnd)
      .map(footnote => ({
        ...footnote,
        start: Math.max(0, footnote.start - childStart),
        end: Math.min(text.length, footnote.end - childStart),
      }))
    return splitTextNodeWithFootnotes(child, childFootnotes)
  })
  return { ...node, content }
}

function applyFootnoteMarksToNodes(nodes: PaperEditorNode[], footnotes: SectionFootnote[]): PaperEditorNode[] {
  if (footnotes.length === 0) return nodes
  if (footnoteIdsInNodes(nodes).size > 0) return nodes
  const footnotesByBlock = new Map<number, SectionFootnote[]>()
  footnotes.forEach(footnote => {
    const list = footnotesByBlock.get(footnote.blockIndex) ?? []
    list.push(footnote)
    footnotesByBlock.set(footnote.blockIndex, list)
  })
  return nodes.map((node, index) => applyFootnoteMarksToNode(node, footnotesByBlock.get(index) ?? []))
}

export function editorDocWithFootnoteMarks(section: DocSection): PaperEditorDoc {
  const sourceDoc = ensurePaperEditorDoc(section.content, section.editorDoc)
  const sourceContent = sourceDoc.content ?? []
  const firstNode = sourceContent[0]
  const firstNodeIsDuplicateHeading = firstNode?.type === 'heading' && isDuplicateSectionTitle(nodeText(firstNode), section.title)
  const markableContent = firstNodeIsDuplicateHeading ? sourceContent.slice(1) : sourceContent
  const markedContent = applyFootnoteMarksToNodes(markableContent, section.footnotes ?? [])
  return {
    ...sourceDoc,
    content: firstNodeIsDuplicateHeading ? [firstNode, ...markedContent] : markedContent,
  }
}

function outlineNodeIds(sections: OutlineSection[] | undefined, ids = new Set<string>()) {
  ;(sections ?? []).forEach(section => {
    ids.add(section.id)
    outlineNodeIds(section.children, ids)
  })
  return ids
}

export function sectionsToPaperDoc(
  _projectTitle: string,
  sections: DocSection[],
  outline?: { sections?: OutlineSection[] } | null
): PaperEditorDoc {
  const validOutlineIds = outlineNodeIds(outline?.sections)
  const footnotes = sections.flatMap(section => section.footnotes ?? [])

  return {
    type: 'doc',
    attrs: {
      footnotes,
      outlineNodeIds: Array.from(validOutlineIds),
    },
    content: sections.flatMap((section, index) => [
      headingNodeForSection(section, index),
      ...sectionBodyNodes(section),
    ]),
  }
}

function footnoteIdsInNodes(nodes: PaperEditorNode[]) {
  const ids = new Set<string>()
  walkEditorText(nodes, (_text, marks) => {
    marks.forEach(mark => {
      if (mark.type === 'footnote' && typeof mark.attrs?.footnoteId === 'string') {
        ids.add(mark.attrs.footnoteId)
      }
    })
  })
  return ids
}

function sectionFootnotesFromNodes(nodes: PaperEditorNode[], previous?: DocSection): SectionFootnote[] | undefined {
  const previousFootnotes = previous?.footnotes ?? []
  if (previousFootnotes.length === 0) return undefined
  const usedIds = footnoteIdsInNodes(nodes)
  if (usedIds.size === 0) return previousFootnotes
  return previousFootnotes.filter(footnote => usedIds.has(footnote.id))
}

function sectionTitleNode(node: PaperEditorNode) {
  return node.type === 'heading' && (node.attrs?.sectionTitle === true || typeof node.attrs?.sectionId === 'string')
}

export function paperDocToSections(doc: PaperEditorDoc, previousSections: DocSection[]): DocSection[] {
  const previousById = new Map(previousSections.map(section => [section.id, section]))
  const next: DocSection[] = []
  let currentHeading: PaperEditorNode | null = null
  let currentBody: PaperEditorNode[] = []

  const flush = () => {
    if (!currentHeading) return
    const rawSectionId = currentHeading.attrs?.sectionId
    const id = typeof rawSectionId === 'string' && rawSectionId.trim() ? rawSectionId : `section-${next.length + 1}`
    const previous = previousById.get(id)
    const title = nodeText(currentHeading).trim() || previous?.title || '未命名章节'
    const editorDoc: PaperEditorDoc = {
      type: 'doc',
      content: [currentHeading!, ...currentBody],
    }
    next.push({
      ...previous,
      id,
      title,
      content: editorDocToPlainText({ type: 'doc', content: currentBody }),
      editorDoc,
      footnotes: sectionFootnotesFromNodes([currentHeading!, ...currentBody], previous),
      status: previous?.status ?? 'done',
      lastModified: Date.now(),
      order: previous?.order ?? next.length,
      outlineNodeId: typeof currentHeading!.attrs?.outlineNodeId === 'string' ? currentHeading!.attrs.outlineNodeId : previous?.outlineNodeId,
      outlineOrder: previous?.outlineOrder,
      outlineChildrenSignature: previous?.outlineChildrenSignature,
      generationPlan: previous?.generationPlan,
      generatedSummary: previous?.generatedSummary,
      archivedAt: previous?.archivedAt,
      projectId: previous?.projectId,
      sourceRefs: previous?.sourceRefs,
    })
  }

  ;(doc.content ?? []).forEach(node => {
    if (sectionTitleNode(node)) {
      flush()
      currentHeading = node
      currentBody = []
      return
    }

    if (currentHeading) {
      currentBody.push(node)
    }
  })
  flush()

  return next
}

export function paperDocToPlainText(doc: PaperEditorDoc): string {
  return editorDocToPlainText(doc)
}

export function walkEditorText(
  nodes: PaperEditorNode[] | undefined,
  visitor: (text: string, marks: PaperEditorMark[]) => void,
  inheritedMarks: PaperEditorMark[] = []
) {
  ;(nodes ?? []).forEach(node => {
    const marks = [...inheritedMarks, ...(node.marks ?? [])]
    if (node.type === 'text') {
      visitor(node.text ?? '', marks)
      return
    }
    walkEditorText(node.content, visitor, marks)
  })
}
