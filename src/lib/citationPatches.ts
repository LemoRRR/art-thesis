import { isFrontMatterTitle } from './academicFormat'
import { parsePaperBlocks } from './documentFormat'
import { paperTextToEditorDoc } from './editorDocument'
import { createFootnote } from './footnotes'
import type { DocSection, SectionFootnote } from './storage'

export interface CitationPatchInput {
  sectionId: string
  originalText: string
  revisedText?: string
  source: {
    noteText: string
  }
}

export interface ApplyCitationPatchResult {
  sections: DocSection[]
  appliedCount: number
}

function isNonBodySectionTitle(title: string): boolean {
  const trimmed = title.trim()
  if (!trimmed) return false
  if (isFrontMatterTitle(trimmed)) return true
  return /^(?:keywords?|abstract|references?|bibliography|appendix|acknowledgements?|title)$/i.test(trimmed)
}

function locateAnchor(content: string, anchorText: string) {
  if (!anchorText.trim()) return null
  const blocks = parsePaperBlocks(content)
  const blockIndex = blocks.findIndex(block => block.type === 'paragraph' && block.text.includes(anchorText))
  if (blockIndex < 0) return null
  const start = blocks[blockIndex].text.indexOf(anchorText)
  if (start < 0) return null
  return {
    blockIndex,
    start,
    end: start + anchorText.length,
  }
}

function refreshFootnoteOffsets(content: string, footnotes: SectionFootnote[]): SectionFootnote[] {
  if (footnotes.length === 0) return footnotes
  return footnotes.map(footnote => {
    const location = locateAnchor(content, footnote.anchorText)
    return location ? { ...footnote, ...location } : footnote
  })
}

function hasSameCitation(footnotes: SectionFootnote[], anchorText: string, originalText: string, noteText: string): boolean {
  return footnotes.some(footnote =>
    (footnote.anchorText === originalText || footnote.anchorText === anchorText) &&
    footnote.noteText === noteText
  )
}

export function applyCitationPatchesToSections(
  inputSections: DocSection[],
  patches: CitationPatchInput[],
  options: {
    shouldSkipSection?: (section: DocSection) => boolean
    now?: () => number
  } = {}
): ApplyCitationPatchResult {
  if (patches.length === 0) return { sections: inputSections, appliedCount: 0 }

  const now = options.now ?? Date.now
  const shouldSkipSection = options.shouldSkipSection ?? ((section: DocSection) => isNonBodySectionTitle(section.title))
  let appliedCount = 0
  let nextSections = inputSections

  patches.forEach(patch => {
    const noteText = patch.source.noteText.trim()
    const originalText = patch.originalText.trim()
    const anchorText = (patch.revisedText?.trim() || originalText).trim()
    if (!noteText || !originalText || !anchorText) return

    nextSections = nextSections.map(section => {
      if (section.id !== patch.sectionId || shouldSkipSection(section)) return section

      const sectionFootnotes = section.footnotes ?? []
      const existingFootnotes = refreshFootnoteOffsets(section.content, sectionFootnotes)
      if (hasSameCitation(existingFootnotes, anchorText, originalText, noteText)) {
        return existingFootnotes === sectionFootnotes ? section : { ...section, footnotes: existingFootnotes }
      }

      const nextContent = section.content.includes(originalText)
        ? section.content.replace(originalText, anchorText)
        : section.content

      const refreshedFootnotes = refreshFootnoteOffsets(nextContent, existingFootnotes)
      const location = locateAnchor(nextContent, anchorText)
      if (!location) {
        return refreshedFootnotes === sectionFootnotes ? section : { ...section, footnotes: refreshedFootnotes }
      }

      const footnote = createFootnote(
        nextSections.map(item => item.id === section.id ? { ...section, footnotes: refreshedFootnotes } : item),
        {
          ...location,
          anchorText,
          noteText,
        }
      )

      appliedCount += 1
      return {
        ...section,
        content: nextContent,
        footnotes: [...refreshedFootnotes, footnote],
        editorDoc: paperTextToEditorDoc(nextContent),
        lastModified: now(),
      }
    })
  })

  return { sections: nextSections, appliedCount }
}
