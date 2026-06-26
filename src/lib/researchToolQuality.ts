import type { Message } from './ai'

export type ResearchToolMode = 'survey' | 'interview' | 'kano' | 'ahp' | 'coding'

export interface ResearchToolSource {
  label: string
  text: string
  outlineText?: string
  fullText?: string
}

export interface ResearchToolRoute {
  label: string
  reason: string
  variables: {
    independent: string[]
    mediator: string[]
    dependent: string[]
  }
}

export interface ResearchDesignBrief {
  researchObject: string
  method: string
  variables: ResearchToolRoute['variables']
  candidateDimensions: string[]
  candidateTouchpoints: string[]
  dataCollection: string[]
  analysisPlan: string[]
}

export interface ResearchToolQualityCheck {
  ok: boolean
  score: number
  issues: string[]
}

const methodLabels: Record<ResearchToolMode, string> = {
  survey: '问卷量表',
  interview: '访谈提纲',
  kano: 'KANO 问卷',
  ahp: 'AHP 专家表',
  coding: '文本编码表',
}

const commonDesignTerms = [
  '视觉美感',
  '文化符号',
  '色彩系统',
  '图形纹样',
  '构图层次',
  '叙事表达',
  '情感共鸣',
  '文化认同',
  '互动体验',
  '传播意愿',
  '满意度',
  '购买意愿',
  '分享意愿',
]

function uniqueClean(items: string[], limit = 12): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  items.forEach(item => {
    const clean = item
      .replace(/[【】[\]（）()：:；;,.，。]/g, '')
      .replace(/^(研究|分析|探析|探究|基于|关于|面向)/, '')
      .trim()
    if (clean.length < 2 || clean.length > 28 || seen.has(clean)) return
    seen.add(clean)
    result.push(clean)
  })
  return result.slice(0, limit)
}

function extractCandidateTerms(text: string): string[] {
  const terms = Array.from(
    text.matchAll(/[“《]?([\u4e00-\u9fa5A-Za-z0-9]{2,18}(?:元素|符号|色彩|纹样|构图|风格|叙事|互动|体验|认同|意愿|满意度|传播|设计|形象|场景|情感|审美|功能|指标|维度))[”》]?/g)
  ).map(match => match[1])
  return uniqueClean([...terms, ...commonDesignTerms], 16)
}

export function buildResearchDesignBrief(
  mode: ResearchToolMode,
  title: string,
  source: ResearchToolSource,
  route: ResearchToolRoute,
): ResearchDesignBrief {
  const text = `${title}\n${source.outlineText ?? ''}\n${source.fullText || source.text}`
  const candidateTerms = extractCandidateTerms(text)
  const candidateDimensions = uniqueClean([
    ...route.variables.independent,
    ...route.variables.mediator,
    ...route.variables.dependent,
    ...candidateTerms,
  ], 12)
  const candidateTouchpoints = uniqueClean([
    ...candidateTerms,
    ...route.variables.independent,
    ...route.variables.dependent,
  ], mode === 'kano' ? 14 : 12)

  const dataCollectionByMode: Record<ResearchToolMode, string[]> = {
    survey: ['正式问卷回收', '样本筛选', '信度与效度检验', '相关/回归/中介或差异分析'],
    kano: ['KANO 正反题问卷回收', 'KANO 分类矩阵', 'Better-Worse 系数', '需求优先级排序'],
    interview: ['半结构式访谈', '访谈录音或文字转写', '开放编码', '主题归纳与典型语句提取'],
    ahp: ['专家评分', '两两比较判断矩阵', '一致性检验', '指标权重计算'],
    coding: ['文本/案例/评论材料收集', '开放编码', '主轴编码', '选择编码与主题模型'],
  }
  const analysisPlanByMode: Record<ResearchToolMode, string[]> = {
    survey: ['描述性统计', 'Cronbach α 信度检验', 'KMO/Bartlett 与因子分析', '相关分析', '回归或中介效应检验'],
    kano: ['正反向题组合分类', '各要素 M/O/A/I 频次统计', 'Better-Worse 系数计算', '四象限或优先级解释'],
    interview: ['逐字稿整理', '开放编码', '主轴编码', '选择编码', '主题饱和度与典型语句呈现'],
    ahp: ['建立层级结构', '专家两两比较', '一致性比例 CR 检验', '权重排序', '策略建议'],
    coding: ['样本清洗', '编码本建立', '双人复核或一致性说明', '主题归纳', '写入论文分析章节'],
  }

  return {
    researchObject: route.variables.dependent[0] || route.variables.independent[0] || title,
    method: methodLabels[mode],
    variables: route.variables,
    candidateDimensions,
    candidateTouchpoints,
    dataCollection: dataCollectionByMode[mode],
    analysisPlan: analysisPlanByMode[mode],
  }
}

function formatBrief(brief: ResearchDesignBrief): string {
  return [
    `研究对象：${brief.researchObject}`,
    `研究方法：${brief.method}`,
    `自变量/影响因素：${brief.variables.independent.join('、') || '待模型从材料中确认'}`,
    `中介/机制变量：${brief.variables.mediator.join('、') || '如不适合可不设置'}`,
    `因变量/结果变量：${brief.variables.dependent.join('、') || '待模型从材料中确认'}`,
    `候选维度：${brief.candidateDimensions.join('、') || '待模型补充'}`,
    `候选触点/题项来源：${brief.candidateTouchpoints.join('、') || '待模型补充'}`,
    `数据收集：${brief.dataCollection.join('；')}`,
    `后续分析：${brief.analysisPlan.join('；')}`,
  ].join('\n')
}

export function buildResearchToolPrompt(
  mode: ResearchToolMode,
  title: string,
  source: ResearchToolSource,
  route: ResearchToolRoute,
  templateText: string,
  brief: ResearchDesignBrief,
): Message[] {
  const commonRules = [
    '必须先依据论文题目、已有大纲/正文和研究对象抽取变量、维度、触点，再生成研究工具。',
    '输出必须可直接用于论文研究方法、附录或数据收集，不得只给简版示例；宁可完整偏长，也不要为了简洁牺牲题项数量。',
    '不得出现其他论文题目、旧案例或与当前论文无关的问卷说明。',
    '必须包含：工具正文、变量/维度说明、数据编码规则、后续分析步骤、论文写入建议。',
    '若当前材料已有全文，应优先使用全文中的论点、对象、章节和关键词来设计题项。',
    '所有题项必须围绕当前论文题目展开，不得套用“非遗短视频”“短视频平台”等旧案例，除非题目本身明确包含这些对象。',
  ]
  const modeRules: Record<ResearchToolMode, string[]> = {
    survey: [
      '正式问卷至少包含：筛选题、基本信息、接触经验、变量量表题、注意力检测题、开放题。',
      '核心变量不少于4个；每个变量至少4个题项；正式量表题建议不少于28题，整份问卷题目不少于38题。',
      '必须给出“变量-维度-题项编号”对应表，说明哪些题项测量自变量、中介变量、因变量或控制变量。',
      '必须写清Likert 5分或7分计分规则、反向题、信度/效度/相关/回归/中介等后续分析方式。',
    ],
    kano: [
      'KANO必须围绕具体设计触点/传播要素，不得把结果变量直接当功能项。',
      'KANO要素不少于12组；每组必须有正向题和反向题，因此KANO核心题不少于24题。若材料不足，必须从视觉、内容、情感、互动、平台/媒介、使用场景中补足触点。',
      '每个KANO要素必须包含：维度名称、具体触点、测量说明、正向题、反向题、预期类型M/O/A/I、入选理由。',
      '必须包含KANO判断矩阵、Better-Worse系数、编码规则、需求优先级解释方式。',
      '还应补充至少2组联动量表，例如感知价值、文化认同、审美满意度、传播意愿或购买/使用意愿；每组不少于4题，用于和KANO分类结果联动分析。',
      '必须包含预测试建议、无效样本剔除规则、正式样本量建议、问卷星/数据表字段建议。',
    ],
    interview: [
      '访谈提纲至少包含访谈对象、招募条件、开场说明、8-12个主问题和追问。',
      '问题应覆盖研究对象、经验过程、态度形成、关键事件、价值判断与改进建议。',
      '必须包含访谈资料整理方式、编码路径、典型语句引用和论文写入位置。',
    ],
    ahp: [
      '必须建立目标层、准则层、指标层三级结构；准则层建议4-6项，指标层不少于12个指标。',
      '每个准则层至少包含3个可评分指标，指标必须是专家能够两两比较的评价项，不能只写抽象概念。',
      '必须给出“指标编码-指标名称-指标定义-评分依据-对应论文章节”的对应表。',
      '必须给出准则层判断矩阵模板、每个准则下的指标层判断矩阵模板、专家评分说明、1-9标度说明、一致性检验CR标准和权重计算步骤。',
      '必须说明专家样本建议、专家筛选条件、评分回收格式、无效判断矩阵处理规则。',
      '指标必须来自当前论文对象和已有大纲/正文，不得套用文化认同、产品设计、价格、宣传渠道等通用模板，除非当前论文材料明确出现这些维度。',
    ],
    coding: [
      '必须输出编码对象、样本来源、编码单位、开放编码表、主轴编码表、选择编码主题。',
      '开放编码建议不少于12个，主轴编码不少于4类，并给出典型材料摘录占位。',
      '必须说明编码一致性、复核方式和如何写入论文分析章节。',
    ],
  }

  return [
    {
      role: 'system',
      content: [
        '你是艺术学、传播学、设计学论文研究方法专家。',
        '你的任务不是泛泛生成模板，而是基于论文全文/大纲设计可执行、可写入论文的研究工具。',
        '所有输出都要学术化、完整、可执行，并兼顾本科/硕士论文实际操作。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `请为以下论文生成正式的「${methodLabels[mode]}」。`,
        '',
        '【论文题目】',
        title,
        '',
        '【系统预分析：变量、维度与触点】',
        formatBrief(brief),
        '',
        '【研究路线】',
        route.label,
        route.reason,
        '',
        `【当前使用的论文上下文：${source.label}】`,
        source.text.slice(0, 12000),
        '',
        '【必须遵守的规则】',
        ...commonRules.map((rule, index) => `${index + 1}. ${rule}`),
        ...modeRules[mode].map((rule, index) => `${commonRules.length + index + 1}. ${rule}`),
        '',
        '【参考模板】',
        templateText.slice(0, 9000),
      ].join('\n'),
    },
  ]
}

function countRegex(text: string, regex: RegExp): number {
  return Array.from(text.matchAll(regex)).length
}

export function validateResearchTool(mode: ResearchToolMode, text: string): ResearchToolQualityCheck {
  const issues: string[] = []
  const normalized = text.replace(/\s+/g, '')

  if (normalized.length < 2200) issues.push('整体内容偏短，容易像简版示例而非正式研究工具。')
  if (!/编码|计分|变量|维度|分析/.test(normalized)) issues.push('缺少变量/维度、编码或后续分析说明。')

  if (mode === 'survey') {
    const questionCount = countRegex(text, /(?:^|\n)\s*(?:[A-Z]\d+|Q\d+|D\d+|S\d+|O\d+)[.．、]/g)
    if (questionCount < 38) issues.push(`量化问卷题量不足，当前识别约 ${questionCount} 题，建议不少于 38 题。`)
    if (!/信度|Cronbach|效度|KMO|因子|回归|相关/.test(normalized)) issues.push('缺少信度、效度、相关或回归等后续统计分析说明。')
    if (!/注意力|质控|无效样本/.test(normalized)) issues.push('缺少注意力检测或无效样本剔除规则。')
  }

  if (mode === 'kano') {
    const kanoGroups = countRegex(text, /(?:^|\n)\s*K\d+[.．、]/g)
    const positiveCount = countRegex(text, /正向题/g)
    const negativeCount = countRegex(text, /反向题/g)
    if (kanoGroups < 12 || positiveCount < 12 || negativeCount < 12) {
      issues.push(`KANO题项不足，当前约 ${kanoGroups} 组，需不少于 12 组正反题。`)
    }
    if (!/Better|Worse|系数|判断矩阵|需求类型/.test(normalized)) issues.push('缺少KANO判断矩阵或Better-Worse系数说明。')
    if (!/传播意愿|满意度|购买意愿|分享意愿|推荐意愿/.test(normalized)) issues.push('缺少与KANO结果联动的结果变量量表。')
    if (!/预测试|样本量|无效样本|问卷星|字段/.test(normalized)) issues.push('缺少预测试、样本量、无效样本或数据字段建议。')
  }

  if (mode === 'interview') {
    const questionCount = countRegex(text, /(?:^|\n)\s*(?:\d+|Q\d+)[.．、]/g)
    if (questionCount < 8) issues.push(`访谈主问题偏少，当前约 ${questionCount} 个，建议 8-12 个。`)
    if (!/追问|访谈对象|招募|逐字稿|编码/.test(normalized)) issues.push('缺少追问、访谈对象或编码整理说明。')
  }

  if (mode === 'ahp') {
    const indicatorCount = countRegex(text, /(?:指标|C\d+|P\d+|A\d+)[\s\S]{0,12}(?:：|:|[.．、])/g)
    if (indicatorCount < 12) issues.push(`AHP指标偏少，当前识别约 ${indicatorCount} 个，建议不少于 12 个。`)
    if (!/目标层|准则层|指标层|判断矩阵|一致性|CR|权重/.test(normalized)) issues.push('缺少AHP层级结构、判断矩阵或一致性检验说明。')
    if (!/专家|评分|回收|无效|筛选/.test(normalized)) issues.push('缺少专家筛选、评分回收或无效矩阵处理规则。')
    if (!/编码|指标定义|评分依据|论文章节/.test(normalized)) issues.push('缺少指标编码、指标定义、评分依据或论文写入位置说明。')
  }

  if (mode === 'coding') {
    const codeCount = countRegex(text, /(?:开放编码|编码)[\s\S]{0,20}(?:C\d+|[A-Z]\d+|：|:)/g)
    if (codeCount < 8) issues.push(`编码项偏少，当前识别约 ${codeCount} 个，建议开放编码不少于 12 个。`)
    if (!/开放编码|主轴编码|选择编码|典型语句|一致性|复核/.test(normalized)) issues.push('缺少完整编码路径、典型语句或一致性复核说明。')
  }

  const score = Math.max(0, 100 - issues.length * 18)
  return { ok: issues.length === 0, score, issues }
}

export function buildResearchToolRepairPrompt(
  mode: ResearchToolMode,
  title: string,
  source: ResearchToolSource,
  route: ResearchToolRoute,
  brief: ResearchDesignBrief,
  draft: string,
  issues: string[],
): Message[] {
  return [
    {
      role: 'system',
      content: '你是严格的论文研究方法审稿人和问卷/研究工具设计专家。请根据质检问题补全并重写研究工具，输出完整最终版。',
    },
    {
      role: 'user',
      content: [
        `论文题目：${title}`,
        `研究路线：${route.label}`,
        '',
        '【系统预分析】',
        formatBrief(brief),
        '',
        `【上下文：${source.label}】`,
        source.text.slice(0, 9000),
        '',
        '【当前草稿】',
        draft.slice(0, 12000),
        '',
        '【必须修复的问题】',
        ...issues.map((issue, index) => `${index + 1}. ${issue}`),
        '',
        mode === 'kano'
          ? '请输出正式KANO问卷最终版：不少于12组KANO正反题，并包含筛选题、基本信息、接触经验、至少2组联动量表、注意力检测、开放题、KANO判断矩阵、Better-Worse系数、编码与分析步骤、预测试和样本量建议。所有题项必须贴合当前论文对象，不得套用旧案例。'
          : mode === 'ahp'
            ? '请输出正式AHP专家评分工具最终版：包含目标层、4-6个准则层、至少12个指标层、指标编码表、准则层判断矩阵、各准则下指标层判断矩阵、1-9标度、专家筛选条件、一致性检验、权重计算、无效矩阵处理和论文写入建议。所有指标必须贴合当前论文对象，不得套用通用模板。'
          : '请输出正式研究工具最终版，必须补齐题量、变量/维度说明、编码规则、后续分析步骤和论文写入建议。',
      ].join('\n'),
    },
  ]
}
