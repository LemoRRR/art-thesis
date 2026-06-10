import { parsePaperBlocks, type PaperBlockType } from './documentFormat'

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
  return (node.content ?? []).map(nodeText).join('')
}

export function editorDocToPlainText(doc: PaperEditorDoc): string {
  return (doc.content ?? [])
    .map(node => nodeText(node).trim())
    .filter(Boolean)
    .join('\n\n')
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
