// Shared, user-facing labels and helpers for the research-analysis UI.
// Keeps internal enums (variable roles, capability tiers) and implementation
// details out of the interface students actually see.
import type { ResearchAnalysisPlan, ResearchAnalysisVariable } from './storage'

export const ROLE_LABELS: Record<ResearchAnalysisVariable['role'], string> = {
  independent: '自变量',
  dependent: '因变量',
  mediator: '中介变量',
  moderator: '调节变量',
  control: '控制变量',
  group: '分组变量',
  item: '题项',
  unknown: '未确定',
}

export const CAPABILITY_TIER_LABELS: Record<string, string> = {
  closed_loop: '可直接完成',
  partial_loop: '可部分完成',
  out_of_scope: '暂不支持',
}

const METHOD_LABELS: Record<string, string> = {
  kano_entropy: 'KANO 模型分析',
  ahp: 'AHP 层次分析法',
  qualitative_coding: '质性编码分析',
  descriptive: '描述性统计',
  cronbach_alpha: '信度分析',
  correlation: '相关分析',
  regression_analysis: '回归分析',
  anova: '方差分析',
  mediation_model_4: '中介效应检验',
  efa: '探索性因子分析',
  out_of_scope: '暂不适用',
}

export function methodLabel(method: string): string {
  return METHOD_LABELS[method.trim().toLowerCase()] ?? method
}

export function methodListText(plan: ResearchAnalysisPlan): string {
  const methods = plan.methods?.length ? plan.methods : [plan.method]
  return methods.filter(Boolean).map(methodLabel).join('、')
}

// Update a variable's mapped column AND keep the fields the analysis engine
// actually reads in sync. The Python service's plan_columns() reads
// requiredColumns FIRST (then variables), and ANOVA grouping reads
// toolCalls[].groupColumn — so editing variables[].column alone would not take
// effect without this.
export function applyVariableColumn(
  plan: ResearchAnalysisPlan,
  index: number,
  column: string,
): ResearchAnalysisPlan {
  const nextColumn = column || undefined
  const variables = plan.variables.map((variable, i) =>
    i === index ? { ...variable, column: nextColumn } : variable,
  )
  // requiredColumns drives column selection; exclude the grouping column,
  // which is routed separately as the ANOVA group.
  const requiredColumns = Array.from(
    new Set(
      variables
        .filter(variable => variable.role !== 'group' && variable.column)
        .map(variable => variable.column as string),
    ),
  )
  const groupColumn = variables.find(variable => variable.role === 'group')?.column
  const toolCalls = (plan.toolCalls ?? []).map(call => ({
    ...call,
    groupColumn: groupColumn ?? call.groupColumn,
  }))
  return { ...plan, variables, requiredColumns, toolCalls }
}

// Lightweight CSV preview parser for the confirmation step (first N rows).
// Best-effort: good enough to let a user eyeball that the columns line up.
export function parseCsvPreview(
  text: string | undefined,
  maxRows = 5,
): { columns: string[]; rows: string[][] } {
  if (!text) return { columns: [], rows: [] }
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (!lines.length) return { columns: [], rows: [] }
  const split = (line: string) => line.split(',').map(cell => cell.trim())
  const columns = split(lines[0])
  const rows = lines.slice(1, maxRows + 1).map(split)
  return { columns, rows }
}
