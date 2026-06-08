import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import { cleanTitle, parsePaperBlocks } from './documentFormat'
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

function createBodyParagraph(text: string) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 360, after: 160 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 24,
      }),
    ],
  })
}

function buildDocChildren(title: string, sections: DocSection[]) {
  const children: Paragraph[] = [createTitleParagraph(title)]

  sections.forEach(section => {
    children.push(createSectionHeading(section.title))
    parsePaperBlocks(section.content).forEach(block => {
      if (block.type === 'heading2') {
        children.push(createSubHeading(block.text, 2))
      } else if (block.type === 'heading3') {
        children.push(createSubHeading(block.text, 3))
      } else {
        children.push(createBodyParagraph(block.text))
      }
    })
  })

  return children
}

export async function exportSectionsToDocx(title: string, sections: DocSection[]) {
  const doc = new Document({
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
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(cleanTitle(title) || '未命名论文').replace(FILE_SAFE_PATTERN, '_')}.docx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
