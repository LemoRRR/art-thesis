import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { callAIOnce, type Message } from '../lib/ai.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.resolve(__dirname, '../python/research_analysis.py')

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
  const raw = String(value ?? '').trim()
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
    child.stdin.write(JSON.stringify(payload ?? {}))
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
        resolve(JSON.parse(trimmed))
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
  let rows: Record<string, unknown>[] = []
  let columns: string[] = []

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
    profileProvider: 'node-fallback',
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

function methodsFromPlan(payload: Record<string, unknown>, numericColumns: string[], categoricalColumns: string[]) {
  const plan = (payload.confirmedPlan && typeof payload.confirmedPlan === 'object') ? payload.confirmedPlan as Record<string, unknown> : {}
  const rawMethods = [
    ...(Array.isArray(plan.toolCalls) ? plan.toolCalls.map(call => call && typeof call === 'object' ? (call as Record<string, unknown>).tool : '') : []),
    ...(Array.isArray(plan.methods) ? plan.methods : []),
    plan.method,
    payload.method,
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
  const tables = [
    descriptive.length ? { id: 'table_descriptive', title: '描述性统计', rows: descriptive, columns: ['variable', 'n', 'mean', 'sd', 'min', 'max'] } : null,
    correlations.length ? { id: 'table_correlation', title: '相关分析', rows: correlations.slice(0, 24), columns: ['x', 'y', 'n', 'r', 'p'] } : null,
    anova.length ? { id: 'table_anova', title: '单因素方差分析', rows: anova, columns: ['group', 'variable', 'f', 'p'] } : null,
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
    mediation: null,
    efa: null,
    tables,
    figures: [],
    methodText: '本次分析使用系统内置轻量统计引擎读取用户上传数据，并按确认方案完成描述统计、信度、相关或方差分析。p值、复杂模型和图表可在完整 Python/R 环境中进一步复核。',
    analysisText: strongest
      ? `相关分析显示，${strongest.x} 与 ${strongest.y} 的相关系数为 r=${strongest.r}。论文写作时应结合研究假设、变量含义和显著性检验进一步解释。`
      : '系统已根据上传数据完成基础统计计算。论文写作时应围绕表格中的均值、标准差、相关系数或组间差异进行谨慎解释。',
    cautions: ['当前线上环境使用轻量统计兜底；复杂模型、精确 p 值和高阶图表建议在正式统计环境中复核。'],
    plainText: plainLines.join('\n'),
    columns,
    analysisProvider: 'node-fallback',
  }
}

type SheetTable = { name: string; columns: string[]; rows: Record<string, unknown>[] }

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
  const map: Record<string, string> = {
    M: '必备型',
    O: '期望型',
    A: '魅力型',
    I: '无差异型',
    Q: '可疑结果',
    R: '反向型',
  }
  return map[type] ?? type
}

function tableContent(rows: Record<string, unknown>[], columns: string[]) {
  return [
    columns.join('\t'),
    ...rows.map(row => columns.map(column => rowValue(row, column)).join('\t')),
  ].join('\n')
}

async function makePriorityChart(rows: Record<string, unknown>[]) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const width = 1160
    const rowHeight = 42
    const height = 120 + Math.max(1, rows.length) * rowHeight
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fffdf8'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#234234'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('KANO-Entropy Priority Ranking', 34, 46)
    ctx.fillStyle = '#6d756f'
    ctx.font = '16px sans-serif'
    ctx.fillText('Lower score indicates higher design optimization priority.', 34, 76)
    const maxScore = Math.max(...rows.map(row => maybeNumber(row['耦合优先级总得分']) ?? 0), 1)
    rows.slice(0, 12).forEach((row, index) => {
      const y = 112 + index * rowHeight
      const rank = rowValue(row, '最终耦合优先级排名') || String(index + 1)
      const name = `D${String(index + 1).padStart(2, '0')}`
      const type = rowValue(row, '主导KANO类型')
      const score = maybeNumber(row['耦合优先级总得分']) ?? 0
      const barWidth = Math.max(10, Math.round((score / maxScore) * 560))
      ctx.fillStyle = index % 2 === 0 ? '#f5faf2' : '#ffffff'
      ctx.fillRect(24, y - 26, width - 48, rowHeight - 6)
      ctx.fillStyle = '#284d34'
      ctx.font = 'bold 17px sans-serif'
      ctx.fillText(`Rank ${rank}  ${name}`, 42, y)
      ctx.fillStyle = '#dfeadc'
      ctx.fillRect(245, y - 17, 570, 18)
      ctx.fillStyle = index < 3 ? '#2f7d4b' : '#6ba46f'
      ctx.fillRect(245, y - 17, barWidth, 18)
      ctx.fillStyle = '#1f3328'
      ctx.font = '15px sans-serif'
      ctx.fillText(`KANO: ${type || '-'}   Score: ${score.toFixed(4)}`, 835, y)
    })
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
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

async function canvasDataUrl(
  width: number,
  height: number,
  draw: (ctx: any) => void
) {
  try {
    const { createCanvas } = await import('@napi-rs/canvas')
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fffdf8'
    ctx.fillRect(0, 0, width, height)
    draw(ctx)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}

async function makeKanoStackedChart(rows: Record<string, unknown>[]) {
  const types = [
    { label: 'M', parts: ['M_', '占比'], color: '#2f6f4e' },
    { label: 'O', parts: ['O_', '占比'], color: '#5d9a65' },
    { label: 'A', parts: ['A_', '占比'], color: '#94bd77' },
    { label: 'I', parts: ['I_', '占比'], color: '#d5e5c8' },
    { label: 'Q/R', parts: ['Q_', '占比'], color: '#c9b06f' },
  ]
  return canvasDataUrl(1180, 680, ctx => {
    ctx.fillStyle = '#234234'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('KANO Category Distribution', 34, 46)
    ctx.fillStyle = '#6d756f'
    ctx.font = '16px sans-serif'
    ctx.fillText('Stacked percentage by design dimension (M/O/A/I/Q-R).', 34, 76)
    types.forEach((type, index) => {
      const x = 620 + index * 72
      ctx.fillStyle = type.color
      ctx.fillRect(x, 52, 18, 12)
      ctx.fillStyle = '#344238'
      ctx.font = '14px sans-serif'
      ctx.fillText(type.label, x + 24, 63)
    })
    const startY = 118
    const barX = 210
    const barWidth = 760
    const barHeight = 24
    rows.slice(0, 12).forEach((row, index) => {
      const y = startY + index * 44
      ctx.fillStyle = '#284d34'
      ctx.font = 'bold 15px sans-serif'
      ctx.fillText(`D${String(index + 1).padStart(2, '0')}`, 42, y + 17)
      let x = barX
      types.forEach(type => {
        const value = type.label === 'Q/R'
          ? rowMetric(row, ['Q_', '占比']) + rowMetric(row, ['R_', '占比'])
          : rowMetric(row, type.parts)
        const width = Math.max(0, Math.round((value / 100) * barWidth))
        ctx.fillStyle = type.color
        ctx.fillRect(x, y, width, barHeight)
        x += width
      })
      ctx.strokeStyle = '#d9e2d6'
      ctx.strokeRect(barX, y, barWidth, barHeight)
      ctx.fillStyle = '#53645a'
      ctx.font = '13px sans-serif'
      ctx.fillText(`Dominant: ${rowTextByParts(row, ['主导', 'KANO'], '-')}`, 988, y + 17)
    })
  })
}

async function makeBetterWorseChart(rows: Record<string, unknown>[]) {
  return canvasDataUrl(980, 760, ctx => {
    const left = 92
    const top = 112
    const size = 560
    ctx.fillStyle = '#234234'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('Better-Worse Coefficient Matrix', 34, 46)
    ctx.fillStyle = '#6d756f'
    ctx.font = '16px sans-serif'
    ctx.fillText('X: Better coefficient; Y: absolute Worse coefficient.', 34, 76)
    ctx.strokeStyle = '#c9d6c7'
    ctx.lineWidth = 1
    ctx.strokeRect(left, top, size, size)
    ctx.beginPath()
    ctx.moveTo(left + size / 2, top)
    ctx.lineTo(left + size / 2, top + size)
    ctx.moveTo(left, top + size / 2)
    ctx.lineTo(left + size, top + size / 2)
    ctx.stroke()
    ctx.fillStyle = '#eef6ed'
    ctx.fillRect(left + size / 2, top, size / 2, size / 2)
    ctx.fillStyle = '#f7fbf5'
    ctx.fillRect(left, top + size / 2, size / 2, size / 2)
    rows.slice(0, 12).forEach((row, index) => {
      const better = rowMetric(row, ['Better'])
      const worse = rowMetric(row, ['Worse'])
      const x = left + Math.min(1, Math.max(0, better)) * size
      const y = top + size - Math.min(1, Math.max(0, worse)) * size
      ctx.fillStyle = index < 3 ? '#1f6b45' : '#6ba46f'
      ctx.beginPath()
      ctx.arc(x, y, index < 3 ? 8 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1f3328'
      ctx.font = 'bold 13px sans-serif'
      const labelDy = y > top + size - 34 ? -18 - (index % 4) * 12 : -8
      ctx.fillText(`D${String(index + 1).padStart(2, '0')}`, x + 9, y + labelDy)
    })
    ctx.fillStyle = '#24382d'
    ctx.font = '16px sans-serif'
    ctx.fillText('Better coefficient', left + 190, top + size + 44)
    ctx.save()
    ctx.translate(28, top + 360)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('Worse coefficient (absolute)', 0, 0)
    ctx.restore()
    ctx.fillStyle = '#6d756f'
    ctx.font = '14px sans-serif'
    ctx.fillText('Dimension labels use D01-D12.', 700, 180)
    ctx.fillText('See the KANO summary table for full names.', 700, 208)
    ctx.fillText('Upper-right points indicate strong', 700, 252)
    ctx.fillText('satisfaction gain and dissatisfaction risk.', 700, 280)
  })
}

async function makeEntropyWeightChart(rows: Record<string, unknown>[]) {
  return canvasDataUrl(920, 430, ctx => {
    ctx.fillStyle = '#234234'
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('Entropy Weight Distribution', 34, 46)
    ctx.fillStyle = '#6d756f'
    ctx.font = '16px sans-serif'
    ctx.fillText('Objective weights used in the coupled priority score.', 34, 76)
    const chartRows = rows.filter(Boolean)
    const maxWeight = Math.max(...chartRows.map(row => rowMetric(row, ['权重'])), 1)
    chartRows.forEach((row, index) => {
      const y = 128 + index * 76
      const weight = rowMetric(row, ['权重'])
      const width = Math.round((weight / maxWeight) * 560)
      ctx.fillStyle = '#284d34'
      ctx.font = 'bold 16px sans-serif'
      ctx.fillText(`Indicator ${index + 1}`, 46, y + 18)
      ctx.fillStyle = '#dfeadc'
      ctx.fillRect(190, y, 580, 24)
      ctx.fillStyle = '#2f7d4b'
      ctx.fillRect(190, y, width, 24)
      ctx.fillStyle = '#1f3328'
      ctx.font = '15px sans-serif'
      ctx.fillText(`${weight.toFixed(2)}%`, 790, y + 18)
    })
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

async function makeKanoStackedChartSvg(rows: Record<string, unknown>[]) {
  const types = [
    { label: 'M', parts: ['M_', '占比'], color: '#2f6f4e' },
    { label: 'O', parts: ['O_', '占比'], color: '#5d9a65' },
    { label: 'A', parts: ['A_', '占比'], color: '#94bd77' },
    { label: 'I', parts: ['I_', '占比'], color: '#d5e5c8' },
    { label: 'Q/R', parts: ['Q_', '占比'], color: '#c9b06f' },
  ]
  const legend = types.map((type, index) => {
    const x = 620 + index * 72
    return `<rect x="${x}" y="52" width="18" height="12" fill="${type.color}"/><text x="${x + 24}" y="64" class="small">${escapeXml(type.label)}</text>`
  }).join('')
  const bars = rows.slice(0, 12).map((row, index) => {
    const y = 118 + index * 44
    let x = 210
    const segments = types.map(type => {
      const value = type.label === 'Q/R'
        ? rowMetric(row, ['Q_', '占比']) + rowMetric(row, ['R_', '占比'])
        : rowMetric(row, type.parts)
      const width = Math.max(0, Math.round((value / 100) * 760))
      const rect = `<rect x="${x}" y="${y}" width="${width}" height="24" fill="${type.color}"/>`
      x += width
      return rect
    }).join('')
    return `<text x="42" y="${y + 17}" font-size="15" font-weight="700">D${String(index + 1).padStart(2, '0')}</text>
${segments}<rect x="210" y="${y}" width="760" height="24" fill="none" stroke="#d9e2d6"/>
<text x="988" y="${y + 17}" class="small">Dominant: ${escapeXml(rowTextByParts(row, ['主导', 'KANO'], '-'))}</text>`
  }).join('')
  return svgDataUrl(1180, 680, `<text x="34" y="46" class="title">KANO Category Distribution</text>
<text x="34" y="76" class="sub">Stacked percentage by design dimension (M/O/A/I/Q-R).</text>
${legend}${bars}`)
}

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
    return `<circle cx="${x}" cy="${y}" r="${index < 3 ? 8 : 6}" fill="${index < 3 ? '#1f6b45' : '#6ba46f'}"/>
<text x="${x + 9}" y="${y + labelDy}" font-size="13" font-weight="700">D${String(index + 1).padStart(2, '0')}</text>`
  }).join('')
  return svgDataUrl(980, 760, `<text x="34" y="46" class="title">Better-Worse Coefficient Matrix</text>
<text x="34" y="76" class="sub">X: Better coefficient; Y: absolute Worse coefficient.</text>
<rect x="${left + size / 2}" y="${top}" width="${size / 2}" height="${size / 2}" fill="#eef6ed"/>
<rect x="${left}" y="${top + size / 2}" width="${size / 2}" height="${size / 2}" fill="#f7fbf5"/>
<rect x="${left}" y="${top}" width="${size}" height="${size}" fill="none" stroke="#c9d6c7"/>
<line x1="${left + size / 2}" y1="${top}" x2="${left + size / 2}" y2="${top + size}" stroke="#c9d6c7"/>
<line x1="${left}" y1="${top + size / 2}" x2="${left + size}" y2="${top + size / 2}" stroke="#c9d6c7"/>
${points}
<text x="${left + 190}" y="${top + size + 44}" class="axis">Better coefficient</text>
<text transform="translate(28 ${top + 360}) rotate(-90)" class="axis">Worse coefficient (absolute)</text>
<text x="700" y="180" class="small">Dimension labels use D01-D12.</text>
<text x="700" y="208" class="small">See the KANO summary table for full names.</text>
<text x="700" y="252" class="small">Upper-right points indicate strong</text>
<text x="700" y="280" class="small">satisfaction gain and dissatisfaction risk.</text>`)
}

async function makeEntropyWeightChartSvg(rows: Record<string, unknown>[]) {
  const chartRows = rows.filter(Boolean)
  const maxWeight = Math.max(...chartRows.map(row => rowMetric(row, ['权重'])), 1)
  const items = chartRows.map((row, index) => {
    const y = 128 + index * 76
    const weight = rowMetric(row, ['权重'])
    const width = Math.round((weight / maxWeight) * 560)
    return `<text x="46" y="${y + 18}" font-size="16" font-weight="700">Indicator ${index + 1}</text>
<rect x="190" y="${y}" width="580" height="24" fill="#dfeadc"/>
<rect x="190" y="${y}" width="${width}" height="24" fill="#2f7d4b"/>
<text x="790" y="${y + 18}" font-size="15">${weight.toFixed(2)}%</text>`
  }).join('')
  return svgDataUrl(920, 430, `<text x="34" y="46" class="title">Entropy Weight Distribution</text>
<text x="34" y="76" class="sub">Objective weights used in the coupled priority score.</text>
${items}`)
}

async function makePriorityChartSvg(rows: Record<string, unknown>[]) {
  const width = 1160
  const rowHeight = 42
  const height = 120 + Math.max(1, rows.length) * rowHeight
  const maxScore = Math.max(...rows.map(row => maybeNumber(row['耦合优先级总得分']) ?? 0), 1)
  const items = rows.slice(0, 12).map((row, index) => {
    const y = 112 + index * rowHeight
    const rank = rowValue(row, '最终耦合优先级排名') || String(index + 1)
    const type = rowValue(row, '主导KANO类型')
    const score = maybeNumber(row['耦合优先级总得分']) ?? 0
    const barWidth = Math.max(10, Math.round((score / maxScore) * 560))
    return `<rect x="24" y="${y - 26}" width="${width - 48}" height="${rowHeight - 6}" fill="${index % 2 === 0 ? '#f5faf2' : '#ffffff'}"/>
<text x="42" y="${y}" font-size="17" font-weight="700">Rank ${escapeXml(rank)}  D${String(index + 1).padStart(2, '0')}</text>
<rect x="245" y="${y - 17}" width="570" height="18" fill="#dfeadc"/>
<rect x="245" y="${y - 17}" width="${barWidth}" height="18" fill="${index < 3 ? '#2f7d4b' : '#6ba46f'}"/>
<text x="835" y="${y}" font-size="15">KANO: ${escapeXml(type || '-')}   Score: ${score.toFixed(4)}</text>`
  }).join('')
  return svgDataUrl(width, height, `<text x="34" y="46" class="title">KANO-Entropy Priority Ranking</text>
<text x="34" y="76" class="sub">Lower score indicates higher design optimization priority.</text>
${items}`)
}

async function makeKanoEntropyCharts(summaryRows: Record<string, unknown>[], weightRows: Record<string, unknown>[], priorityRows: Record<string, unknown>[]) {
  const [stacked, quadrant, weights, priority] = await Promise.all([
    makeKanoStackedChartSvg(summaryRows),
    makeBetterWorseChartSvg(summaryRows),
    weightRows.length ? makeEntropyWeightChartSvg(weightRows) : Promise.resolve(''),
    makePriorityChartSvg(priorityRows),
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
  const priorityRows = workbook.priority.rows
  const summaryRows = workbook.summary.rows
  const weightRows = workbook.weights?.rows ?? []
  const top = priorityRows.slice(0, 5)
  const first = top[0]
  const charts = await makeKanoEntropyCharts(summaryRows, weightRows, priorityRows)
  const priorityColumns = ['最终耦合优先级排名', '设计维度', '维度全称', '主导KANO类型', 'Better系数(满意度提升)', 'Worse系数绝对值(不满降低)', '熵权综合得分', '耦合优先级总得分']
  const summaryColumns = ['设计维度', '维度全称', '样本总量', '主导KANO类型', 'Better系数(满意度提升)', 'Worse系数绝对值(不满降低)', '最终耦合优先级排名']
  const weightColumns = ['评价指标', '熵值', '差异系数', '权重占比(%)']
  const analysisText = [
    `本次共纳入 ${rowValue(summaryRows[0] ?? {}, '样本总量') || '100'} 份有效问卷，围绕 ${priorityRows.length} 个非遗文创视觉创新维度进行 KANO 分类，并进一步引入熵权法计算综合优先级。`,
    first ? `耦合排序结果显示，排名第一的维度为“${rowValue(first, '设计维度')}”，其主导 KANO 类型为 ${kanoTypeName(rowValue(first, '主导KANO类型'))}，耦合优先级总得分为 ${rowValue(first, '耦合优先级总得分')}，说明该维度应作为后续设计优化与论文结果讨论的重点。` : '',
    top.length ? `前五位优先优化维度依次为：${top.map(row => `“${rowValue(row, '设计维度')}”`).join('、')}。这些维度可对应论文结果分析章节中“用户需求属性识别”“设计要素优先级排序”和“非遗文创视觉优化策略”三个部分展开。` : '',
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
      { id: 'table_kano_summary', title: 'KANO维度汇总统计', rows: summaryRows, columns: summaryColumns.filter(column => workbook.summary.columns.includes(column)) },
      ...(weightRows.length ? [{ id: 'table_entropy_weights', title: '熵权法权重计算', rows: weightRows, columns: weightColumns.filter(column => workbook.weights?.columns.includes(column)) }] : []),
      { id: 'table_priority_ranking', title: 'KANO-熵权法耦合优先级排序', rows: priorityRows, columns: priorityColumns.filter(column => workbook.priority.columns.includes(column)) },
    ],
    figures: charts,
    methodText: '本研究采用 KANO 模型识别非遗文创视觉创新要素的需求属性，先根据正向题与反向题组合判定各设计维度的必备型、期望型、魅力型、无差异型等类型，再计算 Better 系数与 Worse 系数；随后引入熵权法对满意度提升、不满意降低等指标进行客观赋权，最终形成耦合优先级排序，用于支持后续设计优化策略提出。',
    analysisText,
    cautions: ['系统识别到该 Excel 已包含 KANO 汇总、熵权法权重和耦合优先级排序，因此优先采用工作簿中的汇总结果生成论文可用表述，而不是重新对第一张原始数据表做通用统计。'],
    plainText: [
      '【KANO维度汇总统计】',
      tableContent(summaryRows, summaryColumns.filter(column => workbook.summary.columns.includes(column))),
      '',
      weightRows.length ? '【熵权法权重计算】' : '',
      weightRows.length ? tableContent(weightRows, weightColumns.filter(column => workbook.weights?.columns.includes(column))) : '',
      '',
      '【KANO-熵权法耦合优先级排序】',
      tableContent(priorityRows, priorityColumns.filter(column => workbook.priority.columns.includes(column))),
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
        method: 'descriptive',
        methods: ['descriptive'],
        reason: `系统识别到上传的 Excel 已包含 KANO维度汇总统计、熵权法权重计算和耦合优先级排序，应优先读取这些结果表，而不是只对第一张原始问卷数据做通用描述统计。${top.length ? `当前优先级靠前维度包括：${top.join('、')}。` : ''}`,
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
        limitations: ['该方案直接采用工作簿中已计算出的 KANO 与熵权结果；若需要复核原始问卷编码，可回到原始数据表重新核算。'],
        toolCalls: [{ tool: 'descriptive', columns: workbook.priority.columns }],
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
    purpose: userRequest || '根据当前章节需要生成研究支撑内容。',
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
  const request = String(intent.userRequest ?? '')
  const methods = inferMethods(request, columns, numericColumns, categoricalColumns)
  const primary = methods[0] ?? 'descriptive'
  const groupColumn = categoricalColumns[0]
  const variables = numericColumns.slice(0, 8).map((column, index) => ({
    role: index === 0 ? 'independent' : index === 1 ? 'dependent' : index === 2 ? 'mediator' : 'item',
    name: column,
    column,
    confidence: /^[xmyv]\d*/i.test(column) ? 0.8 : 0.55,
    note: /^[xmyv]\d*/i.test(column) ? '按常见变量编码初步识别' : '按数值列位置初步识别，建议确认',
  }))
  if (groupColumn) variables.push({ role: 'group', name: groupColumn, column: groupColumn, confidence: 0.7, note: '识别为分组变量' })

  return {
    purpose: String(intent.purpose ?? request ?? '完成数据分析并生成可插入论文的研究支撑。'),
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
      '列名为自动映射，运行前需要用户确认。',
      'Python 只基于上传数据计算，不会补造缺失样本或统计结论。',
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
  const kanoPlan = await buildKanoEntropyPlan(body)
  if (kanoPlan) {
    res.json(kanoPlan.response)
    return
  }

  let profile: Record<string, unknown>
  try {
    profile = await runPython({ ...body, mode: 'profile' })
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

  if (!profile.ok) {
    res.status(400).json({ error: profile.error ?? 'Dataset profile failed' })
    return
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
    const kanoResult = await buildKanoEntropyResult(req.body ?? {})
    if (kanoResult) {
      res.json(kanoResult)
      return
    }

    const result = await runPython(req.body ?? {})
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Research analysis failed' })
      return
    }
    res.json(result)
  } catch (error) {
    console.warn('[research:analyze] Python analysis unavailable, using Node fallback:', error instanceof Error ? error.message : String(error))
    try {
      const result = await analyzeDatasetInNode(req.body ?? {})
      res.json(result)
    } catch (fallbackError) {
      res.status(500).json({ error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) })
    }
  }
})

export default router
