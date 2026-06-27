import {
  researchPackageStore,
  type ResearchAsset,
  type ResearchAnalysisRun,
  type ResearchCapabilityTier,
  type ResearchContentPackage,
  type ResearchPackageComponent,
} from './storage'
import type { PaperEditorDoc, PaperEditorNode } from './editorDocument'

export type ResearchInsertionRole = 'method' | 'sample' | 'result' | 'discussion' | 'conclusion'

type StructuredResearchResult = {
  method?: string
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

function cleanResearchNarrativeText(value: unknown) {
  return String(value ?? '')
    .replace(
      /Descriptive statistics for all variables;?\s*Correlation analysis among numeric variables;?\s*ANOVA for group comparisons\.?/gi,
      '本研究首先对主要变量进行描述性统计，再对数值变量之间的相关关系进行检验，并结合分组变量开展单因素方差分析。'
    )
    .replace(/Descriptive statistics for all variables\.?/gi, '对主要变量进行描述性统计。')
    .replace(/Correlation analysis among numeric variables\.?/gi, '检验数值变量之间的相关关系。')
    .replace(/Correlation matrix for numeric variables\.?/gi, '构建数值变量相关系数矩阵。')
    .replace(/ANOVA for group comparisons\.?/gi, '对不同分组样本进行单因素方差分析。')
    .replace(/Cronbach[’']?s alpha for reliability\.?/gi, '使用 Cronbach α 系数检验量表信度。')
    .replace(/Exploratory factor analysis\.?/gi, '开展探索性因子分析。')
    .replace(/Reliability analysis\.?/gi, '开展量表信度分析。')
    .trim()
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

function normalizedResearchId(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function tableById(result: StructuredResearchResult, id: string) {
  return (result.tables ?? []).find(table => normalizedResearchId(table.id) === id)
}

function tableRows(table: { rows?: unknown[] } | undefined) {
  return Array.isArray(table?.rows)
    ? table.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
    : []
}

function rowText(row: Record<string, unknown> | undefined, keys: string[]) {
  if (!row) return ''
  for (const key of keys) {
    const value = row[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function kanoTypeLabel(type: string) {
  const labels: Record<string, string> = {
    M: '必备型',
    O: '期望型',
    A: '魅力型',
    I: '无差异型',
    Q: '可疑结果',
    R: '反向型',
  }
  return labels[type] ?? type
}

function discussionTextForStructuredResult(result: StructuredResearchResult) {
  const method = normalizedResearchId(result.method)
  const priorityRows = tableRows(tableById(result, 'table_priority_ranking'))
  const ahpRows = tableRows(tableById(result, 'table_ahp_weights'))
  const qualitativeRows = tableRows(tableById(result, 'table_theme_summary'))

  if (method === 'kano_entropy' || priorityRows.length > 0) {
    const top = priorityRows.slice(0, 3)
    const topNames = top
      .map(row => rowText(row, ['维度', '设计维度', 'criterion', '指标']))
      .filter(Boolean)
    const first = top[0]
    const firstName = rowText(first, ['维度', '设计维度', 'criterion', '指标']) || '排名靠前的维度'
    const firstType = kanoTypeLabel(rowText(first, ['KANO', '主导KANO类型']))
    const firstScore = rowText(first, ['综合分', '耦合优先级总得分'])
    return [
      `基于KANO属性与熵权耦合结果，后续讨论不宜只停留在数值排序，而应将排名靠前的维度转化为具体优化策略。${firstName}${firstType ? `属于${firstType}` : ''}${firstScore ? `，综合分为${firstScore}` : ''}，说明其既具有较强的需求识别意义，也适合作为论文策略建议部分的优先切入点。`,
      topNames.length
        ? `在策略展开时，可优先围绕${topNames.map(name => `“${name}”`).join('、')}提出分层优化建议：对必备型要素强调基础体验保障，对期望型要素强调持续改进，对魅力型要素强调差异化表达与传播亮点。`
        : '在策略展开时，应根据KANO类型区分基础保障、持续改进和差异化塑造，避免把所有维度写成同一种笼统建议。',
    ].join('\n')
  }

  if (method === 'ahp' || ahpRows.length > 0) {
    const top = ahpRows.slice(0, 3)
    const topNames = top
      .map(row => rowText(row, ['criterion', '指标', 'matrix']))
      .filter(Boolean)
    return [
      '基于AHP权重排序，讨论部分应从高权重指标解释其对研究目标的影响机制，并进一步转化为设计、传播或管理策略。',
      topNames.length
        ? `具体而言，${topNames.map(name => `“${name}”`).join('、')}应作为后续策略建议的重点对象，论文写作中需要结合研究对象解释其优先性来源。`
        : '具体而言，应结合权重排序识别关键指标，并说明这些指标为何应优先进入后续优化路径。',
    ].join('\n')
  }

  if (method === 'qualitative_coding' || qualitativeRows.length > 0) {
    const top = qualitativeRows.slice(0, 3)
    const topNames = top
      .map(row => rowText(row, ['theme', 'openCode', 'axialCategory']))
      .filter(Boolean)
    return [
      '基于定性编码结果，讨论部分不宜只复述开放编码表，而应围绕高频主题解释受访者态度、体验矛盾和设计优化方向。',
      topNames.length
        ? `具体而言，可优先围绕${topNames.map(name => `“${name}”`).join('、')}展开讨论：说明这些主题为何在材料中反复出现，它们回应了论文的哪个研究问题，并进一步转化为设计、传播或产品优化建议。`
        : '具体而言，应结合主题归纳表与典型证据摘录，说明受访者关注点如何形成，并把编码结果转化为后续策略建议。',
      '正式论文写作中还需要说明定性编码的研究者复核过程、同义编码合并规则和典型证据选取标准，避免把 AI 初编结果直接等同于最终研究结论。',
    ].join('\n')
  }

  const descriptiveRows = tableRows(tableById(result, 'table_descriptive'))
  const reliabilityRows = tableRows(tableById(result, 'table_reliability'))
  const correlationRows = tableRows(tableById(result, 'table_correlation'))
  const anovaRows = tableRows(tableById(result, 'table_anova'))
  const quantSignals = [
    descriptiveRows.length ? '变量总体水平' : '',
    reliabilityRows.length ? '量表内部一致性' : '',
    correlationRows.length ? '变量关联结构' : '',
    anovaRows.length ? '群体差异' : '',
  ].filter(Boolean)
  if (quantSignals.length > 0) {
    const sampleHint = result.method ? `本次${result.method === 'descriptive' ? '描述统计' : '定量'}分析` : '本次定量分析'
    return [
      `${sampleHint}的讨论部分应从“统计结果如何回应研究问题”展开，而不是单纯重复均值、相关系数或显著性数值。结合现有结果，论文可围绕${quantSignals.join('、')}说明研究对象在评价差异、影响关系或测量可靠性上的主要特征。`,
      '在策略建议上，应优先把均值较高或差异较明显的变量转化为设计、传播或服务优化方向；对于相关关系较强的变量，需要结合理论框架说明其可能的解释路径，但不宜直接写成因果结论。',
      (result.cautions ?? []).filter(Boolean).length > 0
        ? `同时，讨论部分还应交代数据质量和样本边界：${(result.cautions ?? []).filter(Boolean).slice(0, 2).join('；')}`
        : '同时，讨论部分应说明样本来源、量表设计和变量识别边界，以避免对统计结果作过度外推。',
    ].join('\n')
  }

  const cautions = (result.cautions ?? []).filter(Boolean)
  if (cautions.length > 0) {
    return `结合本次分析限制，论文讨论部分需要说明数据质量、样本规模或变量识别边界，并据此提出后续复核与优化建议。${cautions.slice(0, 2).join('；')}`
  }

  return ''
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
        content: cleanResearchNarrativeText(result.methodText),
      }))
    }

    const appendFigure = (figure: NonNullable<StructuredResearchResult['figures']>[number], index: number) => {
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
    }

    const appendTable = (table: NonNullable<StructuredResearchResult['tables']>[number], index: number) => {
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
    }

    const figures = result.figures ?? []
    const tables = result.tables ?? []
    const figureById = new Map(figures.map((figure, index) => [normalizedResearchId(figure.id), { figure, index }]))
    const tableById = new Map(tables.map((table, index) => [normalizedResearchId(table.id), { table, index }]))
    const consumedFigures = new Set<string>()
    const consumedTables = new Set<string>()
    const orderedResearchItems = [
      { type: 'table', id: 'table_kano_summary' },
      { type: 'figure', id: 'figure_kano_distribution' },
      { type: 'figure', id: 'figure_better_worse_matrix' },
      { type: 'table', id: 'table_entropy_weights' },
      { type: 'figure', id: 'figure_entropy_weights' },
      { type: 'table', id: 'table_priority_ranking' },
      { type: 'figure', id: 'figure_kano_entropy_priority' },
      { type: 'table', id: 'table_ahp_consistency' },
      { type: 'table', id: 'table_ahp_weights' },
      { type: 'figure', id: 'figure_ahp_weights' },
      { type: 'figure', id: 'figure_ahp_consistency' },
      { type: 'table', id: 'table_data_quality' },
      { type: 'table', id: 'table_descriptive' },
      { type: 'figure', id: 'figure_descriptive_means' },
      { type: 'table', id: 'table_reliability' },
      { type: 'figure', id: 'figure_reliability_alpha' },
      { type: 'table', id: 'table_correlation' },
      { type: 'figure', id: 'figure_correlation_heatmap' },
      { type: 'table', id: 'table_anova' },
      { type: 'figure', id: 'figure_anova_f' },
      { type: 'table', id: 'table_efa' },
      { type: 'figure', id: 'figure_efa_loadings' },
      { type: 'table', id: 'table_open_coding' },
      { type: 'table', id: 'table_axial_coding' },
      { type: 'table', id: 'table_theme_summary' },
      { type: 'figure', id: 'figure_theme_frequency' },
      { type: 'table', id: 'table_evidence_excerpt' },
    ] as const

    orderedResearchItems.forEach(item => {
      if (item.type === 'table') {
        const found = tableById.get(item.id)
        if (!found) return
        appendTable(found.table, found.index)
        consumedTables.add(item.id)
      } else {
        const found = figureById.get(item.id)
        if (!found) return
        appendFigure(found.figure, found.index)
        consumedFigures.add(item.id)
      }
    })

    tables.forEach((table, index) => {
      const id = normalizedResearchId(table.id)
      if (id && consumedTables.has(id)) return
      appendTable(table, index)
    })
    figures.forEach((figure, index) => {
      const id = normalizedResearchId(figure.id)
      if (id && consumedFigures.has(id)) return
      appendFigure(figure, index)
    })

    if ('analysisText' in result && result.analysisText) {
      components.push(component('research_component', {
        type: 'analysis',
        title: '分析文字',
        content: cleanResearchNarrativeText(result.analysisText),
      }))
    }
    const discussionText = discussionTextForStructuredResult(result)
    if (discussionText) {
      components.push(component('research_component', {
        type: 'analysis',
        title: '讨论与优化建议',
        content: discussionText,
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
      title: asset.type === 'quant_analysis_result' ? '分析结果' : '研究结果',
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
  matrix: '矩阵',
  criterion: '指标',
  weight: '权重',
  weightPercent: '权重(%)',
  rank: '排名',
  lambdaMax: 'λmax',
  CI: 'CI',
  RI: 'RI',
  CR: 'CR',
  consistency: '一致性',
}

const RESEARCH_INSERTION_BRIDGE_TEXT: Record<ResearchInsertionRole, string> = {
  method: '\u5728\u524d\u6587\u7814\u7a76\u8bbe\u8ba1\u57fa\u7840\u4e0a\uff0c\u672c\u6587\u8fdb\u4e00\u6b65\u5c06\u672c\u6b21\u7814\u7a76\u8ba1\u7b97\u7684\u65b9\u6cd5\u8def\u5f84\u4e0e\u6570\u636e\u5904\u7406\u8fc7\u7a0b\u8bf4\u660e\u5982\u4e0b\u3002',
  sample: '\u5728\u786e\u8ba4\u6837\u672c\u6765\u6e90\u4e0e\u6570\u636e\u7ed3\u6784\u540e\uff0c\u672c\u6587\u5c06\u6837\u672c\u4e0e\u53d8\u91cf\u60c5\u51b5\u6574\u7406\u5982\u4e0b\u3002',
  result: '\u5728\u5b8c\u6210\u6837\u672c\u6574\u7406\u4e0e\u6307\u6807\u8ba1\u7b97\u540e\uff0c\u672c\u6587\u5c06\u6838\u5fc3\u7ed3\u679c\u7eb3\u5165\u672c\u8282\u8fdb\u884c\u8bf4\u660e\uff0c\u5e76\u7ed3\u5408\u56fe\u8868\u5448\u73b0\u4e3b\u8981\u53d1\u73b0\u3002',
  discussion: '\u57fa\u4e8e\u4e0a\u8ff0\u5206\u6790\u7ed3\u679c\uff0c\u672c\u6587\u8fdb\u4e00\u6b65\u8ba8\u8bba\u5176\u5bf9\u7814\u7a76\u95ee\u9898\u7684\u56de\u5e94\u4ee5\u53ca\u5bf9\u540e\u7eed\u4f18\u5316\u7b56\u7565\u7684\u542f\u793a\u3002',
  conclusion: '\u7efc\u5408\u524d\u6587\u7814\u7a76\u8ba1\u7b97\u4e0e\u7ed3\u679c\u8ba8\u8bba\uff0c\u672c\u8282\u8fdb\u4e00\u6b65\u5f52\u7eb3\u7814\u7a76\u7ed3\u8bba\u4e0e\u5b9e\u8df5\u542f\u793a\u3002',
}

function hasVisiblePaperNode(node: PaperEditorNode) {
  if (node.type === 'researchImage' || node.type === 'researchTable' || node.type === 'researchBlock') return true
  if (node.type === 'text') return Boolean(node.text?.trim())
  return (node.content ?? []).some(hasVisiblePaperNode)
}

function researchTableColumnLabel(column: string) {
  if (RESEARCH_TABLE_COLUMN_LABELS[column]) return RESEARCH_TABLE_COLUMN_LABELS[column]
  return column
    .replace(/^factor_(\d+)$/i, '因子$1')
    .replace(/_/g, ' ')
}

function displayKanoType(value: unknown) {
  const text = String(value ?? '').trim()
  const map: Record<string, string> = {
    M: '必备型',
    O: '期望型',
    A: '魅力型',
    I: '无差异型',
    Q: '可疑结果',
    R: '反向型',
  }
  return map[text] ?? text
}

function numericResearchColumnDigits(column: string) {
  if (['排名', 'N', '样本总量', '最终耦合优先级排名'].includes(column)) return 0
  if (['权重(%)', '权重占比(%)', 'weightPercent'].includes(column)) return 2
  if (['Better', 'Worse', '熵权', '综合分', '熵值', '差异', 'CI', 'CR', 'RI', 'lambdaMax'].includes(column)) return 3
  return null
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
        : title.includes('AHP') && title.includes('一致性')
          ? ['matrix', 'n', 'lambdaMax', 'CI', 'RI', 'CR', 'consistency']
          : title.includes('AHP')
            ? ['matrix', 'criterion', 'weight', 'weightPercent', 'rank']
            : []
  if (!preferred.length) return columns.slice(0, 7)
  const selected = preferred.filter(column => columnSet.has(column))
  const minimumUsefulSelection = Math.min(3, preferred.length)
  return (selected.length >= minimumUsefulSelection ? selected : columns).slice(0, 7)
}

function formatResearchTableValue(column: string, value: unknown) {
  if (value == null) return ''
  if (column === 'KANO' || column === '主导KANO类型') return displayKanoType(value)
  const digits = numericResearchColumnDigits(column)
  if (typeof value === 'number') {
    if (column === 'p') return value < 0.001 ? '<0.001' : value.toFixed(3)
    if (digits !== null) return value.toFixed(digits)
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(Math.abs(value) < 1 ? 3 : 2)
  }
  const text = String(value).trim()
  if (digits !== null && text !== '') {
    const numeric = Number(text)
    if (Number.isFinite(numeric)) return numeric.toFixed(digits)
  }
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
    return '注：KANO类型包括必备型、期望型、魅力型、无差异型等；Better系数表示满意度提升作用，Worse系数绝对值表示缺失时导致不满意的程度。'
  }
  if (id.includes('entropy') || title.includes('熵权')) {
    return '注：熵值越低、差异系数越高，表示该指标对综合评价的区分作用越强；权重用于后续耦合优先级计算。'
  }
  if (id.includes('ahp') || title.includes('ahp')) {
    return '注：AHP权重由专家两两比较判断矩阵计算得到；CR<0.10通常表示一致性检验通过。'
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

export function researchInsertionRoleForComponents(
  components: Pick<ResearchPackageComponent, 'type' | 'title' | 'content'>[]
): ResearchInsertionRole {
  if (components.length > 0 && components.every(component => component.type === 'method')) return 'method'
  const text = components.map(component => `${component.title ?? ''}\n${component.content ?? ''}`).join('\n')
  if (/discussion|recommendation|strategy|limitation|conclusion/i.test(text)) return 'discussion'
  if (/(\u8ba8\u8bba|\u5efa\u8bae|\u7b56\u7565|\u4f18\u5316|\u542f\u793a|\u5c40\u9650|\u7ed3\u8bba)/u.test(text)) return 'discussion'
  return 'result'
}

function paperNodeText(node: PaperEditorNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(paperNodeText).join('')
}

export function mergeResearchNodesIntoDoc(
  doc: PaperEditorDoc,
  researchNodes: PaperEditorNode[],
  role: ResearchInsertionRole = 'result'
): PaperEditorDoc {
  if (researchNodes.length === 0) return doc
  const sourceContent = doc.content ?? []
  const hasExistingContent = sourceContent.some(hasVisiblePaperNode)
  const bridgeText = RESEARCH_INSERTION_BRIDGE_TEXT[role] ?? RESEARCH_INSERTION_BRIDGE_TEXT.result
  const lastText = paperNodeText(sourceContent[sourceContent.length - 1] ?? { type: 'paragraph' }).trim()
  const bridgeNodes = hasExistingContent && lastText !== bridgeText
    ? [paragraphNode(bridgeText, { researchBlock: true })]
    : []
  return {
    ...doc,
    content: [...sourceContent, ...bridgeNodes, ...researchNodes],
  }
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
