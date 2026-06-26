import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from 'docx'
import { isFrontMatterTitle, stripAcademicTitlePrefix } from './academicFormat'
import { cleanTitle, isDuplicateSectionTitle, parsePaperBlocks } from './documentFormat'
import type { PaperEditorMark, PaperEditorNode } from './editorDocument'
import { editorDocWithFootnoteMarks, isPaperEditorDoc, walkEditorText } from './editorDocument'
import { cleanBibliographyNote, getFootnotesForBlock, splitTextWithFootnotes } from './footnotes'
import { researchPackageStore, type DocSection, type ResearchPackageComponent } from './storage'

const FONT = '宋体'
const HEADING_FONT = '黑体'
const EN_FONT = 'Times New Roman'
const TEXT_COLOR = '000000'
const FILE_SAFE_PATTERN = /[\\/:*?"<>|]/g
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 8, color: TEXT_COLOR }
const TABLE_LIGHT_BORDER = { style: BorderStyle.SINGLE, size: 3, color: 'BFBFBF' }
const TABLE_NO_BORDER = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' }
const DOCX_PAGE_MARGIN_LEFT_DXA = 1800
const DOCX_PAGE_MARGIN_RIGHT_DXA = 1800
const DOCX_CONTENT_WIDTH_DXA = 8640
const RESEARCH_TABLE_WIDTH_DXA = DOCX_CONTENT_WIDTH_DXA - 360

function editorAlignment(value: unknown) {
  if (value === 'center') return AlignmentType.CENTER
  if (value === 'right') return AlignmentType.RIGHT
  if (value === 'left') return AlignmentType.LEFT
  return AlignmentType.JUSTIFIED
}

function fontSizeToHalfPoints(value: unknown) {
  if (typeof value !== 'string') return 24
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 24
  if (value.endsWith('px')) return Math.round(numeric * 1.5)
  if (value.endsWith('pt')) return Math.round(numeric * 2)
  return Math.round(numeric)
}

function runStyleFromMarks(marks: PaperEditorMark[]) {
  const textStyle = [...marks].reverse().find(mark => mark.type === 'textStyle')
  const attrs = textStyle?.attrs ?? {}
  return {
    bold: marks.some(mark => mark.type === 'bold') || undefined,
    italics: marks.some(mark => mark.type === 'italic') || undefined,
    underline: marks.some(mark => mark.type === 'underline') ? {} : undefined,
    font: typeof attrs.fontFamily === 'string' ? attrs.fontFamily : FONT,
    size: fontSizeToHalfPoints(attrs.fontSize),
  }
}

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
        color: TEXT_COLOR,
      }),
    ],
  })
}

function createSectionHeading(title: string) {
  const clean = stripAcademicTitlePrefix(cleanTitle(title))
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 240, line: 480 },
    children: [
      new TextRun({
        text: clean,
        bold: true,
        font: HEADING_FONT,
        size: 36,
        color: TEXT_COLOR,
      }),
    ],
  })
}

function createSubHeading(text: string, level: 2 | 3) {
  return new Paragraph({
    heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120, line: 240 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: HEADING_FONT,
        size: level === 2 ? 30 : 28,
        color: TEXT_COLOR,
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
    children.push(new TextRun({ text, ...runStyleFromMarks(marks) }))
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
    alignment: editorAlignment(node.attrs?.textAlign),
    indent: node.attrs?.textAlign === 'center' || node.attrs?.textAlign === 'right' ? undefined : { firstLine: 480 },
    spacing: { line: 360, after: 160 },
    children: runsFromEditorNode(node),
  })
}

type DocxBlock = Paragraph | Table

function isShortResearchTableColumn(label: string, column?: string) {
  const text = `${label} ${column ?? ''}`
  return /^(N|p|r|F|M|SD)$/i.test(label.trim())
    || /排名|序号|KANO|Better|Worse|权重|熵值|差异|综合分|样本|均值|标准差|显著|Alpha|得分/.test(text)
}

function researchColumnWidths(columns: string[], labels: string[]) {
  const weights = columns.map((column, index) => {
    const label = labels[index] ?? column
    if (/维度|指标|变量|题项|主题|证据|说明|摘录|名称/.test(`${label} ${column}`)) return 1.8
    if (isShortResearchTableColumn(label, column)) return 0.95
    return 1.25
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
  return weights.map(weight => Math.max(680, Math.round(RESEARCH_TABLE_WIDTH_DXA * weight / total)))
}

function researchTableCellAlignment(label: string, column?: string) {
  return isShortResearchTableColumn(label, column) ? AlignmentType.CENTER : AlignmentType.LEFT
}

function tableCell(options: {
  text: string
  bold?: boolean
  header?: boolean
  bottomBorder?: boolean
  width?: number
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
}) {
  const { text, bold = false, header = false, bottomBorder = false, width, alignment = AlignmentType.CENTER } = options
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    verticalAlign: VerticalAlignTable.CENTER,
    shading: header ? { fill: 'F2F2F2' } : undefined,
    borders: {
      top: TABLE_NO_BORDER,
      left: TABLE_NO_BORDER,
      right: TABLE_NO_BORDER,
      bottom: bottomBorder ? TABLE_BORDER : TABLE_LIGHT_BORDER,
    },
    children: [
      new Paragraph({
        alignment,
        spacing: { line: 260, before: 0, after: 0 },
        children: [new TextRun({ text, bold, font: bold ? HEADING_FONT : FONT, size: header ? 20 : 19 })],
      }),
    ],
  })
}

function createResearchTableBlocksFromData(data: {
  title?: unknown
  columns?: unknown
  columnLabels?: unknown
  rows?: unknown
  note?: unknown
  truncated?: unknown
  totalRows?: unknown
}): DocxBlock[] {
  const title = typeof data.title === 'string' ? data.title : ''
  const columns = Array.isArray(data.columns) ? data.columns.filter((item): item is string => typeof item === 'string') : []
  const labels = Array.isArray(data.columnLabels) ? data.columnLabels.filter((item): item is string => typeof item === 'string') : columns
  const rows = Array.isArray(data.rows)
    ? data.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : []
  const note = typeof data.note === 'string' ? data.note : ''
  if (!columns.length || !rows.length) return []

  const widths = researchColumnWidths(columns, labels)
  const table = new Table({
    width: { size: RESEARCH_TABLE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: {
      top: TABLE_BORDER,
      bottom: TABLE_BORDER,
      left: TABLE_NO_BORDER,
      right: TABLE_NO_BORDER,
      insideVertical: TABLE_NO_BORDER,
      insideHorizontal: TABLE_LIGHT_BORDER,
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: labels.map((label, index) => tableCell({
          text: label,
          bold: true,
          header: true,
          bottomBorder: true,
          width: widths[index],
          alignment: AlignmentType.CENTER,
        })),
        tableHeader: true,
      }),
      ...rows.map(row => new TableRow({
        children: columns.map((column, index) => tableCell({
          text: String(row[column] ?? ''),
          width: widths[index],
          alignment: researchTableCellAlignment(labels[index] ?? column, column),
        })),
      })),
    ],
  })

  const blocks: DocxBlock[] = [
    ...(title ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 80 },
      keepNext: true,
      children: [new TextRun({ text: title, bold: true, font: HEADING_FONT, size: 24 })],
    })] : []),
    table,
  ]
  const extra = data.truncated ? `（表内展示前 ${rows.length} 行，完整数据共 ${data.totalRows ?? rows.length} 行。）` : ''
  if (note || extra) {
    blocks.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 80, after: 160, line: 260 },
      children: [new TextRun({ text: `${note}${extra}`, font: FONT, size: 18 })],
    }))
  }
  return blocks
}

function createResearchComponentParagraphs(component: ResearchPackageComponent): DocxBlock[] {
  const title = component.label ? `${component.label} ${component.title ?? ''}`.trim() : component.title
  const figureData = component.type === 'figure' && component.data && typeof component.data === 'object'
    ? (component.data as { dataUrl?: string; caption?: string })
    : null
  const dataUrl = figureData?.dataUrl
  if (dataUrl?.startsWith('data:image/')) {
    const caption = title ?? '图表'
    const description = component.content.trim()
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 80 },
        keepNext: true,
        children: [imageRunFromDataUrl(dataUrl)],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: description && description !== caption ? 80 : 160 },
        keepNext: Boolean(description && description !== caption),
        children: [new TextRun({ text: caption, bold: true, font: HEADING_FONT, size: 22 })],
      }),
      ...(description && description !== caption ? [new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { firstLine: 480 },
        spacing: { line: 320, after: 160 },
        children: [new TextRun({ text: description, font: FONT, size: 22 })],
      })] : []),
    ]
  }
  if ((component.type === 'statistics' || component.type === 'table') && component.data && typeof component.data === 'object') {
    const tableBlocks = createResearchTableBlocksFromData(component.data as Record<string, unknown>)
    if (tableBlocks.length) return tableBlocks
  }
  return [
    ...(title ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 100 },
      children: [new TextRun({ text: title, bold: true, font: HEADING_FONT, size: 24 })],
    })] : []),
    ...component.content.split(/\n+/).filter(Boolean).map(line => new Paragraph({
      alignment: component.type === 'statistics' || component.type === 'table' ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
      indent: component.type === 'statistics' || component.type === 'table' ? undefined : { firstLine: 480 },
      spacing: { line: 360, after: 120 },
      children: [new TextRun({ text: line.trim(), font: FONT, size: 24 })],
    })),
  ]
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const payload = dataUrl.split(',')[1] ?? ''
  const isBase64 = dataUrl.slice(0, dataUrl.indexOf(',')).includes(';base64')
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function imageDimensionsFromDataUrl(dataUrl: string) {
  try {
    if (dataUrl.startsWith('data:image/png')) {
      const bytes = dataUrlToBytes(dataUrl)
      if (bytes.length >= 24) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        return { width: view.getUint32(16), height: view.getUint32(20) }
      }
    }

    if (dataUrl.startsWith('data:image/svg+xml')) {
      const svg = new TextDecoder().decode(dataUrlToBytes(dataUrl))
      const width = Number(svg.match(/\bwidth=["']?([\d.]+)/)?.[1])
      const height = Number(svg.match(/\bheight=["']?([\d.]+)/)?.[1])
      const viewBox = svg.match(/\bviewBox=["']?([\d.\s-]+)/)?.[1]?.trim().split(/\s+/).map(Number)
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height }
      if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return { width: viewBox[2], height: viewBox[3] }
    }
  } catch {
    return null
  }
  return null
}

function imageTransformFromDataUrl(dataUrl: string, maxWidth = 460, maxHeight = 310) {
  const dimensions = imageDimensionsFromDataUrl(dataUrl)
  if (!dimensions) return { width: maxWidth, height: Math.round(maxWidth * 0.62) }
  const ratio = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1)
  return {
    width: Math.round(dimensions.width * ratio),
    height: Math.round(dimensions.height * ratio),
  }
}

const TRANSPARENT_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255,
  255, 63, 0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
])

function imageRunFromDataUrl(dataUrl: string) {
  const transformation = imageTransformFromDataUrl(dataUrl)
  if (dataUrl.startsWith('data:image/svg+xml')) {
    return new ImageRun({
      type: 'svg',
      data: dataUrlToBytes(dataUrl),
      fallback: { type: 'png', data: TRANSPARENT_PNG },
      transformation,
    })
  }
  return new ImageRun({
    type: 'png',
    data: dataUrlToBytes(dataUrl),
    transformation,
  })
}

function createResearchImageParagraphs(node: PaperEditorNode): DocxBlock[] {
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  if (!src.startsWith('data:image/')) return []
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 100 },
      children: [imageRunFromDataUrl(src)],
    }),
  ]
}

function createResearchTableParagraphs(node: PaperEditorNode): DocxBlock[] {
  return createResearchTableBlocksFromData(node.attrs ?? {})
}

function createResearchBlockParagraphs(node: PaperEditorNode): DocxBlock[] {
  const packageId = typeof node.attrs?.researchPackageId === 'string' ? node.attrs.researchPackageId : ''
  const pkg = packageId ? researchPackageStore.get(packageId) : null
  if (!pkg) return [createBodyParagraphFromEditorNode(node)]

  const rawComponentIds = Array.isArray(node.attrs?.researchComponentIds) ? node.attrs.researchComponentIds : []
  const componentIds = new Set(rawComponentIds.filter((id): id is string => typeof id === 'string'))
  const components = componentIds.size
    ? pkg.components.filter(component => componentIds.has(component.id))
    : pkg.components

  return components.flatMap(createResearchComponentParagraphs)
}

function createFrontMatterHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 240, line: 480 },
    children: [
      new TextRun({
        text,
        bold: true,
        font: text === 'Abstract' ? EN_FONT : HEADING_FONT,
        size: 32,
        color: TEXT_COLOR,
      }),
    ],
  })
}

function createKeywordParagraph(label: string, text: string, english = false) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, before: 120, after: 160 },
    children: [
      new TextRun({ text: label, bold: true, font: english ? EN_FONT : HEADING_FONT, size: 24 }),
      new TextRun({ text, font: english ? EN_FONT : FONT, size: 24 }),
    ],
  })
}

function createFrontMatterBodyParagraph(text: string, english = false) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 360, after: 160 },
    children: [new TextRun({ text, font: english ? EN_FONT : FONT, size: 24 })],
  })
}

function extractFrontMatterBlocks(content: string) {
  const blocks = {
    abstractZh: '',
    keywordsZh: '',
    abstractEn: '',
    keywordsEn: '',
  }
  let current: keyof typeof blocks | '' = ''

  content.split(/\n+/).forEach(raw => {
    const text = raw.trim()
    if (!text) return
    const match = text.match(/^【?\s*(摘要|中文摘要|关键词|关键字|Abstract|Keywords?)\s*】?\s*[:：]?\s*(.*)$/i)
    if (match) {
      const label = match[1].toLowerCase()
      current = label === 'abstract'
        ? 'abstractEn'
        : label.startsWith('keyword')
          ? 'keywordsEn'
          : label === '关键词' || label === '关键字'
            ? 'keywordsZh'
            : 'abstractZh'
      const rest = match[2]?.trim()
      if (rest) blocks[current] = [blocks[current], rest].filter(Boolean).join('\n')
      return
    }
    if (current) blocks[current] = [blocks[current], text].filter(Boolean).join('\n')
  })

  return blocks
}

function createFrontMatterParagraphs(section: DocSection) {
  const blocks = extractFrontMatterBlocks(section.content)
  const children: Paragraph[] = []
  if (blocks.abstractZh) {
    children.push(createFrontMatterHeading('摘要'))
    blocks.abstractZh.split(/\n+/).filter(Boolean).forEach(line => {
      children.push(createFrontMatterBodyParagraph(line))
    })
  }
  if (blocks.keywordsZh) {
    children.push(createKeywordParagraph('关键词：', blocks.keywordsZh))
  }
  if (blocks.abstractEn) {
    children.push(createFrontMatterHeading('Abstract'))
    blocks.abstractEn.split(/\n+/).filter(Boolean).forEach(line => {
      children.push(createFrontMatterBodyParagraph(line, true))
    })
  }
  if (blocks.keywordsEn) {
    children.push(createKeywordParagraph('Keywords: ', blocks.keywordsEn, true))
  }
  if (children.length > 0) return children

  const rawBlocks = parsePaperBlocks(section.content)
    .filter((block, index) => index > 0 || !isDuplicateSectionTitle(block.text, section.title))
    .map(block => block.text.trim())
    .filter(Boolean)

  if (rawBlocks.length === 0) return [createFrontMatterHeading('摘要')]

  const fallbackChildren: Paragraph[] = []
  let hasHeading = false
  let english = false
  const ensureHeading = () => {
    if (hasHeading) return
    fallbackChildren.push(createFrontMatterHeading('摘要'))
    hasHeading = true
  }

  rawBlocks.forEach(text => {
    if (/^【?\s*摘要\s*】?$/.test(text)) {
      fallbackChildren.push(createFrontMatterHeading('摘要'))
      hasHeading = true
      english = false
      return
    }
    if (/^【?\s*Abstract\s*】?$/i.test(text)) {
      fallbackChildren.push(createFrontMatterHeading('Abstract'))
      hasHeading = true
      english = true
      return
    }

    const zhKeywords = text.match(/^【?\s*关键词\s*】?\s*[:：]?\s*(.+)$/)
    if (zhKeywords?.[1]) {
      fallbackChildren.push(createKeywordParagraph('关键词：', zhKeywords[1].trim()))
      return
    }

    const enKeywords = text.match(/^【?\s*Keywords?\s*】?\s*:?\s*(.+)$/i)
    if (enKeywords?.[1]) {
      fallbackChildren.push(createKeywordParagraph('Keywords: ', enKeywords[1].trim(), true))
      return
    }

    ensureHeading()
    const looksEnglish = english || (/^[A-Za-z0-9\s,.;:'"()/-]+$/.test(text) && /[A-Za-z]{4}/.test(text))
    fallbackChildren.push(createFrontMatterBodyParagraph(text, looksEnglish))
  })

  return fallbackChildren.length > 0 ? fallbackChildren : [createFrontMatterHeading('摘要')]
}

function createFootnoteTextRuns(text: string) {
  const runs: Array<TextRun | ExternalHyperlink> = []
  const pattern = /(https?:\/\/[^\s，。；,;]+)/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const url = match[0]
    const index = match.index ?? 0
    if (index > cursor) {
      runs.push(new TextRun({ text: text.slice(cursor, index), font: FONT, size: 20 }))
    }
    runs.push(new ExternalHyperlink({
      link: url,
      children: [
        new TextRun({
          text: url,
          font: FONT,
          size: 20,
          style: 'Hyperlink',
        }),
      ],
    }))
    cursor = index + url.length
  }
  if (cursor < text.length) {
    runs.push(new TextRun({ text: text.slice(cursor), font: FONT, size: 20 }))
  }
  return runs
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
              ...createFootnoteTextRuns(` ${cleanBibliographyNote(footnote.noteText)}`),
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
  const children: DocxBlock[] = [createTitleParagraph(title)]

  sections.forEach(section => {
    if (isFrontMatterTitle(section.title)) {
      children.push(...createFrontMatterParagraphs(section))
      return
    }

    children.push(createSectionHeading(section.title))

    if (isPaperEditorDoc(section.editorDoc)) {
      editorDocWithFootnoteMarks(section).content
        .filter((node, index) => index > 0 || !isDuplicateSectionTitle(plainTextFromEditorNode(node), section.title))
        .filter((node, index, list) => {
          if (node.type !== 'heading') return true
          const previous = list[index - 1]
          return !(previous?.type === 'heading' && plainTextFromEditorNode(previous) === plainTextFromEditorNode(node))
        })
        .forEach(node => {
          if (node.type === 'heading') {
            children.push(createSubHeading(plainTextFromEditorNode(node), node.attrs?.level === 3 ? 3 : 2))
          } else if (node.type === 'researchImage') {
            children.push(...createResearchImageParagraphs(node))
          } else if (node.type === 'researchTable') {
            children.push(...createResearchTableParagraphs(node))
          } else if (node.type === 'researchBlock' || (node.type === 'paragraph' && node.attrs?.researchBlock)) {
            children.push(...createResearchBlockParagraphs(node))
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

export async function buildSectionsDocxBlob(title: string, sections: DocSection[]) {
  const footnotes = buildFootnotesMap(sections)
  const doc = new Document({
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: 24,
            color: TEXT_COLOR,
          },
          paragraph: {
            spacing: { line: 360 },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            bold: true,
            font: HEADING_FONT,
            size: 36,
            color: TEXT_COLOR,
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            bold: true,
            font: HEADING_FONT,
            size: 30,
            color: TEXT_COLOR,
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            bold: true,
            font: HEADING_FONT,
            size: 28,
            color: TEXT_COLOR,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: DOCX_PAGE_MARGIN_RIGHT_DXA,
              bottom: 1440,
              left: DOCX_PAGE_MARGIN_LEFT_DXA,
            },
          },
        },
        children: buildDocChildren(title, sections),
      },
    ],
  })

  return Packer.toBlob(doc)
}

export async function exportSectionsToDocx(title: string, sections: DocSection[]) {
  const blob = await buildSectionsDocxBlob(title, sections)
  const safeTitle = cleanTitle(title).replace(FILE_SAFE_PATTERN, '_') || '论文'
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeTitle}.docx`
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
    link.remove()
  }, 30_000)
}
