import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'

const baseUrl = (process.argv[2] || process.env.PROD_SMOKE_BASE_URL || 'https://paper-ai-tool.vercel.app').replace(/\/$/, '')
const outputPath = path.resolve(
  process.argv[3] || process.env.PROD_RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/prod-research-smoke.docx'
)

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

function componentsFromAnalysis(analysis) {
  return splitResearchAssetIntoComponents({
    id: 'prod-smoke-asset',
    projectId: 'prod-smoke',
    taskId: 'prod-smoke-task',
    type: 'ahp_result',
    title: 'Production AHP analysis result',
    summary: 'AHP result returned from the deployed production API.',
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

  try {
    await post('/api/projects', {
      id: projectId,
      title: 'Production research smoke test',
      description: 'Temporary automated smoke project',
      current_stage: 'stage3',
      context: { smoke: true, createdBy: 'prod-research-smoke' },
    }, token)

    const common = {
      projectTitle: 'Production research smoke test',
      fileName: 'prod-ahp-smoke.xlsx',
      base64: makeAhpWorkbookBase64(),
      method: 'ahp',
      userRequest: 'Use AHP to calculate weights, consistency, figures, tables and paper-ready method/result/discussion text.',
    }
    const plan = await post('/api/research/analysis-plan', common, token)
    const analysis = await post('/api/research/analyze', { ...common, plan: plan.plan }, token)
    const components = componentsFromAnalysis(analysis)

    assert(plan.plan?.method === 'ahp', `production plan method is not AHP: ${plan.plan?.method}`)
    assert(analysis.method === 'ahp', `production analysis method is not AHP: ${analysis.method}`)
    assert((analysis.tables ?? []).some(table => table.id === 'table_ahp_consistency'), 'production AHP consistency table missing')
    assert((analysis.tables ?? []).some(table => table.id === 'table_ahp_weights'), 'production AHP weights table missing')
    assert((analysis.figures ?? []).some(figure => figure.id === 'figure_ahp_weights'), 'production AHP weight figure missing')
    assert((analysis.figures ?? []).some(figure => figure.id === 'figure_ahp_consistency'), 'production AHP consistency figure missing')

    const sections = [
      { id: 's3', title: 'Chapter 3 Research Method', content: 'Method, sample and data source.' },
      { id: 's4', title: 'Chapter 4 Data Analysis and Results', content: 'Tables, figures and result interpretation.' },
      { id: 's5', title: 'Chapter 5 Discussion and Suggestions', content: 'Discussion and optimization suggestions.' },
    ]
    const writePlan = await post('/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: 'Production AHP analysis result',
      assetSummary: 'AHP tables, figures and narrative generated by deployed API.',
      sections,
      components,
    }, token)
    const placements = writePlan.plan?.placements ?? []
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), 'production write-plan did not route method to chapter 3')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), 'production write-plan did not route result to chapter 4')
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), 'production write-plan did not route discussion to chapter 5')

    const idsBySection = new Map(sections.map(section => [section.id, new Set()]))
    for (const placement of placements) {
      if (!idsBySection.has(placement.targetSectionId)) continue
      for (const id of placement.componentIds ?? []) idsBySection.get(placement.targetSectionId).add(id)
    }
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
      title: 'Production AHP analysis result',
      method: 'ahp',
      methodLabel: 'AHP',
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
    assert(docx.tableCount >= 2, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.imageCount >= 2, `DOCX image count is too low: ${docx.imageCount}`)
    assert(docx.imageExtentCount >= 2, `DOCX images are missing display extents: ${docx.imageExtentCount}`)
    assert(docx.internalLeakCount === 0, `DOCX leaked internal ids: ${docx.internalLeakCount}`)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
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
    await Promise.allSettled([
      ...savedSectionIds.map(id => del(`/api/sections/${encodeURIComponent(id)}`, token)),
      del(`/api/research-packages/${encodeURIComponent(packageId)}`, token),
      del(`/api/projects/${encodeURIComponent(projectId)}`, token),
    ])
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
