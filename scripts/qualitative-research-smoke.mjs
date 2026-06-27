import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'
import { assertPaperNarratives } from './research-smoke-assertions.mjs'
import { idsByResolvedSection, listenOnSafePort } from './smoke-server.mjs'

const outputPath = path.resolve(
  process.argv[2] || process.env.QUAL_RESEARCH_SMOKE_DOCX || '../outputs/ich_kano_entropy/qualitative-research-smoke.docx'
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

function makeInterviewTextBase64() {
  const segments = [
    'Participant 01 said the heritage product looks distinctive, but the story behind the pattern should be explained more clearly before purchase.',
    'Participant 02 cared about whether the craft process is authentic and whether the designer respects the original cultural context.',
    'Participant 03 mentioned that color, packaging and illustration style affect first impression and willingness to share online.',
    'Participant 04 felt that products with practical daily use are easier to recommend to friends than purely decorative souvenirs.',
    'Participant 05 emphasized that short videos should show makers, tools and production details rather than only final product images.',
    'Participant 06 said young consumers may lose interest when cultural explanation is too abstract or disconnected from life scenes.',
    'Participant 07 preferred interactive content such as comments, challenges and repost prompts because it lowers participation barriers.',
    'Participant 08 believed that price transparency and material explanation help build trust in heritage cultural products.',
    'Participant 09 thought similar visual styles are becoming repetitive and brands need clearer differentiation.',
    'Participant 10 suggested combining cultural symbols with contemporary visual language to make the product easier to understand.',
    'Participant 11 said emotional stories about artisans increase recognition and make the product feel more meaningful.',
    'Participant 12 noted that unclear typography and crowded packaging reduce reading comfort and weaken purchase intention.',
  ]
  return Buffer.from(segments.join('\n'), 'utf8').toString('base64')
}

function componentsFromAnalysis(analysis) {
  return splitResearchAssetIntoComponents({
    id: 'qual-smoke-asset',
    projectId: 'qual-smoke',
    taskId: 'qual-smoke-task',
    type: 'qualitative_result',
    title: 'Qualitative coding result',
    summary: 'Interview coding tables, theme summary, evidence excerpts and paper-ready narrative.',
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

function assertQualitativeQuality(plan, analysis, components) {
  assert(plan.plan, 'qualitative plan is missing')
  assert(plan.plan.method === 'qualitative_coding', `plan did not choose qualitative coding: ${plan.plan.method}`)
  assert(analysis.method === 'qualitative_coding', `analysis did not return qualitative coding: ${analysis.method}`)
  assert(Number(analysis.sampleSize) >= 10, `qualitative sample size is too low: ${analysis.sampleSize}`)

  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const requiredTables = [
    'table_open_coding',
    'table_axial_coding',
    'table_theme_summary',
    'table_evidence_excerpt',
  ]
  for (const id of requiredTables) {
    const table = tables.find(item => item.id === id)
    assert(table, `${id} is missing; available=${tables.map(item => item.id).join(',')}`)
    assert((table.rows ?? []).length > 0, `${id} has no rows`)
  }
  const figure = figures.find(item => item.id === 'figure_theme_frequency')
  assert(figure, 'theme frequency figure is missing')
  const dimensions = pngDimensionsFromDataUrl(figure.dataUrl)
  assert(dimensions.width >= 900, `theme figure width is too low: ${dimensions.width}`)
  assert(dimensions.height >= 250, `theme figure height is too low: ${dimensions.height}`)

  const methodCount = components.filter(component => component.type === 'method').length
  const tableCount = components.filter(component => component.type === 'statistics').length
  const figureCount = components.filter(component => component.type === 'figure').length
  const discussionCount = components.filter(component =>
    component.type === 'analysis'
      && !String(component.title ?? '').endsWith(': before')
      && !String(component.title ?? '').endsWith(': after')
      && String(component.content ?? '').length > 80
  ).length
  assert(methodCount >= 1, 'qualitative method narrative is missing')
  assert(tableCount >= requiredTables.length, 'qualitative paper tables are missing')
  assert(figureCount >= 1, 'qualitative paper figure is missing')
  assert(discussionCount >= 2, 'qualitative analysis plus discussion narratives are missing')
  assertPaperNarratives({ assert, components, tables, figures, label: 'qualitative' })
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
    hasQualText: /Participant|coding|theme|Q1|Q2|Q3/i.test(text),
    internalLeakCount: (text.match(/table_open_coding|figure_theme_frequency|research_component/g) ?? []).length,
  }
}

async function main() {
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/research', researchRouter)
  const { server, port } = await listenOnSafePort(app)
  const base = `http://127.0.0.1:${port}`

  try {
    const common = {
      projectTitle: 'Heritage cultural product user experience study',
      fileName: 'interview-coding.txt',
      base64: makeInterviewTextBase64(),
      method: 'qualitative_coding',
      userRequest: 'Run qualitative interview coding, theme extraction, evidence excerpting, and generate paper-ready method, result and discussion content.',
    }
    const plan = await post(base, '/api/research/analysis-plan', common)
    const analysis = await post(base, '/api/research/analyze', { ...common, plan: plan.plan })
    const components = componentsFromAnalysis(analysis)
    assertQualitativeQuality(plan, analysis, components)

    const sections = [
      { id: 's3', title: 'Chapter 3 Research Design and Interview Materials', content: 'This chapter explains interview source, coding method and data processing.' },
      { id: 's4', title: 'Chapter 4 Qualitative Coding Results', content: 'This chapter presents open coding, axial categories, themes and evidence excerpts.' },
      { id: 's5', title: 'Chapter 5 Discussion and Design Implications', content: 'This chapter discusses findings, limitations and optimization suggestions.' },
    ]
    const writePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: 'Qualitative coding result',
      assetSummary: 'Interview coding tables, theme frequency figure and paper-ready interpretation.',
      sections,
      components,
    })
    const placements = writePlan.plan?.placements ?? []
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), 'method components were not routed to chapter 3')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), 'result components were not routed to chapter 4')
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), 'discussion components were not routed to chapter 5')

    const idsBySection = idsByResolvedSection(sections, placements)
    const docSections = sections.map((section, index) => ({
      id: section.id,
      projectId: 'qual-smoke',
      title: section.title,
      content: '',
      editorDoc: {
        type: 'doc',
        content: researchPackageToPaperNodes({
          id: `qual-smoke-${section.id}`,
          projectId: 'qual-smoke',
          title: 'Qualitative research package',
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
    assert(docx.tableCount >= 4, `DOCX table count is too low: ${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX tables are missing fixed grids')
    assert(docx.cellWidthCount > 0, 'DOCX tables are missing cell widths')
    assert(docx.imageCount >= 1, `DOCX image count is too low: ${docx.imageCount}`)
    assert(docx.imageExtentCount >= 1, `DOCX images are missing display extents: ${docx.imageExtentCount}`)
    assert(docx.hasQualText, 'DOCX does not contain qualitative result text')
    assert(docx.internalLeakCount === 0, `DOCX leaked internal research ids: ${docx.internalLeakCount}`)

    console.log(JSON.stringify({
      ok: true,
      outputPath,
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
    server.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
