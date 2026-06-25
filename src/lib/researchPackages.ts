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
      components.push(component('research_component', {
        type: 'figure',
        title: figure.title ?? `图${index + 1}`,
        label: figure.title ?? `图${index + 1}`,
        content: figure.caption ?? figure.title ?? `图${index + 1}`,
        data: figure,
      }))
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
        : '无可用统计表。'
      components.push(component('research_component', {
        type: 'statistics',
        title: table.title ?? `统计表${index + 1}`,
        label: `表${index + 1}`,
        content,
        data: table,
      }))
    })
    if ('analysisText' in result && result.analysisText) {
      components.push(component('research_component', {
        type: 'analysis',
        title: '分析文字',
        content: String(result.analysisText),
      }))
    }
    if ('cautions' in result && Array.isArray(result.cautions) && result.cautions.length > 0) {
      components.push(component('research_component', {
        type: 'raw_text',
        title: '计算提示',
        content: result.cautions.join('\n'),
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

  const previewRows = rows.slice(0, 8)
  const visibleColumns = columns.slice(0, 5)
  return [
    ...(title ? [paragraphNode(title, { textAlign: 'center', researchTableCaption: true })] : []),
    paragraphNode(visibleColumns.join('    '), { textAlign: 'center', researchTableRow: true }),
    ...previewRows.map(row => paragraphNode(visibleColumns.map(column => {
      const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : ''
      return value == null ? '' : String(value)
    }).join('    '), { textAlign: 'center', researchTableRow: true })),
  ]
}

function componentToPaperNodes(component: ResearchPackageComponent): PaperEditorNode[] {
  if (component.type === 'method' || component.type === 'analysis' || component.type === 'raw_text') {
    return splitParagraphs(component.content).map(text => paragraphNode(text))
  }

  const figure = componentFigureData(component)
  if (figure) {
    const title = component.label ? `${component.label} ${component.title ?? ''}`.trim() : component.title
    return [
      {
        type: 'researchImage',
        attrs: {
          src: figure.dataUrl,
          alt: title ?? '分析结果图',
          title: title ?? figure.title ?? '分析结果图',
          caption: figure.caption,
        },
      },
      paragraphNode(figure.caption || title || '分析结果图', { textAlign: 'center', researchFigureCaption: true }),
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

export function appendResearchBlockToDoc(doc: PaperEditorDoc, pkg: ResearchContentPackage, componentIds?: string[]): PaperEditorDoc {
  return {
    ...doc,
    content: [
      ...(doc.content ?? []),
      researchBlockNode(pkg, componentIds),
    ],
  }
}
