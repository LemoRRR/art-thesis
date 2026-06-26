import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'

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

function assertResearchOutputQuality(analysis, components) {
  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const priorityTable = tables.find(table => table.id === 'table_priority_ranking')
  assert(priorityTable, 'priority ranking table is missing')
  assert(
    JSON.stringify(priorityTable.columns) === JSON.stringify(['排名', '维度', 'KANO', 'Better', 'Worse', '熵权', '综合分']),
    `priority ranking table columns are not paper-ready: ${JSON.stringify(priorityTable.columns)}`
  )
  for (const table of tables) {
    assert((table.columns ?? []).length <= 7, `${table.title} has too many displayed columns`)
    assert(!(table.columns ?? []).includes('维度全称'), `${table.title} still exposes the long dimension column`)
  }
  for (const figure of figures) {
    const dimensions = pngDimensionsFromDataUrl(figure.dataUrl)
    assert(dimensions.width >= 1600, `${figure.title} width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 800, `${figure.title} height is too low: ${dimensions.height}`)
  }
  const narrativeComponents = components.filter(component => component.type === 'analysis')
  const beforeCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': before')).length
  const afterCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': after')).length
  assert(beforeCount >= tables.length + figures.length, `not every table/figure has a before paragraph: ${beforeCount}`)
  assert(afterCount >= tables.length + figures.length, `not every table/figure has an after paragraph: ${afterCount}`)
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX 缺少 word/document.xml')
  const text = Array.from(documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g))
    .map(match => match[1])
    .join('')
  const media = Object.keys(zip.files).filter(name => name.startsWith('word/media/') && !name.endsWith('/'))
  const badTerms = ['系统识别到', '研究支撑', '上传工作簿', '当前工作簿', '该方案直接采用', '寤鸿', '鐔', '璁', '銆']
    .filter(term => text.includes(term))
  return {
    tableCount: (documentXml.match(/<w:tbl>/g) ?? []).length,
    imageCount: media.length,
    tableCaptionCount: (text.match(/表4-/g) ?? []).length,
    figureCaptionCount: (text.match(/图4-/g) ?? []).length,
    badTerms,
  }
}

async function main() {
  assert(fs.existsSync(workbookPath), `找不到烟测 Excel：${workbookPath}`)

  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.use('/api/research', researchRouter)
  const server = app.listen(0)
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  try {
    const fileData = fs.readFileSync(workbookPath).toString('base64')
    const common = {
      projectTitle: '面向青年群体的非遗文创视觉元素魅力识别——基于KANO-熵权法的分析',
      fileName: path.basename(workbookPath),
      base64: fileData,
      userRequest: '请根据上传的问卷数据生成论文第四章可用的KANO-熵权法分析结果、表格、图片和论文式解释。',
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
      assetTitle: 'KANO-熵权法分析',
      assetSummary: '问卷数据分析结果',
      sections,
      components,
    })

    const placements = writePlan.plan?.placements ?? []
    const tableCount = analysis.tables?.length ?? 0
    const figureCount = analysis.figures?.length ?? 0
    assert(plan.plan?.method === 'kano_entropy', '未识别为 KANO-熵权法分析')
    assert(tableCount >= 3, `表格数量不足：${tableCount}`)
    assert(figureCount >= 4, `图片数量不足：${figureCount}`)
    assert(placements.some(item => item.role === 'method' && item.targetSectionId === 's3'), '方法组件未写入研究设计章节')
    assert(placements.some(item => item.role === 'result' && item.targetSectionId === 's4'), '结果组件未写入数据分析章节')

    const methodIds = new Set(placements.filter(item => item.targetSectionId === 's3').flatMap(item => item.componentIds ?? []))
    const resultIds = new Set(placements.filter(item => item.targetSectionId === 's4').flatMap(item => item.componentIds ?? []))
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
      title: 'KANO-熵权法分析结果',
      components: components.filter(component => resultIds.has(component.id)),
      insertedComponentIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const docSections = [
      {
        id: 's3',
        projectId: 'smoke',
        title: '三、研究设计与数据来源',
        content: '',
        editorDoc: { type: 'doc', content: researchPackageToPaperNodes(methodPkg) },
        status: 'done',
        order: 3,
      },
      {
        id: 's4',
        projectId: 'smoke',
        title: '四、数据分析与研究结果',
        content: '',
        editorDoc: { type: 'doc', content: researchPackageToPaperNodes(resultPkg) },
        status: 'done',
        order: 4,
      },
    ]
    const blob = await buildSectionsDocxBlob(common.projectTitle, docSections)
    const buffer = Buffer.from(await blob.arrayBuffer())
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, buffer)

    const docx = await inspectDocx(buffer)
    assert(docx.tableCount >= 3, `DOCX 表格数量不足：${docx.tableCount}`)
    assert(docx.imageCount >= 4, `DOCX 图片数量不足：${docx.imageCount}`)
    assert(docx.tableCaptionCount >= 3, `DOCX 表题数量不足：${docx.tableCaptionCount}`)
    assert(docx.figureCaptionCount >= 4, `DOCX 图题数量不足：${docx.figureCaptionCount}`)
    assert(docx.badTerms.length === 0, `DOCX 出现不应展示的内部/乱码词：${docx.badTerms.join('、')}`)

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
