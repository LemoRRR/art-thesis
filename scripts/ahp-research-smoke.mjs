import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'

const outputPath = path.resolve(
  process.argv[2] || process.env.AHP_RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/ahp-research-smoke.docx'
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

function makeAhpWorkbookBase64() {
  const criteria = ['文化认同', '产品设计', '价格因素', '宣传渠道']
  const indicators = ['文化价值感知', '情感连接', '文化背景认知', '文化传承意识']
  const criteriaRows = [
    ['', ...criteria],
    ['文化认同', 1, 3, 5, 4],
    ['产品设计', 1 / 3, 1, 3, 2],
    ['价格因素', 1 / 5, 1 / 3, 1, 1 / 2],
    ['宣传渠道', 1 / 4, 1 / 2, 2, 1],
  ]
  const indicatorRows = [
    ['', ...indicators],
    ['文化价值感知', 1, 2, 4, 3],
    ['情感连接', 1 / 2, 1, 3, 2],
    ['文化背景认知', 1 / 4, 1 / 3, 1, 1 / 2],
    ['文化传承意识', 1 / 3, 1 / 2, 2, 1],
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(criteriaRows), '准则层判断矩阵')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(indicatorRows), '文化认同指标矩阵')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return buffer.toString('base64')
}

function componentsFromAnalysis(analysis) {
  return splitResearchAssetIntoComponents({
    id: 'ahp-smoke-asset',
    projectId: 'ahp-smoke',
    taskId: 'ahp-smoke-task',
    type: 'ahp_result',
    title: 'AHP评价指标体系分析结果',
    summary: '基于专家判断矩阵的AHP权重与一致性检验结果',
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

function assertAhpQuality(plan, analysis, components) {
  assert(plan.plan?.method === 'ahp', `plan did not choose AHP: ${plan.plan?.method}`)
  assert(analysis.method === 'ahp', `analysis did not return AHP: ${analysis.method}`)

  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const consistencyTable = tables.find(table => table.id === 'table_ahp_consistency')
  const weightTable = tables.find(table => table.id === 'table_ahp_weights')
  assert(consistencyTable, 'AHP consistency table is missing')
  assert(weightTable, 'AHP weight table is missing')
  assert((consistencyTable.rows ?? []).length >= 2, 'AHP consistency table should cover multiple matrices')
  assert((weightTable.rows ?? []).length >= 8, 'AHP weight table should include criteria and indicator rows')
  assert((consistencyTable.rows ?? []).every(row => Number(row.CR) < 0.1), 'AHP consistency check should pass in smoke workbook')

  const weightFigure = figures.find(figure => figure.id === 'figure_ahp_weights')
  const consistencyFigure = figures.find(figure => figure.id === 'figure_ahp_consistency')
  assert(weightFigure, 'AHP weight figure is missing')
  assert(consistencyFigure, 'AHP consistency figure is missing')
  for (const figure of [weightFigure, consistencyFigure]) {
    const dimensions = pngDimensionsFromDataUrl(figure.dataUrl)
    assert(dimensions.width >= 900, `${figure.title} width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 250, `${figure.title} height is too low: ${dimensions.height}`)
  }

  const methodCount = components.filter(component => component.type === 'method').length
  const tableCount = components.filter(component => component.type === 'statistics').length
  const figureCount = components.filter(component => component.type === 'figure').length
  const discussionCount = components.filter(component =>
    component.type === 'analysis' && /讨论|建议|策略|discussion|optimization/i.test(`${component.title}\n${component.content}`)
  ).length
  const beforeCount = components.filter(component => component.type === 'analysis' && String(component.title ?? '').endsWith(': before')).length
  const afterCount = components.filter(component => component.type === 'analysis' && String(component.title ?? '').endsWith(': after')).length
  assert(methodCount >= 1, 'AHP method narrative is missing')
  assert(tableCount >= 2, 'AHP paper tables are missing')
  assert(figureCount >= 2, 'AHP paper figures are missing')
  assert(discussionCount >= 1, 'AHP discussion or strategy narrative is missing')
  assert(beforeCount >= tables.length + figures.length, 'not every AHP table/figure has a before paragraph')
  assert(afterCount >= tables.length + figures.length, 'not every AHP table/figure has an after paragraph')
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX is missing word/document.xml')
  const text = Array.from(documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  const pageSize = documentXml.match(/<w:pgSz[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"[^>]*>/)
  const pageMargin = documentXml.match(/<w:pgMar[^>]*w:top="(\d+)"[^>]*w:right="(\d+)"[^>]*w:bottom="(\d+)"[^>]*w:left="(\d+)"/)
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
    imageExtentCount: (documentXml.match(/<wp:extent\b/g) ?? []).length,
    hasAhpText: /AHP|CR|权重|一致性/.test(text),
    internalLeakCount: (text.match(/table_ahp_|figure_ahp_|research_component/g) ?? []).length,
  }
}

async function main() {
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/research', researchRouter)
  const server = app.listen(0)
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  try {
    const common = {
      projectTitle: '非遗文创产品用户购买意愿影响因素研究',
      fileName: 'ahp-smoke.xlsx',
      base64: makeAhpWorkbookBase64(),
      method: 'ahp',
      userRequest: '请基于AHP判断矩阵生成权重、一致性检验、图表和论文表述。',
    }
    const plan = await post(base, '/api/research/analysis-plan', common)
    const analysis = await post(base, '/api/research/analyze', { ...common, plan: plan.plan })
    const components = componentsFromAnalysis(analysis)
    assertAhpQuality(plan, analysis, components)

    const sections = [
      { id: 's3', title: '第三章 研究方法与数据来源', content: '本章说明评价指标体系、专家评分和研究方法。' },
      { id: 's4', title: '第四章 数据分析与研究结果', content: '本章呈现权重计算、一致性检验和结果解释。' },
      { id: 's5', title: '第五章 讨论与优化建议', content: '本章结合实证结果提出策略建议和研究讨论。' },
    ]
    const writePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: 'AHP评价指标体系分析结果',
      assetSummary: '基于专家判断矩阵的AHP权重与一致性检验结果',
      sections,
      components,
    })
    const placements = writePlan.plan?.placements ?? []
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), 'method components were not routed to chapter 3')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), 'result components were not routed to chapter 4')
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), 'discussion components were not routed to chapter 5')

    const idsBySection = new Map(sections.map(section => [section.id, new Set()]))
    for (const placement of placements) {
      const target = placement.targetSectionId
      if (!idsBySection.has(target)) continue
      for (const id of placement.componentIds ?? []) idsBySection.get(target).add(id)
    }
    const docSections = sections.map((section, index) => ({
      id: section.id,
      projectId: 'ahp-smoke',
      title: section.title,
      content: '',
      editorDoc: {
        type: 'doc',
        content: researchPackageToPaperNodes({
          id: `ahp-smoke-${section.id}`,
          projectId: 'ahp-smoke',
          title: 'AHP research package',
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
    assert(docx.tableCount >= 2, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.cellWidthCount > 0, 'DOCX tables are missing cell widths')
    assert(docx.imageCount >= 2, `DOCX image count is too low: ${docx.imageCount}`)
    assert(docx.imageExtentCount >= 2, `DOCX images are missing display extents: ${docx.imageExtentCount}`)
    assert(docx.hasAhpText, 'DOCX does not contain AHP result text')
    assert(docx.internalLeakCount === 0, `DOCX leaked internal research ids: ${docx.internalLeakCount}`)

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
