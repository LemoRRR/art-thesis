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
import type { PaperEditorMark, PaperEditorNode } from './editorDocument'
import { isPaperEditorDoc, walkEditorText } from './editorDocument'
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

function footnoteNumberFromMarks(marks: PaperEditorMark[]) {
  const footnote = marks.find(mark => mark.type === 'footnote')
  const rawNumber = footnote?.attrs?.footnoteNumber
  const number = typeof rawNumber === 'number' ? rawNumber : Number(rawNumber)
  return Number.isFinite(number) && number > 0 ? number : null
}

function runsFromEditorNode(node: PaperEditorNode) {
  const children: Array<TextRun | FootnoteReferenceRun> = []

  walkEditorText(node.content, (text, marks) => {
    if (!text) return
    const number = footnoteNumberFromMarks(marks)
    children.push(new TextRun({ text, font: FONT, size: 24 }))
    if (number) children.push(new FootnoteReferenceRun(number))
  })

  return children.length > 0 ? children : [new TextRun({ text: '', font: FONT, size: 24 })]
}

function plainTextFromEditorNode(node: PaperEditorNode) {
  let text = ''
  walkEditorText(node.content, chunk => {
    text += chunk
  })
  return text.trim()
}

function createBodyParagraphFromEditorNode(node: PaperEditorNode) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 360, after: 160 },
    children: runsFromEditorNode(node),
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

function isRepeatedHeading(
  current: ReturnType<typeof parsePaperBlocks>[number],
  previous?: ReturnType<typeof parsePaperBlocks>[number]
) {
  if (!previous) return false
  if (current.type !== 'heading2' && current.type !== 'heading3') return false
  return previous.type === current.type && previous.text.trim() === current.text.trim()
}

function buildDocChildren(title: string, sections: DocSection[]) {
  const children: Paragraph[] = [createTitleParagraph(title)]

  sections.forEach(section => {
    children.push(createSectionHeading(section.title))

    if (isPaperEditorDoc(section.editorDoc)) {
      section.editorDoc.content
        .filter((node, index) => index > 0 || !isDuplicateSectionTitle(plainTextFromEditorNode(node), section.title))
        .filter((node, index, list) => {
          if (node.type !== 'heading') return true
          const previous = list[index - 1]
          return !(previous?.type === 'heading' && plainTextFromEditorNode(previous) === plainTextFromEditorNode(node))
        })
        .forEach(node => {
          if (node.type === 'heading') {
            children.push(createSubHeading(plainTextFromEditorNode(node), node.attrs?.level === 3 ? 3 : 2))
          } else if (node.type === 'paragraph') {
            children.push(createBodyParagraphFromEditorNode(node))
          }
        })
      return
    }

    parsePaperBlocks(section.content)
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }, index) => index > 0 || !isDuplicateSectionTitle(block.text, section.title))
      .filter((item, index, list) => !isRepeatedHeading(item.block, list[index - 1]?.block))
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
