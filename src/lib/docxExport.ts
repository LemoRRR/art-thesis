import {
  AlignmentType,
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { cleanTitle, isDuplicateSectionTitle, parsePaperBlocks } from './documentFormat'
import { getFootnotesForBlock, splitTextWithFootnotes } from './footnotes'
import type { DocSection } from './storage'

const FONT = '宋体'
const FILE_SAFE_PATTERN = /[\\/:*?"<>|]/g

function createTitleParagraph(title: string) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [
      new TextRun({
        text: cleanTitle(title) || '未命名论文',
        bold: true,
        font: FONT,
        size: 32,
      }),
    ],
  })
}

function createSectionHeading(title: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 240 },
    children: [
      new TextRun({
        text: cleanTitle(title),
        bold: true,
        font: FONT,
        size: 28,
      }),
    ],
  })
}

function createSubHeading(text: string, level: 2 | 3) {
  return new Paragraph({
    heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 160 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: FONT,
        size: level === 2 ? 26 : 24,
      }),
    ],
  })
}

function createBodyParagraphFromBlock(text: string, section: DocSection | undefined, blockIndex: number) {
  const footnotes = getFootnotesForBlock(section, blockIndex)
  const parts = splitTextWithFootnotes(text, footnotes)

  const children = parts.flatMap(part => {
    if (part.type === 'text') {
      return [new TextRun({ text: part.text, font: FONT, size: 24 })]
    }

    const runs: Array<TextRun | FootnoteReferenceRun> = [
      new TextRun({ text: part.text, font: FONT, size: 24 }),
      ...(part.footnotes ?? [part.footnote!]).map(footnote => new FootnoteReferenceRun(footnote.number)),
    ]
    return runs
  })

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 360, after: 160 },
    children,
  })
}

function buildFootnotesMap(sections: DocSection[]) {
  const footnotes: Record<string, { children: Paragraph[] }> = {}

  sections.forEach(section => {
    ;(section.footnotes ?? []).forEach(footnote => {
      footnotes[String(footnote.number)] = {
        children: [
          new Paragraph({
            indent: { hanging: 240 },
            spacing: { after: 120 },
            children: [
              new FootnoteReferenceRun(footnote.number),
              new TextRun({
                text: ` ${footnote.noteText}`,
                font: FONT,
                size: 20,
              }),
            ],
          }),
        ],
      }
    })
  })

  return footnotes
}

function buildDocChildren(title: string, sections: DocSection[]) {
  const children: Paragraph[] = [createTitleParagraph(title)]

  sections.forEach(section => {
    children.push(createSectionHeading(section.title))
    parsePaperBlocks(section.content)
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }, index) => index > 0 || !isDuplicateSectionTitle(block.text, section.title))
      .forEach(({ block, blockIndex }) => {
        if (block.type === 'heading2') {
          children.push(createSubHeading(block.text, 2))
        } else if (block.type === 'heading3') {
          children.push(createSubHeading(block.text, 3))
        } else {
          children.push(createBodyParagraphFromBlock(block.text, section, blockIndex))
        }
      })
  })

  return children
}

export async function exportSectionsToDocx(title: string, sections: DocSection[]) {
  const footnotes = buildFootnotesMap(sections)
  const doc = new Document({
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: 24,
          },
          paragraph: {
            spacing: { line: 360 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: buildDocChildren(title, sections),
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const safeTitle = cleanTitle(title).replace(FILE_SAFE_PATTERN, '_') || '论文'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeTitle}.docx`
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
    link.remove()
  }, 30_000)
}
