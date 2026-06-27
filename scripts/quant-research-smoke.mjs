import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'
import { assertPaperNarratives } from './research-smoke-assertions.mjs'
import { idsByResolvedSection, listenOnSafePort } from './smoke-server.mjs'

const outputPath = path.resolve(
  process.argv[2] || process.env.QUANT_RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/quant-research-smoke.docx'
)

const numericColumns = [
  '视觉识别1',
  '视觉识别2',
  '视觉识别3',
  '文化认同1',
  '文化认同2',
  '文化认同3',
  '互动体验1',
  '互动体验2',
  '互动体验3',
  '传播意愿1',
  '传播意愿2',
  '传播意愿3',
]

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

function clampLikert(value) {
  return Math.max(1, Math.min(5, Math.round(value)))
}

function makeQuantWorkbookBase64() {
  const rows = Array.from({ length: 120 }, (_item, index) => {
    const group = index % 3 === 0 ? '高频使用' : index % 3 === 1 ? '中频使用' : '低频使用'
    const latent = 2.2 + (index % 9) * 0.24 + (group === '高频使用' ? 0.5 : group === '中频使用' ? 0.2 : -0.05)
    const visual = latent + ((index % 3) - 1) * 0.05
    const culture = latent + 0.1 + ((index % 4) - 1.5) * 0.04
    const interaction = latent - 0.05 + ((index % 5) - 2) * 0.04
    const intention = latent + 0.15 + ((index % 6) - 2.5) * 0.03
    return {
      使用频率: group,
      性别: index % 2 === 0 ? '女' : '男',
      年龄段: index % 4 === 0 ? '18-25岁' : index % 4 === 1 ? '26-30岁' : index % 4 === 2 ? '31-35岁' : '36岁以上',
      视觉识别1: clampLikert(visual),
      视觉识别2: clampLikert(visual + 0.2),
      视觉识别3: clampLikert(visual - 0.1),
      文化认同1: clampLikert(culture),
      文化认同2: clampLikert(culture + 0.15),
      文化认同3: clampLikert(culture - 0.05),
      互动体验1: clampLikert(interaction),
      互动体验2: clampLikert(interaction + 0.1),
      互动体验3: clampLikert(interaction - 0.15),
      传播意愿1: clampLikert(intention),
      传播意愿2: clampLikert(intention + 0.15),
      传播意愿3: clampLikert(intention - 0.1),
    }
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '问卷数据')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return buffer.toString('base64')
}

function componentsFromAnalysis(analysis) {
  return splitResearchAssetIntoComponents({
    id: 'quant-smoke-asset',
    projectId: 'quant-smoke',
    taskId: 'quant-smoke-task',
    type: 'quant_analysis_result',
    title: '问卷量化分析结果',
    summary: '基于问卷数据的描述统计、信度、相关、方差和因子分析结果',
    plainText: analysis.plainText ?? '',
    structuredData: { result: analysis },
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

function pngDimensionsFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl ?? ''))
  assert(match, 'figure is missing a PNG data URL')
  const buffer = Buffer.from(match[1], 'base64')
  assert(buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG', 'figure data is not a valid PNG')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  }
}

function assertQuantQuality(analysis, components) {
  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const requiredTables = [
    'table_data_quality',
    'table_descriptive',
    'table_reliability',
    'table_correlation',
    'table_anova',
    'table_efa',
  ]
  const requiredFigures = [
    'figure_descriptive_means',
    'figure_reliability_alpha',
    'figure_correlation_heatmap',
    'figure_anova_f',
    'figure_efa_loadings',
  ]
  for (const id of requiredTables) {
    assert(tables.some(table => table.id === id), `${id} is missing; available=${tables.map(table => table.id).join(',')}`)
  }
  for (const id of requiredFigures) {
    const figure = figures.find(item => item.id === id)
    assert(figure, `${id} is missing`)
    const dimensions = pngDimensionsFromDataUrl(figure.dataUrl)
    assert(dimensions.width >= 900, `${id} width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 250, `${id} height is too low: ${dimensions.height}`)
  }

  const reliability = tables.find(table => table.id === 'table_reliability')
  const alpha = Number(reliability?.rows?.[0]?.alpha)
  assert(Number.isFinite(alpha) && alpha >= 0.7, `Cronbach alpha should be acceptable, got ${alpha}`)

  const methodCount = components.filter(component => component.type === 'method').length
  const tableCount = components.filter(component => component.type === 'statistics').length
  const figureCount = components.filter(component => component.type === 'figure').length
  assert(methodCount >= 1, 'quant method narrative is missing')
  assert(tableCount >= requiredTables.length, 'quant paper tables are missing')
  assert(figureCount >= requiredFigures.length, 'quant paper figures are missing')
  assertPaperNarratives({ assert, components, tables, figures, label: 'quant' })
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX is missing word/document.xml')
  const text = Array.from(documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  const mediaChecks = []
  for (const name of media) {
    const mediaBuffer = await zip.file(name)?.async('nodebuffer')
    assert(mediaBuffer && mediaBuffer.length > 25, `DOCX image is empty: ${name}`)
    if (name.toLowerCase().endsWith('.png')) {
      assert(mediaBuffer.toString('ascii', 1, 4) === 'PNG', `DOCX image is not a valid PNG: ${name}`)
      const colorType = mediaBuffer[25]
      assert(colorType !== 4 && colorType !== 6, `DOCX PNG image must be flattened without alpha: ${name}`)
      mediaChecks.push({ name, colorType, bytes: mediaBuffer.length })
    }
  }
  const pageSize = documentXml.match(/<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*>/)
  const pageMargin = documentXml.match(/<w:pgMar[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/)
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
    tableCount: (documentXml.match(/<w:tbl>/g) ?? []).length,
    tableGridCount: (documentXml.match(/<w:tblGrid>/g) ?? []).length,
    cellWidthCount: (documentXml.match(/<w:tcW\b/g) ?? []).length,
    imageCount: media.length,
    flattenedPngCount: mediaChecks.length,
    imageExtentCount: (documentXml.match(/<wp:extent\b/g) ?? []).length,
    hasQuantText: /Cronbach|Pearson|方差|因子|描述/.test(text),
    internalLeakCount: (text.match(/table_descriptive|figure_descriptive|research_component/g) ?? []).length,
    suspiciousQuestionRuns,
  }
}

async function main() {
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/research', researchRouter)
  const { server, port } = await listenOnSafePort(app)
  const base = `http://127.0.0.1:${port}`

  try {
    const confirmedPlan = {
      method: 'descriptive',
      methods: ['descriptive', 'cronbach_alpha', 'correlation', 'anova', 'efa'],
      requiredColumns: numericColumns,
      toolCalls: [
        { tool: 'descriptive', columns: numericColumns },
        { tool: 'cronbach_alpha', columns: numericColumns },
        { tool: 'correlation', columns: numericColumns },
        { tool: 'anova', columns: numericColumns.slice(0, 6), groupColumn: '使用频率' },
        { tool: 'efa', columns: numericColumns.slice(0, 10) },
      ],
    }
    const common = {
      projectTitle: '短视频平台非遗内容传播意愿影响因素研究',
      fileName: 'quant-smoke.xlsx',
      base64: makeQuantWorkbookBase64(),
      groupColumn: '使用频率',
      userRequest: '请对问卷数据进行描述统计、信度分析、相关分析、单因素方差分析和探索性因子分析，并生成论文第四章可用图表与解释。',
    }
    const plan = await post(base, '/api/research/analysis-plan', common)
    const analysis = await post(base, '/api/research/analyze', {
      ...common,
      plan: plan.plan,
      confirmedPlan: { ...plan.plan, ...confirmedPlan },
    })
    const components = componentsFromAnalysis(analysis)
    assertQuantQuality(analysis, components)

    const sections = [
      { id: 's3', title: '第三章 研究设计与问卷数据来源', content: '本章说明问卷设计、变量测量、样本来源和分析方法。' },
      { id: 's4', title: '第四章 数据分析与研究结果', content: '本章呈现描述统计、信度效度、相关关系和差异检验结果。' },
      { id: 's5', title: '第五章 讨论与传播优化建议', content: '本章围绕研究问题解释结果，并提出传播优化策略。' },
    ]
    const writePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: '问卷量化分析结果',
      assetSummary: '描述统计、信度、相关、方差和因子分析结果',
      sections,
      components,
    })
    const placements = writePlan.plan?.placements ?? []
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), 'method components were not routed to chapter 3')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), 'result components were not routed to chapter 4')

    const idsBySection = idsByResolvedSection(sections, placements)
    const docSections = sections.map((section, index) => ({
      id: section.id,
      projectId: 'quant-smoke',
      title: section.title,
      content: '',
      editorDoc: {
        type: 'doc',
        content: researchPackageToPaperNodes({
          id: `quant-smoke-${section.id}`,
          projectId: 'quant-smoke',
          title: 'Quant research package',
          components: components.filter(component => idsBySection.get(section.id)?.has(component.id)),
          insertedComponentIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      },
      status: 'done',
      order: index + 3,
    }))

    const blob = await buildSectionsDocxBlob(common.projectTitle, docSections)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)
    const docx = await inspectDocx(buffer)
    assert(docx.page.width === 11906 && docx.page.height === 16838, `DOCX page is not A4 portrait: ${JSON.stringify(docx.page)}`)
    assert(docx.page.marginLeft >= 1440 && docx.page.marginRight >= 1440, `DOCX side margins are too narrow: ${JSON.stringify(docx.page)}`)
    assert(docx.tableCount >= 6, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.cellWidthCount > 0, 'DOCX tables are missing cell widths')
    assert(docx.imageCount >= 5, `DOCX image count is too low: ${docx.imageCount}`)
    assert(docx.imageExtentCount >= 5, `DOCX images are missing display extents: ${docx.imageExtentCount}`)
    assert(docx.hasQuantText, 'DOCX does not contain quant result text')
    assert(docx.internalLeakCount === 0, `DOCX leaked internal research ids: ${docx.internalLeakCount}`)
    assert(docx.suspiciousQuestionRuns.length === 0, `DOCX contains suspicious question-mark text: ${docx.suspiciousQuestionRuns.join(', ')}`)

    console.log(JSON.stringify({
      ok: true,
      outputPath,
      planMethod: plan.plan.method,
      tableCount: analysis.tables?.length ?? 0,
      figureCount: analysis.figures?.length ?? 0,
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
