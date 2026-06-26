import type { DocSection, SectionFootnote } from './storage'

export function getAllFootnotes(sections: DocSection[]): SectionFootnote[] {
  return sections
    .flatMap(section => section.footnotes ?? [])
    .sort((a, b) => a.number - b.number)
}

export function nextFootnoteNumber(sections: DocSection[]): number {
  const numbers = getAllFootnotes(sections).map(item => item.number)
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1
}

export function createFootnote(
  sections: DocSection[],
  input: Omit<SectionFootnote, 'id' | 'number'>
): SectionFootnote {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    number: nextFootnoteNumber(sections),
    ...input,
  }
}

export function getFootnotesForBlock(
  section: DocSection | undefined,
  blockIndex: number
): SectionFootnote[] {
  if (!section?.footnotes?.length) return []
  return section.footnotes
    .filter(item => item.blockIndex === blockIndex)
    .sort((a, b) => a.start - b.start)
}

export interface FootnoteTextPart {
  type: 'text' | 'anchor'
  text: string
  footnote?: SectionFootnote
  footnotes?: SectionFootnote[]
}

export function splitTextWithFootnotes(text: string, footnotes: SectionFootnote[]): FootnoteTextPart[] {
  if (footnotes.length === 0) return [{ type: 'text', text }]

  const parts: FootnoteTextPart[] = []
  let cursor = 0
  const ordered = footnotes.slice().sort((a, b) => a.start - b.start || a.end - b.end || a.number - b.number)

  for (let index = 0; index < ordered.length; index += 1) {
    const footnote = ordered[index]
    const start = Math.max(0, Math.min(footnote.start, text.length))
    const end = Math.max(start, Math.min(footnote.end, text.length))
    if (end <= cursor) continue

    const grouped = [footnote]
    while (index + 1 < ordered.length) {
      const next = ordered[index + 1]
      const nextStart = Math.max(0, Math.min(next.start, text.length))
      const nextEnd = Math.max(nextStart, Math.min(next.end, text.length))
      if (nextStart !== start || nextEnd !== end) break
      grouped.push(next)
      index += 1
    }

    if (start > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, start) })
    }
    parts.push({
      type: 'anchor',
      text: text.slice(start, end) || footnote.anchorText,
      footnote,
      footnotes: grouped,
    })
    cursor = end
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) })
  }

  return parts
}

export function updateFootnoteNote(
  sections: DocSection[],
  footnoteId: string,
  noteText: string
): DocSection[] {
  const trimmed = noteText.trim()
  if (!trimmed) return sections

  return sections.map(section => {
    const footnotes = section.footnotes ?? []
    if (!footnotes.some(item => item.id === footnoteId)) return section
    return {
      ...section,
      footnotes: footnotes.map(item =>
        item.id === footnoteId ? { ...item, noteText: trimmed } : item
      ),
      lastModified: Date.now(),
    }
  })
}

export function deleteFootnote(sections: DocSection[], footnoteId: string): DocSection[] {
  let removedNumber = 0

  const withoutTarget = sections.map(section => {
    const footnotes = section.footnotes ?? []
    const target = footnotes.find(item => item.id === footnoteId)
    if (!target) return section

    removedNumber = target.number
    return {
      ...section,
      footnotes: footnotes.filter(item => item.id !== footnoteId),
      lastModified: Date.now(),
    }
  })

  if (!removedNumber) return sections

  return withoutTarget.map(section => ({
    ...section,
    footnotes: (section.footnotes ?? []).map(item => ({
      ...item,
      number: item.number > removedNumber ? item.number - 1 : item.number,
    })),
  }))
}

export interface BibliographyEntry {
  number: number
  noteText: string
}

function normalizeDoi(value: string): string {
  const match = value.match(/(?:doi[:：]\s*)?(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s，。；;,]+)/i)
  return match?.[1]?.replace(/[.。]$/, '').toLowerCase() ?? ''
}

function normalizeUrl(value: string): string {
  const match = value.match(/https?:\/\/[^\s，。；;,]+/i)
  return match?.[0]?.replace(/[.。]$/, '').toLowerCase() ?? ''
}

export function cleanBibliographyNote(noteText: string): string {
  const text = noteText
    .replace(/\s*(?:可用依据|摘要依据|使用依据|筛选理由|Usable evidence|Abstract|Footnote text)[:：][\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.replace(/\s+([,.;，。；])/g, '$1')
}

function bibliographyKey(noteText: string): string {
  const doi = normalizeDoi(noteText)
  if (doi) return `doi:${doi}`
  const url = normalizeUrl(noteText)
  if (url) return `url:${url}`
  return `text:${cleanBibliographyNote(noteText)
    .replace(/\[[A-Z]\]/g, '')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '')
    .toLowerCase()}`
}

export function collectBibliographyEntries(sections: DocSection[]): BibliographyEntry[] {
  const seen = new Set<string>()
  const entries: BibliographyEntry[] = []

  getAllFootnotes(sections).forEach(footnote => {
    const noteText = cleanBibliographyNote(footnote.noteText)
    const key = bibliographyKey(noteText)
    if (!noteText || seen.has(key)) return
    seen.add(key)
    entries.push({ number: entries.length + 1, noteText })
  })

  return entries.sort((a, b) => a.number - b.number)
}

export function buildBibliographyContent(sections: DocSection[]): string {
  const entries = collectBibliographyEntries(sections)
  if (entries.length === 0) return ''
  return entries.map(entry => `[${entry.number}] ${entry.noteText}`).join('\n\n')
}

export function buildBibliographySection(sections: DocSection[], projectId: string): DocSection | null {
  const content = buildBibliographyContent(sections)
  if (!content) return null

  return {
    id: 'bibliography-export',
    projectId,
    title: '参考文献',
    content,
    status: 'done',
    lastModified: Date.now(),
    order: sections.length,
  }
}
