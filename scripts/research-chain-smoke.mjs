import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import JSZip from 'jszip'
import researchRouter from '../server/routes/research.ts'
import { buildSectionsDocxBlob } from '../src/lib/docxExport.ts'
import { researchPackageToPaperNodes, splitResearchAssetIntoComponents } from '../src/lib/researchPackages.ts'
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

function assertResearchOutputQuality(analysis, components) {
  const tables = analysis.tables ?? []
  const figures = analysis.figures ?? []
  const priorityTable = tables.find(table => table.id === 'table_priority_ranking')
  const entropyTable = tables.find(table => table.id === 'table_entropy_weights')
  assert(priorityTable, 'priority ranking table is missing')
  assert(entropyTable, 'entropy weight table is missing')
  assert(
    JSON.stringify(priorityTable.columns) === JSON.stringify(['排名', '维度', 'KANO', 'Better', 'Worse', '熵权', '综合分']),
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
  assert(
    JSON.stringify(entropyTable.columns) === JSON.stringify(['指标', '熵值', '差异', '权重(%)']),
    `entropy weight table columns are not paper-ready: ${JSON.stringify(entropyTable.columns)}`
  )
  for (const table of tables) {
    assert((table.columns ?? []).length <= 7, `${table.title} has too many displayed columns`)
    assert(!(table.columns ?? []).includes('维度全称'), `${table.title} still exposes the long dimension column`)
  }
  for (const figure of figures) {
    const dimensions = imageDimensionsFromDataUrl(figure.dataUrl)
    assert(dimensions.width >= 1000, `${figure.title} width is too low: ${dimensions.width}`)
    assert(dimensions.height >= 360, `${figure.title} height is too low: ${dimensions.height}`)
    if (figure.id === 'figure_entropy_weights') {
      assert(dimensions.height >= 520, `${figure.title} is too short for a paper-ready Word figure: ${dimensions.height}`)
    }
  }
  const narrativeComponents = components.filter(component => component.type === 'analysis')
  const beforeCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': before')).length
  const afterCount = narrativeComponents.filter(component => String(component.title ?? '').endsWith(': after')).length
  assert(beforeCount >= tables.length + figures.length, `not every table/figure has a before paragraph: ${beforeCount}`)
  assert(afterCount >= tables.length + figures.length, `not every table/figure has an after paragraph: ${afterCount}`)
  const narrativeText = narrativeComponents.map(component => component.content ?? '').join('\n')
  assert(!narrativeText.includes('用于辅助说明数据中的主要分布特征'), 'figure narrative still uses generic fallback wording')
  assert(narrativeText.includes('回应了研究中关于') || narrativeText.includes('转化为具体的设计优化方向'), 'figure narrative is not research-question oriented enough')
}

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  assert(documentXml, 'DOCX 缺少 word/document.xml')
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
    badTerms,
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
    assert(placements.some(item => item.role === 'discussion' && item.targetSectionId === 's5'), '讨论建议组件未写入优化策略/研究讨论章节')

    const semanticSections = [
      { id: 'design', title: '研究设计、样本与测量', content: '说明问卷来源、样本处理、KANO模型和熵权法计算口径。' },
      { id: 'findings', title: '实证结果分析', content: '呈现KANO分类、Better-Worse系数、熵权结果和综合排序。' },
      { id: 'strategy', title: '设计优化路径与讨论', content: '将实证发现转化为视觉元素优化策略和研究讨论。' },
    ]
    const semanticWritePlan = await post(base, '/api/research/write-plan', {
      paperTitle: common.projectTitle,
      assetTitle: 'KANO-熵权法分析',
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
      title: 'KANO-熵权法分析结果',
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
      {
        id: 's5',
        projectId: 'smoke',
        title: '五、优化策略与研究讨论',
        content: '',
        editorDoc: { type: 'doc', content: researchPackageToPaperNodes(discussionPkg) },
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
    assert(docx.tableCount >= 3, `DOCX 表格数量不足：${docx.tableCount}`)
    assert(docx.tableGridCount >= docx.tableCount, 'DOCX 表格缺少固定列宽网格，可能在 Word 中挤压变形')
    assert(docx.cellWidthCount > 0, 'DOCX 表格缺少单元格宽度，可能在 Word 中自动撑爆')
    assert(docx.imageCount >= 4, `DOCX 图片数量不足：${docx.imageCount}`)
    assert(docx.imageExtentCount >= 4, `DOCX 图片缺少 Word 显示尺寸：${docx.imageExtentCount}`)
    assert(docx.minImageExtent.cx >= 3000000 && docx.minImageExtent.cy >= 2400000, `DOCX 图片显示尺寸过小：${JSON.stringify(docx.minImageExtent)}`)
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
