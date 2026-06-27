import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { mergeResearchNodesIntoDoc, researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'
import { assertPaperNarratives } from './research-smoke-assertions.mjs'
import { idsByResolvedSection, listenOnSafePort } from './smoke-server.mjs'

const defaultWorkbook = path.resolve(
  process.cwd(),
  '../outputs/ich_kano_entropy/非遗文创KANO-熵权法耦合模型问卷100份样本数据.xlsx'
)
const workbookPath = path.resolve(process.argv[2] || process.env.RESEARCH_SMOKE_XLSX || defaultWorkbook)
const outputPath = path.resolve(
  process.argv[3] || process.env.RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/research-chain-smoke.docx'
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function post(base, route, body) {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok === false) {
    throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 1000)}`)
  }
  return json
}

function componentsFromAnalysis(analysis) {
  return splitResearchAssetIntoComponents({
    id: 'smoke-asset',
    projectId: 'smoke',
    taskId: 'smoke-task',
    type: 'quant_analysis_result',
    title: 'KANO-熵权法分析结果',
    summary: '真实问卷数据的 KANO-熵权法分析结果',
    plainText: analysis.plainText ?? '',
    structuredData: { result: analysis },
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

function imageDimensionsFromDataUrl(dataUrl) {
  const value = String(dataUrl ?? '')
  const pngMatch = /^data:image\/png;base64,(.+)$/.exec(value)
  if (pngMatch) {
    const buffer = Buffer.from(pngMatch[1], 'base64')
    assert(buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG', 'figure data is not a valid PNG')
    return {
      type: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      colorType: buffer[25],
      bytes: buffer.length,
    }
  }
  const svgMatch = /^data:image\/svg\+xml[^,]*,(.+)$/.exec(value)
  assert(svgMatch, 'figure is missing a PNG or SVG data URL')
  const svg = decodeURIComponent(svgMatch[1])
  assert(svg.includes('<svg') && svg.includes('</svg>'), 'figure data is not a valid SVG')
  const width = Number(svg.match(/\bwidth=["']?([\d.]+)/)?.[1])
  const height = Number(svg.match(/\bheight=["']?([\d.]+)/)?.[1])
  assert(Number.isFinite(width) && width > 0, 'SVG figure width is missing')
  assert(Number.isFinite(height) && height > 0, 'SVG figure height is missing')
  return {
    type: 'svg',
    width,
    height,
    bytes: Buffer.byteLength(svg, 'utf8'),
  }
}

function assertProfessionalFigureMetadata(figure, dimensions) {
  const title = String(figure.title ?? '').trim()
  const caption = String(figure.caption ?? '').trim()
  assert(title.length >= 4, `figure title is too short: ${figure.id}`)
  assert(caption.length >= 12, `figure caption is too thin for paper use: ${figure.id}`)
  assert(!/^图\s*\d*$/i.test(title), `figure title is generic: ${figure.id}`)
  assert(!/undefined|null|NaN|未命名/.test(`${title}\n${caption}`), `figure metadata contains placeholder text: ${figure.id}`)
  assert(dimensions.type === 'png', `${figure.title} should be exported as a flattened PNG, got ${dimensions.type}`)
  assert(dimensions.colorType !== 4 && dimensions.colorType !== 6, `${figure.title} PNG still has alpha; Word/WPS may render it inconsistently`)
  assert(dimensions.bytes >= 12_000, `${figure.title} PNG is suspiciously small: ${dimensions.bytes} bytes`)
}

async function inspectPngPixels(buffer, name) {
  const { default: sharp } = await import('sharp')
  const image = sharp(buffer)
  const metadata = await image.metadata()
  assert(metadata.width >= 1000, `DOCX PNG width is too low: ${name}`)
  assert(metadata.height >= 360, `DOCX PNG height is too low: ${name}`)
  const { data, info } = await image
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels
  const pixel = (x, y) => {
    const offset = (y * info.width + x) * channels
    return [data[offset], data[offset + 1], data[offset + 2]]
  }
  const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue
  const corners = [
    pixel(0, 0),
    pixel(info.width - 1, 0),
    pixel(0, info.height - 1),
    pixel(info.width - 1, info.height - 1),
  ]
  assert(
    corners.every(value => luminance(value) >= 245),
    `DOCX PNG corners must stay white for thesis charts: ${name}`
  )
  const edgeSamples = []
  const sampleStepX = Math.max(1, Math.floor(info.width / 36))
  const sampleStepY = Math.max(1, Math.floor(info.height / 24))
  for (let x = 0; x < info.width; x += sampleStepX) {
    edgeSamples.push(pixel(x, 0), pixel(x, info.height - 1))
  }
  for (let y = 0; y < info.height; y += sampleStepY) {
    edgeSamples.push(pixel(0, y), pixel(info.width - 1, y))
  }
  assert(
    edgeSamples.every(value => luminance(value) >= 245),
    `DOCX PNG edges must stay white for thesis charts: ${name}`
  )
}

function assertResearchOutputQuality(analysis, components) {
  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const priorityTable = tables.find(table => table.id === 'table_priority_ranking')
  const entropyTable = tables.find(table => table.id === 'table_entropy_weights')
  assert(priorityTable, 'priority ranking table is missing')
  const hasEntropyTable = Boolean(entropyTable)
  const expectedPriorityColumns = hasEntropyTable
    ? ['排名', '维度', 'KANO', 'Better', 'Worse', '熵权', '综合分']
    : ['排名', '维度', 'KANO', 'Better', 'Worse']
  assert(
    JSON.stringify(priorityTable.columns) === JSON.stringify(expectedPriorityColumns),
    `priority ranking table columns are not paper-ready: ${JSON.stringify(priorityTable.columns)}`
  )
  const rawKanoCodes = new Set(['M', 'O', 'A', 'I', 'Q', 'R'])
  const priorityKanoValues = (priorityTable.rows ?? []).map(row => String(row.KANO ?? '').trim()).filter(Boolean)
  assert(priorityKanoValues.length > 0, 'priority ranking table has no KANO labels')
  assert(
    priorityKanoValues.every(value => !rawKanoCodes.has(value)),
    `priority ranking table still exposes raw KANO codes: ${priorityKanoValues.join(', ')}`
  )
  assert(
    priorityKanoValues.some(value => value.includes('型')),
    `priority ranking table should use Chinese KANO labels: ${priorityKanoValues.join(', ')}`
  )
  if (entropyTable) {
    assert(
      JSON.stringify(entropyTable.columns) === JSON.stringify(['指标', '熵值', '差异', '权重(%)']),
      `entropy weight table columns are not paper-ready: ${JSON.stringify(entropyTable.columns)}`
    )
  } else {
    const combinedText = [
      analysis.methodText,
      analysis.analysisText,
      analysis.plainText,
      ...tables.flatMap(table => [table.title, ...(table.columns ?? [])]),
      ...figures.flatMap(figure => [figure.title, figure.caption]),
      ...components.map(component => `${component.title ?? ''}\n${component.content ?? ''}`),
    ].join('\n')
    assert(!/熵权|耦合/.test(combinedText), 'KANO-only output should not mention entropy weighting or coupling')
  }
  for (const table of tables) {
    assert((table.columns ?? []).length <= 7, `${table.title} has too many displayed columns`)
    assert(!(table.columns ?? []).includes('维度全称'), `${table.title} still exposes the long dimension column`)
  }
  for (const figure of figures) {
    const dimensions = imageDimensionsFromDataUrl(figure.dataUrl)
    assertProfessionalFigureMetadata(figure, dimensions)
    assert(dimensions.width >= 1000, `${figure.title} width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 360, `${figure.title} height is too low: ${dimensions.height}`)
    if (figure.id === 'figure_entropy_weights') {
      assert(dimensions.height >= 520, `${figure.title} is too short for a paper-ready Word figure: ${dimensions.height}`)
    }
    if (figure.id === 'figure_kano_entropy_priority') {
      assert(dimensions.width >= 2000, `${figure.title} source image is too narrow for Word export: ${dimensions.width}`)
      assert(dimensions.height >= 900, `${figure.title} source image is too compressed for a paper-ready ranking chart: ${dimensions.height}`)
    }
  }
  assertPaperNarratives({ assert, components, tables, figures, label: 'KANO entropy' })
  const narrativeComponents = components.filter(component => component.type === 'analysis')
  const narrativeText = narrativeComponents.map(component => component.content ?? '').join('\n')
  assert(narrativeText.includes('回应了研究中关于') || narrativeText.includes('转化为具体的设计优化方向'), 'figure narrative is not research-question oriented enough')
}

function paperNodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'researchImage') return String(node.attrs?.caption ?? node.attrs?.title ?? '')
  if (node.type === 'researchTable') return String(node.attrs?.title ?? '')
  return (node.content ?? []).map(paperNodeText).join('')
}

function paperDocText(doc) {
  return (doc.content ?? []).map(paperNodeText).filter(Boolean).join('\n')
}

function assertResearchBridgeInsertion(pkg) {
  const sourceDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '\u672c\u8282\u9996\u5148\u5bf9\u7814\u7a76\u7ed3\u679c\u8fdb\u884c\u6982\u8ff0\u3002' }],
      },
    ],
  }
  const merged = mergeResearchNodesIntoDoc(sourceDoc, researchPackageToPaperNodes(pkg), 'result')
  const mergedText = paperDocText(merged)
  assert(mergedText.includes('\u672c\u8282\u9996\u5148\u5bf9\u7814\u7a76\u7ed3\u679c\u8fdb\u884c\u6982\u8ff0'), 'research insertion should preserve existing section prose')
  assert(mergedText.includes('\u672c\u6587\u5c06\u6838\u5fc3\u7ed3\u679c\u7eb3\u5165\u672c\u8282\u8fdb\u884c\u8bf4\u660e'), 'research insertion lacks thesis-style bridge prose')
  assert(merged.content.length > sourceDoc.content.length + 1, 'research insertion did not append package nodes after the bridge')
}

function paragraphNode(text) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  }
}

function thesisSectionDoc(introText, pkg, role) {
  const sourceDoc = {
    type: 'doc',
    content: [paragraphNode(introText)],
  }
  const researchNodes = researchPackageToPaperNodes(pkg)
  return mergeResearchNodesIntoDoc(sourceDoc, researchNodes, role)
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  const footnotesXml = await zip.file('word/footnotes.xml')?.async('string')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string')
  assert(documentXml, 'DOCX 缺少 word/document.xml')
  const text = Array.from(documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
  const footnoteText = footnotesXml
    ? Array.from(footnotesXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)).map(match => match[1]).join('')
    : ''
  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  const mediaChecks = []
  for (const name of media) {
    const mediaBuffer = await zip.file(name)?.async('nodebuffer')
    assert(mediaBuffer && mediaBuffer.length > 25, `DOCX image is empty: ${name}`)
    if (name.toLowerCase().endsWith('.png')) {
      assert(mediaBuffer.toString('ascii', 1, 4) === 'PNG', `DOCX image is not a valid PNG: ${name}`)
      const colorType = mediaBuffer[25]
      assert(colorType !== 4 && colorType !== 6, `DOCX PNG image must be flattened without alpha: ${name}`)
      await inspectPngPixels(mediaBuffer, name)
      mediaChecks.push({ name, colorType, bytes: mediaBuffer.length })
    }
  }
  const pageSize = documentXml.match(/<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*>/)
  const pageMargin = documentXml.match(/<w:pgMar[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/)
  const tableCount = (documentXml.match(/<w:tbl>/g) ?? []).length
  const tableGridCount = (documentXml.match(/<w:tblGrid>/g) ?? []).length
  const cellWidthCount = (documentXml.match(/<w:tcW\b/g) ?? []).length
  const imageExtents = Array.from(documentXml.matchAll(/<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*>/g))
    .map(match => ({ cx: Number(match[1]), cy: Number(match[2]) }))
  const minImageExtent = imageExtents.reduce(
    (min, item) => ({
      cx: Math.min(min.cx, item.cx),
      cy: Math.min(min.cy, item.cy),
    }),
    { cx: Number.POSITIVE_INFINITY, cy: Number.POSITIVE_INFINITY }
  )
  const badTerms = ['系统识别到', '研究支撑', '上传工作簿', '当前工作簿', '该方案直接采用', '用于辅助说明数据中的主要分布特征', '寤鸿', '鐔', '璁', '銆']
    .filter(term => text.includes(term))
  const hasEntropyTable = /熵权法权重计算/.test(text)
  const falseEntropyTerms = hasEntropyTable ? [] : ['熵权', '耦合'].filter(term => text.includes(term))
  const suspiciousQuestionRuns = text.match(/\?{4,}/g) ?? []
  return {
    page: {
      width: pageSize ? Number(pageSize[1]) : 0,
      height: pageSize ? Number(pageSize[2]) : 0,
      marginTop: pageMargin ? Number(pageMargin[1]) : 0,
      marginRight: pageMargin ? Number(pageMargin[2]) : 0,
      marginBottom: pageMargin ? Number(pageMargin[3]) : 0,
      marginLeft: pageMargin ? Number(pageMargin[4]) : 0,
    },
    tableCount,
    tableGridCount,
    cellWidthCount,
    imageCount: media.length,
    flattenedPngCount: mediaChecks.length,
    imageExtentCount: imageExtents.length,
    minImageExtent,
    tableCaptionCount: (text.match(/表4-/g) ?? []).length,
    figureCaptionCount: (text.match(/图4-/g) ?? []).length,
    bodyFootnoteReferenceCount: (documentXml.match(/<w:footnoteReference\b/g) ?? []).length,
    footnoteCount: (footnotesXml?.match(/<w:footnote\b/g) ?? []).length,
    hasFootnotesRelationship: relsXml ? /Type="[^"]+\/footnotes"/.test(relsXml) : false,
    hasFootnotesContentType: contentTypesXml ? /PartName="\/word\/footnotes\.xml"/.test(contentTypesXml) : false,
    hasResearchCitationFootnote: /Kano/i.test(footnoteText) && footnoteText.includes('1984'),
    badTerms,
    falseEntropyTerms,
    suspiciousQuestionRuns,
    hasExistingMethodProse: text.includes('\u672c\u7814\u7a76\u5728\u95ee\u5377\u6570\u636e\u57fa\u7840\u4e0a\u5efa\u7acb\u5206\u6790\u8def\u5f84'),
    hasExistingResultProse: text.includes('\u672c\u8282\u9996\u5148\u5bf9\u7814\u7a76\u7ed3\u679c\u8fdb\u884c\u6982\u8ff0'),
    hasExistingDiscussionProse: text.includes('\u4ee5\u4e0b\u8ba8\u8bba\u5c06\u56de\u5230\u7814\u7a76\u95ee\u9898\u672c\u8eab'),
    hasMethodBridge: text.includes('\u5c06\u672c\u6b21\u7814\u7a76\u8ba1\u7b97\u7684\u65b9\u6cd5\u8def\u5f84\u4e0e\u6570\u636e\u5904\u7406\u8fc7\u7a0b\u8bf4\u660e\u5982\u4e0b'),
    hasResultBridge: text.includes('\u672c\u6587\u5c06\u6838\u5fc3\u7ed3\u679c\u7eb3\u5165\u672c\u8282\u8fdb\u884c\u8bf4\u660e'),
    hasDiscussionBridge: text.includes('\u8ba8\u8bba\u5176\u5bf9\u7814\u7a76\u95ee\u9898\u7684\u56de\u5e94'),
  }
}

async function main() {
  assert(fs.existsSync(workbookPath), `找不到烟测 Excel：${workbookPath}`)

  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/research', researchRouter)
  const { server, port } = await listenOnSafePort(app)
  const base = `http://127.0.0.1:${port}`

  try {
    const fileData = fs.readFileSync(workbookPath).toString('base64')
    const expectedEntropyWorkbook = workbookPath.includes('熵权')
    const common = {
      projectTitle: expectedEntropyWorkbook
        ? '面向青年群体的非遗文创视觉元素魅力识别——基于KANO-熵权法的分析'
        : '面向青年群体的国潮插画视觉元素魅力识别——基于KANO模型的分析',
      fileName: path.basename(workbookPath),
      base64: fileData,
      userRequest: expectedEntropyWorkbook
        ? '请根据上传的问卷数据生成论文第四章可用的KANO-熵权法分析结果、表格、图片和论文式解释。'
        : '请根据上传的问卷数据生成论文第四章可用的KANO分析结果、表格、图片和论文式解释。',
    }
    const plan = await post(base, '/api/research/analysis-plan', common)
    const analysis = await post(base, '/api/research/analyze', { ...common, plan: plan.plan })
    const components = componentsFromAnalysis(analysis)
    assertResearchOutputQuality(analysis, components)
    const sections = [
      { id: 's3', title: '三、研究设计与数据来源', content: '' },
      { id: 's4', title: '四、数据分析与研究结果', content: '' },
      { id: 's5', title: '五、优化策略与研究讨论', content: '' },
    ]
    const writePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: expectedEntropyWorkbook ? 'KANO-熵权法分析' : 'KANO分析',
      assetSummary: '问卷数据分析结果',
      sections,
      components,
    })

    const placements = writePlan.plan?.placements ?? []
    const tableCount = analysis.tables?.length ?? 0
    const figureCount = analysis.figures?.length ?? 0
    const hasEntropyTable = (analysis.tables ?? []).some(table => table.id === 'table_entropy_weights')
    const expectedTableCount = hasEntropyTable ? 3 : 2
    const expectedFigureCount = hasEntropyTable ? 4 : 3
    assert(plan.plan?.method === 'kano_entropy', '未识别为 KANO-熵权法分析')
    assert(tableCount >= expectedTableCount, `表格数量不足：${tableCount}`)
    assert(figureCount >= expectedFigureCount, `图片数量不足：${figureCount}`)
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), '方法组件未写入研究设计章节')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), '结果组件未写入数据分析章节')
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), '讨论建议组件未写入优化策略/研究讨论章节')

    const semanticSections = [
      { id: 'design', title: '研究设计、样本与测量', content: expectedEntropyWorkbook ? '说明问卷来源、样本处理、KANO模型和熵权法计算口径。' : '说明问卷来源、样本处理、KANO模型和优先级计算口径。' },
      { id: 'findings', title: '实证结果分析', content: expectedEntropyWorkbook ? '呈现KANO分类、Better-Worse系数、熵权结果和综合排序。' : '呈现KANO分类、Better-Worse系数和优先级排序。' },
      { id: 'strategy', title: '设计优化路径与讨论', content: '将实证发现转化为视觉元素优化策略和研究讨论。' },
    ]
    const semanticWritePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: expectedEntropyWorkbook ? 'KANO-熵权法分析' : 'KANO分析',
      assetSummary: '问卷数据分析结果',
      sections: semanticSections,
      components,
    })
    const semanticPlacements = semanticWritePlan.plan?.placements ?? []
    assert(semanticPlacements.some(item => item.role === 'method' && item.targetSectionId === 'design'), '语义大纲下方法组件未写入研究设计章节')
    assert(semanticPlacements.some(item => item.role === 'result' && item.targetSectionId === 'findings'), '语义大纲下结果组件未写入实证结果章节')
    assert(semanticPlacements.some(item => item.role === 'discussion' && item.targetSectionId === 'strategy'), '语义大纲下讨论组件未写入优化讨论章节')

    const idsBySection = idsByResolvedSection(sections, placements)
    const methodIds = idsBySection.get('s3') ?? new Set()
    const resultIds = idsBySection.get('s4') ?? new Set()
    const discussionIds = idsBySection.get('s5') ?? new Set()
    const methodPkg = {
      id: 'smoke-method',
      projectId: 'smoke',
      title: '研究方法说明',
      components: components.filter(component => methodIds.has(component.id)),
      insertedComponentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const resultPkg = {
      id: 'smoke-result',
      projectId: 'smoke',
      title: hasEntropyTable ? 'KANO-熵权法分析结果' : 'KANO分析结果',
      components: components.filter(component => resultIds.has(component.id)),
      insertedComponentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const discussionPkg = {
      id: 'smoke-discussion',
      projectId: 'smoke',
      title: '讨论与优化建议',
      components: components.filter(component => discussionIds.has(component.id)),
      insertedComponentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    assertResearchBridgeInsertion(resultPkg)
    const methodIntro = '\u672c\u7814\u7a76\u5728\u95ee\u5377\u6570\u636e\u57fa\u7840\u4e0a\u5efa\u7acb\u5206\u6790\u8def\u5f84\uff0c\u4ee5\u4fdd\u8bc1\u540e\u7eed\u7ed3\u679c\u89e3\u91ca\u5177\u6709\u65b9\u6cd5\u4f9d\u636e\u3002'
    const resultIntro = '\u672c\u8282\u9996\u5148\u5bf9\u7814\u7a76\u7ed3\u679c\u8fdb\u884c\u6982\u8ff0\uff0c\u518d\u56f4\u7ed5\u6838\u5fc3\u6307\u6807\u5c55\u5f00\u5177\u4f53\u5206\u6790\u3002'
    const discussionIntro = '\u4ee5\u4e0b\u8ba8\u8bba\u5c06\u56de\u5230\u7814\u7a76\u95ee\u9898\u672c\u8eab\uff0c\u5e76\u5c06\u7edf\u8ba1\u7ed3\u679c\u8f6c\u5316\u4e3a\u8bbe\u8ba1\u4e0e\u4f20\u64ad\u4f18\u5316\u542f\u793a\u3002'
    const methodFootnoteAnchor = '\u5206\u6790\u8def\u5f84'
    const methodFootnoteStart = methodIntro.indexOf(methodFootnoteAnchor)
    assert(methodFootnoteStart >= 0, 'method footnote anchor is missing')
    const methodDoc = thesisSectionDoc(
      methodIntro,
      methodPkg,
      'method'
    )
    const resultDoc = thesisSectionDoc(
      resultIntro,
      resultPkg,
      'result'
    )
    const discussionDoc = thesisSectionDoc(
      discussionIntro,
      discussionPkg,
      'discussion'
    )
    const docSections = [
      {
        id: 's3',
        projectId: 'smoke',
        title: '三、研究设计与方法',
        content: paperDocText(methodDoc),
        editorDoc: methodDoc,
        footnotes: [{
          id: 'smoke-research-citation-footnote',
          number: 1,
          blockIndex: 0,
          start: methodFootnoteStart,
          end: methodFootnoteStart + methodFootnoteAnchor.length,
          anchorText: methodFootnoteAnchor,
          noteText: 'Kano, N. Attractive quality and must-be quality. Journal of the Japanese Society for Quality Control, 1984.',
        }],
        status: 'done',
        order: 3,
      },
      {
        id: 's4',
        projectId: 'smoke',
        title: '四、数据分析与结果',
        content: paperDocText(resultDoc),
        editorDoc: resultDoc,
        status: 'done',
        order: 4,
      },
      {
        id: 's5',
        projectId: 'smoke',
        title: '五、讨论与优化建议',
        content: paperDocText(discussionDoc),
        editorDoc: discussionDoc,
        status: 'done',
        order: 5,
      },
    ]
    const blob = await buildSectionsDocxBlob(common.projectTitle, docSections)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)

    const docx = await inspectDocx(buffer)
    assert(docx.page.width === 11906 && docx.page.height === 16838, `DOCX 页面不是 A4 纵向：${JSON.stringify(docx.page)}`)
    assert(docx.page.marginLeft >= 1440 && docx.page.marginRight >= 1440, `DOCX 左右页边距过窄：${JSON.stringify(docx.page)}`)
    assert(docx.page.marginTop >= 1200 && docx.page.marginBottom >= 1200, `DOCX 上下页边距过窄：${JSON.stringify(docx.page)}`)
    assert(docx.tableCount >= expectedTableCount, `DOCX 表格数量不足：${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX 表格缺少固定列宽网格，可能在 Word 中挤压变形')
    assert(docx.cellWidthCount > 0, 'DOCX 表格缺少单元格宽度，可能在 Word 中自动撑爆')
    assert(docx.imageCount >= expectedFigureCount, `DOCX 图片数量不足：${docx.imageCount}`)
    assert(docx.imageExtentCount >= expectedFigureCount, `DOCX 图片缺少 Word 显示尺寸：${docx.imageExtentCount}`)
    assert(docx.minImageExtent.cx >= 5000000 && docx.minImageExtent.cy >= 2400000, `DOCX 图片显示尺寸过小：${JSON.stringify(docx.minImageExtent)}`)
    assert(docx.tableCaptionCount >= expectedTableCount, `DOCX 表题数量不足：${docx.tableCaptionCount}`)
    assert(docx.figureCaptionCount >= expectedFigureCount, `DOCX 图题数量不足：${docx.figureCaptionCount}`)
    assert(docx.bodyFootnoteReferenceCount >= 1, `DOCX 缺少正文脚注引用：${docx.bodyFootnoteReferenceCount}`)
    assert(docx.footnoteCount >= 1, `DOCX footnotes.xml 脚注数量不足：${docx.footnoteCount}`)
    assert(docx.hasFootnotesRelationship, 'DOCX 缺少 footnotes relationship')
    assert(docx.hasFootnotesContentType, 'DOCX 缺少 footnotes content type')
    assert(docx.hasResearchCitationFootnote, 'DOCX 研究计算导出未保留文献脚注')
    assert(docx.badTerms.length === 0, `DOCX 出现不应展示的内部/乱码词：${docx.badTerms.join('、')}`)
    assert(docx.falseEntropyTerms.length === 0, `KANO-only DOCX 不应出现熵权/耦合表述：${docx.falseEntropyTerms.join('、')}`)
    assert(docx.suspiciousQuestionRuns.length === 0, `DOCX 出现疑似乱码问号段落：${docx.suspiciousQuestionRuns.join('、')}`)
    assert(docx.hasExistingMethodProse && docx.hasExistingResultProse && docx.hasExistingDiscussionProse, 'DOCX should preserve existing thesis section prose before inserted research results')
    assert(docx.hasMethodBridge && docx.hasResultBridge && docx.hasDiscussionBridge, 'DOCX should include thesis-style bridge prose for method, result, and discussion insertions')

    console.log(JSON.stringify({
      ok: true,
      workbookPath,
      outputPath,
      planMethod: plan.plan.method,
      tableCount,
      figureCount,
      componentCount: components.length,
      placements: placements.map(item => ({
        role: item.role,
        targetSectionId: item.targetSectionId,
        componentCount: item.componentIds?.length ?? 0,
      })),
      docx,
    }, null, 2))
  } finally {
    server.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
