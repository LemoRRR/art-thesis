import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { callAIOnce, type Message } from '../lib/ai.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(__dirname, '../python/research_analysis.py')
const CHART_FONT_FAMILY = 'PaperChartCN'
let chartFontsRegistered = false

type ResearchAnalysisMethod =
  | 'descriptive'
  | 'cronbach_alpha'
  | 'correlation'
  | 'anova'
  | 'mediation_model_4'
  | 'efa'
  | 'out_of_scope'

const ANALYSIS_METHODS: ResearchAnalysisMethod[] = [
  'descriptive',
  'cronbach_alpha',
  'correlation',
  'anova',
  'mediation_model_4',
  'efa',
  'out_of_scope',
]

function normalizeAnalysisMethod(value: unknown): ResearchAnalysisMethod | '' {
  const raw = String(value ?? '').trim().toLowerCase()
  const aliases: Record<string, ResearchAnalysisMethod> = {
    cronbach: 'cronbach_alpha',
    alpha: 'cronbach_alpha',
    mediation: 'mediation_model_4',
    process_model_4: 'mediation_model_4',
  }
  const normalized = aliases[raw] ?? raw
  return ANALYSIS_METHODS.includes(normalized as ResearchAnalysisMethod)
    ? normalized as ResearchAnalysisMethod
    : ''
}

function pythonCommand() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3')
}

function sanitizeForPythonJson(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/[\uD800-\uDFFF]/g, '')
  if (Array.isArray(value)) return value.map(sanitizeForPythonJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeForPythonJson(item)])
    )
  }
  return value
}

function runPython(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand(), [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, 120_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdin.write(JSON.stringify(sanitizeForPythonJson(payload ?? {})))
    child.stdin.end()

    child.on('error', error => {
      clearTimeout(timeout)
      reject(new Error(`Python analysis failed to start: ${error.message}`))
    })

    child.on('close', code => {
      clearTimeout(timeout)
      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(new Error(stderr || `Python analysis exited with code ${code}`))
        return
      }
      try {
        resolve(sanitizeForPythonJson(JSON.parse(trimmed)) as Record<string, unknown>)
      } catch (error) {
        reject(new Error(`${error instanceof Error ? error.message : 'Invalid Python analysis output'}\n${trimmed.slice(0, 1000)}\n${stderr.slice(0, 1000)}`))
      }
    })
  })
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

async function readDatasetInNode(payload: Record<string, unknown>): Promise<{ fileName: string; columns: string[]; rows: Record<string, unknown>[] }> {
  const fileName = String(payload.fileName ?? 'dataset.csv')
  let rows: Record<string, unknown>[]
  let columns: string[]

  if (payload.base64 && fileName.toLowerCase().match(/\.(xlsx|xls)$/)) {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(Buffer.from(String(payload.base64), 'base64'), { type: 'buffer' })
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
    columns = rows[0] ? Object.keys(rows[0]) : []
  } else {
    const text = payload.base64
      ? Buffer.from(String(payload.base64), 'base64').toString('utf8')
      : String(payload.text ?? '')
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    if (lines.length === 0) throw new Error('数据文件为空，无法生成分析方案。')
    columns = parseCsvLine(lines[0]).map((column, index) => column || `列${index + 1}`)
    rows = lines.slice(1, 501).map(line => {
      const values = parseCsvLine(line)
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']))
    })
  }

  if (columns.length === 0) throw new Error('没有识别到数据列，请检查文件表头。')
  return { fileName, columns, rows }
}

async function profileDatasetInNode(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { columns, rows } = await readDatasetInNode(payload)

  const numericColumns = columns.filter(column => {
    const values = rows.map(row => row[column]).filter(value => value !== null && value !== undefined && String(value).trim() !== '')
    if (values.length === 0) return false
    const numericCount = values.filter(value => Number.isFinite(Number(String(value).replace(/%$/, '')))).length
    return numericCount / values.length >= 0.6
  })
  const numericSet = new Set(numericColumns)
  const categoricalColumns = columns.filter(column => {
    if (numericSet.has(column)) return false
    const unique = new Set(rows.map(row => String(row[column] ?? '').trim()).filter(Boolean))
    return unique.size > 1 && unique.size <= Math.max(20, Math.floor(rows.length / 2))
  })

  return {
    ok: true,
    sampleSize: rows.length,
    columns,
    numericColumns,
    categoricalColumns,
    previewRows: rows.slice(0, 8),
    qualityReport: assessDatasetQuality(rows, columns, numericColumns, categoricalColumns),
    profileProvider: 'node-fallback',
  }
}

function splitMethodValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(splitMethodValues)
  return String(value ?? '')
    .split(/[,，、\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function assessDatasetQuality(rows: Record<string, unknown>[], columns: string[], numericColumns: string[], categoricalColumns: string[]) {
  const totalCells = Math.max(1, rows.length * Math.max(1, columns.length))
  const missingCells = rows.reduce((sum, row) => sum + columns.filter(column => String(row[column] ?? '').trim() === '').length, 0)
  const missingRate = missingCells / totalCells
  const duplicateRows = rows.length - new Set(rows.map(row => JSON.stringify(row))).size
  const likertLike = numericColumns.filter(column => {
    const values = valuesForColumn(rows, column)
    if (!values.length) return false
    return values.every(value => value >= 1 && value <= 7 && Number.isInteger(value))
  })
  const highMissingRowIndexes = new Set<number>()
  rows.forEach((row, index) => {
    const missing = columns.filter(column => String(row[column] ?? '').trim() === '').length
    if (missing / Math.max(1, columns.length) > 0.5) highMissingRowIndexes.add(index)
  })
  const straightLineRowIndexes = new Set<number>()
  if (likertLike.length >= 5) {
    rows.forEach((row, index) => {
      const values = likertLike.map(column => numericValue(row[column])).filter((value): value is number => value !== null)
      if (values.length >= 5 && sampleSd(values) === 0) straightLineRowIndexes.add(index)
    })
  }
  const invalidSampleCandidates = new Set([...highMissingRowIndexes, ...straightLineRowIndexes])
  const warnings = [
    rows.length < 30 ? '样本量低于 30，统计推断应谨慎，建议作为探索性结果。' : '',
    missingRate > 0.15 ? `缺失率约 ${(missingRate * 100).toFixed(1)}%，建议先清洗无效样本或缺失过多的题项。` : '',
    duplicateRows > 0 ? `检测到 ${duplicateRows} 条重复记录，建议确认是否为重复提交。` : '',
    invalidSampleCandidates.size > 0 ? `检测到 ${invalidSampleCandidates.size} 条疑似无效样本（缺失过多或量表题直线作答），建议剔除或人工复核后再写入正式结论。` : '',
    numericColumns.length < 2 ? '可用于统计建模的数值变量不足，相关、回归或因子分析可能不适用。' : '',
  ].filter(Boolean)
  return {
    sampleSize: rows.length,
    columnCount: columns.length,
    numericCount: numericColumns.length,
    categoricalCount: categoricalColumns.length,
    missingRate: Number(missingRate.toFixed(4)),
    duplicateRows,
    highMissingRows: highMissingRowIndexes.size,
    straightLineRows: straightLineRowIndexes.size,
    invalidSampleCandidates: invalidSampleCandidates.size,
    likertLikeColumns: likertLike,
    reliabilitySuitable: rows.length >= 30 && likertLike.length >= 3,
    efaSuitable: rows.length >= Math.max(50, numericColumns.length * 5) && numericColumns.length >= 6,
    correlationSuitable: rows.length >= 20 && numericColumns.length >= 2,
    anovaSuitable: rows.length >= 20 && numericColumns.length >= 1 && categoricalColumns.length >= 1,
    warnings,
  }
}

function numericValue(value: unknown): number | null {
  const number = Number(String(value ?? '').trim().replace(/%$/, ''))
  return Number.isFinite(number) ? number : null
}

function valuesForColumn(rows: Record<string, unknown>[], column: string): number[] {
  return rows.map(row => numericValue(row[column])).filter((value): value is number => value !== null)
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleSd(values: number[]) {
  if (values.length < 2) return null
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function round(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Number(value.toFixed(digits))
}

function pearson(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 3) return null
  const leftMean = mean(left)
  const rightMean = mean(right)
  let numerator = 0
  let leftSum = 0
  let rightSum = 0
  left.forEach((value, index) => {
    const lx = value - leftMean
    const ry = right[index] - rightMean
    numerator += lx * ry
    leftSum += lx ** 2
    rightSum += ry ** 2
  })
  const denominator = Math.sqrt(leftSum * rightSum)
  return denominator ? numerator / denominator : null
}

function nodeDescribe(rows: Record<string, unknown>[], columns: string[]) {
  return columns.flatMap(column => {
    const values = valuesForColumn(rows, column)
    if (!values.length) return []
    return [{
      variable: column,
      n: values.length,
      mean: round(mean(values)),
      sd: round(sampleSd(values)),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
    }]
  })
}

function nodeCronbach(rows: Record<string, unknown>[], columns: string[]) {
  if (columns.length < 3) return null
  const completeRows = rows
    .map(row => columns.map(column => numericValue(row[column])))
    .filter(row => row.every(value => value !== null)) as number[][]
  if (completeRows.length < 3) return null
  const itemVariances = columns.reduce((sum, _column, index) => sum + (sampleSd(completeRows.map(row => row[index])) ?? 0) ** 2, 0)
  const totals = completeRows.map(row => row.reduce((sum, value) => sum + value, 0))
  const totalVariance = (sampleSd(totals) ?? 0) ** 2
  if (!totalVariance) return null
  const k = columns.length
  return {
    items: columns,
    n: completeRows.length,
    alpha: round((k / (k - 1)) * (1 - itemVariances / totalVariance)),
  }
}

function nodeCorrelations(rows: Record<string, unknown>[], columns: string[]) {
  const results: Array<Record<string, unknown>> = []
  columns.forEach((left, leftIndex) => {
    columns.slice(leftIndex + 1).forEach(right => {
      const pairs = rows.map(row => [numericValue(row[left]), numericValue(row[right])])
        .filter(pair => pair[0] !== null && pair[1] !== null) as number[][]
      const r = pearson(pairs.map(pair => pair[0]), pairs.map(pair => pair[1]))
      if (r !== null) results.push({ x: left, y: right, n: pairs.length, r: round(r), p: null })
    })
  })
  return results
}

function nodeAnova(rows: Record<string, unknown>[], columns: string[], groupColumn?: string) {
  if (!groupColumn) return []
  return columns.flatMap(column => {
    const groups = new Map<string, number[]>()
    rows.forEach(row => {
      const group = String(row[groupColumn] ?? '').trim()
      const value = numericValue(row[column])
      if (!group || value === null) return
      groups.set(group, [...(groups.get(group) ?? []), value])
    })
    const validGroups = Array.from(groups.values()).filter(values => values.length >= 2)
    if (validGroups.length < 2) return []
    const allValues = validGroups.flat()
    const grandMean = mean(allValues)
    const ssBetween = validGroups.reduce((sum, values) => sum + values.length * (mean(values) - grandMean) ** 2, 0)
    const ssWithin = validGroups.reduce((sum, values) => {
      const avg = mean(values)
      return sum + values.reduce((inner, value) => inner + (value - avg) ** 2, 0)
    }, 0)
    const dfBetween = validGroups.length - 1
    const dfWithin = allValues.length - validGroups.length
    const f = dfWithin > 0 && ssWithin ? (ssBetween / dfBetween) / (ssWithin / dfWithin) : null
    return [{ group: groupColumn, variable: column, f: round(f), p: null }]
  })
}

function dot(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

function multiplyMatrixVector(matrix: number[][], vector: number[]) {
  return matrix.map(row => dot(row, vector))
}

function vectorNorm(vector: number[]) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0))
}

function firstPrincipalComponent(matrix: number[][], seedIndex: number) {
  const size = matrix.length
  let vector: number[] = Array.from({ length: size }, (_, index) => (index === seedIndex % size ? 1 : 0.35))
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const next = multiplyMatrixVector(matrix, vector)
    const norm = vectorNorm(next)
    if (!norm) break
    vector = next.map(value => value / norm)
  }
  const mv = multiplyMatrixVector(matrix, vector)
  const eigenvalue = dot(vector, mv)
  return { vector, eigenvalue }
}

function deflateMatrix(matrix: number[][], vector: number[], eigenvalue: number) {
  return matrix.map((row, rowIndex) => row.map((value, colIndex) => value - eigenvalue * vector[rowIndex] * vector[colIndex]))
}

function nodeEfa(rows: Record<string, unknown>[], columns: string[]) {
  if (columns.length < 3) return null
  const completeRows = rows
    .map(row => columns.map(column => numericValue(row[column])))
    .filter(row => row.every(value => value !== null)) as number[][]
  if (completeRows.length < 10) return null
  const means = columns.map((_column, index) => mean(completeRows.map(row => row[index])))
  const sds = columns.map((_column, index) => sampleSd(completeRows.map(row => row[index])) ?? 0)
  if (sds.some(sd => sd === 0)) return null
  const standardized = completeRows.map(row => row.map((value, index) => (value - means[index]) / sds[index]))
  const corrMatrix = columns.map((_rowColumn, rowIndex) => columns.map((_colColumn, colIndex) => {
    if (rowIndex === colIndex) return 1
    const left = standardized.map(row => row[rowIndex])
    const right = standardized.map(row => row[colIndex])
    return pearson(left, right) ?? 0
  }))
  const factorCount = Math.max(1, Math.min(3, columns.length - 1))
  let working = corrMatrix.map(row => [...row])
  const factors = Array.from({ length: factorCount }, (_item, factorIndex) => {
    const component = firstPrincipalComponent(working, factorIndex)
    working = deflateMatrix(working, component.vector, component.eigenvalue)
    return component
  }).filter(component => component.eigenvalue > 0.25)
  if (!factors.length) return null
  const loadings = columns.map((column, rowIndex) => ({
    variable: column,
    ...Object.fromEntries(factors.map((factor, factorIndex) => [
      `factor_${factorIndex + 1}`,
      round(factor.vector[rowIndex] * Math.sqrt(Math.max(0, factor.eigenvalue))),
    ])),
  }))
  const eigenvalues = factors.map(factor => round(factor.eigenvalue))
  const totalVariance = columns.length
  const explainedVariance = factors.map(factor => round(factor.eigenvalue / totalVariance, 4))
  return {
    n: completeRows.length,
    factors: factors.length,
    method: 'principal_component_fallback',
    eigenvalues,
    explainedVariance,
    loadings,
  }
}

function methodsFromPlan(payload: Record<string, unknown>, numericColumns: string[], categoricalColumns: string[]) {
  const plan = (payload.confirmedPlan && typeof payload.confirmedPlan === 'object') ? payload.confirmedPlan as Record<string, unknown> : {}
  const rawMethods = [
    ...(Array.isArray(plan.toolCalls) ? plan.toolCalls.flatMap(call => call && typeof call === 'object' ? splitMethodValues((call as Record<string, unknown>).tool) : []) : []),
    ...splitMethodValues(plan.methods),
    ...splitMethodValues(plan.method),
    ...splitMethodValues(payload.method),
  ]
  const methods = rawMethods.map(normalizeAnalysisMethod).filter(Boolean)
  if (methods.length) return Array.from(new Set(methods)).filter(method => method !== 'out_of_scope')
  return inferMethods('', numericColumns, numericColumns, categoricalColumns).filter(method => method !== 'out_of_scope')
}

function columnsFromPlan(payload: Record<string, unknown>, numericColumns: string[]) {
  const plan = (payload.confirmedPlan && typeof payload.confirmedPlan === 'object') ? payload.confirmedPlan as Record<string, unknown> : {}
  const required = Array.isArray(plan.requiredColumns) ? plan.requiredColumns.filter((column): column is string => typeof column === 'string' && numericColumns.includes(column)) : []
  if (required.length) return required
  const variables = Array.isArray(plan.variables) ? plan.variables : []
  const variableColumns = variables
    .map(variable => variable && typeof variable === 'object' ? (variable as Record<string, unknown>).column : '')
    .filter((column): column is string => typeof column === 'string' && numericColumns.includes(column))
  return variableColumns.length ? Array.from(new Set(variableColumns)) : numericColumns
}

async function analyzeDatasetInNode(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { columns, rows } = await readDatasetInNode(payload)
  const profile = await profileDatasetInNode(payload)
  const numericColumns = Array.isArray(profile.numericColumns) ? profile.numericColumns.filter((item): item is string => typeof item === 'string') : []
  const categoricalColumns = Array.isArray(profile.categoricalColumns) ? profile.categoricalColumns.filter((item): item is string => typeof item === 'string') : []
  const methods = methodsFromPlan(payload, numericColumns, categoricalColumns)
  const selectedColumns = columnsFromPlan(payload, numericColumns).slice(0, 12)
  const groupColumn = typeof payload.groupColumn === 'string'
    ? payload.groupColumn
    : (() => {
        const plan = (payload.confirmedPlan && typeof payload.confirmedPlan === 'object') ? payload.confirmedPlan as Record<string, unknown> : {}
        const call = Array.isArray(plan.toolCalls) ? plan.toolCalls.find(item => item && typeof item === 'object' && typeof (item as Record<string, unknown>).groupColumn === 'string') : null
        return call ? String((call as Record<string, unknown>).groupColumn) : categoricalColumns[0]
      })()

  const descriptive = methods.includes('descriptive') ? nodeDescribe(rows, selectedColumns) : []
  const correlations = methods.includes('correlation') ? nodeCorrelations(rows, selectedColumns.slice(0, 8)) : []
  const cronbachAlpha = methods.includes('cronbach_alpha') ? nodeCronbach(rows, selectedColumns) : null
  const anova = methods.includes('anova') ? nodeAnova(rows, selectedColumns.slice(0, 6), groupColumn) : []
  const efa = methods.includes('efa') ? nodeEfa(rows, selectedColumns.slice(0, 10)) : null
  const qualityReport = profile.qualityReport && typeof profile.qualityReport === 'object'
    ? profile.qualityReport as Record<string, unknown>
    : null
  const tables = [
    descriptive.length ? { id: 'table_descriptive', title: '描述性统计表', rows: descriptive, columns: ['variable', 'n', 'mean', 'sd', 'min', 'max'] } : null,
    cronbachAlpha ? { id: 'table_reliability', title: '信度分析表', rows: [{ alpha: cronbachAlpha.alpha, items: cronbachAlpha.items.length, n: cronbachAlpha.n, itemColumns: cronbachAlpha.items.join('、') }], columns: ['alpha', 'items', 'n', 'itemColumns'] } : null,
    correlations.length ? { id: 'table_correlation', title: '相关分析表', rows: correlations.slice(0, 24), columns: ['x', 'y', 'n', 'r', 'p'] } : null,
    anova.length ? { id: 'table_anova', title: '单因素方差分析表', rows: anova, columns: ['group', 'variable', 'f', 'p'] } : null,
    efa ? { id: 'table_efa', title: '探索性因子载荷表', rows: arrayRecords(efa.loadings), columns: ['variable', ...Array.from({ length: Number(efa.factors) || 0 }, (_item, index) => `factor_${index + 1}`)] } : null,
    qualityReport ? {
      id: 'table_data_quality',
      title: '数据质量与方法适用性检查表',
      rows: [{
        sampleSize: qualityReport.sampleSize,
        missingRate: qualityReport.missingRate,
        duplicateRows: qualityReport.duplicateRows,
        invalidSampleCandidates: qualityReport.invalidSampleCandidates,
        reliabilitySuitable: qualityReport.reliabilitySuitable ? '适合' : '需谨慎',
        efaSuitable: qualityReport.efaSuitable ? '适合' : '需谨慎',
        correlationSuitable: qualityReport.correlationSuitable ? '适合' : '需谨慎',
        anovaSuitable: qualityReport.anovaSuitable ? '适合' : '需谨慎',
      }],
      columns: ['sampleSize', 'missingRate', 'duplicateRows', 'invalidSampleCandidates', 'reliabilitySuitable', 'efaSuitable', 'correlationSuitable', 'anovaSuitable'],
    } : null,
  ].filter(Boolean)
  const strongest = correlations.length
    ? correlations.reduce((best, row) => Math.abs(Number(row.r ?? 0)) > Math.abs(Number(best.r ?? 0)) ? row : best, correlations[0])
    : null
  const plainLines = [
    `样本量：${rows.length}`,
    `识别数值变量：${numericColumns.join('、') || '无'}`,
    '',
    descriptive.length ? '【描述性统计】' : '',
    ...descriptive.map(row => `${row.variable}: n=${row.n}, M=${row.mean}, SD=${row.sd}, min=${row.min}, max=${row.max}`),
    cronbachAlpha ? `\n【信度分析】\nCronbach's alpha=${cronbachAlpha.alpha}，题项数=${cronbachAlpha.items.length}，有效样本=${cronbachAlpha.n}。` : '',
    correlations.length ? '\n【相关分析】' : '',
    ...correlations.slice(0, 12).map(row => `${row.x} 与 ${row.y}: r=${row.r}, p=${row.p ?? '未计算'}`),
    anova.length ? '\n【方差分析】' : '',
    ...anova.map(row => `${row.group} 分组下 ${row.variable}: F=${row.f}, p=${row.p ?? '未计算'}`),
    efa ? '\n【探索性因子分析】' : '',
    ...(efa ? arrayRecords(efa.loadings).slice(0, 12).map(row => `${row.variable}: ${Object.keys(row).filter(key => key.startsWith('factor_')).map(key => `${key}=${row[key]}`).join('，')}`) : []),
  ].filter(Boolean)

  return {
    ok: true,
    method: methods.join(',') || 'descriptive',
    sampleSize: rows.length,
    numericColumns,
    categoricalColumns,
    descriptive,
    cronbachAlpha,
    correlations,
    anova,
    qualityReport,
    mediation: null,
    efa,
    tables,
    figures: await buildGenericQuantFigures(descriptive, correlations, anova, efa, cronbachAlpha),
    methodText: '本次分析使用系统内置轻量统计引擎读取用户上传数据，并按确认方案完成描述统计、信度、相关、方差分析或探索性因子载荷近似计算。p值、复杂模型和高阶因子旋转建议在完整 Python/R 环境中进一步复核。',
    analysisText: strongest
      ? `相关分析显示，${strongest.x} 与 ${strongest.y} 的相关系数为 r=${strongest.r}。论文写作时应结合研究假设、变量含义和显著性检验进一步解释。`
      : '系统已根据上传数据完成基础统计计算。论文写作时应围绕表格中的均值、标准差、相关系数或组间差异进行谨慎解释。',
    cautions: [
      '当前线上环境使用轻量统计兜底；复杂模型、精确 p 值和高阶图表建议在正式统计环境中复核。',
      ...(Array.isArray(qualityReport?.warnings) ? qualityReport.warnings.filter((item): item is string => typeof item === 'string') : []),
    ],
    plainText: plainLines.join('\n'),
    columns,
    analysisProvider: 'node-fallback',
  }
}

type SheetTable = { name: string; columns: string[]; rows: Record<string, unknown>[] }
type AhpMatrix = { name: string; labels: string[]; matrix: number[][] }

async function readWorkbookTablesInNode(payload: Record<string, unknown>): Promise<SheetTable[]> {
  const fileName = String(payload.fileName ?? '')
  if (!payload.base64 || !fileName.toLowerCase().match(/\.(xlsx|xls)$/)) return []
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(Buffer.from(String(payload.base64), 'base64'), { type: 'buffer' })
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    const columns = rows[0] ? Object.keys(rows[0]) : []
    return { name, columns, rows }
  })
}

async function readWorkbookSheetArraysInNode(payload: Record<string, unknown>): Promise<Array<{ name: string; rows: unknown[][] }>> {
  const fileName = String(payload.fileName ?? '')
  if (!payload.base64 || !fileName.toLowerCase().match(/\.(xlsx|xls)$/)) return []
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(Buffer.from(String(payload.base64), 'base64'), { type: 'buffer' })
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    return { name, rows }
  })
}

async function readKanoEntropyWorkbook(payload: Record<string, unknown>) {
  const tables = await readWorkbookTablesInNode(payload)
  if (!tables.length) return null
  const summary = tables.find(table => table.name.includes('KANO') && table.name.includes('汇总'))
  const weights = tables.find(table => table.name.includes('熵权'))
  const priority = tables.find(table => table.name.includes('优先级') || table.columns.some(column => column.includes('最终耦合优先级排名')))
  if (!summary || !priority) return null
  const priorityRows = priority.rows
    .filter(row => row['设计维度'] || row['维度全称'])
    .sort((left, right) => Number(left['最终耦合优先级排名'] ?? 999) - Number(right['最终耦合优先级排名'] ?? 999))
  return {
    sheets: tables.map(table => table.name),
    summary,
    weights,
    priority: { ...priority, rows: priorityRows },
  }
}

function rowValue(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return value === null || value === undefined ? '' : String(value)
}

function maybeNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function kanoTypeName(type: string) {
  const normalized = type.trim()
  const map: Record<string, string> = {
    M: '必备型',
    O: '期望型',
    A: '魅力型',
    I: '无差异型',
    Q: '可疑结果',
    R: '反向型',
  }
  return map[normalized] ?? normalized
}

function formatResearchNumber(value: unknown, digits = 3) {
  const number = maybeNumber(value)
  if (number === null) return rowValue({ value }, 'value')
  if (Number.isInteger(number)) return String(number)
  return number.toFixed(digits)
}

function formatKanoTableValue(label: string, value: unknown) {
  if (label === 'KANO') return kanoTypeName(rowValue({ value }, 'value'))
  if (label === '排名' || label === 'N') return formatResearchNumber(value, 0)
  if (label === '权重(%)') return formatResearchNumber(value, 2)
  if (label === '熵值' || label === '差异' || label === 'Better' || label === 'Worse' || label === '熵权' || label === '综合分') {
    return formatResearchNumber(value, 3)
  }
  return value
}

function tableContent(rows: Record<string, unknown>[], columns: string[]) {
  return [
    columns.join('\t'),
    ...rows.map(row => columns.map(column => rowValue(row, column)).join('\t')),
  ].join('\n')
}

async function makePriorityChart(rows: Record<string, unknown>[]) {
  const displayRows = rows.slice(0, 12)
  const width = 1320
  const rowHeight = 46
  const height = 136 + Math.max(1, displayRows.length) * rowHeight
  const barX = 390
  const barMaxWidth = 540
  const metaX = 970
  const total = Math.max(displayRows.length, 1)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, 'KANO-熵权耦合优先级排序', '条形表示按排序归一化后的优先级强度；综合分越低，表示越应优先纳入设计优化。')
    ctx.fillStyle = CHART_THEME.muted
    ctx.font = chartFont(13)
    ctx.fillText('优先级强度', barX, 104)
    ctx.fillText('KANO类型 / 综合分', metaX, 104)
    displayRows.forEach((row, index) => {
      const y = 132 + index * rowHeight
      const rank = rowValue(row, '最终耦合优先级排名') || String(index + 1)
      const rawName = rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`
      const name = shortLabel(rawName, 14)
      const type = rowValue(row, '主导KANO类型')
      const score = maybeNumber(row['耦合优先级总得分']) ?? 0
      const priorityStrength = (total - index) / total
      const barWidth = Math.max(18, Math.round(priorityStrength * barMaxWidth))
      ctx.fillStyle = index % 2 === 0 ? '#f5faf2' : '#ffffff'
      ctx.fillRect(24, y - 26, width - 48, rowHeight - 6)
      ctx.fillStyle = '#284d34'
      ctx.font = chartFont(17, '700')
      ctx.fillText(`排序 ${rank}`, 42, y)
      ctx.font = chartFont(16)
      ctx.fillText(name, 126, y)
      ctx.fillStyle = CHART_THEME.track
      ctx.fillRect(barX, y - 17, barMaxWidth, 18)
      ctx.fillStyle = index < 3 ? CHART_THEME.primary : CHART_THEME.primaryMid
      ctx.fillRect(barX, y - 17, barWidth, 18)
      ctx.fillStyle = CHART_THEME.ink
      ctx.font = chartFont(15)
      ctx.fillText(`KANO：${type ? kanoTypeName(type) : '-'}   综合分：${score.toFixed(3)}`, metaX, y)
    })
    drawFootnote(ctx, '注：排序越靠前表示越应优先进入设计优化与策略建议；综合分原始值保留在右侧供核对。', 34, height - 18)
  })
}

function rowKey(row: Record<string, unknown>, parts: string[]) {
  return Object.keys(row).find(key => parts.every(part => key.includes(part))) ?? ''
}

function rowMetric(row: Record<string, unknown>, parts: string[]) {
  const key = rowKey(row, parts)
  return key ? maybeNumber(row[key]) ?? 0 : 0
}

function rowTextByParts(row: Record<string, unknown>, parts: string[], fallback = '') {
  const key = rowKey(row, parts)
  return key ? rowValue(row, key) : fallback
}

function parseAhpNumber(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const fraction = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (fraction) {
    const numerator = Number(fraction[1])
    const denominator = Number(fraction[2])
    return denominator ? numerator / denominator : null
  }
  const number = Number(text)
  return Number.isFinite(number) && number > 0 ? number : null
}

function findAhpMatricesInRows(sheetName: string, rows: unknown[][]): AhpMatrix[] {
  const matrices: AhpMatrix[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const labels = row.slice(colIndex + 1).map(cell => String(cell ?? '').trim()).filter(Boolean)
      if (labels.length < 2 || labels.length > 9) continue
      const matrixRows: number[][] = []
      const rowLabels: string[] = []
      for (let offset = 1; offset <= labels.length; offset += 1) {
        const current = rows[rowIndex + offset] ?? []
        const rowLabel = String(current[colIndex] ?? '').trim()
        const values = current.slice(colIndex + 1, colIndex + 1 + labels.length).map(parseAhpNumber)
        if (!rowLabel || values.some(value => value == null)) break
        rowLabels.push(rowLabel)
        matrixRows.push(values as number[])
      }
      if (matrixRows.length !== labels.length) continue
      const sameLabels = labels.every((label, index) => rowLabels[index] === label || rowLabels.includes(label))
      const diagonalOk = matrixRows.every((values, index) => Math.abs(values[index] - 1) < 0.08)
      if (!sameLabels || !diagonalOk) continue
      matrices.push({
        name: `${sheetName}${matrices.length ? `-${matrices.length + 1}` : ''}`,
        labels,
        matrix: matrixRows.map((values, index) => values.map((value, innerIndex) => index === innerIndex ? 1 : value)),
      })
      rowIndex += labels.length
      break
    }
  }
  return matrices
}

async function readAhpWorkbook(payload: Record<string, unknown>) {
  const sheets = await readWorkbookSheetArraysInNode(payload)
  const matrices = sheets.flatMap(sheet => findAhpMatricesInRows(sheet.name, sheet.rows))
  return matrices.length ? { sheets: sheets.map(sheet => sheet.name), matrices } : null
}

const AHP_RI: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0.58,
  4: 0.9,
  5: 1.12,
  6: 1.24,
  7: 1.32,
  8: 1.41,
  9: 1.45,
}

function calculateAhpMatrix(input: AhpMatrix) {
  const n = input.labels.length
  const geometricMeans = input.matrix.map(row => Math.pow(row.reduce((product, value) => product * value, 1), 1 / n))
  const total = geometricMeans.reduce((sum, value) => sum + value, 0) || 1
  const weights = geometricMeans.map(value => value / total)
  const weightedSums = input.matrix.map(row => row.reduce((sum, value, index) => sum + value * weights[index], 0))
  const lambdaValues = weightedSums.map((value, index) => value / Math.max(weights[index], 1e-8))
  const lambdaMax = lambdaValues.reduce((sum, value) => sum + value, 0) / n
  const ci = n <= 2 ? 0 : (lambdaMax - n) / (n - 1)
  const ri = AHP_RI[n] ?? 1.49
  const cr = ri === 0 ? 0 : ci / ri
  return {
    ...input,
    n,
    lambdaMax,
    ci: Math.max(0, ci),
    ri,
    cr: Math.max(0, cr),
    passed: cr < 0.1,
    weights: input.labels.map((label, index) => ({
      criterion: label,
      weight: weights[index],
      weightPercent: weights[index] * 100,
    })).sort((left, right) => right.weight - left.weight).map((row, index) => ({ ...row, rank: index + 1 })),
  }
}

type ChartCanvasContext = CanvasRenderingContext2D

const CHART_THEME = {
  background: '#fffdf8',
  ink: '#1f3328',
  inkSoft: '#53645a',
  muted: '#6d756f',
  rule: '#d8e2d6',
  grid: '#e7eee4',
  track: '#dfeadc',
  primary: '#2f7d4b',
  primaryDark: '#1f6b45',
  primaryMid: '#6ba46f',
  warm: '#9a5b4f',
  warmTrack: '#eadfda',
}

function registerChartFonts(GlobalFonts: typeof import('@napi-rs/canvas').GlobalFonts) {
  if (chartFontsRegistered) return
  chartFontsRegistered = true
  const candidates = [
    path.resolve(process.cwd(), 'server/assets/fonts/NotoSansCJKsc-Regular.otf'),
    path.resolve(__dirname, '../assets/fonts/NotoSansCJKsc-Regular.otf'),
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/simsun.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'),
  ]
  candidates
    .filter(fontPath => fs.existsSync(fontPath))
    .forEach(fontPath => {
      try {
        GlobalFonts.registerFromPath(fontPath, CHART_FONT_FAMILY)
      } catch {
        // Ignore unavailable font formats; the next candidate may work.
      }
    })
}

async function canvasDataUrl(
  width: number,
  height: number,
  draw: (ctx: ChartCanvasContext) => void
) {
  try {
    const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas')
    registerChartFonts(GlobalFonts)
    const scale = 2
    const canvas = createCanvas(width * scale, height * scale)
    const ctx = canvas.getContext('2d') as unknown as ChartCanvasContext
    ctx.scale(scale, scale)
    ctx.fillStyle = CHART_THEME.background
    ctx.fillRect(0, 0, width, height)
    draw(ctx)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

function chartFont(size: number, weight = '400') {
  return `${weight} ${size}px "${CHART_FONT_FAMILY}", "Microsoft YaHei", "SimHei", "Noto Sans CJK SC", Arial, sans-serif`
}

function drawChartHeader(ctx: ChartCanvasContext, title: string, subtitle: string) {
  ctx.fillStyle = CHART_THEME.ink
  ctx.font = chartFont(28, '700')
  ctx.fillText(title, 34, 46)
  ctx.fillStyle = CHART_THEME.muted
  ctx.font = chartFont(15)
  ctx.fillText(subtitle, 34, 76)
  ctx.strokeStyle = CHART_THEME.rule
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(34, 92)
  ctx.lineTo(940, 92)
  ctx.stroke()
}

function drawAxisLabel(ctx: ChartCanvasContext, text: string, x: number, y: number) {
  ctx.fillStyle = CHART_THEME.inkSoft
  ctx.font = chartFont(12)
  ctx.fillText(text, x, y)
}

function drawFootnote(ctx: ChartCanvasContext, text: string, x: number, y: number) {
  ctx.fillStyle = CHART_THEME.muted
  ctx.font = chartFont(12)
  ctx.fillText(text, x, y)
}

function drawLegendItem(ctx: ChartCanvasContext, x: number, y: number, color: string, label: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y - 11, 18, 12)
  ctx.fillStyle = '#344238'
  ctx.font = chartFont(13)
  ctx.fillText(label, x + 24, y)
}

function drawLinearTicks(ctx: ChartCanvasContext, left: number, top: number, width: number, values: number[], formatter: (value: number) => string) {
  ctx.strokeStyle = CHART_THEME.grid
  ctx.fillStyle = CHART_THEME.inkSoft
  ctx.font = chartFont(12)
  values.forEach(value => {
    const x = left + width * value
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + 5)
    ctx.stroke()
    ctx.fillText(formatter(value), x - 12, top + 22)
  })
}

function drawVerticalTicks(ctx: ChartCanvasContext, left: number, top: number, height: number, values: number[], formatter: (value: number) => string) {
  ctx.strokeStyle = CHART_THEME.grid
  ctx.fillStyle = CHART_THEME.inkSoft
  ctx.font = chartFont(12)
  values.forEach(value => {
    const y = top + height - height * value
    ctx.beginPath()
    ctx.moveTo(left - 5, y)
    ctx.lineTo(left, y)
    ctx.stroke()
    ctx.fillText(formatter(value), left - 34, y + 4)
  })
}

function drawChartArea(ctx: ChartCanvasContext, left: number, top: number, width: number, height: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(left, top, width, height)
  ctx.strokeStyle = CHART_THEME.rule
  ctx.lineWidth = 1
  ctx.strokeRect(left, top, width, height)
}

function drawVerticalGrid(
  ctx: ChartCanvasContext,
  left: number,
  top: number,
  width: number,
  height: number,
  values: number[],
  maxValue: number,
  formatter: (value: number) => string
) {
  ctx.strokeStyle = CHART_THEME.grid
  ctx.fillStyle = CHART_THEME.inkSoft
  ctx.font = chartFont(12)
  values.forEach(value => {
    const x = left + (value / maxValue) * width
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + height)
    ctx.stroke()
    ctx.fillText(formatter(value), x - 14, top + height + 22)
  })
}

async function makeKanoStackedChart(rows: Record<string, unknown>[]) {
  const types = [
    { code: 'M', label: '必备', parts: ['M_', '占比'], color: '#2f6f4e' },
    { code: 'O', label: '期望', parts: ['O_', '占比'], color: '#5d9a65' },
    { code: 'A', label: '魅力', parts: ['A_', '占比'], color: '#94bd77' },
    { code: 'I', label: '无差异', parts: ['I_', '占比'], color: '#d5e5c8' },
    { code: 'Q/R', label: '可疑/反向', parts: ['Q_', '占比'], color: '#c9b06f' },
  ]
  return canvasDataUrl(1180, 680, ctx => {
    drawChartHeader(ctx, 'KANO需求类型分布', '各设计维度在必备型、期望型、魅力型、无差异型等类型中的占比分布。')
    types.forEach((type, index) => {
      const x = 570 + index * 104
      drawLegendItem(ctx, x, 63, type.color, type.label)
    })
    const startY = 118
    const barX = 250
    const barWidth = 700
    const barHeight = 24
    drawLinearTicks(ctx, barX, 96, barWidth, [0, 0.25, 0.5, 0.75, 1], value => `${Math.round(value * 100)}%`)
    rows.slice(0, 12).forEach((row, index) => {
      const y = startY + index * 44
      const name = shortLabel(rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`, 12)
      ctx.fillStyle = '#284d34'
      ctx.font = chartFont(15, '700')
      ctx.fillText(name, 42, y + 17)
      let x = barX
      types.forEach(type => {
        const value = type.code === 'Q/R'
          ? rowMetric(row, ['Q_', '占比']) + rowMetric(row, ['R_', '占比'])
          : rowMetric(row, type.parts)
        const width = Math.max(0, Math.round((value / 100) * barWidth))
        ctx.fillStyle = type.color
        ctx.fillRect(x, y, width, barHeight)
        x += width
      })
      ctx.strokeStyle = CHART_THEME.rule
      ctx.strokeRect(barX, y, barWidth, barHeight)
      ctx.fillStyle = CHART_THEME.inkSoft
      ctx.font = chartFont(13)
      ctx.fillText(`主导类型：${kanoTypeName(rowTextByParts(row, ['主导', 'KANO'], '-'))}`, 988, y + 17)
    })
    drawFootnote(ctx, '注：必备型、期望型、魅力型、无差异型用于说明不同维度的用户需求属性；可疑/反向结果需结合问卷质量进一步复核。', 42, 660)
  })
}

async function makeBetterWorseChart(rows: Record<string, unknown>[]) {
  return canvasDataUrl(1120, 760, ctx => {
    const left = 92
    const top = 112
    const size = 560
    drawChartHeader(ctx, 'Better-Worse系数矩阵', '横轴为Better满意提升系数，纵轴为Worse不满降低系数绝对值。')
    ctx.fillStyle = '#eef6ed'
    ctx.fillRect(left + size / 2, top, size / 2, size / 2)
    ctx.fillStyle = '#f7fbf5'
    ctx.fillRect(left, top + size / 2, size / 2, size / 2)
    ctx.strokeStyle = '#c9d6c7'
    ctx.lineWidth = 1
    ctx.strokeRect(left, top, size, size)
    ctx.beginPath()
    ctx.moveTo(left + size / 2, top)
    ctx.lineTo(left + size / 2, top + size)
    ctx.moveTo(left, top + size / 2)
    ctx.lineTo(left + size, top + size / 2)
    ctx.stroke()
    ctx.fillStyle = CHART_THEME.muted
    ctx.font = chartFont(12)
    ctx.fillText('高满意提升 / 高不满风险', left + size / 2 + 18, top + 24)
    ctx.fillText('低满意提升 / 低不满风险', left + 18, top + size / 2 + 26)
    drawLinearTicks(ctx, left, top + size + 6, size, [0, 0.5, 1], value => value.toFixed(1))
    drawVerticalTicks(ctx, left, top, size, [0, 0.5, 1], value => value.toFixed(1))
    rows.slice(0, 12).forEach((row, index) => {
      const better = rowMetric(row, ['Better'])
      const worse = rowMetric(row, ['Worse'])
      const label = shortLabel(rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`, 5)
      const x = left + Math.min(1, Math.max(0, better)) * size
      const y = top + size - Math.min(1, Math.max(0, worse)) * size
      ctx.fillStyle = index < 3 ? CHART_THEME.primaryDark : CHART_THEME.primaryMid
      ctx.beginPath()
      ctx.arc(x, y, index < 3 ? 8 : 6, 0, Math.PI * 2)
      ctx.fill()
      if (index < 6 || worse > 0.1) {
        ctx.fillStyle = '#1f3328'
        ctx.font = chartFont(13, '700')
        const labelDy = y > top + size - 34 ? -18 : -8
        ctx.fillText(label, x + 9, y + labelDy)
      }
    })
    ctx.fillStyle = '#24382d'
    ctx.font = chartFont(16)
    ctx.fillText('Better满意提升系数', left + 190, top + size + 44)
    ctx.save()
    ctx.translate(28, top + 360)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('Worse不满降低系数绝对值', 0, 0)
    ctx.restore()
    ctx.fillStyle = '#6d756f'
    ctx.font = chartFont(14)
    ctx.fillText('图中点标签为评价维度简称。', 700, 180)
    ctx.fillText('完整数值见KANO维度汇总表。', 700, 208)
    ctx.fillText('低不满风险的未标注点可结合表4-1读取。', 700, 236)
    ctx.fillText('右上区域表示满意提升与不满风险均较高，', 700, 270)
    ctx.fillText('可作为优先优化对象。', 700, 298)
  })
}

async function makeEntropyWeightChart(rows: Record<string, unknown>[]) {
  return canvasDataUrl(1180, 430, ctx => {
    drawChartHeader(ctx, '熵权指标权重分布', '用于耦合优先级得分计算的客观权重。')
    const chartRows = rows.filter(Boolean)
    const maxWeight = Math.max(...chartRows.map(row => rowMetric(row, ['权重'])), 1)
    drawLinearTicks(ctx, 360, 96, 660, [0, 0.5, 1], value => `${(value * maxWeight).toFixed(0)}%`)
    chartRows.forEach((row, index) => {
      const y = 128 + index * 76
      const weight = rowMetric(row, ['权重'])
      const label = shortLabel(rowValue(row, '指标') || rowValue(row, '指标名称') || rowValue(row, '评价指标') || `指标${index + 1}`, 18)
      const width = Math.round((weight / maxWeight) * 640)
      ctx.fillStyle = '#284d34'
      ctx.font = chartFont(16, '700')
      ctx.fillText(label, 46, y + 18)
      ctx.fillStyle = CHART_THEME.track
      ctx.fillRect(360, y, 660, 24)
      ctx.fillStyle = CHART_THEME.primary
      ctx.fillRect(360, y, width, 24)
      ctx.fillStyle = CHART_THEME.ink
      ctx.font = chartFont(15)
      ctx.fillText(`${weight.toFixed(2)}%`, 1040, y + 18)
    })
    drawFootnote(ctx, '注：熵权越高表示该指标在样本差异中提供的信息量越大。', 42, 404)
  })
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function svgDataUrl(width: number, height: number, body: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#fffdf8"/>
<style>
text{font-family:Arial,'Microsoft YaHei','Noto Sans CJK SC',sans-serif;fill:#1f3328}
.title{font-size:28px;font-weight:700;fill:#234234}
.sub{font-size:16px;fill:#6d756f}
.small{font-size:13px;fill:#53645a}
.axis{font-size:16px;fill:#24382d}
</style>
${body}
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function makeKanoStackedChartSvg(rows: Record<string, unknown>[]) {
  const types = [
    { code: 'M', label: '必备', parts: ['M_', '占比'], color: '#2f6f4e' },
    { code: 'O', label: '期望', parts: ['O_', '占比'], color: '#5d9a65' },
    { code: 'A', label: '魅力', parts: ['A_', '占比'], color: '#94bd77' },
    { code: 'I', label: '无差异', parts: ['I_', '占比'], color: '#d5e5c8' },
    { code: 'Q/R', label: '可疑/反向', parts: ['Q_', '占比'], color: '#c9b06f' },
  ]
  const legend = types.map((type, index) => {
    const x = 570 + index * 104
    return `<rect x="${x}" y="52" width="18" height="12" fill="${type.color}"/><text x="${x + 24}" y="64" class="small">${escapeXml(type.label)}</text>`
  }).join('')
  const bars = rows.slice(0, 12).map((row, index) => {
    const y = 118 + index * 44
    let x = 250
    const label = shortLabel(rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`, 12)
    const segments = types.map(type => {
      const value = type.code === 'Q/R'
        ? rowMetric(row, ['Q_', '占比']) + rowMetric(row, ['R_', '占比'])
        : rowMetric(row, type.parts)
      const width = Math.max(0, Math.round((value / 100) * 700))
      const rect = `<rect x="${x}" y="${y}" width="${width}" height="24" fill="${type.color}"/>`
      x += width
      return rect
    }).join('')
    return `<text x="42" y="${y + 17}" font-size="15" font-weight="700">${escapeXml(label)}</text>
${segments}<rect x="250" y="${y}" width="700" height="24" fill="none" stroke="#d9e2d6"/>
<text x="988" y="${y + 17}" class="small">主导类型：${escapeXml(kanoTypeName(rowTextByParts(row, ['主导', 'KANO'], '-')))}</text>`
  }).join('')
  return svgDataUrl(1180, 680, `<text x="34" y="46" class="title">KANO需求类型分布</text>
<text x="34" y="76" class="sub">各设计维度在必备型、期望型、魅力型、无差异型等类型中的占比分布。</text>
${legend}${bars}`)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function makeBetterWorseChartSvg(rows: Record<string, unknown>[]) {
  const left = 92
  const top = 112
  const size = 560
  const points = rows.slice(0, 12).map((row, index) => {
    const better = rowMetric(row, ['Better'])
    const worse = rowMetric(row, ['Worse'])
    const x = left + Math.min(1, Math.max(0, better)) * size
    const y = top + size - Math.min(1, Math.max(0, worse)) * size
    const labelDy = y > top + size - 34 ? -18 - (index % 4) * 12 : -8
    const label = shortLabel(rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`, 5)
    return `<circle cx="${x}" cy="${y}" r="${index < 3 ? 8 : 6}" fill="${index < 3 ? '#1f6b45' : '#6ba46f'}"/>
${index < 6 || worse > 0.1 ? `<text x="${x + 9}" y="${y + labelDy}" font-size="13" font-weight="700">${escapeXml(label)}</text>` : ''}`
  }).join('')
  return svgDataUrl(1120, 760, `<text x="34" y="46" class="title">Better-Worse系数矩阵</text>
<text x="34" y="76" class="sub">横轴为Better满意提升系数，纵轴为Worse不满降低系数绝对值。</text>
<rect x="${left + size / 2}" y="${top}" width="${size / 2}" height="${size / 2}" fill="#eef6ed"/>
<rect x="${left}" y="${top + size / 2}" width="${size / 2}" height="${size / 2}" fill="#f7fbf5"/>
<rect x="${left}" y="${top}" width="${size}" height="${size}" fill="none" stroke="#c9d6c7"/>
<line x1="${left + size / 2}" y1="${top}" x2="${left + size / 2}" y2="${top + size}" stroke="#c9d6c7"/>
<line x1="${left}" y1="${top + size / 2}" x2="${left + size}" y2="${top + size / 2}" stroke="#c9d6c7"/>
${points}
<text x="${left + 190}" y="${top + size + 44}" class="axis">Better满意提升系数</text>
<text transform="translate(28 ${top + 360}) rotate(-90)" class="axis">Worse不满降低系数绝对值</text>
<text x="700" y="180" class="small">图中点标签为评价维度简称。</text>
<text x="700" y="208" class="small">完整数值见KANO维度汇总表。</text>
<text x="700" y="236" class="small">低不满风险的未标注点可结合表4-1读取。</text>
<text x="700" y="270" class="small">右上区域表示满意提升与不满风险均较高，</text>
<text x="700" y="298" class="small">可作为优先优化对象。</text>`)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function makeEntropyWeightChartSvg(rows: Record<string, unknown>[]) {
  const chartRows = rows.filter(Boolean)
  const maxWeight = Math.max(...chartRows.map(row => rowMetric(row, ['权重'])), 1)
  const items = chartRows.map((row, index) => {
    const y = 128 + index * 76
    const weight = rowMetric(row, ['权重'])
    const width = Math.round((weight / maxWeight) * 640)
    const label = shortLabel(rowValue(row, '指标') || rowValue(row, '指标名称') || rowValue(row, '评价指标') || `指标${index + 1}`, 18)
    return `<text x="46" y="${y + 18}" font-size="16" font-weight="700">${escapeXml(label)}</text>
<rect x="360" y="${y}" width="660" height="24" fill="#dfeadc"/>
<rect x="360" y="${y}" width="${width}" height="24" fill="#2f7d4b"/>
<text x="1040" y="${y + 18}" font-size="15">${weight.toFixed(2)}%</text>`
  }).join('')
  return svgDataUrl(1180, 430, `<text x="34" y="46" class="title">熵权指标权重分布</text>
<text x="34" y="76" class="sub">用于耦合优先级得分计算的客观权重。</text>
${items}`)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function makePriorityChartSvg(rows: Record<string, unknown>[]) {
  const displayRows = rows.slice(0, 12)
  const width = 1320
  const rowHeight = 46
  const height = 136 + Math.max(1, displayRows.length) * rowHeight
  const barX = 390
  const barMaxWidth = 540
  const metaX = 970
  const total = Math.max(displayRows.length, 1)
  const items = displayRows.map((row, index) => {
    const y = 132 + index * rowHeight
    const rank = rowValue(row, '最终耦合优先级排名') || String(index + 1)
    const rawName = rowValue(row, '设计维度') || rowValue(row, '维度全称') || `维度${index + 1}`
    const name = shortLabel(rawName, 14)
    const type = rowValue(row, '主导KANO类型')
    const score = maybeNumber(row['耦合优先级总得分']) ?? 0
    const priorityStrength = (total - index) / total
    const barWidth = Math.max(18, Math.round(priorityStrength * barMaxWidth))
    return `<rect x="24" y="${y - 26}" width="${width - 48}" height="${rowHeight - 6}" fill="${index % 2 === 0 ? '#f5faf2' : '#ffffff'}"/>
<text x="42" y="${y}" font-size="17" font-weight="700">排序 ${escapeXml(rank)}</text>
<text x="126" y="${y}" font-size="16">${escapeXml(name)}</text>
<rect x="${barX}" y="${y - 17}" width="${barMaxWidth}" height="18" fill="#dfeadc"/>
<rect x="${barX}" y="${y - 17}" width="${barWidth}" height="18" fill="${index < 3 ? '#1f7a4c' : '#6ba46f'}"/>
<text x="${metaX}" y="${y}" font-size="15">KANO：${escapeXml(type ? kanoTypeName(type) : '-')}   综合分：${score.toFixed(3)}</text>`
  }).join('')
  return svgDataUrl(width, height, `<text x="34" y="46" class="title">KANO-熵权耦合优先级排序</text>
<text x="34" y="76" class="sub">条形表示按排序归一化后的优先级强度；综合分越低，表示越应优先纳入设计优化。</text>
<text x="${barX}" y="104" class="small">优先级强度</text>
<text x="${metaX}" y="104" class="small">KANO类型 / 综合分</text>
${items}`)
}

function shortLabel(value: unknown, max = 16) {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function normalizeFigureTitle(title: unknown, index: number) {
  const raw = String(title ?? '').trim() || '分析结果图'
  return /^图\d+[-—-]\d+/.test(raw) || /^图\d+/.test(raw) ? raw : `图4-${index + 1} ${raw}`
}

function normalizeTableTitle(title: unknown, index: number) {
  const raw = String(title ?? '').trim() || '分析结果表'
  return /^表\d+[-—-]\d+/.test(raw) || /^表\d+/.test(raw) ? raw : `表4-${index + 1} ${raw}`
}

function uniqueWarnings(items: unknown[]) {
  const seen = new Set<string>()
  return items
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .filter(item => {
      const key = item.replace(/\s+/g, '').replace(/[，。；;,.]/g, '').toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function mergeNodeQualityProfile(profile: Record<string, unknown>, payload: Record<string, unknown>) {
  if (profile.qualityReport) return profile
  try {
    const nodeProfile = await profileDatasetInNode(payload)
    return {
      ...profile,
      qualityReport: nodeProfile.qualityReport,
      previewRows: profile.previewRows ?? nodeProfile.previewRows,
      columns: Array.isArray(profile.columns) && profile.columns.length ? profile.columns : nodeProfile.columns,
      numericColumns: Array.isArray(profile.numericColumns) && profile.numericColumns.length ? profile.numericColumns : nodeProfile.numericColumns,
      categoricalColumns: Array.isArray(profile.categoricalColumns) && profile.categoricalColumns.length ? profile.categoricalColumns : nodeProfile.categoricalColumns,
    }
  } catch {
    return profile
  }
}

function normalizeResultLabels<T extends Record<string, unknown>>(result: T): T {
  const figures = Array.isArray(result.figures)
    ? result.figures.map((figure, index) => figure && typeof figure === 'object'
      ? { ...(figure as Record<string, unknown>), title: normalizeFigureTitle((figure as Record<string, unknown>).title, index) }
      : figure)
    : result.figures
  const tables = Array.isArray(result.tables)
    ? result.tables.map((table, index) => table && typeof table === 'object'
      ? { ...(table as Record<string, unknown>), title: normalizeTableTitle((table as Record<string, unknown>).title, index) }
      : table)
    : result.tables
  return { ...result, figures, tables }
}

async function makeDescriptiveMeanFigure(descriptive: Record<string, unknown>[]) {
  if (!descriptive.length) return ''
  const rows = descriptive.slice(0, 10)
  const width = 980
  const height = 150 + rows.length * 42
  const means = rows.map(row => Number(row.mean) || 0)
  const max = Math.max(...means.map(value => Math.abs(value)), 1)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '主要变量均值分布', '主要数值变量的均值与标准差，用于呈现样本总体评价水平。')
    const barX = 235
    const barWidth = 560
    rows.forEach((row, index) => {
      const y = 118 + index * 42
      const value = Number(row.mean) || 0
      const widthValue = Math.max(4, Math.round((Math.abs(value) / max) * barWidth))
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(14, '700')
      ctx.fillText(shortLabel(row.variable, 18), 42, y + 17)
      ctx.fillStyle = '#e5eddf'
      ctx.fillRect(barX, y, barWidth, 22)
      ctx.fillStyle = '#2f7d4b'
      ctx.fillRect(barX, y, widthValue, 22)
      ctx.fillStyle = '#263a2e'
      ctx.font = chartFont(13)
      ctx.fillText(`M=${row.mean ?? '-'}  SD=${row.sd ?? '-'}`, 815, y + 16)
    })
    drawFootnote(ctx, '注：M 表示均值，SD 表示标准差；仅展示前 10 个主要数值变量。', 42, height - 22)
  })
}

async function makeCorrelationHeatmapFigure(correlations: Record<string, unknown>[]) {
  if (!correlations.length) return ''
  const variables = Array.from(new Set(correlations.flatMap(row => [String(row.x ?? ''), String(row.y ?? '')]).filter(Boolean))).slice(0, 8)
  if (variables.length < 2) return ''
  const valueMap = new Map<string, number>()
  correlations.forEach(row => {
    const x = String(row.x ?? '')
    const y = String(row.y ?? '')
    const r = Number(row.r)
    if (x && y && Number.isFinite(r)) {
      valueMap.set(`${x}|||${y}`, r)
      valueMap.set(`${y}|||${x}`, r)
    }
  })
  const cell = 52
  const left = 178
  const top = 120
  const width = left + variables.length * cell + 110
  const height = top + variables.length * cell + 90
  const color = (r: number) => {
    const intensity = Math.min(1, Math.abs(r))
    const alpha = 0.18 + intensity * 0.72
    return r >= 0
      ? `rgba(47,125,75,${alpha})`
      : `rgba(174,82,72,${alpha})`
  }
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '变量相关系数热力图', '主要变量之间的 Pearson 相关系数矩阵。')
    variables.forEach((name, index) => {
      ctx.fillStyle = '#344238'
      ctx.font = chartFont(11)
      ctx.textAlign = 'center'
      ctx.fillText(shortLabel(name, 8), left + index * cell + 25, 104)
      ctx.textAlign = 'right'
      ctx.fillText(shortLabel(name, 14), left - 12, top + index * cell + 31)
    })
    variables.forEach((rowName, rowIndex) => {
      variables.forEach((colName, colIndex) => {
        const r = rowName === colName ? 1 : valueMap.get(`${rowName}|||${colName}`) ?? 0
        const x = left + colIndex * cell
        const y = top + rowIndex * cell
        ctx.fillStyle = color(r)
        ctx.fillRect(x, y, cell - 2, cell - 2)
        ctx.strokeStyle = '#ffffff'
        ctx.strokeRect(x, y, cell - 2, cell - 2)
        ctx.fillStyle = '#1f3328'
        ctx.font = chartFont(11)
        ctx.textAlign = 'center'
        ctx.fillText(r.toFixed(2), x + cell / 2, y + 31)
      })
    })
    ctx.textAlign = 'left'
    drawFootnote(ctx, '注：绿色表示正相关，红色表示负相关；系数绝对值越大，色块越深。', left, height - 34)
  })
}

async function makeAnovaFigure(anova: Record<string, unknown>[]) {
  if (!anova.length) return ''
  const rows = anova.slice(0, 8)
  const width = 980
  const height = 145 + rows.length * 44
  const values = rows.map(row => Number(row.f) || 0)
  const max = Math.max(...values, 1)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '组间差异检验结果', '分组比较中的方差分析 F 统计量。')
    rows.forEach((row, index) => {
      const y = 118 + index * 44
      const f = Number(row.f) || 0
      const barWidth = Math.max(4, Math.round((f / max) * 560))
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(14, '700')
      ctx.fillText(shortLabel(row.variable, 18), 42, y + 17)
      ctx.fillStyle = '#eadfda'
      ctx.fillRect(230, y, 580, 22)
      ctx.fillStyle = '#9a5b4f'
      ctx.fillRect(230, y, barWidth, 22)
      ctx.fillStyle = '#263a2e'
      ctx.font = chartFont(13)
      ctx.fillText(`F=${row.f ?? '-'}  p=${row.p ?? '未计算'}`, 830, y + 16)
    })
    drawFootnote(ctx, '注：F 值用于呈现组间差异强度，p 值用于辅助判断显著性。', 42, height - 22)
  })
}

async function makeReliabilityFigure(cronbachAlpha: Record<string, unknown> | null | undefined) {
  if (!cronbachAlpha) return ''
  const alpha = Number(cronbachAlpha.alpha)
  if (!Number.isFinite(alpha)) return ''
  const normalized = Math.max(0, Math.min(1, alpha))
  const width = 980
  const height = 260
  const left = 120
  const top = 130
  const barWidth = 720
  const filled = Math.round(barWidth * normalized)
  const items = Number(cronbachAlpha.items) || (Array.isArray(cronbachAlpha.items) ? cronbachAlpha.items.length : 0)
  const n = Number(cronbachAlpha.n) || 0
  const level = alpha >= 0.9 ? '优秀' : alpha >= 0.8 ? '良好' : alpha >= 0.7 ? '可接受' : alpha >= 0.6 ? '偏低' : '不足'
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '量表信度分析', 'Cronbach α 用于衡量量表题项内部一致性。')
    ctx.fillStyle = '#eadfda'
    ctx.fillRect(left, top, barWidth, 34)
    ctx.fillStyle = alpha >= 0.7 ? '#2f7d4b' : '#9a5b4f'
    ctx.fillRect(left, top, filled, 34)
    ctx.strokeStyle = '#5f5b52'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(left + barWidth * 0.7, top - 8)
    ctx.lineTo(left + barWidth * 0.7, top + 48)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#1f3328'
    ctx.font = chartFont(18, '700')
    ctx.fillText(`α=${alpha.toFixed(3)}（${level}）`, left, top - 18)
    drawAxisLabel(ctx, '0', left, top + 68)
    ctx.textAlign = 'center'
    drawAxisLabel(ctx, '0.70', left + barWidth * 0.7, top + 68)
    ctx.textAlign = 'right'
    drawAxisLabel(ctx, '1.00', left + barWidth, top + 68)
    ctx.textAlign = 'left'
    drawFootnote(ctx, `注：题项数 ${items || 'N/A'}，有效样本 ${n || 'N/A'}；虚线表示常用 0.70 参考阈值。`, left, top + 102)
  })
}

async function makeEfaLoadingFigure(efa: Record<string, unknown> | null | undefined) {
  const loadings = arrayRecords(efa?.loadings).slice(0, 10)
  if (!loadings.length) return ''
  const factorKeys = Object.keys(loadings[0] ?? {}).filter(key => /^factor_\d+/.test(key)).slice(0, 3)
  if (!factorKeys.length) return ''
  const width = 980
  const height = 150 + loadings.length * 42
  const max = Math.max(...loadings.flatMap(row => factorKeys.map(key => Math.abs(Number(row[key]) || 0))), 1)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '探索性因子载荷分布', '各题项在提取因子上的载荷强度。')
    loadings.forEach((row, index) => {
      const y = 118 + index * 42
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(14, '700')
      ctx.fillText(shortLabel(row.variable, 18), 42, y + 17)
      factorKeys.forEach((key, factorIndex) => {
        const value = Number(row[key]) || 0
        const barWidth = Math.max(3, Math.round((Math.abs(value) / max) * 150))
        const x = 230 + factorIndex * 205
        ctx.fillStyle = factorIndex === 0 ? '#2f7d4b' : factorIndex === 1 ? '#566c86' : '#9a5b4f'
        ctx.fillRect(x, y + factorIndex * 8, barWidth, 7)
        ctx.fillStyle = '#263a2e'
        ctx.font = chartFont(11)
        ctx.fillText(`${key.replace('_', ' ')}: ${value.toFixed(2)}`, x + 156, y + 7 + factorIndex * 8)
      })
    })
    drawFootnote(ctx, '注：载荷越高，表示题项与对应因子的关联越强。', 42, height - 22)
  })
}

async function makeAhpWeightFigure(rows: Record<string, unknown>[]) {
  const items = rows.slice(0, 12)
  const width = 1180
  const rowHeight = 58
  const height = Math.max(520, 184 + items.length * rowHeight)
  const axisMax = Math.min(100, Math.max(20, Math.ceil(Math.max(...items.map(row => Number(row.weightPercent) || 0), 1) / 10) * 10))
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, 'AHP指标权重排序图', '依据判断矩阵计算得到的指标权重及排序。')
    const left = 330
    const top = 126
    const chartWidth = 660
    const chartHeight = Math.max(1, items.length) * rowHeight - 12
    drawChartArea(ctx, left, top - 18, chartWidth, chartHeight)
    drawVerticalGrid(ctx, left, top - 18, chartWidth, chartHeight, [0, axisMax * 0.25, axisMax * 0.5, axisMax * 0.75, axisMax], axisMax, value => `${Math.round(value)}%`)
    items.forEach((row, index) => {
      const y = top + index * rowHeight
      const weight = Number(row.weightPercent) || 0
      const barWidth = Math.max(5, Math.round((weight / axisMax) * chartWidth))
      ctx.fillStyle = index % 2 === 0 ? '#f7fbf5' : '#ffffff'
      ctx.fillRect(28, y - 20, width - 56, rowHeight - 10)
      ctx.fillStyle = index < 3 ? CHART_THEME.primaryDark : CHART_THEME.inkSoft
      ctx.font = chartFont(13, '700')
      ctx.fillText(`第${row.rank ?? index + 1}位`, 42, y + 16)
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(17, '700')
      ctx.fillText(shortLabel(row.criterion, 18), 118, y + 16)
      ctx.fillStyle = CHART_THEME.track
      ctx.fillRect(left, y, chartWidth, 24)
      ctx.fillStyle = index < 3 ? CHART_THEME.primary : CHART_THEME.primaryMid
      ctx.fillRect(left, y, barWidth, 24)
      ctx.fillStyle = '#263a2e'
      ctx.font = chartFont(15, '700')
      ctx.fillText(`${weight.toFixed(2)}%`, left + chartWidth + 22, y + 18)
    })
    drawAxisLabel(ctx, '权重占比（%）', left + 258, height - 50)
    drawFootnote(ctx, '注：权重越高，表示该指标在目标评价中的相对重要性越强；排序用于识别论文讨论中的重点影响因素。', 42, height - 22)
  })
}

async function makeAhpConsistencyFigure(rows: Record<string, unknown>[]) {
  const items = rows.slice(0, 8)
  const width = 1180
  const rowHeight = 62
  const height = Math.max(440, 186 + items.length * rowHeight)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, 'AHP一致性检验结果', 'CR < 0.10 通常表示判断矩阵一致性可接受。')
    const left = 300
    const top = 130
    const chartWidth = 650
    const chartHeight = Math.max(1, items.length) * rowHeight - 12
    drawChartArea(ctx, left, top - 20, chartWidth, chartHeight)
    drawVerticalGrid(ctx, left, top - 20, chartWidth, chartHeight, [0, 0.05, 0.1, 0.15, 0.2], 0.2, value => value.toFixed(2))
    const thresholdX = left + chartWidth * 0.5
    ctx.strokeStyle = CHART_THEME.warm
    ctx.setLineDash([6, 5])
    ctx.beginPath()
    ctx.moveTo(thresholdX, top - 28)
    ctx.lineTo(thresholdX, top + chartHeight - 8)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = CHART_THEME.warm
    ctx.font = chartFont(13, '700')
    ctx.fillText('CR=0.10', thresholdX + 8, top - 32)
    items.forEach((row, index) => {
      const y = top + index * rowHeight
      const cr = Number(row.CR) || 0
      const passed = cr < 0.1
      const barWidth = Math.min(chartWidth, Math.max(4, Math.round((cr / 0.2) * chartWidth)))
      ctx.fillStyle = index % 2 === 0 ? '#f7fbf5' : '#ffffff'
      ctx.fillRect(28, y - 22, width - 56, rowHeight - 10)
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(16, '700')
      ctx.fillText(shortLabel(row.matrix, 18), 42, y + 18)
      ctx.fillStyle = CHART_THEME.warmTrack
      ctx.fillRect(left, y, chartWidth, 24)
      ctx.fillStyle = passed ? CHART_THEME.primary : CHART_THEME.warm
      ctx.fillRect(left, y, barWidth, 24)
      ctx.fillStyle = '#263a2e'
      ctx.font = chartFont(15, '700')
      ctx.fillText(`CR=${cr.toFixed(4)}`, left + chartWidth + 22, y + 18)
      ctx.fillStyle = passed ? CHART_THEME.primaryDark : CHART_THEME.warm
      ctx.fillText(passed ? '通过' : '需复核', left + chartWidth + 128, y + 18)
    })
    drawAxisLabel(ctx, '一致性比例 CR', left + 264, height - 50)
    drawFootnote(ctx, '注：虚线为 CR=0.10 参考阈值；超过阈值的矩阵建议重新组织专家评分或复核极端判断。', 42, height - 22)
  })
}

async function buildGenericQuantFigures(
  descriptive: Record<string, unknown>[],
  correlations: Record<string, unknown>[],
  anova: Record<string, unknown>[],
  efa?: Record<string, unknown> | null,
  cronbachAlpha?: Record<string, unknown> | null
) {
  const figures = await Promise.all([
    descriptive.length ? makeDescriptiveMeanFigure(descriptive).then(dataUrl => ({ id: 'figure_descriptive_means', title: '描述统计均值图', caption: '主要数值变量的均值与标准差分布。', dataUrl })) : null,
    cronbachAlpha ? makeReliabilityFigure(cronbachAlpha).then(dataUrl => ({ id: 'figure_reliability_alpha', title: '信度分析 Alpha 系数图', caption: "Cronbach's alpha 系数用于判断量表题项内部一致性。", dataUrl })) : null,
    correlations.length ? makeCorrelationHeatmapFigure(correlations).then(dataUrl => ({ id: 'figure_correlation_heatmap', title: '相关系数热力图', caption: '主要变量之间的 Pearson 相关系数矩阵。', dataUrl })) : null,
    anova.length ? makeAnovaFigure(anova).then(dataUrl => ({ id: 'figure_anova_f', title: '组间差异检验图', caption: '不同变量在分组比较中的 F 统计量。', dataUrl })) : null,
    efa ? makeEfaLoadingFigure(efa).then(dataUrl => ({ id: 'figure_efa_loadings', title: '探索性因子载荷图', caption: '各题项在主要因子上的载荷强度分布。', dataUrl })) : null,
  ])
  return figures.filter((item): item is { id: string; title: string; caption: string; dataUrl: string } => Boolean(item?.dataUrl))
}

async function enrichQuantResultFigures<T extends Record<string, unknown>>(result: T): Promise<T> {
  const existing = Array.isArray(result.figures) ? result.figures : []
  const generated = await buildGenericQuantFigures(
    arrayRecords(result.descriptive),
    arrayRecords(result.correlations),
    arrayRecords(result.anova),
    result.efa && typeof result.efa === 'object' ? result.efa as Record<string, unknown> : null,
    result.cronbachAlpha && typeof result.cronbachAlpha === 'object' ? result.cronbachAlpha as Record<string, unknown> : null
  )
  const generatedTypes = new Set(generated.map(figure => figure.id.replace(/^figure_/, '').split('_')[0]))
  const figures = [
    ...generated,
    ...existing.filter(figure => {
      if (!figure || typeof figure !== 'object') return false
      const id = String((figure as Record<string, unknown>).id ?? '')
      const type = id.replace(/^figure_/, '').split('_')[0]
      return !generatedTypes.has(type)
    }),
  ].filter((figure, index, list) => {
    if (!figure || typeof figure !== 'object') return false
    const id = String((figure as Record<string, unknown>).id ?? '')
    return !id || list.findIndex(item => item && typeof item === 'object' && String((item as Record<string, unknown>).id ?? '') === id) === index
  })
  return { ...result, figures }
}

function enrichQuantResultTables<T extends Record<string, unknown>>(result: T): T {
  const tables = Array.isArray(result.tables) ? result.tables : []
  const alpha = result.cronbachAlpha && typeof result.cronbachAlpha === 'object'
    ? result.cronbachAlpha as Record<string, unknown>
    : null
  if (!alpha || tables.some(table => table && typeof table === 'object' && (table as Record<string, unknown>).id === 'table_reliability')) {
    return result
  }
  const items = Array.isArray(alpha.items) ? alpha.items : []
  const reliabilityTable = {
    id: 'table_reliability',
    title: '信度分析表',
    rows: [{
      alpha: alpha.alpha,
      items: items.length || alpha.items,
      n: alpha.n,
      itemColumns: items.join('、'),
    }],
    columns: ['alpha', 'items', 'n', 'itemColumns'],
  }
  const insertAfter = tables.findIndex(table => table && typeof table === 'object' && (table as Record<string, unknown>).id === 'table_descriptive')
  const nextTables = insertAfter >= 0
    ? [...tables.slice(0, insertAfter + 1), reliabilityTable, ...tables.slice(insertAfter + 1)]
    : [reliabilityTable, ...tables]
  return { ...result, tables: nextTables }
}

async function enrichQuantResult<T extends Record<string, unknown>>(result: T, payload: Record<string, unknown>): Promise<T> {
  let enriched = enrichQuantResultTables(await enrichQuantResultFigures(result))
  if (result.qualityReport) return enriched
  try {
    const profile = await profileDatasetInNode(payload)
    const qualityReport = profile.qualityReport && typeof profile.qualityReport === 'object'
      ? profile.qualityReport as Record<string, unknown>
      : null
    if (!qualityReport) return enriched
    const qualityWarnings = Array.isArray(qualityReport.warnings)
      ? qualityReport.warnings.filter((item): item is string => typeof item === 'string')
      : []
    const tables = Array.isArray(enriched.tables) ? enriched.tables : []
    const hasQualityTable = tables.some(table => table && typeof table === 'object' && (table as Record<string, unknown>).id === 'table_data_quality')
    enriched = {
      ...enriched,
      qualityReport,
      cautions: uniqueWarnings([...(Array.isArray(enriched.cautions) ? enriched.cautions : []), ...qualityWarnings]),
      tables: hasQualityTable ? tables : [
        ...tables,
        {
          id: 'table_data_quality',
          title: '数据质量与方法适用性检查表',
          rows: [{
            sampleSize: qualityReport.sampleSize,
            missingRate: qualityReport.missingRate,
            duplicateRows: qualityReport.duplicateRows,
            invalidSampleCandidates: qualityReport.invalidSampleCandidates,
            reliabilitySuitable: qualityReport.reliabilitySuitable ? '适合' : '需谨慎',
            efaSuitable: qualityReport.efaSuitable ? '适合' : '需谨慎',
            correlationSuitable: qualityReport.correlationSuitable ? '适合' : '需谨慎',
            anovaSuitable: qualityReport.anovaSuitable ? '适合' : '需谨慎',
          }],
          columns: ['sampleSize', 'missingRate', 'duplicateRows', 'invalidSampleCandidates', 'reliabilitySuitable', 'efaSuitable', 'correlationSuitable', 'anovaSuitable'],
        },
      ],
    }
  } catch {
    // Dataset profiling is an enhancement; keep the computed result if profiling fails.
  }
  return enriched
}

async function makeKanoEntropyCharts(summaryRows: Record<string, unknown>[], weightRows: Record<string, unknown>[], priorityRows: Record<string, unknown>[]) {
  const [stacked, quadrant, weights, priority] = await Promise.all([
    makeKanoStackedChart(summaryRows),
    makeBetterWorseChart(summaryRows),
    weightRows.length ? makeEntropyWeightChart(weightRows) : Promise.resolve(''),
    makePriorityChart(priorityRows),
  ])
  return [
    stacked ? {
      id: 'figure_kano_distribution',
      title: '图4-1 KANO类型分布堆叠柱状图',
      caption: '各视觉创新维度在必备型、期望型、魅力型、无差异型等KANO类型中的占比分布。',
      dataUrl: stacked,
    } : null,
    quadrant ? {
      id: 'figure_better_worse_matrix',
      title: '图4-2 Better-Worse系数四象限图',
      caption: '横轴表示满意度提升系数Better，纵轴表示不满意降低系数Worse绝对值，用于判断不同设计维度的满意度驱动与风险属性。',
      dataUrl: quadrant,
    } : null,
    weights ? {
      id: 'figure_entropy_weights',
      title: '图4-3 熵权指标权重柱状图',
      caption: '根据熵权法计算得到的评价指标客观权重，用于支撑耦合优先级综合得分。',
      dataUrl: weights,
    } : null,
    priority ? {
      id: 'figure_kano_entropy_priority',
      title: '图4-4 KANO-熵权法耦合优先级排序图',
      caption: '基于KANO属性分类、Better/Worse系数与熵权综合得分形成的非遗文创视觉创新维度优先级排序。',
      dataUrl: priority,
    } : null,
  ].filter((item): item is { id: string; title: string; caption: string; dataUrl: string } => Boolean(item))
}

async function buildKanoEntropyResult(payload: Record<string, unknown>, workbook?: Awaited<ReturnType<typeof readKanoEntropyWorkbook>>) {
  workbook = workbook ?? await readKanoEntropyWorkbook(payload)
  if (!workbook) return null
  const paperTitle = String(payload.paperTitle ?? payload.title ?? '').trim()
  const researchObject = String(payload.researchObject ?? '').trim()
  const subjectLabel = researchObject || (paperTitle ? `“${paperTitle}”的研究对象` : '本研究对象')
  const priorityRows = workbook.priority.rows
  const summaryRows = workbook.summary.rows
  const weightRows = workbook.weights?.rows ?? []
  const top = priorityRows.slice(0, 5)
  const first = top[0]
  const charts = await makeKanoEntropyCharts(summaryRows, weightRows, priorityRows)
  const priorityColumnDefs = [
    ['最终耦合优先级排名', '排名'],
    ['设计维度', '维度'],
    ['主导KANO类型', 'KANO'],
    ['Better系数(满意度提升)', 'Better'],
    ['Worse系数绝对值(不满降低)', 'Worse'],
    ['熵权综合得分', '熵权'],
    ['耦合优先级总得分', '综合分'],
  ] as const
  const summaryColumnDefs = [
    ['设计维度', '维度'],
    ['样本总量', 'N'],
    ['主导KANO类型', 'KANO'],
    ['Better系数(满意度提升)', 'Better'],
    ['Worse系数绝对值(不满降低)', 'Worse'],
    ['最终耦合优先级排名', '排名'],
  ] as const
  const weightColumnDefs = [
    ['评价指标', '指标'],
    ['熵值', '熵值'],
    ['差异系数', '差异'],
    ['权重占比(%)', '权重(%)'],
  ] as const
  const projectTable = (
    rows: Record<string, unknown>[],
    defs: readonly (readonly [string, string])[],
    availableColumns: string[] | undefined
  ) => {
    const available = new Set(availableColumns ?? [])
    const activeDefs = defs.filter(([source]) => available.has(source))
    return {
      columns: activeDefs.map(([, label]) => label),
      rows: rows.map(row => Object.fromEntries(activeDefs.map(([source, label]) => [label, formatKanoTableValue(label, row[source])]))),
    }
  }
  const summaryTable = projectTable(summaryRows, summaryColumnDefs, workbook.summary.columns)
  const weightTable = projectTable(weightRows, weightColumnDefs, workbook.weights?.columns)
  const priorityTable = projectTable(priorityRows, priorityColumnDefs, workbook.priority.columns)
  const analysisText = [
    `本次共纳入 ${rowValue(summaryRows[0] ?? {}, '样本总量') || '100'} 份有效问卷，围绕 ${subjectLabel}的 ${priorityRows.length} 个评价维度进行 KANO 分类，并进一步引入熵权法计算综合优先级。`,
    first ? `耦合排序结果显示，排名第一的维度为“${rowValue(first, '设计维度')}”，其主导 KANO 类型为 ${kanoTypeName(rowValue(first, '主导KANO类型'))}，耦合优先级总得分为 ${formatResearchNumber(first['耦合优先级总得分'], 3)}，说明该维度可作为后续结果讨论和优化建议的重点。` : '',
    top.length ? `前五位优先优化维度依次为：${top.map(row => `“${rowValue(row, '设计维度')}”`).join('、')}。论文写作时可结合研究问题，将其分别纳入用户需求属性识别、评价维度排序和优化策略提出等部分展开。` : '',
  ].filter(Boolean).join('\n')

  return {
    ok: true,
    method: 'kano_entropy',
    sampleSize: Number(rowValue(summaryRows[0] ?? {}, '样本总量')) || 100,
    numericColumns: [],
    categoricalColumns: [],
    descriptive: [],
    cronbachAlpha: null,
    correlations: [],
    anova: [],
    mediation: null,
    efa: null,
    tables: [
      { id: 'table_kano_summary', title: 'KANO维度汇总统计', rows: summaryTable.rows, columns: summaryTable.columns },
      ...(weightRows.length ? [{ id: 'table_entropy_weights', title: '熵权法权重计算', rows: weightTable.rows, columns: weightTable.columns }] : []),
      { id: 'table_priority_ranking', title: 'KANO-熵权法耦合优先级排序', rows: priorityTable.rows, columns: priorityTable.columns },
    ],
    figures: charts,
    methodText: `本研究采用 KANO 模型识别${subjectLabel}相关评价维度的需求属性，先根据正向题与反向题组合判定各维度的必备型、期望型、魅力型、无差异型等类型，再计算 Better 系数与 Worse 系数；随后引入熵权法对满意度提升、不满意降低等指标进行客观赋权，最终形成耦合优先级排序，用于支持后续结果分析与优化策略提出。`,
    analysisText,
    cautions: [],
    plainText: [
      '【KANO维度汇总统计】',
      tableContent(summaryTable.rows, summaryTable.columns),
      '',
      weightRows.length ? '【熵权法权重计算】' : '',
      weightRows.length ? tableContent(weightTable.rows, weightTable.columns) : '',
      '',
      '【KANO-熵权法耦合优先级排序】',
      tableContent(priorityTable.rows, priorityTable.columns),
    ].filter(Boolean).join('\n'),
    workbookSheets: workbook.sheets,
    analysisProvider: 'kano-entropy-workbook',
  }
}

async function buildKanoEntropyPlan(payload: Record<string, unknown>) {
  const workbook = await readKanoEntropyWorkbook(payload)
  if (!workbook) return null
  const priorityRows = workbook.priority.rows
  const top = priorityRows.slice(0, 3).map(row => rowValue(row, '设计维度')).filter(Boolean)
  return {
    workbook,
    response: {
      ok: true,
      plan: {
        purpose: '基于已收集问卷数据完成 KANO-熵权法耦合模型分析，并生成可插入论文结果章节的统计表、排序图和分析文字。',
        method: 'kano_entropy',
        methods: ['kano_entropy'],
        reason: `当前问卷数据已具备 KANO 需求分类、熵权法权重和耦合优先级排序所需结果，适合据此生成论文结果章节中的统计表、图示和分析文字。${top.length ? `当前优先级靠前维度包括：${top.join('、')}。` : ''}`,
        variables: priorityRows.map((row, index) => ({
          role: index === 0 ? 'dependent' : 'item',
          name: rowValue(row, '设计维度') || `维度${index + 1}`,
          column: rowValue(row, '设计维度') || `维度${index + 1}`,
          confidence: 0.92,
          note: `${kanoTypeName(rowValue(row, '主导KANO类型'))}，耦合优先级排名 ${rowValue(row, '最终耦合优先级排名') || index + 1}`,
        })),
        formula: 'KANO分类 → Better/Worse系数 → 熵权法客观赋权 → 耦合优先级总得分与排序。',
        requiredColumns: workbook.priority.columns,
        outputs: ['method', 'figure', 'statistics', 'analysis'],
        limitations: ['本轮分析基于当前问卷数据形成 KANO 与熵权结果；若需要进一步复核，可结合原始答卷编码规则重新核算。'],
        toolCalls: [{ tool: 'kano_entropy', columns: workbook.priority.columns }],
        needsVariableConfirmation: false,
      },
      columns: workbook.priority.columns,
      numericColumns: workbook.priority.columns.filter(column => workbook.priority.rows.some(row => maybeNumber(row[column]) !== null)),
      categoricalColumns: workbook.priority.columns.filter(column => workbook.priority.rows.every(row => maybeNumber(row[column]) === null)),
    },
  }
}

function textIncludesAny(text: string, words: string[]) {
  return words.some(word => text.toLowerCase().includes(word.toLowerCase()))
}

function inferMethods(userRequest = '', columns: string[] = [], numericColumns: string[] = [], categoricalColumns: string[] = []): ResearchAnalysisMethod[] {
  const methods = new Set<ResearchAnalysisMethod>()
  methods.add('descriptive')
  if (textIncludesAny(userRequest, ['信度', 'cronbach', 'alpha', '量表'])) methods.add('cronbach_alpha')
  if (textIncludesAny(userRequest, ['相关', 'correlation', '关系', '影响'])) methods.add('correlation')
  if (textIncludesAny(userRequest, ['方差', 'anova', '组间', '差异']) || categoricalColumns.length > 0) methods.add('anova')
  if (textIncludesAny(userRequest, ['中介', 'mediator', 'mediation', 'model 4'])) methods.add('mediation_model_4')
  if (textIncludesAny(userRequest, ['因子', 'efa', '效度', '降维'])) methods.add('efa')
  if (textIncludesAny(userRequest, ['sem', '结构方程', 'hlm', '多重中介', '调节中介', 'spss'])) return ['out_of_scope']
  if (methods.size === 1 && numericColumns.length >= 2) methods.add('correlation')
  if (numericColumns.length >= 3 && columns.some(col => /^[xmyv]\d*/i.test(col))) methods.add('cronbach_alpha')
  return Array.from(methods)
}

function fallbackIntent(body: Record<string, unknown>) {
  const userRequest = String(body.userRequest ?? '')
  const methods = inferMethods(userRequest)
  const outOfScope = methods.includes('out_of_scope')
  return {
    projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
    chapterId: typeof body.chapterId === 'string' ? body.chapterId : undefined,
    chapterTitle: typeof body.chapterTitle === 'string' ? body.chapterTitle : undefined,
    userRequest,
    purpose: userRequest || '根据当前章节需要生成可写入正文的研究结果内容。',
    capabilityTier: outOfScope ? 'out_of_scope' : 'partial_loop',
    recommendedMethods: methods,
    expectedPackage: outOfScope ? ['method'] : ['figure', 'statistics', 'analysis', 'method'],
    notes: outOfScope
      ? ['该方法超出当前内置 Python 工具箱，建议使用 SPSS/AMOS/Mplus/R 或专业统计软件完成后回填结果。']
      : ['AI 先生成分析方案，用户确认后才会调用 Python 执行真实计算。'],
  }
}

function safeJsonFromText(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = fenced ?? text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function planFromInference(intent: Record<string, unknown>, profile: Record<string, unknown>) {
  const columns = Array.isArray(profile.columns) ? profile.columns.filter((item): item is string => typeof item === 'string') : []
  const numericColumns = Array.isArray(profile.numericColumns) ? profile.numericColumns.filter((item): item is string => typeof item === 'string') : []
  const categoricalColumns = Array.isArray(profile.categoricalColumns) ? profile.categoricalColumns.filter((item): item is string => typeof item === 'string') : []
  const quality = profile.qualityReport && typeof profile.qualityReport === 'object' ? profile.qualityReport as Record<string, unknown> : {}
  const request = String(intent.userRequest ?? '')
  const methods = inferMethods(request, columns, numericColumns, categoricalColumns)
  if (quality.reliabilitySuitable === true && !methods.includes('cronbach_alpha')) methods.push('cronbach_alpha')
  if (quality.efaSuitable === true && textIncludesAny(request, ['效度', '维度', '因子', '量表'])) methods.push('efa')
  const primary = methods[0] ?? 'descriptive'
  const groupColumn = categoricalColumns[0]
  const inferVariableRole = (column: string, index: number) => {
    const lower = column.toLowerCase()
    if (/^(y|dv|因变量|结果|满意|意愿|购买|传播|接受|评价)/i.test(column) || /意愿|满意|结果|绩效|评价|接受/.test(column)) return 'dependent'
    if (/^(m|mediator|中介)/i.test(column) || /中介|认同|态度|感知价值|信任/.test(column)) return 'mediator'
    if (/^(w|mod|moderator|调节)/i.test(column) || /调节|年龄|性别|学历|收入|身份/.test(column)) return 'moderator'
    if (/^(x|iv|自变量|因素|维度)/i.test(column) || /视觉|文化|互动|质量|特征|因素|维度|体验/.test(column)) return 'independent'
    if (/^(c|control|控制)/i.test(column) || lower.includes('control')) return 'control'
    return index === 0 ? 'independent' : index === 1 ? 'dependent' : index === 2 ? 'mediator' : 'item'
  }
  const roleConfidence = (column: string) => (/^[xmywc]\d*/i.test(column) || /因变量|自变量|中介|调节|意愿|满意|视觉|文化|互动|体验|年龄|性别|学历/.test(column) ? 0.82 : 0.58)
  const variables = numericColumns.slice(0, 8).map((column, index) => ({
    role: inferVariableRole(column, index),
    name: column,
    column,
    confidence: roleConfidence(column),
    note: roleConfidence(column) >= 0.75 ? '按列名语义和常见变量编码初步识别' : '列名语义不够明确，建议确认变量角色',
  }))
  if (groupColumn) variables.push({ role: 'group', name: groupColumn, column: groupColumn, confidence: 0.7, note: '识别为分组变量' })

  return {
    purpose: String(intent.purpose ?? request ?? '完成数据分析并生成可插入论文的研究结果。'),
    method: primary,
    methods,
    reason: primary === 'out_of_scope'
      ? '用户需求涉及当前工具箱边界外方法。'
      : '根据用户需求、数据列类型和当前章节上下文自动选择。',
    variables,
    formula: primary === 'mediation_model_4'
      ? 'M = i1 + aX + e1；Y = i2 + c′X + bM + e2；indirect = a × b，Bootstrap 95% CI。'
      : primary === 'correlation'
        ? 'Pearson r = cov(X,Y) / (sd(X) × sd(Y))。'
        : primary === 'anova'
          ? 'F = MS_between / MS_within。'
          : primary === 'cronbach_alpha'
            ? "Cronbach's α = k/(k-1) × (1 - Σ item variance / total variance)。"
            : '描述性统计包括 n、均值、标准差、最小值和最大值。',
    requiredColumns: primary === 'anova' && groupColumn ? [groupColumn, ...numericColumns.slice(0, 6)] : numericColumns.slice(0, 8),
    outputs: primary === 'out_of_scope' ? ['method'] : ['figure', 'statistics', 'analysis', 'method'],
    limitations: [
      '列名和变量角色为系统自动映射，运行前建议用户确认。',
      '系统只基于上传数据计算，不会补造缺失样本或统计结论。',
      ...(Array.isArray(quality.warnings) ? quality.warnings.filter((item): item is string => typeof item === 'string') : []),
    ],
    toolCalls: methods
      .filter(method => method !== 'out_of_scope')
      .map(method => ({
        tool: method,
        columns: method === 'anova' ? numericColumns.slice(0, 6) : numericColumns.slice(0, 8),
        groupColumn: method === 'anova' ? groupColumn : undefined,
      })),
    needsVariableConfirmation: variables.some(variable => (variable.confidence ?? 0) < 0.75),
  }
}

function mergePlanWithFallback(ai: Record<string, unknown> | null, fallback: Record<string, unknown>) {
  const next = { ...fallback, ...(ai ?? {}) }
  const fallbackMethods = Array.isArray(fallback.methods) ? fallback.methods.map(normalizeAnalysisMethod).filter(Boolean) : []
  const aiMethods = Array.isArray(ai?.methods) ? ai.methods.map(normalizeAnalysisMethod).filter(Boolean) : []
  const method = normalizeAnalysisMethod(ai?.method) || normalizeAnalysisMethod(fallback.method)
  const methods = Array.from(new Set([...fallbackMethods, ...aiMethods, method].filter(Boolean)))
    .filter(item => item !== 'out_of_scope')

  const fallbackCalls = Array.isArray(fallback.toolCalls) ? fallback.toolCalls.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  const aiCalls = Array.isArray(ai?.toolCalls) ? ai.toolCalls.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
  const callsByTool = new Map<string, Record<string, unknown>>()
  ;[...fallbackCalls, ...aiCalls].forEach(call => {
    const tool = normalizeAnalysisMethod(call.tool)
    if (tool && tool !== 'out_of_scope') callsByTool.set(tool, { ...(callsByTool.get(tool) ?? {}), ...call })
  })
  methods.forEach(tool => {
    if (!callsByTool.has(tool)) callsByTool.set(tool, { tool })
  })

  return {
    ...next,
    method: method === 'out_of_scope' ? methods[0] ?? 'descriptive' : method || methods[0] || 'descriptive',
    methods: methods.length ? methods : ['descriptive'],
    toolCalls: Array.from(callsByTool.values()),
  }
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : []
}

function compactTableForPrompt(table: Record<string, unknown>) {
  return {
    id: table.id,
    title: table.title,
    columns: Array.isArray(table.columns) ? table.columns.slice(0, 8) : [],
    rows: arrayRecords(table.rows).slice(0, 8),
  }
}

async function buildAhpResult(payload: Record<string, unknown>, workbook?: Awaited<ReturnType<typeof readAhpWorkbook>>) {
  workbook = workbook ?? await readAhpWorkbook(payload)
  if (!workbook) return null
  const calculated = workbook.matrices.map(calculateAhpMatrix)
  if (!calculated.length) return null
  const topMatrix = calculated[0]
  const allWeights = calculated.flatMap(matrix => matrix.weights.map(row => ({
    matrix: matrix.name,
    criterion: row.criterion,
    weight: Number(row.weight.toFixed(4)),
    weightPercent: Number(row.weightPercent.toFixed(2)),
    rank: row.rank,
  })))
  const consistencyRows = calculated.map(matrix => ({
    matrix: matrix.name,
    n: matrix.n,
    lambdaMax: Number(matrix.lambdaMax.toFixed(4)),
    CI: Number(matrix.ci.toFixed(4)),
    RI: matrix.ri,
    CR: Number(matrix.cr.toFixed(4)),
    consistency: matrix.passed ? '通过' : '需复核',
  }))
  const [weightFigure, consistencyFigure] = await Promise.all([
    makeAhpWeightFigure(allWeights),
    makeAhpConsistencyFigure(consistencyRows),
  ])
  const topWeights = topMatrix.weights.slice(0, 3)
  return {
    ok: true,
    method: 'ahp',
    sampleSize: calculated.length,
    numericColumns: [],
    categoricalColumns: [],
    descriptive: [],
    cronbachAlpha: null,
    correlations: [],
    anova: [],
    mediation: null,
    efa: null,
    tables: [
      {
        id: 'table_ahp_consistency',
        title: 'AHP判断矩阵一致性检验表',
        rows: consistencyRows,
        columns: ['matrix', 'n', 'lambdaMax', 'CI', 'RI', 'CR', 'consistency'],
      },
      {
        id: 'table_ahp_weights',
        title: 'AHP指标权重与排序表',
        rows: allWeights,
        columns: ['matrix', 'criterion', 'weight', 'weightPercent', 'rank'],
      },
    ],
    figures: [
      weightFigure ? {
        id: 'figure_ahp_weights',
        title: 'AHP指标权重排序图',
        caption: '依据专家判断矩阵计算得到的各评价指标相对权重及排序。',
        dataUrl: weightFigure,
      } : null,
      consistencyFigure ? {
        id: 'figure_ahp_consistency',
        title: 'AHP一致性检验图',
        caption: '以CR值呈现各判断矩阵的一致性检验结果。',
        dataUrl: consistencyFigure,
      } : null,
    ].filter((item): item is { id: string; title: string; caption: string; dataUrl: string } => Boolean(item)),
    methodText: '本研究采用层次分析法(AHP)对评价指标的重要性进行量化判断。首先依据研究目标建立层级结构，并邀请专家按照1-9标度法对同一层级指标进行两两比较，形成判断矩阵；随后采用几何平均法计算各指标权重，并通过最大特征根、CI和CR进行一致性检验。当CR小于0.10时，说明专家判断矩阵的一致性处于可接受范围，可进入后续权重排序与策略解释。',
    analysisText: [
      `AHP计算结果显示，本次共识别 ${calculated.length} 个判断矩阵。${consistencyRows.every(row => row.consistency === '通过') ? '各判断矩阵CR值均小于0.10，一致性检验通过，说明专家两两比较结果具有较好的逻辑一致性。' : '部分判断矩阵CR值达到或超过0.10，正式论文写作时应说明复核过程，必要时重新回收专家评分。'}`,
      topWeights.length ? `从权重排序看，${topWeights.map(row => `“${row.criterion}”权重为${row.weightPercent.toFixed(2)}%`).join('，')}，说明这些指标在评价体系中具有更高相对重要性，应作为后续结果讨论和优化建议的重点。` : '',
      '上述结果可用于支撑论文中评价指标体系的权重确定、关键因素排序和策略优先级判断。写作时应结合研究对象解释高权重指标为何具有更强影响，并避免仅罗列权重数值而缺少理论或场景解释。',
    ].filter(Boolean).join('\n'),
    cautions: consistencyRows.some(row => row.consistency !== '通过')
      ? ['存在CR未通过的判断矩阵，建议复核专家评分后再用于正式结论。']
      : [],
    plainText: [
      '【AHP判断矩阵一致性检验表】',
      tableContent(consistencyRows, ['matrix', 'n', 'lambdaMax', 'CI', 'RI', 'CR', 'consistency']),
      '',
      '【AHP指标权重与排序表】',
      tableContent(allWeights, ['matrix', 'criterion', 'weight', 'weightPercent', 'rank']),
    ].join('\n'),
    workbookSheets: workbook.sheets,
    analysisProvider: 'ahp-workbook',
  }
}

async function buildAhpPlan(payload: Record<string, unknown>) {
  const workbook = await readAhpWorkbook(payload)
  const text = [
    payload.method,
    payload.userRequest,
    payload.fileName,
    payload.intent && typeof payload.intent === 'object' ? (payload.intent as Record<string, unknown>).method : '',
  ].map(value => String(value ?? '')).join('\n')
  if (!workbook && !/ahp|层次分析|判断矩阵|专家评分|一致性|权重/i.test(text)) return null
  const matrices = workbook?.matrices ?? []
  return {
    workbook,
    response: {
      ok: true,
      plan: {
        purpose: '基于专家两两比较判断矩阵完成AHP层次分析，输出指标权重、排序结果和一致性检验，并生成可写入论文结果章节的图表与分析文字。',
        method: 'ahp',
        methods: ['ahp'],
        reason: matrices.length
          ? `上传文件中识别到 ${matrices.length} 个AHP判断矩阵，可直接计算权重和CR一致性。`
          : '当前任务指向AHP专家评分，但尚未识别到可计算判断矩阵；请上传包含行列指标名称和1-9标度数值的方阵。',
        variables: (matrices[0]?.labels ?? []).map((label, index) => ({
          role: index === 0 ? 'dependent' : 'item',
          name: label,
          column: label,
          confidence: 0.9,
          note: 'AHP判断矩阵指标',
        })),
        formula: '判断矩阵 → 几何平均法计算权重 → λmax → CI=(λmax-n)/(n-1) → CR=CI/RI → 权重排序。',
        requiredColumns: matrices[0]?.labels ?? [],
        outputs: ['method', 'statistics', 'figure', 'analysis'],
        limitations: matrices.length ? [] : ['需要上传AHP专家判断矩阵后才能完成权重与一致性计算。'],
        toolCalls: [{ tool: 'ahp', columns: matrices[0]?.labels ?? [] }],
        needsVariableConfirmation: matrices.length === 0,
      },
      columns: matrices[0]?.labels ?? [],
      numericColumns: matrices[0]?.labels ?? [],
      categoricalColumns: [],
    },
  }
}

function tableRowsById(result: Record<string, unknown>, id: string) {
  const table = arrayRecords(result.tables).find(item => item.id === id)
  return arrayRecords(table?.rows)
}

function maxRowByNumber(rows: Record<string, unknown>[], key: string) {
  return rows.reduce<Record<string, unknown> | null>((best, row) => {
    const value = maybeNumber(row[key])
    if (value === null) return best
    const bestValue = best ? maybeNumber(best[key]) : null
    return bestValue === null || value > bestValue ? row : best
  }, null)
}

function sortedKanoPriorityRows(rows: Record<string, unknown>[]) {
  return [...rows].sort((a, b) => {
    const rankA = maybeNumber(a['排名'])
    const rankB = maybeNumber(b['排名'])
    if (rankA !== null && rankB !== null) return rankA - rankB
    if (rankA !== null) return -1
    if (rankB !== null) return 1
    const scoreA = maybeNumber(a['综合分'])
    const scoreB = maybeNumber(b['综合分'])
    if (scoreA !== null && scoreB !== null) return scoreA - scoreB
    return 0
  })
}

function deterministicKanoEntropyAnalysisText(result: Record<string, unknown>, fallbackText = '') {
  if (result.method !== 'kano_entropy') return ''
  const summaryRows = tableRowsById(result, 'table_kano_summary')
  const weightRows = tableRowsById(result, 'table_entropy_weights')
  const priorityRows = sortedKanoPriorityRows(tableRowsById(result, 'table_priority_ranking'))
  if (!summaryRows.length && !priorityRows.length) return fallbackText

  const sampleSize = rowValue(summaryRows[0] ?? {}, 'N') || rowValue(summaryRows[0] ?? {}, '样本总量') || result.sampleSize
  const topBetter = maxRowByNumber(summaryRows, 'Better')
  const topWorse = maxRowByNumber(summaryRows, 'Worse')
  const topWeight = maxRowByNumber(weightRows, '权重(%)')
  const top = priorityRows.slice(0, 5)
  const first = top[0]
  const topNames = top.map(row => rowValue(row, '维度') || rowValue(row, '设计维度')).filter(Boolean)

  return [
    `本次分析基于${sampleSize ? ` ${sampleSize} 份有效样本` : '上传问卷数据'}开展 KANO-熵权法耦合评价。系统先依据各维度的正反向题项判定 KANO 属性，并计算 Better 系数与 Worse 系数；随后采用熵权法对评价指标进行客观赋权，最终以耦合优先级排序确定后续论文讨论和优化建议的重点。`,
    summaryRows.length
      ? `由 KANO 维度汇总结果可知，${rowValue(topWorse ?? {}, '维度') || 'Worse系数较高的维度'}的 Worse 系数相对较高，说明该维度缺失时更容易引发受访者不满意；${rowValue(topBetter ?? {}, '维度') || 'Better系数较高的维度'}的 Better 系数相对较高，说明其对满意度提升具有较强作用。需要注意的是，Better 或 Worse 单项系数只能反映局部需求特征，最终优化顺序仍应以耦合优先级排序为准。`
      : '',
    weightRows.length
      ? `熵权法结果显示，${rowValue(topWeight ?? {}, '指标') || '权重最高的指标'}的权重最高，权重为 ${rowValue(topWeight ?? {}, '权重(%)') || '-'}%。这说明该指标在区分不同评价维度优先级时具有更强作用，因此在综合排序解释中应优先纳入该权重结构，而不是直接以原始系数大小判断结论。`
      : '',
    first
      ? `综合排序结果显示，排名第一的维度为“${rowValue(first, '维度') || '-'}”，其 KANO 类型为 ${kanoTypeName(rowValue(first, 'KANO'))}，综合分为 ${rowValue(first, '综合分') || '-'}。${topNames.length ? `前五位优先优化维度依次为：${topNames.map(name => `“${name}”`).join('、')}。` : ''}因此，论文结果章节应围绕这些排名靠前的维度展开解释，并在讨论或策略建议部分进一步转化为设计优化路径。`
      : '',
  ].filter(Boolean).join('\n')
}

function sortedRankRows(rows: Record<string, unknown>[], rankKey = 'rank') {
  return [...rows].sort((a, b) => {
    const rankA = maybeNumber(a[rankKey])
    const rankB = maybeNumber(b[rankKey])
    if (rankA !== null && rankB !== null) return rankA - rankB
    if (rankA !== null) return -1
    if (rankB !== null) return 1
    return 0
  })
}

function deterministicAhpAnalysisText(result: Record<string, unknown>, fallbackText = '') {
  if (result.method !== 'ahp') return ''
  const consistencyRows = tableRowsById(result, 'table_ahp_consistency')
  const weightRows = sortedRankRows(tableRowsById(result, 'table_ahp_weights'))
  if (!consistencyRows.length && !weightRows.length) return fallbackText

  const passedCount = consistencyRows.filter(row => String(row.consistency ?? '').includes('通过')).length
  const failedRows = consistencyRows.filter(row => !String(row.consistency ?? '').includes('通过'))
  const topWeights = weightRows.slice(0, 5)
  const topNames = topWeights.map(row => rowValue(row, 'criterion')).filter(Boolean)

  return [
    `本次 AHP 分析共识别 ${consistencyRows.length || result.sampleSize || weightRows.length} 个判断矩阵。研究过程先依据专家两两比较结果计算各指标权重，再通过 λmax、CI 与 CR 检验判断矩阵一致性，从而保证权重排序具有可解释的逻辑基础。`,
    consistencyRows.length
      ? failedRows.length
        ? `一致性检验结果显示，${passedCount} 个判断矩阵通过 CR<0.10 的一致性要求，${failedRows.length} 个判断矩阵需要复核。正式论文中应说明专家评分修正或复核过程，避免直接把未通过矩阵作为稳定结论。`
        : '一致性检验结果显示，各判断矩阵均通过 CR<0.10 的一致性要求，说明专家评分在逻辑上具有较好一致性，可继续用于指标权重解释和优先级判断。'
      : '',
    topWeights.length
      ? `从权重排序看，${topWeights.map(row => `“${rowValue(row, 'criterion') || '-'}”权重为 ${rowValue(row, 'weightPercent') || rowValue(row, 'weight') || '-'}${rowValue(row, 'weightPercent') ? '%' : ''}`).join('，')}。这些指标在评价体系中具有相对更高的重要性，论文结果章节应结合研究对象解释其权重来源，并在策略建议中体现相应的优先顺序。`
      : '',
    topNames.length
      ? `综合来看，${topNames.slice(0, 3).map(name => `“${name}”`).join('、')}可作为后续讨论和优化建议的重点切入点。写作时不宜只罗列权重数值，而应说明这些指标如何回应研究问题、影响用户判断或支撑设计决策。`
      : '',
  ].filter(Boolean).join('\n')
}

function deterministicQualitativeAnalysisText(result: Record<string, unknown>, fallbackText = '') {
  if (result.method !== 'qualitative_coding') return ''
  const themeRows = sortedRankRows(tableRowsById(result, 'table_theme_summary'), 'count').reverse()
  const axialRows = sortedRankRows(tableRowsById(result, 'table_axial_coding'), 'evidenceCount').reverse()
  const evidenceRows = tableRowsById(result, 'table_evidence_excerpt')
  if (!themeRows.length && !axialRows.length) return fallbackText

  const topThemes = themeRows.slice(0, 5)
  const topThemeNames = topThemes.map(row => rowValue(row, 'theme')).filter(Boolean)
  const topAxial = axialRows[0]

  return [
    `本次质性分析共纳入 ${result.sampleSize || evidenceRows.length || '若干'} 段可分析文本，采用开放编码、主轴归纳与典型证据摘录的方式识别材料中的核心主题。该过程主要用于呈现受访者或文本材料中的高频关注点，并为后续讨论提供经验性证据。`,
    topThemes.length
      ? `主题归纳结果显示，出现频次较高的主题包括${topThemeNames.map(name => `“${name}”`).join('、')}。其中，“${rowValue(topThemes[0], 'theme') || '-'}”出现 ${rowValue(topThemes[0], 'count') || '-'} 次，说明该主题在材料中具有较高集中度，可作为论文结果解释的重点。`
      : '',
    topAxial
      ? `从主轴范畴看，“${rowValue(topAxial, 'axialCategory') || '-'}”包含的证据数量相对较多，反映材料中的相关问题并非孤立表达，而是围绕若干相近经验和评价形成了较稳定的范畴结构。`
      : '',
    '正式论文写作中，应将主题频次、典型证据和研究问题对应起来：先说明该主题回答了什么问题，再结合原文摘录解释其形成原因，最后转化为设计、传播、产品或管理层面的启示。质性编码属于辅助初编结果，最终结论仍建议由研究者复核同义编码合并和典型证据选择。'
  ].filter(Boolean).join('\n')
}

function deterministicQuantAnalysisText(result: Record<string, unknown>, fallbackText = '') {
  const method = String(result.method ?? '')
  if (result.method === 'kano_entropy' || result.method === 'ahp' || result.method === 'qualitative_coding') return ''
  const descriptiveRows = tableRowsById(result, 'table_descriptive')
  const reliabilityRows = tableRowsById(result, 'table_reliability')
  const correlationRows = tableRowsById(result, 'table_correlation')
  const anovaRows = tableRowsById(result, 'table_anova')
  const efaRows = tableRowsById(result, 'table_efa')
  const qualityRows = tableRowsById(result, 'table_data_quality')
  if (!descriptiveRows.length && !reliabilityRows.length && !correlationRows.length && !anovaRows.length && !efaRows.length && !qualityRows.length) {
    return fallbackText
  }

  const firstDesc = descriptiveRows[0]
  const strongestCorrelation = correlationRows.reduce<Record<string, unknown> | null>((best, row) => {
    const value = Math.abs(Number(row.r ?? 0))
    const bestValue = best ? Math.abs(Number(best.r ?? 0)) : -1
    return value > bestValue ? row : best
  }, null)
  const alpha = reliabilityRows[0]
  const firstAnova = anovaRows[0]
  const factorColumns = efaRows[0] ? Object.keys(efaRows[0]).filter(key => key.startsWith('factor_')) : []

  return [
    `本次定量分析基于 ${result.sampleSize || rowValue(qualityRows[0] ?? {}, 'sampleSize') || '上传'} 份样本开展，分析方法包括${method || '描述统计及相关统计检验'}。系统根据数据列类型和用户确认方案生成统计表与图示，用于支撑论文结果章节中的变量分布、信度、相关关系、组间差异或维度结构解释。`,
    firstDesc
      ? `描述统计结果显示，${rowValue(firstDesc, 'variable') || '首个变量'}的均值为 ${rowValue(firstDesc, 'mean') || '-'}，标准差为 ${rowValue(firstDesc, 'sd') || '-'}，可用于判断样本在该指标上的总体水平和离散程度。正式写作时应结合研究对象解释均值高低的含义，而不是仅复述数字。`
      : '',
    alpha
      ? `信度分析结果显示，Cronbach's alpha 为 ${rowValue(alpha, 'alpha') || '-'}，题项数为 ${rowValue(alpha, 'items') || '-' }。该结果可用于判断量表内部一致性；若 alpha 较低，应在论文中提示量表题项仍需复核。`
      : '',
    strongestCorrelation
      ? `相关分析中，${rowValue(strongestCorrelation, 'x') || '变量X'}与${rowValue(strongestCorrelation, 'y') || '变量Y'}的相关系数为 r=${rowValue(strongestCorrelation, 'r') || '-'}，p=${rowValue(strongestCorrelation, 'p') || '未计算'}。该结果应结合研究假设判断其方向和强度，不能在缺少显著性或理论支撑时扩大解释为因果关系。`
      : '',
    firstAnova
      ? `方差分析结果显示，分组变量 ${rowValue(firstAnova, 'group') || '-'} 在 ${rowValue(firstAnova, 'variable') || '-'} 上的检验结果为 F=${rowValue(firstAnova, 'f') || '-'}，p=${rowValue(firstAnova, 'p') || '未计算'}。论文中可据此讨论不同群体是否存在差异，但应保留对样本量和组别均衡性的说明。`
      : '',
    efaRows.length
      ? `探索性因子分析输出了 ${factorColumns.length || '若干'} 个潜在因子载荷。写作时应结合载荷较高的题项归属解释潜在维度结构，并在正式论文中结合旋转结果、KMO/Bartlett 检验或理论维度进一步复核。`
      : '',
  ].filter(Boolean).join('\n')
}

function deterministicAnalysisText(result: Record<string, unknown>, fallbackText = '') {
  return deterministicKanoEntropyAnalysisText(result, fallbackText)
    || deterministicAhpAnalysisText(result, fallbackText)
    || deterministicQualitativeAnalysisText(result, fallbackText)
    || deterministicQuantAnalysisText(result, fallbackText)
}

function kanoEntropyComponentNarratives(result: Record<string, unknown>) {
  if (result.method !== 'kano_entropy') return null
  const summaryRows = tableRowsById(result, 'table_kano_summary')
  const weightRows = tableRowsById(result, 'table_entropy_weights')
  const priorityRows = sortedKanoPriorityRows(tableRowsById(result, 'table_priority_ranking'))
  const topPriority = priorityRows[0] ?? null
  const topBetter = maxRowByNumber(summaryRows, 'Better')
  const topWorse = maxRowByNumber(summaryRows, 'Worse')
  const topWeight = maxRowByNumber(weightRows, '权重(%)')
  const narratives: Array<{ componentId: string; title: string; beforeText: string; afterText: string }> = []

  if (summaryRows.length) {
    narratives.push({
      componentId: 'table_kano_summary',
      title: 'KANO维度汇总统计',
      beforeText: '表4-1用于汇总各评价维度的KANO属性、Better系数、Worse系数及优先级排名，为后续识别用户需求属性和优化重点提供基础数据。',
      afterText: `由表4-1可知，${rowValue(topWorse ?? {}, '维度') || 'Worse系数较高的维度'}的Worse系数相对较高，说明该类维度缺失时更容易引发不满意；${rowValue(topBetter ?? {}, '维度') || 'Better系数较高的维度'}的Better系数相对较高，说明其对满意度提升具有较强作用。该结果需要与耦合优先级排序共同判断，而不能仅依据单一系数下结论。`,
    })
  }

  if (weightRows.length) {
    narratives.push({
      componentId: 'table_entropy_weights',
      title: '熵权法权重计算',
      beforeText: '表4-2用于呈现熵权法对Better系数与Worse系数的客观赋权结果，以减少主观判断对综合排序的影响。',
      afterText: `由表4-2可知，${rowValue(topWeight ?? {}, '指标') || '权重较高的指标'}的权重最高，权重为${rowValue(topWeight ?? {}, '权重(%)') || '-'}%，说明该指标在耦合优先级计算中具有更强区分作用。`,
    })
  }

  if (priorityRows.length) {
    narratives.push({
      componentId: 'table_priority_ranking',
      title: 'KANO-熵权法耦合优先级排序',
      beforeText: '表4-3综合KANO属性、Better/Worse系数和熵权结果，对各评价维度进行耦合优先级排序，用于确定论文讨论和策略建议的重点顺序。',
      afterText: `由表4-3可知，排名第一的维度为“${rowValue(topPriority ?? {}, '维度') || '-'}”，其KANO类型为${kanoTypeName(rowValue(topPriority ?? {}, 'KANO'))}，综合分为${rowValue(topPriority ?? {}, '综合分') || '-'}。这表明该维度应优先进入后续设计优化和策略建议，而不是简单以单项Better系数或综合分高低替代排序结论。`,
    })
  }

  return narratives
}

function compactComponentForWritePlan(component: Record<string, unknown>) {
  return {
    id: String(component.id ?? ''),
    type: String(component.type ?? ''),
    title: String(component.title ?? ''),
    content: String(component.content ?? '').slice(0, 900),
  }
}

type WritePlanRole = 'method' | 'sample' | 'result' | 'discussion' | 'conclusion'

function normalizeWriteRole(value: unknown): WritePlanRole {
  const role = String(value ?? '').toLowerCase()
  if (role === 'method' || role === 'sample' || role === 'result' || role === 'discussion' || role === 'conclusion') return role
  return 'result'
}

function guardedRoleForWriteComponent(component: { type: string; title?: string; content?: string }): WritePlanRole {
  const title = `${component.title ?? ''}`
  const text = `${title}\n${component.content ?? ''}`
  if (component.type === 'method') return 'method'
  if (component.type === 'analysis' && (/[:：]\s*(before|after)$/i.test(title) || /^[图表]\s*\d|^表\s*\d/.test(title))) return 'result'
  if (component.type === 'analysis' && /(\u5efa\u8bae|\u7b56\u7565|\u4f18\u5316|\u8ba8\u8bba|\u542f\u793a|\u5bf9\u7b56|\u5c40\u9650|\u5c55\u671b|suggest|strategy|discussion|optimization|limitation)/i.test(text)) return 'discussion'
  if (/建议|策略|优化|讨论|启示|对策|局限|展望/.test(text)) return 'discussion'
  return 'result'
}

function sectionScore(section: Record<string, unknown>, role: WritePlanRole) {
  const text = `${section.title ?? ''}\n${section.content ?? ''}`.toLowerCase()
  const keywords = role === 'method'
    ? ['研究方法', '研究设计', '数据来源', '样本', '方法', '第三章', 'chapter 3', 'method']
    : role === 'discussion'
      ? ['讨论', '建议', '策略', '优化', '启示', '对策', '第五章', 'discussion']
      : role === 'conclusion'
        ? ['结论', '总结', '不足', '展望', 'conclusion']
        : ['结果', '分析', '实证', '数据分析', '研究结果', '第四章', 'chapter 4', 'result']
  return keywords.reduce((sum, keyword) => sum + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0)
}

function fallbackTitleForGuardedWriteRole(role: WritePlanRole) {
  return role === 'method'
    ? '研究方法与数据来源'
    : role === 'discussion'
      ? '讨论与优化建议'
      : '数据分析与研究结果'
}

function bestSectionForGuardedWriteRole(sections: Record<string, unknown>[], role: WritePlanRole) {
  const target = sections
    .map(section => ({ section, score: sectionScore(section, role) }))
    .sort((a, b) => b.score - a.score)[0]
  return target && target.score > 0 ? target.section : null
}

function guardedWritePlanFromIds(
  orderedIds: string[],
  components: Array<{ id: string; type: string; title?: string; content?: string }>,
  sections: Record<string, unknown>[]
) {
  const componentById = new Map(components.map(component => [component.id, component]))
  const grouped = new Map<WritePlanRole, string[]>()
  orderedIds.forEach(id => {
    const component = componentById.get(id)
    if (!component) return
    const role = guardedRoleForWriteComponent(component)
    grouped.set(role, [...(grouped.get(role) ?? []), id])
  })
  return Array.from(grouped.entries()).map(([role, componentIds]) => {
    const matched = bestSectionForGuardedWriteRole(sections, role)
    return {
      targetSectionId: typeof matched?.id === 'string' ? matched.id : undefined,
      targetSectionTitle: typeof matched?.title === 'string' ? matched.title : fallbackTitleForGuardedWriteRole(role),
      role,
      insertPosition: 'append',
      reason: matched
        ? '按论文结构护栏校准写入位置，确保方法、结果图表和讨论建议进入对应章节。'
        : '当前大纲未发现明确章节，创建论文常用章节承接该内容。',
      componentIds,
    }
  }).filter(placement => placement.componentIds.length > 0)
}

function fallbackWritePlan(body: Record<string, unknown>) {
  const sections = arrayRecords(body.sections)
  const components = arrayRecords(body.components).map(compactComponentForWritePlan).filter(component => component.id)
  const placements = guardedWritePlanFromIds(components.map(component => component.id), components, sections)
  return { placements, summary: '已根据章节语义自动规划研究结果写入位置。' }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function firstNonEmptyTable(result: Record<string, unknown>, id: string) {
  return arrayRecords(result.tables).find(table => table.id === id || String(table.title ?? '').includes(id))
}

function fallbackResearchInterpretation(result: Record<string, unknown>, payload: Record<string, unknown>) {
  const sampleSize = Number(result.sampleSize) || 0
  const method = String(result.method ?? payload.method ?? 'descriptive')
  const descriptive = arrayRecords(result.descriptive)
  const correlations = arrayRecords(result.correlations)
  const anova = arrayRecords(result.anova)
  const alpha = result.cronbachAlpha && typeof result.cronbachAlpha === 'object'
    ? result.cronbachAlpha as Record<string, unknown>
    : null
  const efa = result.efa && typeof result.efa === 'object'
    ? result.efa as Record<string, unknown>
    : null
  const firstLoading = arrayRecords(efa?.loadings)[0]
  const strongest = correlations.length
    ? correlations.reduce((best, row) => Math.abs(Number(row.r ?? 0)) > Math.abs(Number(best.r ?? 0)) ? row : best, correlations[0])
    : null
  const firstDesc = descriptive[0]
  const firstAnova = anova[0]

  const methodParts = [
    sampleSize ? `本节基于回收数据中的 ${sampleSize} 份有效样本开展分析。` : '本节基于用户上传的数据文件开展分析。',
    method.includes('cronbach') ? '首先对量表题项进行信度检验，以判断题项内部一致性是否满足后续分析需要。' : '',
    method.includes('correlation') ? '随后采用相关分析考察变量之间的线性关系，并结合相关系数方向与强度解释研究对象之间的关联。' : '',
    method.includes('anova') ? '对于包含分组变量的数据，进一步采用单因素方差分析比较不同群体在关键变量上的差异。' : '',
    method.includes('efa') ? '若题项数量与样本条件允许，则通过探索性因子分析观察潜在维度结构。' : '',
    method === 'descriptive' || method.includes('descriptive') ? '描述统计用于呈现主要变量的样本量、均值、标准差及取值范围。' : '',
  ].filter(Boolean)

  const analysisParts = [
    alpha ? `信度结果显示，Cronbach's alpha 为 ${alpha.alpha ?? '待复核'}，可作为判断量表内部一致性的依据。` : '',
    firstDesc ? `描述统计方面，${firstDesc.variable ?? '核心变量'} 的均值为 ${firstDesc.mean ?? '-'}，标准差为 ${firstDesc.sd ?? '-'}，说明样本在该指标上呈现出一定的集中趋势与离散程度。` : '',
    strongest ? `相关分析中，${strongest.x ?? '变量X'} 与 ${strongest.y ?? '变量Y'} 的相关系数为 r=${strongest.r ?? '-'}，p=${strongest.p ?? '未计算'}，可在论文中结合研究假设进一步判断其方向、强度与显著性。` : '',
    firstAnova ? `方差分析结果显示，分组变量 ${firstAnova.group ?? 'group'} 在 ${firstAnova.variable ?? '目标变量'} 上的检验结果为 F=${firstAnova.f ?? '-'}，p=${firstAnova.p ?? '未计算'}，可用于讨论不同群体之间是否存在差异。` : '',
    efa ? `探索性因子分析近似结果提取了 ${efa.factors ?? '-'} 个潜在因子；载荷表中，${firstLoading?.variable ?? '首个题项'} 在主要因子上的载荷可作为题项归属判断的初步依据，正式论文中应结合旋转结果和理论维度复核。` : '',
    !firstDesc && !strongest && !firstAnova && !alpha && !efa ? '系统已完成基础计算。论文写作时应以统计表中的实际系数、均值、p 值或分类结果为依据，避免加入数据中不存在的结论。' : '',
  ].filter(Boolean)

  return {
    methodText: methodParts.join(''),
    analysisText: analysisParts.join('\n'),
  }
}

async function interpretAnalysisResult(result: Record<string, unknown>, payload: Record<string, unknown>) {
  const fallback = fallbackResearchInterpretation(result, payload)
  const tables = arrayRecords(result.tables).map(compactTableForPrompt)
  const figures = arrayRecords(result.figures).map(figure => ({
    id: figure.id,
    title: figure.title,
    caption: figure.caption,
  }))

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是论文研究结果写作助手。请只返回 JSON，不要 Markdown。
任务：把统计/编码工具结果统一改写成正式论文正文，可直接插入“研究结果/数据分析/实证分析”章节。
规则：
1. 只能依据输入结果写，不得编造不存在的显著性、系数、样本量、结论。
2. methodText 写研究方法和计算口径，1段，正式论文语气。
3. analysisText 写结果解释，2-4段，使用“由表/图可知”“结果显示”等论文表述。
4. 如果 p 值为空或工具提示需复核，必须保守表达。
5. 对定性材料，使用“编码、主题归纳、证据摘录、范畴关系”的语言；对定量材料，使用“样本、均值、相关、差异、信度”的语言。
6. 每张表和每张图都要给出 beforeText 与 afterText：beforeText 说明该图表回答什么问题，afterText 解释最高项/最低项/主要趋势及其论文含义。
返回字段：
{"methodText":"...","analysisText":"...","componentNarratives":[{"componentId":"table_or_figure_id","title":"图表标题","beforeText":"...","afterText":"..."}],"warnings":["..."]}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        paperTitle: payload.paperTitle,
        chapterTitle: payload.chapterTitle,
        userRequest: payload.userRequest,
        confirmedPlan: payload.confirmedPlan,
        method: result.method,
        sampleSize: result.sampleSize,
        numericColumns: result.numericColumns,
        categoricalColumns: result.categoricalColumns,
        cronbachAlpha: result.cronbachAlpha,
        tables,
        figures,
        cautions: result.cautions,
        plainText: String(result.plainText ?? '').slice(0, 6000),
      }, null, 2),
    },
  ]

  try {
    const aiText = await callAIOnce(messages, 'gpt')
    const ai = safeJsonFromText(aiText)
    const deterministicMethodText = typeof result.methodText === 'string' && result.methodText.trim()
      ? result.methodText.trim()
      : ''
    const methodText = deterministicMethodText || (typeof ai?.methodText === 'string' && ai.methodText.trim()
      ? ai.methodText.trim()
      : fallback.methodText)
    const safeAnalysisText = deterministicAnalysisText(result, fallback.analysisText)
    const analysisText = safeAnalysisText || (typeof ai?.analysisText === 'string' && ai.analysisText.trim()
      ? ai.analysisText.trim()
      : fallback.analysisText)
    const aiWarnings = Array.isArray(ai?.warnings)
      ? ai.warnings.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
    const deterministicNarratives = kanoEntropyComponentNarratives(result)
    const componentNarratives = deterministicNarratives ?? (Array.isArray(ai?.componentNarratives)
      ? ai.componentNarratives
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map(item => ({
            componentId: typeof item.componentId === 'string' ? item.componentId : undefined,
            title: typeof item.title === 'string' ? item.title : undefined,
            beforeText: typeof item.beforeText === 'string' ? item.beforeText : undefined,
            afterText: typeof item.afterText === 'string' ? item.afterText : undefined,
          }))
          .filter(item => item.componentId || item.title)
      : [])
    return {
      ...result,
      methodText,
      analysisText,
      componentNarratives,
      cautions: uniqueWarnings([...(Array.isArray(result.cautions) ? result.cautions : []), ...aiWarnings]),
      interpretationProvider: 'ai',
    }
  } catch (error) {
    console.warn('[research:interpret] AI interpretation unavailable, using deterministic fallback:', error instanceof Error ? error.message : String(error))
    return {
      ...result,
      ...fallback,
      interpretationProvider: 'fallback',
    }
  }
}

function shouldRunQualitativeAnalysis(payload: Record<string, unknown>) {
  const methodText = [
    payload.method,
    payload.userRequest,
    payload.fileName,
    payload.confirmedPlan && typeof payload.confirmedPlan === 'object' ? (payload.confirmedPlan as Record<string, unknown>).method : '',
  ].map(value => String(value ?? '').toLowerCase()).join(' ')
  return /qualitative|coding|theme|interview|访谈|编码|主题|质性|文本/.test(methodText)
}

function qualitativeSourceText(payload: Record<string, unknown>) {
  if (payload.base64) {
    try {
      return Buffer.from(String(payload.base64), 'base64').toString('utf8')
    } catch {
      return String(payload.text ?? '')
    }
  }
  return String(payload.text ?? '')
}

function splitQualitativeSegments(text: string) {
  return text
    .split(/\n{2,}|\r?\n|。|；|;|\.\s+/)
    .map(item => item.replace(/^(受访者|访谈者|Q|A|问|答)\s*[:：]?\s*/i, '').trim())
    .filter(item => item.length >= 8)
    .slice(0, 80)
}

function keywordScore(segment: string, words: string[]) {
  return words.reduce((sum, word) => sum + (segment.includes(word) ? 1 : 0), 0)
}

function classifyQualitativeTheme(segment: string) {
  const themes = [
    { theme: '视觉感知', category: '视觉呈现与审美体验', words: ['视觉', '颜色', '色彩', '图案', '画面', '风格', '造型', '好看', '审美'] },
    { theme: '文化认同', category: '文化理解与身份认同', words: ['文化', '传统', '非遗', '历史', '传承', '国潮', '民族', '认同', '意义'] },
    { theme: '使用体验', category: '场景体验与功能价值', words: ['使用', '体验', '方便', '产品', '购买', '实用', '场景', '需求', '功能'] },
    { theme: '传播意愿', category: '分享传播与社交互动', words: ['分享', '传播', '推荐', '转发', '评论', '社交', '朋友', '平台', '互动'] },
    { theme: '改进建议', category: '问题反馈与优化方向', words: ['问题', '不足', '改进', '优化', '单一', '同质', '复杂', '看不懂', '不喜欢'] },
  ]
  const best = themes
    .map(item => ({ ...item, score: keywordScore(segment, item.words) }))
    .sort((a, b) => b.score - a.score)[0]
  return best.score > 0 ? best : { theme: '综合评价', category: '综合态度与总体判断', words: [], score: 0 }
}

async function makeThemeFrequencyFigure(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const width = 920
  const height = 130 + rows.length * 48
  const max = Math.max(...rows.map(row => Number(row.count) || 0), 1)
  return canvasDataUrl(width, height, ctx => {
    drawChartHeader(ctx, '定性主题频次分布', '访谈、开放题或文本材料中主要编码主题的出现频次。')
    rows.forEach((row, index) => {
      const y = 108 + index * 48
      const count = Number(row.count) || 0
      const barWidth = Math.max(8, Math.round((count / max) * 560))
      ctx.fillStyle = '#1f3328'
      ctx.font = chartFont(15, '700')
      ctx.fillText(shortLabel(row.theme, 14), 42, y + 18)
      ctx.fillStyle = '#dfeadc'
      ctx.fillRect(210, y, 580, 24)
      ctx.fillStyle = '#2f7d4b'
      ctx.fillRect(210, y, barWidth, 24)
      ctx.fillStyle = '#263a2e'
      ctx.font = chartFont(14)
      ctx.fillText(`${count} 条`, 812, y + 18)
    })
    drawFootnote(ctx, '注：频次表示该主题在可分析文本片段中的出现次数，可辅助判断访谈材料的关注重点。', 42, height - 22)
  })
}

async function buildQualitativeResult(payload: Record<string, unknown>) {
  if (!shouldRunQualitativeAnalysis(payload)) return null
  const text = qualitativeSourceText(payload)
  const segments = splitQualitativeSegments(text)
  if (segments.length < 3) {
    return {
      ok: false,
      error: '定性材料不足：请上传访谈记录、开放题回答或案例文本，至少需要 3 段可分析文本。',
    }
  }
  const codedRows = segments.slice(0, 40).map((segment, index) => {
    const theme = classifyQualitativeTheme(segment)
    return {
      id: `Q${index + 1}`,
      originalText: segment,
      openCode: theme.theme,
      axialCategory: theme.category,
      evidenceExcerpt: segment.slice(0, 80),
      memo: `该材料可用于说明“${theme.theme}”相关体验或态度。`,
    }
  })
  const themeMap = new Map<string, { count: number; category: string; excerpts: string[] }>()
  codedRows.forEach(row => {
    const current = themeMap.get(row.openCode) ?? { count: 0, category: row.axialCategory, excerpts: [] }
    current.count += 1
    if (current.excerpts.length < 3) current.excerpts.push(row.evidenceExcerpt)
    themeMap.set(row.openCode, current)
  })
  const themeRows = Array.from(themeMap.entries())
    .map(([theme, value]) => ({
      theme,
      axialCategory: value.category,
      count: value.count,
      evidence: value.excerpts.join('；'),
    }))
    .sort((a, b) => Number(b.count) - Number(a.count))
  const axialRows = Array.from(new Map(themeRows.map(row => [row.axialCategory, row.axialCategory])).keys())
    .map(category => {
      const themes = themeRows.filter(row => row.axialCategory === category)
      return {
        axialCategory: category,
        includedOpenCodes: themes.map(row => row.theme).join('、'),
        evidenceCount: themes.reduce((sum, row) => sum + Number(row.count || 0), 0),
        conceptualMeaning: `${category}反映材料中围绕${themes.slice(0, 3).map(row => `“${row.theme}”`).join('、')}形成的共同关注。`,
      }
    })
    .sort((a, b) => Number(b.evidenceCount) - Number(a.evidenceCount))
  const evidenceRows = themeRows.flatMap(row => row.evidence.split('；').filter(Boolean).slice(0, 2).map((excerpt, index) => ({
    theme: row.theme,
    axialCategory: row.axialCategory,
    evidenceExcerpt: excerpt,
    writingUse: `可作为“${row.theme}”主题的代表性访谈/文本证据${index + 1}。`,
  }))).slice(0, 16)
  const figure = await makeThemeFrequencyFigure(themeRows)
  const tables = [
    { id: 'table_open_coding', title: '开放编码表', rows: codedRows, columns: ['id', 'originalText', 'openCode', 'axialCategory', 'evidenceExcerpt', 'memo'] },
    { id: 'table_axial_coding', title: '主轴编码表', rows: axialRows, columns: ['axialCategory', 'includedOpenCodes', 'evidenceCount', 'conceptualMeaning'] },
    { id: 'table_theme_summary', title: '主题归纳表', rows: themeRows, columns: ['theme', 'axialCategory', 'count', 'evidence'] },
    { id: 'table_evidence_excerpt', title: '典型证据摘录表', rows: evidenceRows, columns: ['theme', 'axialCategory', 'evidenceExcerpt', 'writingUse'] },
  ]
  return normalizeResultLabels({
    ok: true,
    method: 'qualitative_coding',
    sampleSize: segments.length,
    numericColumns: [],
    categoricalColumns: ['openCode', 'axialCategory'],
    descriptive: [],
    cronbachAlpha: null,
    correlations: [],
    anova: [],
    mediation: null,
    efa: null,
    tables,
    figures: figure ? [{ id: 'figure_theme_frequency', title: '主题频次分布图', caption: '访谈/文本材料中主要编码主题的出现频次。', dataUrl: figure }] : [],
    methodText: '本节采用质性编码方法对访谈记录、开放题回答或文本材料进行分析。分析过程包括文本分段、开放编码、主轴范畴归纳与典型证据摘录，以识别研究对象中的核心体验、问题反馈与优化方向。',
    analysisText: `质性编码结果显示，材料中共识别出 ${themeRows.length} 类主题。其中，“${themeRows[0]?.theme ?? '综合评价'}”出现频次较高，说明该主题是受访者或文本材料中较为集中的关注点。后续论文写作可结合开放编码表中的原文证据，对各主题的形成原因、表现方式和设计启示进行进一步讨论。`,
    cautions: ['当前质性编码为系统辅助初编码结果，正式论文中建议结合研究者复核、合并同义编码，并补充典型原文引语。'],
    plainText: [
      '【开放编码表】',
      tableContent(codedRows, ['id', 'originalText', 'openCode', 'axialCategory', 'evidenceExcerpt', 'memo']),
      '',
      '【主轴编码表】',
      tableContent(axialRows, ['axialCategory', 'includedOpenCodes', 'evidenceCount', 'conceptualMeaning']),
      '',
      '【主题归纳表】',
      tableContent(themeRows, ['theme', 'axialCategory', 'count', 'evidence']),
      '',
      '【典型证据摘录表】',
      tableContent(evidenceRows, ['theme', 'axialCategory', 'evidenceExcerpt', 'writingUse']),
    ].join('\n'),
    analysisProvider: 'qualitative-coding',
  })
}

router.post('/intent', async (req, res) => {
  const body = req.body ?? {}
  const fallback = fallbackIntent(body)
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是论文研究计算编排助手。请只返回 JSON，不要 Markdown。字段：
{
  "purpose": "研究目的",
  "capabilityTier": "closed_loop | partial_loop | out_of_scope",
  "recommendedMethods": ["descriptive" | "cronbach_alpha" | "correlation" | "anova" | "mediation_model_4" | "efa" | "out_of_scope"],
  "expectedPackage": ["figure" | "statistics" | "analysis" | "method"],
  "notes": ["边界、风险或确认事项"]
}
规则：SEM、HLM、多重中介、调节中介、SPSS 文件直接导入属于 out_of_scope。需要上传数据并由 Python 执行的量化分析属于 partial_loop。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        userRequest: body.userRequest,
        chapterTitle: body.chapterTitle,
        chapterContent: body.chapterContent,
        outlineContext: body.outlineContext,
        stage1ResearchPlan: body.stage1ResearchPlan,
        existingAssets: body.existingAssets,
      }, null, 2),
    },
  ]

  try {
    const aiText = await callAIOnce(messages, 'gpt')
    const ai = safeJsonFromText(aiText)
    res.json({
      ok: true,
      intent: {
        ...fallback,
        ...(ai ?? {}),
        userRequest: fallback.userRequest,
        projectId: fallback.projectId,
        chapterId: fallback.chapterId,
        chapterTitle: fallback.chapterTitle,
      },
    })
  } catch {
    res.json({ ok: true, intent: fallback })
  }
})

router.post('/analysis-plan', async (req, res) => {
  const body = req.body ?? {}
  if (shouldRunQualitativeAnalysis(body)) {
    const text = qualitativeSourceText(body)
    const segments = splitQualitativeSegments(text)
    res.json({
      ok: true,
      plan: {
        purpose: '对访谈记录、开放题回答或文本材料进行质性编码，生成可写入论文结果章节的编码表、主题归纳表、证据摘录和分析文字。',
        method: 'qualitative_coding',
        methods: ['qualitative_coding'],
        reason: '当前材料以访谈记录、开放题回答或文本片段为主，适合采用开放编码、主轴编码和主题归纳形成论文结果，而不适合直接套用数值统计。',
        variables: [
          { role: 'item', name: '文本片段', column: 'originalText', confidence: 0.9, note: '访谈/文本材料分段后的分析单位' },
          { role: 'item', name: '开放编码', column: 'openCode', confidence: 0.8, note: '由文本内容归纳形成的初始概念' },
          { role: 'item', name: '主轴范畴', column: 'axialCategory', confidence: 0.8, note: '将开放编码进一步聚合成主题范畴' },
        ],
        formula: '开放编码 → 主轴编码 → 主题归纳 → 典型证据摘录 → 论文结果解释。',
        requiredColumns: ['originalText', 'openCode', 'axialCategory', 'evidenceExcerpt'],
        outputs: ['method', 'statistics', 'figure', 'analysis'],
        limitations: ['AI 初编码需要研究者复核；正式论文中应保留典型原文证据，并说明编码过程与一致性控制。'],
        toolCalls: [{ tool: 'qualitative_coding', columns: ['originalText', 'openCode', 'axialCategory'] }],
        needsVariableConfirmation: segments.length < 10,
      },
      columns: ['originalText', 'openCode', 'axialCategory', 'evidenceExcerpt'],
      numericColumns: [],
      categoricalColumns: ['openCode', 'axialCategory'],
    })
    return
  }
  const ahpPlan = await buildAhpPlan(body)
  if (ahpPlan) {
    res.json(ahpPlan.response)
    return
  }
  const kanoPlan = await buildKanoEntropyPlan(body)
  if (kanoPlan) {
    res.json(kanoPlan.response)
    return
  }

  let profile: Record<string, unknown>
  try {
    profile = await runPython({ ...body, mode: 'profile' })
    if (!profile.ok) throw new Error(String(profile.error ?? 'Python profile returned an invalid result'))
    profile = await mergeNodeQualityProfile(profile, body)
  } catch (error) {
    console.warn('[research:analysis-plan] Python profile unavailable, using Node fallback:', error instanceof Error ? error.message : String(error))
    try {
      profile = await profileDatasetInNode(body)
    } catch (fallbackError) {
      res.status(400).json({
        error: fallbackError instanceof Error ? fallbackError.message : 'Dataset profile failed',
      })
      return
    }
  }

  const fallback = planFromInference(body.intent ?? {}, profile)
  const messages: Message[] = [
    {
      role: 'system',
      content: `你是严谨的数据分析方法顾问。只返回 JSON，不要 Markdown。字段：
{
  "purpose": "本次分析目的",
  "method": "descriptive | cronbach_alpha | correlation | anova | mediation_model_4 | efa | out_of_scope",
  "methods": ["可执行方法列表"],
  "reason": "为什么选择这些方法",
  "variables": [{"role":"independent|dependent|mediator|moderator|control|group|item|unknown","name":"变量名","column":"数据列","confidence":0.0,"note":"说明"}],
  "formula": "公式或模型",
  "requiredColumns": ["列名"],
  "outputs": ["figure","statistics","analysis","method"],
  "limitations": ["限制"],
  "toolCalls": [{"tool":"方法","columns":["列名"],"groupColumn":"分组列"}],
  "needsVariableConfirmation": true
}
不要选择工具箱外方法。列名不清晰时给出低 confidence 并要求确认。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        intent: body.intent,
        datasetProfile: profile,
      }, null, 2),
    },
  ]

  try {
    const aiText = await callAIOnce(messages, 'gpt')
    const ai = safeJsonFromText(aiText)
    res.json({
      ok: true,
      plan: mergePlanWithFallback(ai, fallback),
      columns: profile.columns,
      numericColumns: profile.numericColumns,
      categoricalColumns: profile.categoricalColumns,
    })
  } catch {
    res.json({
      ok: true,
      plan: fallback,
      columns: profile.columns,
      numericColumns: profile.numericColumns,
      categoricalColumns: profile.categoricalColumns,
    })
  }
})

router.post('/analyze', async (req, res) => {
  try {
    const qualitativeResult = await buildQualitativeResult(req.body ?? {})
    if (qualitativeResult) {
      if (!qualitativeResult.ok) {
        const detail = 'error' in qualitativeResult ? qualitativeResult.error : 'Qualitative analysis failed'
        res.status(400).json({ error: detail ?? 'Qualitative analysis failed' })
        return
      }
      res.json(normalizeResultLabels(await interpretAnalysisResult(qualitativeResult, req.body ?? {})))
      return
    }

    const ahpResult = await buildAhpResult(req.body ?? {})
    if (ahpResult) {
      res.json(normalizeResultLabels(await interpretAnalysisResult(ahpResult, req.body ?? {})))
      return
    }

    const kanoResult = await buildKanoEntropyResult(req.body ?? {})
    if (kanoResult) {
      res.json(normalizeResultLabels(await interpretAnalysisResult(kanoResult, req.body ?? {})))
      return
    }

    const result = await runPython(req.body ?? {})
    if (!result.ok) {
      throw new Error(String(result.error ?? 'Research analysis failed'))
    }
    const enriched = await enrichQuantResult(result, req.body ?? {})
    res.json(normalizeResultLabels(await interpretAnalysisResult(enriched, req.body ?? {})))
  } catch (error) {
    console.warn('[research:analyze] Python analysis unavailable, using Node fallback:', error instanceof Error ? error.message : String(error))
    try {
      const result = await analyzeDatasetInNode(req.body ?? {})
      const enriched = await enrichQuantResult(result, req.body ?? {})
      res.json(normalizeResultLabels(await interpretAnalysisResult(enriched, req.body ?? {})))
    } catch (fallbackError) {
      res.status(500).json({ error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) })
    }
  }
})

router.post('/interpret', async (req, res) => {
  const body = req.body ?? {}
  const result = body.result && typeof body.result === 'object' ? body.result as Record<string, unknown> : null
  if (!result) {
    res.status(400).json({ error: 'Missing analysis result' })
    return
  }
  res.json({
    ok: true,
    result: await interpretAnalysisResult(result, body),
  })
})

router.post('/write-plan', async (req, res) => {
  const body = req.body ?? {}
  const fallback = fallbackWritePlan(body)
  const components = arrayRecords(body.components).map(compactComponentForWritePlan).filter(component => component.id)
  const componentIds = new Set(components.map(component => component.id))
  const sections = arrayRecords(body.sections).map(section => ({
    id: String(section.id ?? ''),
    title: String(section.title ?? ''),
    content: String(section.content ?? '').slice(0, 900),
  }))

  const messages: Message[] = [
    {
      role: 'system',
      content: `你是论文研究结果写入规划器。只返回 JSON，不要 Markdown。
任务：根据论文题目、当前章节结构和研究计算组件，判断每个组件最适合写入哪个章节。
规则：
1. 不固定章节名，必须依据当前大纲和正文语义判断。
2. method 组件优先写入研究方法、研究设计、数据来源、样本说明相关章节。
3. statistics/figure/table 组件和直接结果解释优先写入结果分析、数据分析、实证分析相关章节。
4. 与建议、策略、优化、讨论相关的 analysis 组件写入讨论、建议、策略章节。
5. 不要丢弃任何组件；每个 componentId 必须出现且只出现一次。
6. targetSectionId 只有确信匹配已有章节时才填写；否则给出 targetSectionTitle 让系统创建新章节。
返回格式：
{"placements":[{"targetSectionId":"...","targetSectionTitle":"...","role":"method|sample|result|discussion|conclusion","insertPosition":"append","reason":"...","componentIds":["..."]}],"summary":"..."}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        paperTitle: body.paperTitle,
        assetTitle: body.assetTitle,
        assetSummary: body.assetSummary,
        sections,
        components,
      }, null, 2),
    },
  ]

  try {
    const aiText = await callAIOnce(messages, 'gpt', 2600)
    const ai = safeJsonFromText(aiText)
    const rawPlacements = Array.isArray(ai?.placements) ? ai.placements.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
    const used = new Set<string>()
    const placements = rawPlacements.map(placement => {
      const ids = Array.isArray(placement.componentIds)
        ? placement.componentIds.filter((id): id is string => typeof id === 'string' && componentIds.has(id) && !used.has(id))
        : []
      ids.forEach(id => used.add(id))
      const targetSectionId = typeof placement.targetSectionId === 'string' && sections.some(section => section.id === placement.targetSectionId)
        ? placement.targetSectionId
        : undefined
      const matchedTitle = targetSectionId ? sections.find(section => section.id === targetSectionId)?.title : undefined
      return {
        targetSectionId,
        targetSectionTitle: matchedTitle || String(placement.targetSectionTitle ?? '').trim() || '数据分析与研究结果',
        role: normalizeWriteRole(placement.role),
        insertPosition: 'append',
        reason: String(placement.reason ?? ''),
        componentIds: ids,
      }
    }).filter(placement => placement.componentIds.length > 0)

    const missingIds = components.map(component => component.id).filter(id => !used.has(id))
    if (missingIds.length) {
      const fallbackResult = fallbackWritePlan({ ...body, components: components.filter(component => missingIds.includes(component.id)) })
      placements.push(...fallbackResult.placements)
    }
    const guardedPlacements = guardedWritePlanFromIds(
      placements.flatMap(placement => placement.componentIds),
      components,
      sections
    )

    res.json({
      ok: true,
      plan: {
        placements: guardedPlacements,
        summary: typeof ai?.summary === 'string' ? ai.summary : fallback.summary,
      },
    })
  } catch (error) {
    console.warn('[research:write-plan] AI planning unavailable, using deterministic fallback:', error instanceof Error ? error.message : String(error))
    res.json({ ok: true, plan: fallback })
  }
})

export default router

