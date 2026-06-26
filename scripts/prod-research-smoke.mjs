import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'
import { idsByResolvedSection } from './smoke-server.mjs'

const baseUrl = (process.argv[2] || process.env.PROD_SMOKE_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const outputPath = path.resolve(
  process.argv[3] || process.env.PROD_RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/prod-research-smoke.docx'
)
const defaultKanoWorkbookPath = path.resolve(
  process.cwd(),
  '../outputs/ich_kano_entropy/非遗文创KANO-熵权法耦合模型问卷100份样本数据.xlsx'
)
const scenarioName = String(process.env.PROD_RESEARCH_SMOKE_SCENARIO ?? process.argv[4] ?? 'ahp').toLowerCase()
const keepProject = process.env.PROD_RESEARCH_SMOKE_KEEP === '1'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function post(route, body, token = '') {
  return requestJson('POST', route, body, token)
}

async function put(route, body, token = '') {
  return requestJson('PUT', route, body, token)
}

async function del(route, token = '') {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'DELETE',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 1200)}`)
  return text ? JSON.parse(text) : { ok: true }
}

async function requestJson(method, route, body, token = '') {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok === false) {
    throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 1200)}`)
  }
  return json
}

async function getText(route, token = '') {
  const res = await fetch(`${baseUrl}${route}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 1200)}`)
  return text
}

async function getJson(route, token = '') {
  const text = await getText(route, token)
  return text ? JSON.parse(text) : null
}

function makeAhpWorkbookBase64() {
  const criteria = ['Culture', 'Design', 'Price', 'Channel']
  const matrix = [
    ['', ...criteria],
    ['Culture', 1, 3, 5, 4],
    ['Design', 1 / 3, 1, 3, 2],
    ['Price', 1 / 5, 1 / 3, 1, 1 / 2],
    ['Channel', 1 / 4, 1 / 2, 2, 1],
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), 'AHP Matrix')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return buffer.toString('base64')
}

function makeKanoWorkbookBase64() {
  const workbookPath = path.resolve(process.env.PROD_RESEARCH_SMOKE_XLSX || defaultKanoWorkbookPath)
  assert(fs.existsSync(workbookPath), `KANO workbook not found: ${workbookPath}`)
  return fs.readFileSync(workbookPath).toString('base64')
}

function scenarioConfig() {
  if (scenarioName === 'kano' || scenarioName === 'kano_entropy') {
    return {
      name: 'kano_entropy',
      title: 'Production KANO entropy research smoke test',
      fileName: 'prod-kano-entropy-smoke.xlsx',
      base64: makeKanoWorkbookBase64(),
      method: 'kano_entropy',
      assetType: 'quant_analysis_result',
      assetTitle: 'Production KANO-熵权法分析结果',
      assetSummary: '真实问卷 Excel 的 KANO-熵权法分析结果。',
      userRequest: '请根据上传的真实问卷 Excel 生成 KANO-熵权法分析结果、论文表格、论文图和可写入正文的解释。',
      sections: [
        { id: 's3', title: '三、研究设计与数据来源', content: '本章说明问卷设计、样本来源、KANO模型和熵权法计算过程。' },
        { id: 's4', title: '四、数据分析与研究结果', content: '本章呈现KANO分类、Better-Worse系数、熵权计算和耦合优先级排序结果。' },
        { id: 's5', title: '五、优化策略与研究讨论', content: '本章结合数据分析结果提出非遗文创视觉创新优化策略。' },
      ],
      assertAnalysis: analysis => {
        assert(analysis.method === 'kano_entropy', `production analysis method is not KANO entropy: ${analysis.method}`)
        assert((analysis.tables ?? []).some(table => table.id === 'table_kano_summary'), 'production KANO summary table missing')
        assert((analysis.tables ?? []).some(table => table.id === 'table_entropy_weights'), 'production entropy weight table missing')
        assert((analysis.tables ?? []).some(table => table.id === 'table_priority_ranking'), 'production priority table missing')
        assert((analysis.figures ?? []).some(figure => figure.id === 'figure_kano_distribution'), 'production KANO distribution figure missing')
        assert((analysis.figures ?? []).some(figure => figure.id === 'figure_kano_entropy_priority'), 'production priority figure missing')
      },
      minTables: 3,
      minFigures: 4,
    }
  }

  return {
    name: 'ahp',
    title: 'Production research smoke test',
    fileName: 'prod-ahp-smoke.xlsx',
    base64: makeAhpWorkbookBase64(),
    method: 'ahp',
    assetType: 'ahp_result',
    assetTitle: 'Production AHP analysis result',
    assetSummary: 'AHP result returned from the deployed production API.',
    userRequest: 'Use AHP to calculate weights, consistency, figures, tables and paper-ready method/result/discussion text.',
    sections: [
      { id: 's3', title: 'Chapter 3 Research Method', content: 'Method, sample and data source.' },
      { id: 's4', title: 'Chapter 4 Data Analysis and Results', content: 'Tables, figures and result interpretation.' },
      { id: 's5', title: 'Chapter 5 Discussion and Suggestions', content: 'Discussion and optimization suggestions.' },
    ],
    assertAnalysis: analysis => {
      assert(analysis.method === 'ahp', `production analysis method is not AHP: ${analysis.method}`)
      assert((analysis.tables ?? []).some(table => table.id === 'table_ahp_consistency'), 'production AHP consistency table missing')
      assert((analysis.tables ?? []).some(table => table.id === 'table_ahp_weights'), 'production AHP weights table missing')
      assert((analysis.figures ?? []).some(figure => figure.id === 'figure_ahp_weights'), 'production AHP weight figure missing')
      assert((analysis.figures ?? []).some(figure => figure.id === 'figure_ahp_consistency'), 'production AHP consistency figure missing')
    },
    minTables: 2,
    minFigures: 2,
  }
}

function componentsFromAnalysis(analysis, scenario) {
  return splitResearchAssetIntoComponents({
    id: 'prod-smoke-asset',
    projectId: 'prod-smoke',
    taskId: 'prod-smoke-task',
    type: scenario.assetType,
    title: scenario.assetTitle,
    summary: scenario.assetSummary,
    plainText: analysis.plainText ?? '',
    structuredData: { result: analysis },
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

function pngDimensionsFromDataUrl(dataUrl) {
  const value = String(dataUrl ?? '')
  const match = /^data:image\/png;base64,(.+)$/.exec(value)
  assert(match, 'figure is not a PNG data URL')
  const buffer = Buffer.from(match[1], 'base64')
  assert(buffer.length > 25 && buffer.toString('ascii', 1, 4) === 'PNG', 'figure data is not a valid PNG')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
    bytes: buffer.length,
  }
}

function assertPaperReadyComponents(analysis, components, scenario) {
  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const methodCount = components.filter(component => component.type === 'method').length
  const tableCount = components.filter(component => component.type === 'statistics' || component.type === 'table').length
  const figureCount = components.filter(component => component.type === 'figure').length
  const beforeCount = components.filter(component => component.type === 'analysis' && String(component.title ?? '').endsWith(': before')).length
  const afterCount = components.filter(component => component.type === 'analysis' && String(component.title ?? '').endsWith(': after')).length
  const narrativeText = components
    .filter(component => component.type === 'analysis' || component.type === 'method')
    .map(component => String(component.content ?? ''))
    .join('\n')

  assert(methodCount >= 1, 'paper-ready method narrative is missing')
  assert(tableCount >= scenario.minTables, `paper-ready table components are missing: ${tableCount}`)
  assert(figureCount >= scenario.minFigures, `paper-ready figure components are missing: ${figureCount}`)
  assert(beforeCount >= tables.length + figures.length, `not every production table/figure has a before paragraph: ${beforeCount}`)
  assert(afterCount >= tables.length + figures.length, `not every production table/figure has an after paragraph: ${afterCount}`)
  assert(/由表|由图|结果显示|可知|说明|表明/.test(narrativeText), 'paper-ready narrative lacks academic result interpretation wording')

  for (const table of tables) {
    assert((table.columns ?? []).length <= 8, `${table.title} has too many displayed columns`)
  }
  for (const figure of figures) {
    const dimensions = pngDimensionsFromDataUrl(figure.dataUrl)
    assert(dimensions.width >= 900, `${figure.title} source PNG width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 250, `${figure.title} source PNG height is too low: ${dimensions.height}`)
    assert(dimensions.colorType !== 4 && dimensions.colorType !== 6, `${figure.title} source PNG still has alpha`)
  }
}

function docxPlainTextFromXml(documentXml) {
  return Array.from(documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
}

function normalizedSectionTitle(title) {
  return String(title ?? '')
    .replace(/^\s*(第?[一二三四五六七八九十]+[章节篇部分]?|[一二三四五六七八九十]+|[0-9]+(?:\.[0-9]+)*)[、.．\s-]*/u, '')
    .trim()
}

function assertDocxPaperStructure(text, sections, scenario) {
  const sectionPositions = sections.map(section => ({
    title: section.title,
    normalizedTitle: normalizedSectionTitle(section.title),
    index: Math.max(text.indexOf(section.title), text.indexOf(normalizedSectionTitle(section.title))),
  }))
  for (const item of sectionPositions) {
    assert(item.index >= 0, `DOCX is missing target section heading: ${item.title}`)
  }
  for (let index = 1; index < sectionPositions.length; index += 1) {
    assert(
      sectionPositions[index - 1].index < sectionPositions[index].index,
      `DOCX section order is wrong: ${sectionPositions[index - 1].title} should appear before ${sectionPositions[index].title}`
    )
  }

  const [methodSection, resultSection, discussionSection] = sectionPositions
  const methodText = text.slice(methodSection.index, resultSection.index)
  const resultText = text.slice(resultSection.index, discussionSection.index)
  const discussionText = text.slice(discussionSection.index)

  assert(/KANO|AHP|层次分析|熵权|模型|方法|计算|权重/.test(methodText), 'DOCX method section lacks method/calculation wording')
  assert(/表4-|图4-|结果显示|由表|由图|可知/.test(resultText), 'DOCX result section lacks table/figure result analysis')
  assert(/讨论|建议|策略|优化|转化|路径|启示/.test(discussionText), 'DOCX discussion section lacks strategy/discussion wording')
  assert((resultText.match(/表4-/g) ?? []).length >= scenario.minTables, 'DOCX result section has too few table captions')
  assert((resultText.match(/图4-/g) ?? []).length >= scenario.minFigures, 'DOCX result section has too few figure captions')
}

async function inspectDocx(buffer, sections, scenario) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX is missing word/document.xml')
  const text = docxPlainTextFromXml(documentXml)
  assertDocxPaperStructure(text, sections, scenario)
  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  const mediaChecks = []
  for (const name of media) {
    const mediaBuffer = await zip.file(name)?.async('nodebuffer')
    assert(mediaBuffer && mediaBuffer.length > 25, `DOCX image is empty: ${name}`)
    if (name.toLowerCase().endsWith('.png')) {
      assert(mediaBuffer.toString('ascii', 1, 4) === 'PNG', `DOCX image is not a valid PNG: ${name}`)
      const width = mediaBuffer.readUInt32BE(16)
      const height = mediaBuffer.readUInt32BE(20)
      const colorType = mediaBuffer[25]
      assert(width >= 900, `DOCX PNG width is too low: ${name} ${width}`)
      assert(height >= 250, `DOCX PNG height is too low: ${name} ${height}`)
      assert(colorType !== 4 && colorType !== 6, `DOCX PNG image must be flattened without alpha: ${name}`)
      mediaChecks.push({ name, width, height, colorType, bytes: mediaBuffer.length })
    }
  }
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
    flattenedPngCount: mediaChecks.length,
    minImagePixels: mediaChecks.reduce(
      (min, item) => ({
        width: Math.min(min.width, item.width),
        height: Math.min(min.height, item.height),
      }),
      { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
    ),
    imageExtentCount: (documentXml.match(/<wp:extent\b/g) ?? []).length,
    internalLeakCount: ((documentXml.match(/table_ahp_|figure_ahp_|research_component/g) ?? []).length),
    paperStructure: {
      hasOrderedSections: true,
      hasMethodNarrative: true,
      hasResultNarrative: true,
      hasDiscussionNarrative: true,
    },
  }
}

async function main() {
  const health = await getText('/api/health')
  assert(health.includes('"ok":true'), `health check failed: ${health}`)

  const login = await post('/api/auth/demo-login', {})
  const token = login.session?.access_token
  assert(token, 'demo login did not return an access token')
  const projectId = randomUUID()
  const packageId = randomUUID()
  const savedSectionIds = ['s3', 's4', 's5'].map(() => randomUUID())
  const scenario = scenarioConfig()

  try {
    await post('/api/projects', {
      id: projectId,
      title: scenario.title,
      description: 'Temporary automated smoke project',
      current_stage: 'stage3',
      context: { smoke: true, scenario: scenario.name, createdBy: 'prod-research-smoke' },
    }, token)

    const common = {
      projectTitle: scenario.title,
      fileName: scenario.fileName,
      base64: scenario.base64,
      method: scenario.method,
      userRequest: scenario.userRequest,
    }
    const plan = await post('/api/research/analysis-plan', common, token)
    const analysis = await post('/api/research/analyze', { ...common, plan: plan.plan }, token)
    const components = componentsFromAnalysis(analysis, scenario)

    assert(plan.plan?.method === scenario.method, `production plan method is wrong: ${plan.plan?.method}`)
    scenario.assertAnalysis(analysis)
    assertPaperReadyComponents(analysis, components, scenario)

    const sections = scenario.sections
    const writePlan = await post('/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: scenario.assetTitle,
      assetSummary: scenario.assetSummary,
      sections,
      components,
    }, token)
    const placements = writePlan.plan?.placements ?? []
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), 'production write-plan did not route method to chapter 3')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), 'production write-plan did not route result to chapter 4')
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), 'production write-plan did not route discussion to chapter 5')

    const idsBySection = idsByResolvedSection(sections, placements)
    const docSections = sections.map((section, index) => ({
      id: section.id,
      projectId,
      title: section.title,
      content: '',
      editorDoc: {
        type: 'doc',
        content: researchPackageToPaperNodes({
          id: `${packageId}-${section.id}`,
          projectId,
          title: 'Production smoke package',
          components: components.filter(component => idsBySection.get(section.id)?.has(component.id)),
          insertedComponentIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      },
      status: 'done',
      order: index + 3,
    }))

    const sectionRows = docSections.map((section, index) => ({
      id: savedSectionIds[index],
      title: section.title,
      content: '',
      content_doc: section.editorDoc,
      status: 'done',
      sort_order: index,
    }))
    await put(`/api/sections/project/${encodeURIComponent(projectId)}`, { sections: sectionRows }, token)

    const researchPackage = {
      id: packageId,
      projectId,
      title: scenario.assetTitle,
      method: scenario.method,
      methodLabel: scenario.name === 'kano_entropy' ? 'KANO-熵权法' : 'AHP',
      capabilityTier: 'closed_loop',
      intentSummary: 'Production smoke package generated from deployed research APIs.',
      components,
      insertedComponentIds: components.map(component => component.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await put(`/api/research-packages/${encodeURIComponent(packageId)}`, { package: researchPackage }, token)

    const savedSections = await getJson(`/api/sections/project/${encodeURIComponent(projectId)}`, token)
    const savedPackages = await getJson(`/api/research-packages/project/${encodeURIComponent(projectId)}`, token)
    assert(Array.isArray(savedSections) && savedSections.length === 3, `saved section count is wrong: ${savedSections?.length}`)
    assert(savedSections.every(section => section.content_doc?.content?.length > 0), 'saved sections are missing content_doc research nodes')
    assert(Array.isArray(savedPackages) && savedPackages.some(pkg => pkg.id === packageId), 'saved research package is missing')

    const blob = await buildSectionsDocxBlob(common.projectTitle, docSections)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)
    const docx = await inspectDocx(buffer, sections, scenario)
    assert(docx.page.width === 11906 && docx.page.height === 16838, `DOCX page is not A4 portrait: ${JSON.stringify(docx.page)}`)
    assert(docx.tableCount >= scenario.minTables, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.imageCount >= scenario.minFigures, `DOCX image count is too low: ${docx.imageCount}`)
    assert(docx.flattenedPngCount >= scenario.minFigures, `DOCX flattened PNG count is too low: ${docx.flattenedPngCount}`)
    assert(docx.minImagePixels.width >= 900 && docx.minImagePixels.height >= 250, `DOCX image pixels are too small: ${JSON.stringify(docx.minImagePixels)}`)
    assert(docx.imageExtentCount >= scenario.minFigures, `DOCX images are missing display extents: ${docx.imageExtentCount}`)
    assert(docx.internalLeakCount === 0, `DOCX leaked internal ids: ${docx.internalLeakCount}`)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      scenario: scenario.name,
      outputPath,
      projectPersisted: {
        projectId,
        sectionCount: savedSections.length,
        packageCount: savedPackages.length,
      },
      planMethod: plan.plan.method,
      resultMethod: analysis.method,
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
    if (keepProject) {
      console.log(JSON.stringify({ keptProjectId: projectId, keptPackageId: packageId, savedSectionIds }))
    } else {
      await Promise.allSettled([
        ...savedSectionIds.map(id => del(`/api/sections/${encodeURIComponent(id)}`, token)),
        del(`/api/research-packages/${encodeURIComponent(packageId)}`, token),
        del(`/api/projects/${encodeURIComponent(projectId)}`, token),
      ])
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
