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

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX is missing word/document.xml')
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
    internalLeakCount: ((documentXml.match(/table_ahp_|figure_ahp_|research_component/g) ?? []).length),
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
    const docx = await inspectDocx(buffer)
    assert(docx.page.width === 11906 && docx.page.height === 16838, `DOCX page is not A4 portrait: ${JSON.stringify(docx.page)}`)
    assert(docx.tableCount >= scenario.minTables, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.imageCount >= scenario.minFigures, `DOCX image count is too low: ${docx.imageCount}`)
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
