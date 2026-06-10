import type { DocSection } from './storage'

export type PaperBlockType = 'heading2' | 'heading3' | 'paragraph'

export interface PaperBlock {
  type: PaperBlockType
  text: string
}

const MARKDOWN_RULES: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ''],
  [/^\s{0,3}#{1,6}\s+/gm, ''],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/\*([^*]+)\*/g, '$1'],
  [/__([^_]+)__/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/`([^`]+)`/g, '$1'],
  [/^\s*[-*+]\s+/gm, ''],
  [/^\s*\d+\.\s+/gm, ''],
  [/\[(.*?)\]\((.*?)\)/g, '$1'],
]

export function cleanMarkdownText(text: string): string {
  let next = text.replace(/\r\n/g, '\n')
  MARKDOWN_RULES.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement)
  })
  return next
    .split('\n')
    .map(line => line.replace(/\s+$/g, '').trimStart())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanTitle(title: string): string {
  return cleanMarkdownText(title).replace(/\n/g, ' ').trim()
}

function inferBlockType(line: string): PaperBlockType {
  if (/^\d+\.\d+\.\d+\s+/.test(line)) return 'heading3'
  if (/^\d+\.\d+\s+/.test(line)) return 'heading2'
  if (/^第[一二三四五六七八九十]+节/.test(line)) return 'heading2'
  if (/^（[一二三四五六七八九十]+）/.test(line)) return 'heading3'
  return 'paragraph'
}

export function parsePaperBlocks(content: string): PaperBlock[] {
  const clean = cleanMarkdownText(content)
  if (!clean) return []

  const blocks: PaperBlock[] = []
  clean.split(/\n+/).forEach(rawLine => {
    const text = rawLine.trim()
    if (!text) return
    blocks.push({
      type: inferBlockType(text),
      text,
    })
  })
  return blocks
}

export function formatSectionContent(content: string): string {
  return parsePaperBlocks(content).map(block => block.text).join('\n\n')
}

export function formatSectionsForPaper(sections: DocSection[]): DocSection[] {
  return sections.map(section => ({
    ...section,
    title: cleanTitle(section.title),
    content: formatSectionContent(section.content),
  }))
}

export function sectionsToPlainText(sections: DocSection[], title?: string): string {
  const body = formatSectionsForPaper(sections)
    .map(section => `${section.title}\n\n${section.content}`)
    .join('\n\n')
  const cleanPaperTitle = title ? cleanTitle(title) : ''
  return cleanPaperTitle ? `${cleanPaperTitle}\n\n${body}` : body
}
