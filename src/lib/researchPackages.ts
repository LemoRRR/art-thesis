import {
  researchPackageStore,
  type ResearchAsset,
  type ResearchAnalysisRun,
  type ResearchCapabilityTier,
  type ResearchContentPackage,
  type ResearchPackageComponent,
} from './storage'
import type { PaperEditorDoc, PaperEditorNode } from './editorDocument'

type StructuredResearchResult = {
  figures?: Array<{ id?: string; title?: string; dataUrl?: string; caption?: string }>
  tables?: Array<{ id?: string; title?: string; rows?: unknown[]; columns?: string[] }>
  componentNarratives?: Array<{ componentId?: string; title?: string; beforeText?: string; afterText?: string }>
  methodText?: string
  analysisText?: string
  cautions?: string[]
}

function uid(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function component(idPrefix: string, item: Omit<ResearchPackageComponent, 'id'>): ResearchPackageComponent {
  return { ...item, id: uid(idPrefix) }
}

function narrativeFor(result: StructuredResearchResult, id?: string, title?: string) {
  const key = String(id ?? '').trim()
  const normalizedTitle = String(title ?? '').replace(/\s+/g, '')
  return (result.componentNarratives ?? []).find(item => {
    const itemId = String(item.componentId ?? '').trim()
    const itemTitle = String(item.title ?? '').replace(/\s+/g, '')
    return (key && itemId === key) || (normalizedTitle && itemTitle === normalizedTitle)
  }) ?? null
}

function cleanResearchTitle(value?: string) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function fallbackFigureNarrative(figure: { caption?: string; title?: string }, title: string) {
  const caption = cleanResearchTitle(figure.caption) || cleanResearchTitle(title)
  return {
    beforeText: `为更直观地呈现${caption.replace(/[。.]$/, '')}，本文将相关统计结果整理为${title}。`,
    afterText: `${title}用于辅助说明数据中的主要分布特征和比较关系，后续分析可结合表格中的具体数值进一步解释其对研究问题的回应。`,
  }
}

function fallbackTableNarrative(table: { rows?: unknown[]; columns?: string[] }, title: string) {
  const rows = Array.isArray(table.rows) ? table.rows.filter(row => row && typeof row === 'object') as Record<string, unknown>[] : []
  const columns = Array.isArray(table.columns) ? table.columns : []
  const rank = '\u6700\u7ec8\u8026\u5408\u4f18\u5148\u7ea7\u6392\u540d'
  const dimension = '\u8bbe\u8ba1\u7ef4\u5ea6'
  const score = '\u8026\u5408\u4f18\u5148\u7ea7\u603b\u5f97\u5206'
  const first = rows[0]
  const topDimension = first && (first[dimension] != null || first['维度'] != null)
    ? String(first[dimension] ?? first['维度'])
    : ''
  const topScore = first && (first[score] != null || first['综合分'] != null)
    ? String(first[score] ?? first['综合分'])
    : ''
  const hasRank = (columns.includes(rank) || columns.includes('排名')) && Boolean(topDimension)
  return {
    beforeText: `为保证研究结果具有可核验性，本文将核心计算结果汇总为${title}，用于呈现样本、指标或模型输出的关键数值。`,
    afterText: hasRank
      ? `由${title}可见，排序靠前的维度为“${topDimension}”${topScore ? `，其综合得分为 ${topScore}` : ''}。该结果说明该维度在后续讨论和优化建议中应被优先关注。`
      : `${title}展示了本次分析的主要统计结果，可为后续结果解释、研究讨论和策略建议提供数据依据。`,
  }
}

export function splitResearchAssetIntoComponents(asset: ResearchAsset): ResearchPackageComponent[] {
  const structured = asset.structuredData as { run?: ResearchAnalysisRun & StructuredResearchResult; result?: StructuredResearchResult } | null
  const result: StructuredResearchResult | undefined = structured?.result ?? structured?.run
  if (result && (Array.isArray(result.figures) || Array.isArray(result.tables) || result.methodText || result.analysisText)) {
    const components: ResearchPackageComponent[] = []
    if ('methodText' in result && result.methodText) {
      components.push(component('research_component', {
        type: 'method',
        title: '研究方法说明',
        content: String(result.methodText),
      }))
    }
    ;(result.figures ?? []).forEach((figure, index) => {
      if (!figure?.dataUrl) return
      const title = figure.title ?? `Figure ${index + 1}`
      const narrative = narrativeFor(result, figure.id, title) ?? fallbackFigureNarrative(figure, title)
      if (narrative?.beforeText) {
        components.push(component('research_component', {
          type: 'analysis',
          title: `${title}: before`,
          content: String(narrative.beforeText),
        }))
      }
      components.push(component('research_component', {
        type: 'figure',
        title,
        content: figure.caption ?? title,
        data: figure,
      }))
      if (narrative?.afterText) {
        components.push(component('research_component', {
          type: 'analysis',
          title: `${title}: after`,
          content: String(narrative.afterText),
        }))
      }
    })
    ;(result.tables ?? []).forEach((table, index) => {
      const rows = Array.isArray(table.rows) ? table.rows : []
      const columns = table.columns?.length
        ? table.columns
        : rows[0] && typeof rows[0] === 'object'
          ? Object.keys(rows[0] as Record<string, unknown>)
          : []
      const content = rows.length && columns.length
        ? [
            columns.join('\t'),
            ...rows.map(row => columns.map(column => {
              const value = (row as Record<string, unknown>)[column]
              return value == null ? '' : String(value)
            }).join('\t')),
          ].join('\n')
        : 'No available statistical table.'
      const title = table.title ?? `Table ${index + 1}`
      const narrative = narrativeFor(result, table.id, title) ?? fallbackTableNarrative(table, title)
      if (narrative?.beforeText) {
        components.push(component('research_component', {
          type: 'analysis',
          title: `${title}: before`,
          content: String(narrative.beforeText),
        }))
      }
      const displayColumns = selectResearchTableColumns(columns, title)
      const displayRows = rows.slice(0, 24).map(row => Object.fromEntries(displayColumns.map(column => {
        const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : ''
        return [column, formatResearchTableValue(column, value)]
      })))
      components.push(component('research_component', {
        type: 'statistics',
        title,
        content,
        data: {
          ...table,
          title,
          columns: displayColumns,
          columnLabels: displayColumns.map(researchTableColumnLabel),
          rows: displayRows,
          note: researchTableNote({ type: 'statistics', title, content, data: table } as ResearchPackageComponent),
          truncated: rows.length > displayRows.length,
          totalRows: rows.length,
        },
      }))
      if (narrative?.afterText) {
        components.push(component('research_component', {
          type: 'analysis',
          title: `${title}: after`,
          content: String(narrative.afterText),
        }))
      }
    })
    if ('analysisText' in result && result.analysisText) {
      components.push(component('research_component', {
        type: 'analysis',
        title: '分析文字',
        content: String(result.analysisText),
      }))
    }
    if (components.length > 0) return components
  }

  const text = asset.plainText.trim()
  const components: ResearchPackageComponent[] = []
  const methodMatch = text.match(/【(?:研究方法|问卷说明|方法说明|研究设计)】([\s\S]*?)(?=\n?【|$)/)
  const statsMatch = text.match(/【(?:描述性统计|数据分析结果|统计数据|信度分析|相关分析|方差分析|中介效应|因子分析)】([\s\S]*?)(?=\n?【|$)/)
  const analysisMatch = text.match(/【(?:论文写作提示|分析文字|结果解释|总体判断|结论)】([\s\S]*?)(?=\n?【|$)/)

  if (methodMatch?.[1]?.trim()) {
    components.push(component('research_component', {
      type: 'method',
      title: '研究方法描述',
      content: methodMatch[1].trim(),
    }))
  }

  if (statsMatch?.[1]?.trim()) {
    components.push(component('research_component', {
      type: 'statistics',
      title: '统计数据',
      label: '表X',
      content: statsMatch[1].trim(),
    }))
  }

  if (analysisMatch?.[1]?.trim()) {
    components.push(component('research_component', {
      type: 'analysis',
      title: '分析文字',
      content: analysisMatch[1].trim(),
    }))
  }

  if (components.length === 0) {
    components.push(component('research_component', {
      type: asset.type === 'quant_analysis_result' ? 'analysis' : 'method',
      title: asset.type === 'quant_analysis_result' ? '分析结果' : '研究支撑',
      content: text,
    }))
  }

  return components
}

export function createPackageFromAsset(input: {
  projectId: string
  chapterId?: string
  asset: ResearchAsset
  intentSummary?: string
  capabilityTier?: ResearchCapabilityTier
}): ResearchContentPackage {
  return researchPackageStore.add({
    projectId: input.projectId,
    chapterId: input.chapterId,
    sourceAssetIds: [input.asset.id],
    title: input.asset.title,
    method: input.asset.type,
    methodLabel: input.asset.summary,
    capabilityTier: input.capabilityTier ?? (input.asset.type === 'quant_analysis_result' ? 'partial_loop' : 'closed_loop'),
    intentSummary: input.intentSummary,
    components: splitResearchAssetIntoComponents(input.asset),
    insertedComponentIds: [],
  })
}

export function researchPackagePlainText(pkg: ResearchContentPackage, componentIds?: string[]): string {
  const allowed = componentIds?.length ? new Set(componentIds) : null
  return pkg.components
    .filter(item => !allowed || allowed.has(item.id))
    .map(item => {
      const title = item.label ? `${item.label} ${item.title ?? ''}`.trim() : item.title
      const prefix = item.type === 'figure' ? '[图表]' : ''
      return [title ? `【${title}】` : '', prefix, item.content.trim()].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

export function researchBlockNode(pkg: ResearchContentPackage, componentIds?: string[]): PaperEditorNode {
  const ids = componentIds?.length ? componentIds : pkg.components.map(item => item.id)
  return {
    type: 'researchBlock',
    attrs: {
      researchPackageId: pkg.id,
      researchComponentIds: ids,
      title: pkg.title,
      previewText: researchPackagePlainText(pkg, ids).slice(0, 800),
    },
  }
}

function textNode(text: string): PaperEditorNode {
  return { type: 'text', text }
}

function paragraphNode(text: string, attrs?: Record<string, unknown>): PaperEditorNode {
  return {
    type: 'paragraph',
    attrs,
    content: text ? [textNode(text)] : undefined,
  }
}

const RESEARCH_TABLE_COLUMN_LABELS: Record<string, string> = {
  ['\u6700\u7ec8\u8026\u5408\u4f18\u5148\u7ea7\u6392\u540d']: '\u6392\u540d',
  ['\u8bbe\u8ba1\u7ef4\u5ea6']: '\u7ef4\u5ea6',
  ['\u7ef4\u5ea6\u5168\u79f0']: '\u7ef4\u5ea6\u8bf4\u660e',
  ['\u6837\u672c\u603b\u91cf']: 'N',
  ['\u4e3b\u5bfcKANO\u7c7b\u578b']: 'KANO',
  ['Better\u7cfb\u6570(\u6ee1\u610f\u5ea6\u63d0\u5347)']: 'Better',
  ['Worse\u7cfb\u6570\u7edd\u5bf9\u503c(\u4e0d\u6ee1\u964d\u4f4e)']: 'Worse',
  ['\u71b5\u6743\u7efc\u5408\u5f97\u5206']: '\u71b5\u6743',
  ['\u8026\u5408\u4f18\u5148\u7ea7\u603b\u5f97\u5206']: '\u7efc\u5408\u5206',
  ['\u8bc4\u4ef7\u6307\u6807']: '\u6307\u6807',
  ['\u71b5\u503c']: '\u71b5\u503c',
  ['\u5dee\u5f02\u7cfb\u6570']: '\u5dee\u5f02',
  ['\u6743\u91cd\u5360\u6bd4(%)']: '\u6743\u91cd(%)',
  variable: '变量',
  n: '样本量',
  mean: '均值',
  sd: '标准差',
  min: '最小值',
  max: '最大值',
  alpha: 'Cronbach α',
  items: '题项数',
  itemColumns: '题项',
  x: '变量X',
  y: '变量Y',
  r: '相关系数',
  p: '显著性',
  group: '分组变量',
  f: 'F值',
  sampleSize: '样本量',
  missingRate: '缺失率',
  duplicateRows: '重复样本',
  invalidSampleCandidates: '疑似无效样本',
  reliabilitySuitable: '信度分析',
  efaSuitable: '因子分析',
  correlationSuitable: '相关分析',
  anovaSuitable: '方差分析',
  openCode: '开放编码',
  axialCategory: '主轴范畴',
  evidenceExcerpt: '典型证据',
  memo: '备忘',
  theme: '主题',
  count: '频次',
  evidence: '证据摘要',
  conceptualMeaning: '概念含义',
  includedOpenCodes: '包含开放编码',
  evidenceCount: '证据数',
  writingUse: '写作用途',
}

function researchTableColumnLabel(column: string) {
  if (RESEARCH_TABLE_COLUMN_LABELS[column]) return RESEARCH_TABLE_COLUMN_LABELS[column]
  return column
    .replace(/^factor_(\d+)$/i, '因子$1')
    .replace(/_/g, ' ')
}

function selectResearchTableColumns(columns: string[], title = '') {
  const rank = '\u6700\u7ec8\u8026\u5408\u4f18\u5148\u7ea7\u6392\u540d'
  const dimension = '\u8bbe\u8ba1\u7ef4\u5ea6'
  const sampleSize = '\u6837\u672c\u603b\u91cf'
  const kanoType = '\u4e3b\u5bfcKANO\u7c7b\u578b'
  const better = 'Better\u7cfb\u6570(\u6ee1\u610f\u5ea6\u63d0\u5347)'
  const worse = 'Worse\u7cfb\u6570\u7edd\u5bf9\u503c(\u4e0d\u6ee1\u964d\u4f4e)'
  const entropyScore = '\u71b5\u6743\u7efc\u5408\u5f97\u5206'
  const priorityScore = '\u8026\u5408\u4f18\u5148\u7ea7\u603b\u5f97\u5206'
  const indicator = '\u8bc4\u4ef7\u6307\u6807'
  const entropy = '\u71b5\u503c'
  const diff = '\u5dee\u5f02\u7cfb\u6570'
  const weight = '\u6743\u91cd\u5360\u6bd4(%)'
  const columnSet = new Set(columns)
  const preferred = title.includes('KANO') && (title.includes('\u8026\u5408') || title.includes('\u4f18\u5148\u7ea7'))
    ? [rank, dimension, kanoType, better, worse, entropyScore, priorityScore]
    : title.includes('KANO')
      ? [dimension, sampleSize, kanoType, better, worse, rank]
      : title.includes('\u71b5\u6743')
        ? [indicator, entropy, diff, weight]
        : []
  const selected = preferred.filter(column => columnSet.has(column))
  return (selected.length ? selected : columns).slice(0, 7)
}

function formatResearchTableValue(column: string, value: unknown) {
  if (value == null) return ''
  if (typeof value === 'number') {
    if (column === 'p') return value < 0.001 ? '<0.001' : value.toFixed(3)
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(Math.abs(value) < 1 ? 3 : 2)
  }
  const text = String(value).trim()
  const maxLength = column === '\u7ef4\u5ea6\u5168\u79f0' ? 18 : column === '\u8bbe\u8ba1\u7ef4\u5ea6' ? 8 : 28
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function researchTableNote(component: ResearchPackageComponent) {
  const data = component.data && typeof component.data === 'object' ? component.data as { id?: unknown } : null
  const id = String(data?.id ?? '').toLowerCase()
  const title = `${component.title ?? ''}`.toLowerCase()
  if (id.includes('descriptive') || title.includes('描述')) {
    return '注：N表示有效样本量，M表示均值，SD表示标准差。'
  }
  if (id.includes('reliability') || title.includes('信度')) {
    return '注：Cronbach α用于衡量量表题项内部一致性，通常以0.70作为可接受参考值。'
  }
  if (id.includes('correlation') || title.includes('相关')) {
    return '注：r表示相关系数，p表示显著性水平。'
  }
  if (id.includes('anova') || title.includes('方差')) {
    return '注：F值用于判断不同组别在变量均值上的差异程度，p值用于辅助判断显著性。'
  }
  if (id.includes('efa') || title.includes('因子')) {
    return '注：表中数值为探索性因子载荷，载荷越高表示题项与对应因子的关联越强。'
  }
  if (id.includes('quality') || title.includes('质量')) {
    return '注：数据质量判断用于提示后续统计分析的适用性，正式论文中可结合无效样本剔除规则进一步说明。'
  }
  if (id.includes('priority') || title.includes('优先级') || title.includes('耦合')) {
    return '注：综合分由KANO属性、Better/Worse系数与熵权结果耦合得到，排名越靠前表示越应优先纳入设计优化与策略建议。'
  }
  if (id.includes('kano') || title.includes('kano')) {
    return '注：M表示必备型，O表示期望型，A表示魅力型，I表示无差异型；Better系数表示满意度提升作用，Worse系数绝对值表示缺失时导致不满意的程度。'
  }
  if (id.includes('entropy') || title.includes('熵权')) {
    return '注：熵值越低、差异系数越高，表示该指标对综合评价的区分作用越强；权重用于后续耦合优先级计算。'
  }
  return ''
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}|\r?\n/)
    .map(part => part.trim())
    .filter(Boolean)
}

function componentFigureData(component: ResearchPackageComponent) {
  if (component.type !== 'figure' || !component.data || typeof component.data !== 'object') return null
  const data = component.data as { dataUrl?: unknown; caption?: unknown; title?: unknown }
  if (typeof data.dataUrl !== 'string' || !data.dataUrl.startsWith('data:image/')) return null
  return {
    dataUrl: data.dataUrl,
    caption: typeof data.caption === 'string' ? data.caption : component.content,
    title: typeof data.title === 'string' ? data.title : component.title,
  }
}

function componentTableRows(component: ResearchPackageComponent): PaperEditorNode[] {
  if (component.type !== 'statistics' && component.type !== 'table') return []
  const table = component.data && typeof component.data === 'object'
    ? component.data as { rows?: unknown[]; columns?: string[] }
    : null
  const rows = Array.isArray(table?.rows) ? table.rows : []
  const columns = Array.isArray(table?.columns) ? table.columns : []
  const title = component.label ? `${component.label} ${component.title ?? ''}`.trim() : component.title
  if (!rows.length || !columns.length) {
    return title ? [paragraphNode(title, { textAlign: 'center', researchTableCaption: true })] : []
  }

  const previewRows = rows.slice(0, 24)
  const visibleColumns = selectResearchTableColumns(columns, title ?? '')
  const normalizedRows = previewRows.map(row => Object.fromEntries(visibleColumns.map(column => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : ''
    return [column, formatResearchTableValue(column, value)]
  })))

  return [
    {
      type: 'researchTable',
      attrs: {
        title,
        columns: visibleColumns,
        columnLabels: visibleColumns.map(researchTableColumnLabel),
        rows: normalizedRows,
        note: researchTableNote(component),
        truncated: rows.length > previewRows.length,
        totalRows: rows.length,
      },
    },
  ]
}

function componentToPaperNodes(component: ResearchPackageComponent): PaperEditorNode[] {
  if (component.type === 'method' || component.type === 'analysis' || component.type === 'raw_text') {
    return splitParagraphs(component.content).map(text => paragraphNode(text))
  }

  const figure = componentFigureData(component)
  if (figure) {
    const title = component.label ? `${component.label} ${component.title ?? ''}`.trim() : component.title
    const figureTitle = title ?? figure.title ?? '分析结果图'
    return [
      {
        type: 'researchImage',
        attrs: {
          src: figure.dataUrl,
          alt: figureTitle,
          title: figureTitle,
          caption: figureTitle,
          description: figure.caption,
        },
      },
      paragraphNode(figureTitle, { textAlign: 'center', researchFigureCaption: true }),
    ]
  }

  const tableNodes = componentTableRows(component)
  if (tableNodes.length) return tableNodes

  return splitParagraphs(component.content).map(text => paragraphNode(text))
}

export function researchPackageToPaperNodes(pkg: ResearchContentPackage, componentIds?: string[]): PaperEditorNode[] {
  const allowed = componentIds?.length ? new Set(componentIds) : null
  return pkg.components
    .filter(item => !allowed || allowed.has(item.id))
    .flatMap(componentToPaperNodes)
}

function paperNodeText(node: PaperEditorNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(paperNodeText).join('')
}

function normalizedTableTitle(value: unknown) {
  return String(value ?? '').replace(/\s+/g, '').trim()
}

function isResearchTableCaptionNode(node: PaperEditorNode, title: string) {
  if (node.type !== 'paragraph') return false
  const text = normalizedTableTitle(paperNodeText(node))
  if (!text) return false
  const target = normalizedTableTitle(title)
  if (text === target) return true
  return Boolean(node.attrs?.researchTableCaption) && text.includes(target)
}

export function researchTableNodesFromPackage(pkg: ResearchContentPackage, componentIds?: string[]): PaperEditorNode[] {
  return researchPackageToPaperNodes(pkg, componentIds).filter(node => node.type === 'researchTable')
}

export function repairResearchTablesInDoc(
  doc: PaperEditorDoc,
  packages: Array<Pick<ResearchContentPackage, 'components'> & Partial<ResearchContentPackage>>
): { doc: PaperEditorDoc; changed: boolean } {
  const tableNodes = packages.flatMap(pkg =>
    researchTableNodesFromPackage({
      id: pkg.id ?? 'research-package-repair',
      projectId: pkg.projectId ?? 'research-package-repair',
      title: pkg.title ?? 'research package',
      method: pkg.method ?? 'research',
      methodLabel: pkg.methodLabel,
      capabilityTier: pkg.capabilityTier ?? 'partial_loop',
      intentSummary: pkg.intentSummary,
      components: pkg.components,
      insertedComponentIds: pkg.insertedComponentIds ?? [],
      versions: pkg.versions ?? [],
      createdAt: pkg.createdAt ?? Date.now(),
      updatedAt: pkg.updatedAt ?? Date.now(),
    })
  )
  if (!tableNodes.length) return { doc, changed: false }

  const existingTitles = new Set(
    (doc.content ?? [])
      .filter(node => node.type === 'researchTable')
      .map(node => normalizedTableTitle(node.attrs?.title))
      .filter(Boolean)
  )

  let changed = false
  const nextContent = (doc.content ?? []).flatMap(node => {
    const match = tableNodes.find(tableNode => {
      const title = normalizedTableTitle(tableNode.attrs?.title)
      return title && !existingTitles.has(title) && isResearchTableCaptionNode(node, title)
    })
    if (!match) return [node]
    existingTitles.add(normalizedTableTitle(match.attrs?.title))
    changed = true
    return [match]
  })

  return changed ? { doc: { ...doc, content: nextContent }, changed: true } : { doc, changed: false }
}

export function appendResearchBlockToDoc(doc: PaperEditorDoc, pkg: ResearchContentPackage, componentIds?: string[]): PaperEditorDoc {
  return {
    ...doc,
    content: [
      ...(doc.content ?? []),
      researchBlockNode(pkg, componentIds),
    ],
  }
}
