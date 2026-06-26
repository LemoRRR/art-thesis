import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Pencil,
  Save,
  Upload,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { researchAPI, type ResearchWritePlanPlacement } from '../lib/api'
import { callGPT, type Message } from '../lib/ai'
import { editorDocToPlainText, ensurePaperEditorDoc } from '../lib/editorDocument'
import { createPackageFromAsset, researchPackageToPaperNodes } from '../lib/researchPackages'
import {
  buildResearchDesignBrief,
  buildResearchToolPrompt,
  buildResearchToolRepairPrompt,
  validateResearchTool,
} from '../lib/researchToolQuality'
import {
  outlineStore,
  projectStore,
  researchAssetStore,
  researchPackageStore,
  researchTaskStore,
  sectionStore,
  type OutlineSection,
  type ResearchAsset,
  type ResearchAssetType,
  type ResearchMethodType,
  type ResearchPackageComponent,
  type ResearchPlan,
  type ResearchTask,
  type ScaleAssetData,
  type ScaleVariable,
} from '../lib/storage'

type ToolMode = 'survey' | 'interview' | 'kano' | 'ahp' | 'coding'
type WorkspacePurpose = 'generate' | 'analyze' | 'optimize'
type SourceKind = 'outline' | 'full_text' | 'stage1'
type AnalysisPhase = 'idle' | 'uploaded' | 'planning' | 'running' | 'interpreting' | 'ready' | 'error'

interface ToolOption {
  value: ToolMode
  label: string
  shortLabel: string
  methodType: ResearchMethodType
  assetType: ResearchAssetType
  outcome: string
}

interface SourceContext {
  label: string
  text: string
  confidence: 'high' | 'medium' | 'low'
  outlineText: string
  fullText: string
}

interface SourceOption extends SourceContext {
  kind: SourceKind
  description: string
  available: boolean
}

interface InferredRoute {
  label: string
  reason: string
  preferredMode: ToolMode
  variables: {
    independent: string[]
    mediator: string[]
    dependent: string[]
  }
}

interface ParsedDataset {
  rows: Record<string, string>[]
  headers: string[]
}

interface KanoFeature {
  dimension: string
  name: string
  description: string
  positive: string
  negative: string
  expectedType: 'M' | 'O' | 'A' | 'I'
  reason: string
}

type ResultView = 'questionnaire' | 'analysis' | 'full'

interface MethodDraft {
  mode: ToolMode
  label: string
  reason: string
  dataNeeds: string
  outlineRequirements: string
  pendingTasks: string
}

const purposeOptions: Array<{
  value: WorkspacePurpose
  label: string
  desc: string
  action: string
}> = [
  {
    value: 'generate',
    label: '根据论文生成研究工具',
    desc: '从 Stage1、Stage2 大纲和已有正文里读取上下文，生成量表、问卷、KANO、AHP 或访谈/编码工具。',
    action: '选择工具并生成',
  },
  {
    value: 'analyze',
    label: '已有数据直接分析',
    desc: '用户已经有回收表、访谈文本或其他分析材料时，直接上传，系统先留痕再生成分析资产。',
    action: '上传数据或材料',
  },
  {
    value: 'optimize',
    label: '上传已有问卷优化',
    desc: '用户已有问卷时，检查重复题、引导性问题、维度覆盖和是否适合后续信效度分析。',
    action: '上传问卷检查',
  },
]

const toolOptions: ToolOption[] = [
  {
    value: 'survey',
    label: '问卷量表',
    shortLabel: '量表',
    methodType: 'quantitative',
    assetType: 'survey_questionnaire',
    outcome: '变量定义、维度、题项、反向题、计分规则、数据模板',
  },
  {
    value: 'interview',
    label: '访谈提纲',
    shortLabel: '访谈',
    methodType: 'qualitative',
    assetType: 'qualitative_coding',
    outcome: '访谈对象、主问题、追问、整理口径',
  },
  {
    value: 'kano',
    label: 'KANO 问卷',
    shortLabel: 'KANO',
    methodType: 'design_evaluation',
    assetType: 'kano_result',
    outcome: '功能项、正反向问题、标准选项、后续分析模板',
  },
  {
    value: 'ahp',
    label: 'AHP 专家表',
    shortLabel: 'AHP',
    methodType: 'design_evaluation',
    assetType: 'ahp_result',
    outcome: '目标层、准则层、指标层、专家评分表',
  },
  {
    value: 'coding',
    label: '文本编码表',
    shortLabel: '编码',
    methodType: 'qualitative',
    assetType: 'qualitative_coding',
    outcome: '开放编码、主轴编码、选择编码、情感倾向',
  },
]

const commonDesignTerms = ['视觉美感', '叙事沉浸感', '互动体验', '文化认同', '传播意愿', '使用意愿', '满意度', '购买意愿', '参与意愿']

function outlineToText(sections: OutlineSection[], depth = 0): string {
  return sections.map(section => {
    const children = section.children?.length ? `\n${outlineToText(section.children, depth + 1)}` : ''
    return `${'  '.repeat(depth)}${section.order} ${section.title}${children}`
  }).join('\n')
}

function projectContextText(project: ReturnType<typeof projectStore.ensure>): string {
  return [
    `论文题目：${project.title}`,
    project.context.researchObject ? `研究对象：${project.context.researchObject}` : '',
    project.context.writingBoundary ? `写作边界：${project.context.writingBoundary}` : '',
    project.context.coreArguments?.length ? `核心论点：${project.context.coreArguments.join('；')}` : '',
    project.context.rawSummary ? `Stage1 理解：\n${project.context.rawSummary}` : '',
  ].filter(Boolean).join('\n')
}

function getSourceOptions(projectId: string): SourceOption[] {
  const project = projectStore.ensure(projectId)
  const outline = outlineStore.get(projectId)
  const sections = sectionStore.getByProject(projectId)
  const outlineText = outline?.sections?.length ? outlineToText(outline.sections) : ''
  const fullText = sections
    .filter(section => section.status === 'done' && section.content.trim())
    .map(section => `${section.title}\n${section.content}`)
    .join('\n\n')
    .trim()
  const context = projectContextText(project)

  return [
    {
      kind: 'outline',
      label: '已有大纲',
      description: '适合先生成量表、问卷、KANO、AHP 或访谈提纲',
      available: Boolean(outlineText),
      confidence: outlineText ? 'high' : 'low',
      outlineText,
      fullText,
      text: outlineText
        ? [`【论文大纲】\n${outlineText}`, context ? `【项目理解】\n${context}` : ''].filter(Boolean).join('\n\n')
        : '当前项目还没有可用大纲。',
    },
    {
      kind: 'full_text',
      label: '已有全文',
      description: '适合根据已写内容补充研究工具或生成数据分析文字',
      available: Boolean(fullText),
      confidence: fullText ? 'high' : 'low',
      outlineText,
      fullText,
      text: fullText
        ? [`【已有正文】\n${fullText.slice(0, 9000)}`, context ? `【项目理解】\n${context}` : ''].filter(Boolean).join('\n\n')
        : '当前项目还没有已完成正文。',
    },
    {
      kind: 'stage1',
      label: 'Stage1 理解',
      description: '适合大纲和正文都不足时，用题目与统一理解兜底',
      available: Boolean(context || project.title),
      confidence: context ? 'medium' : 'low',
      outlineText: '',
      fullText: '',
      text: context || `论文题目：${project.title}`,
    },
  ]
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)))
}

function inferVariables(title: string, sourceText: string): InferredRoute['variables'] {
  const text = `${title}\n${sourceText}`
  const found = commonDesignTerms.filter(term => text.includes(term))
  const dependent = text.includes('传播意愿')
    ? ['传播意愿']
    : text.includes('使用意愿')
      ? ['使用意愿']
      : text.includes('满意度')
        ? ['满意度']
        : ['行为意愿']
  const mediator = text.includes('文化认同')
    ? ['文化认同']
    : text.includes('感知价值')
      ? ['感知价值']
      : []
  const independent = unique(found.filter(term => !dependent.includes(term) && !mediator.includes(term))).slice(0, 3)

  if (independent.length > 0) {
    return { independent, mediator, dependent }
  }

  if (/短视频|传播|媒介|社交|平台/.test(text)) {
    return {
      independent: ['内容呈现质量', '叙事吸引力', '互动体验'],
      mediator,
      dependent,
    }
  }

  if (/产品|交互|服务|设计|适老|文创/.test(text)) {
    return {
      independent: ['审美表现', '功能体验', '文化表达'],
      mediator: mediator.length ? mediator : ['感知价值'],
      dependent: text.includes('满意') ? ['满意度'] : ['使用意愿'],
    }
  }

  return {
    independent: ['感知质量', '情感体验', '情境适配'],
    mediator,
    dependent,
  }
}

function inferRoute(title: string, sourceText: string): InferredRoute {
  const text = `${title}\n${sourceText}`
  const variables = inferVariables(title, sourceText)

  if (/KANO|需求分析|功能项|用户需求|产品功能|服务设计|交互设计|适老化|文创设计/.test(text)) {
    return {
      label: '设计需求评价',
      reason: '文本中出现需求、功能或产品评价线索，更适合先生成 KANO 或 AHP 工具。',
      preferredMode: 'kano',
      variables,
    }
  }

  if (/影响|意愿|量化|问卷|变量|信度|效度|相关分析|回归|中介效应|数据收集/.test(text)) {
    return {
      label: '量化问卷研究',
      reason: '当前题目或大纲已经出现变量关系、问卷/数据收集或影响机制线索，建议先生成量表并预留第四章数据分析。',
      preferredMode: 'survey',
      variables,
    }
  }

  if (/访谈|扎根|质性|文本编码|情感编码|主题提取/.test(text)) {
    return {
      label: '质性研究',
      reason: '文本中出现访谈、扎根、案例或编码线索，更适合先生成访谈/编码工具。',
      preferredMode: 'interview',
      variables,
    }
  }

  return {
    label: '量化问卷研究',
    reason: '当前题目和大纲包含“影响研究/意愿/体验”等变量关系，建议先生成量表并预留第四章数据分析。',
    preferredMode: 'survey',
    variables,
  }
}

function variablesFromPlan(plan: ResearchPlan | undefined, fallback: InferredRoute['variables']): InferredRoute['variables'] {
  if (!plan?.variables) return fallback
  return {
    independent: plan.variables.independent?.length ? plan.variables.independent : fallback.independent,
    mediator: plan.variables.mediator?.length ? plan.variables.mediator : fallback.mediator,
    dependent: plan.variables.dependent?.length ? plan.variables.dependent : fallback.dependent,
  }
}

function preferredModeFromPlan(plan: ResearchPlan | undefined, fallback: ToolMode): ToolMode {
  if (!plan) return fallback
  if (plan.suggestedTools.includes('kano')) return 'kano'
  if (plan.suggestedTools.includes('ahp')) return 'ahp'
  if (plan.suggestedTools.some(tool => tool === 'grounded_coding' || tool === 'emotion_coding' || tool === 'theme_extraction')) return 'coding'
  if (plan.methodType === 'qualitative' || plan.suggestedTools.includes('case_summary')) return 'interview'
  if (plan.methodType === 'design_evaluation') return plan.suggestedTools.includes('ahp') ? 'ahp' : 'kano'
  if (plan.methodType === 'quantitative' || plan.methodType === 'mixed') return 'survey'
  return fallback
}

function routeFromResearchPlan(plan: ResearchPlan | undefined, fallback: InferredRoute): InferredRoute {
  if (!plan) return fallback
  const preferredMode = preferredModeFromPlan(plan, fallback.preferredMode)
  return {
    label: plan.methodLabel || fallback.label,
    reason: plan.methodReason || fallback.reason,
    preferredMode,
    variables: variablesFromPlan(plan, fallback.variables),
  }
}

function splitDraftList(value: string): string[] {
  return value.split(/[；;、,\n]/).map(item => item.trim()).filter(Boolean)
}

function toolKeysForMode(mode: ToolMode): ResearchPlan['suggestedTools'] {
  if (mode === 'survey') return ['scale_generation', 'hypothesis_model', 'survey_analysis']
  if (mode === 'interview') return ['theme_extraction']
  if (mode === 'kano') return ['kano']
  if (mode === 'ahp') return ['ahp']
  return ['grounded_coding', 'theme_extraction']
}

function createMethodDraft(route: InferredRoute, plan: ResearchPlan | undefined): MethodDraft {
  const mode = plan ? preferredModeFromPlan(plan, route.preferredMode) : route.preferredMode
  return {
    mode,
    label: plan?.methodLabel || route.label,
    reason: plan?.methodReason || route.reason,
    dataNeeds: plan?.dataNeeds.join('；') || '根据所选工具生成问卷、访谈或编码材料',
    outlineRequirements: plan?.outlineRequirements.join('；') || '研究方法；数据分析；结果讨论',
    pendingTasks: plan?.pendingResearchTasks.join('；') || '生成研究工具；等待用户收集数据；上传数据并分析',
  }
}

function streamResearchText(messages: Message[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullContent = ''
    callGPT(messages, {
      onChunk: (chunk) => {
        fullContent += chunk
      },
      onDone: () => resolve(fullContent.trim()),
      onError: reject,
    })
  })
}

function createVariable(name: string, role: ScaleVariable['role'], index: number): ScaleVariable {
  const prefix = role === 'independent' ? 'X' : role === 'dependent' ? 'Y' : role === 'mediator' ? 'M' : 'V'
  const stem = role === 'dependent' ? '我愿意' : '我认为'
  return {
    id: `${role}-${index}-${Date.now()}`,
    name,
    role,
    definition: `${name}指受访者围绕研究对象形成的相关感知、态度或行为倾向，用于解释论文模型中的${role === 'independent' ? '前因变量' : role === 'mediator' ? '中介机制' : '结果变量'}。`,
    dimensions: [
      {
        id: `${role}-${index}-dimension-${Date.now()}`,
        name,
        definition: `围绕${name}形成的核心测量维度。`,
        items: [
          {
            id: `${role}-${index}-item-1-${Date.now()}`,
            code: `${prefix}${index + 1}1`,
            text: `${stem}该研究对象在${name}方面具有较强表现。`,
            reverseScored: false,
            required: true,
          },
          {
            id: `${role}-${index}-item-2-${Date.now()}`,
            code: `${prefix}${index + 1}2`,
            text: `${stem}该研究对象的${name}能够影响我的整体判断。`,
            reverseScored: false,
            required: true,
          },
          {
            id: `${role}-${index}-item-3-${Date.now()}`,
            code: `${prefix}${index + 1}3`,
            text: `${stem}该研究对象在${name}方面的表现并不明显。`,
            reverseScored: true,
            required: true,
          },
        ],
      },
    ],
  }
}

function buildScale(projectTitle: string, route: InferredRoute): ScaleAssetData {
  return {
    title: `${projectTitle}调研问卷`,
    version: 1,
    researchTopic: projectTitle,
    scaleType: 'likert_5',
    variables: [
      ...route.variables.independent.map((name, index) => createVariable(name, 'independent', index)),
      ...route.variables.mediator.map((name, index) => createVariable(name, 'mediator', index)),
      ...route.variables.dependent.map((name, index) => createVariable(name, 'dependent', index)),
    ],
    scoringRules: '采用李克特 5 分制：1=非常不同意，2=不同意，3=一般，4=同意，5=非常同意。反向题需反向计分后再计算维度均值；同一变量下题项取均值作为变量得分。',
    notes: '本量表根据当前论文大纲/正文自动生成，可由用户编辑后保存为新版本；后续统计分析以最终确认版本和回收数据为准。',
  }
}

function formatScale(scale: ScaleAssetData, route: InferredRoute, sourceLabel: string): string {
  const hypotheses = [
    ...route.variables.independent.map((x, index) => `H${index + 1}：${x}对${route.variables.dependent[0]}具有显著正向影响。`),
    ...(route.variables.mediator.length
      ? [`H${route.variables.independent.length + 1}：${route.variables.mediator[0]}在${route.variables.independent.join('、')}与${route.variables.dependent[0]}之间发挥中介作用。`]
      : []),
  ]

  return [
    `【问卷标题】${scale.title}`,
    '',
    '【研究模型】',
    `研究路线：${route.label}`,
    `模型框架：${route.variables.independent.join('、')} → ${route.variables.mediator.length ? `${route.variables.mediator.join('、')} → ` : ''}${route.variables.dependent.join('、')}`,
    ...hypotheses,
    '',
    '【问卷说明】',
    `您好！本问卷用于了解“${scale.researchTopic}”相关体验、态度与行为意愿。问卷仅用于论文研究，答案没有对错之分，请根据真实感受填写。`,
    '',
    '【一、基本信息】',
    'D1. 您的性别：男 / 女 / 其他 / 不便透露',
    'D2. 您的年龄：18岁以下 / 18-25岁 / 26-35岁 / 36-45岁 / 46岁及以上',
    'D3. 您的最高学历：高中及以下 / 专科 / 本科 / 硕士及以上',
    'D4. 您接触相关内容或产品的频率：从不 / 偶尔 / 有时 / 经常 / 非常频繁',
    '',
    '【二、量表题项】',
    '请根据真实感受选择最符合的一项：1=非常不同意，2=不同意，3=一般，4=同意，5=非常同意。',
    '',
    ...scale.variables.flatMap(variable => [
      `【${variable.name}】`,
      `变量定义：${variable.definition}`,
      ...variable.dimensions.flatMap(dimension => dimension.items.map(item =>
        `${item.code}. ${item.text}${item.reverseScored ? '（反向题）' : ''}`
      )),
      '',
    ]),
    '【计分说明】',
    scale.scoringRules,
    '',
    `生成依据：${sourceLabel}`,
  ].join('\n')
}

function inferKanoFeatures(title: string, sourceText: string): KanoFeature[] {
  const text = `${title}\n${sourceText}`

  if (/古籍|书籍|装帧|版式|阅读/.test(text)) {
    return [
      {
        dimension: '版面结构',
        name: '天头地脚留白',
        description: '关于书页整体排版与空间组织方式',
        positive: '如果这本书采用了模仿古籍的天头地脚留白（上下页边距较宽，形成“留空框架”），您感觉如何？',
        negative: '如果这本书没有采用天头地脚留白，而是与普通现代书籍一样的紧凑页边距，您感觉如何？',
        expectedType: 'A',
        reason: '普通读者不一定预期该要素，有则容易形成古籍气质上的惊喜。',
      },
      {
        dimension: '版框与界行',
        name: '版框线设计',
        description: '关于页面边框、栏线等视觉分割元素',
        positive: '如果书页中使用了源自古籍的版框线（页面四周细线围合，形成矩形框架），您感觉如何？',
        negative: '如果书页中没有版框线设计，您感觉如何？',
        expectedType: 'A',
        reason: '版框线带来强烈古典识别度，但并非现代读者默认期待。',
      },
      {
        dimension: '字体与排版',
        name: '仿宋/楷体字体',
        description: '关于正文字体选择与文字排列方式',
        positive: '如果书籍正文采用具有古籍风格的仿宋或楷体字体（区别于现代常用的黑体、宋体），您感觉如何？',
        negative: '如果书籍正文使用普通现代字体，没有古籍字体风格，您感觉如何？',
        expectedType: 'O',
        reason: '字体影响可读性与风格一致性，适配度越高，满意度通常越高。',
      },
      {
        dimension: '装饰纹样',
        name: '传统纹样',
        description: '关于书口、封面等部位的装饰性元素',
        positive: '如果封面或章节页使用了来自古籍的传统纹样（如云纹、回纹、卷草纹），您感觉如何？',
        negative: '如果封面或章节页没有传统纹样装饰，您感觉如何？',
        expectedType: 'A',
        reason: '纹样主要承担装饰和文化联想功能，通常不是基本功能需求。',
      },
      {
        dimension: '色彩系统',
        name: '低饱和哑光配色',
        description: '关于书籍整体色彩方案',
        positive: '如果书籍整体采用古籍常见的低饱和度色调（米黄、灰蓝、朱砂红等哑光配色），您感觉如何？',
        negative: '如果书籍采用现代设计常见的鲜明色彩，没有古籍哑光配色，您感觉如何？',
        expectedType: 'O',
        reason: '色彩系统直接影响整体氛围与阅读感受，适配越好体验越好。',
      },
      {
        dimension: '书口与装订',
        name: '线装/仿线装工艺',
        description: '关于书籍物理形态与装订方式',
        positive: '如果书籍采用线装或仿线装工艺（书脊可见缝线，模仿古籍装订），您感觉如何？',
        negative: '如果书籍采用普通胶装，没有线装工艺，您感觉如何？',
        expectedType: 'A',
        reason: '装订工艺成本较高，消费者通常不视为基本要求，但出现时有明显记忆点。',
      },
      {
        dimension: '图像风格',
        name: '白描/水墨插图',
        description: '关于书中插图与图像处理风格',
        positive: '如果书中插图采用白描线稿或水墨风格（古籍版画风格），您感觉如何？',
        negative: '如果书中插图采用现代摄影或数字插画，没有白描水墨风格，您感觉如何？',
        expectedType: 'O',
        reason: '图像风格影响内容体验和视觉一致性，越适配越能提升整体评价。',
      },
      {
        dimension: '整体文化感',
        name: '古典文化气息',
        description: '关于书籍整体传递的文化氛围',
        positive: '如果这本书在整体设计上明显能感受到古典文化气息（让人联想到传统典籍），您感觉如何？',
        negative: '如果这本书在整体设计上感受不到古典文化气息，与普通现代书籍无异，您感觉如何？',
        expectedType: 'M',
        reason: '古典文化感是古籍版式美学再生设计的核心承诺，缺失会削弱研究对象成立基础。',
      },
    ]
  }

  if (/国潮|插画/.test(text)) {
    return [
      {
        dimension: '传统色彩',
        name: '传统色彩与现代配色融合',
        description: '关于国潮插画中色彩识别、色彩情绪和现代审美适配',
        positive: '如果国潮插画能够将传统色彩与现代配色方式自然融合，您的感受是？',
        negative: '如果国潮插画的色彩缺乏传统辨识度，也不符合现代审美，您的感受是？',
        expectedType: 'O',
        reason: '色彩是国潮插画最直接的视觉识别入口，通常会影响整体吸引力。',
      },
      {
        dimension: '文化符号',
        name: '传统文化符号的创新转译',
        description: '关于纹样、器物、神话、民俗或地域文化符号的再设计',
        positive: '如果国潮插画能以新颖方式转译传统文化符号，您的感受是？',
        negative: '如果国潮插画几乎看不出传统文化符号或只是简单堆砌符号，您的感受是？',
        expectedType: 'M',
        reason: '文化符号是国潮插画区别于普通商业插画的基础条件。',
      },
      {
        dimension: '造型语言',
        name: '人物/动物/器物造型的国潮化表达',
        description: '关于角色、器物和装饰形态的造型设计',
        positive: '如果国潮插画中的人物、动物或器物造型具有鲜明国潮风格，您的感受是？',
        negative: '如果国潮插画造型普通，缺少国潮风格特征，您的感受是？',
        expectedType: 'O',
        reason: '造型语言会影响受众对插画主题和风格的第一判断。',
      },
      {
        dimension: '构图层次',
        name: '画面构图与视觉层次',
        description: '关于主体突出、留白、层次组织和视觉秩序',
        positive: '如果国潮插画构图清晰、主体突出且层次丰富，您的感受是？',
        negative: '如果国潮插画构图混乱、主体不清或层次单薄，您的感受是？',
        expectedType: 'O',
        reason: '构图决定信息阅读效率和视觉停留时间。',
      },
      {
        dimension: '装饰细节',
        name: '纹样与细节丰富度',
        description: '关于装饰纹样、线条细节和局部工艺感',
        positive: '如果国潮插画在纹样、线条和局部细节上较为精致，您的感受是？',
        negative: '如果国潮插画细节粗糙、装饰单薄，您的感受是？',
        expectedType: 'A',
        reason: '细节通常不是最低要求，但能提升审美惊喜和收藏意愿。',
      },
      {
        dimension: '现代融合',
        name: '传统元素与当代生活场景结合',
        description: '关于传统文化元素是否能进入青年熟悉的现代消费和生活语境',
        positive: '如果国潮插画能把传统元素融入当代生活、消费或社交场景，您的感受是？',
        negative: '如果国潮插画只停留在传统元素展示，缺少现代生活关联，您的感受是？',
        expectedType: 'A',
        reason: '现代场景融合有助于青年群体产生亲近感和使用想象。',
      },
      {
        dimension: '情感共鸣',
        name: '民族文化认同与情绪感染',
        description: '关于插画是否激发文化自豪感、亲切感或情感记忆',
        positive: '如果国潮插画能激发您对传统文化的亲切感、自豪感或情感共鸣，您的感受是？',
        negative: '如果国潮插画缺少情感表达，难以引发文化认同，您的感受是？',
        expectedType: 'A',
        reason: '情感共鸣会影响主动分享、收藏和持续关注。',
      },
      {
        dimension: '信息传达',
        name: '主题含义与文化说明清晰度',
        description: '关于插画主题、文化来源和设计含义是否易于理解',
        positive: '如果国潮插画能够让人清楚理解主题含义和文化来源，您的感受是？',
        negative: '如果国潮插画含义模糊，难以理解其文化来源或主题，您的感受是？',
        expectedType: 'O',
        reason: '清晰的信息传达能降低理解门槛，提高传播效率。',
      },
      {
        dimension: '媒介适配',
        name: '社交媒体传播与屏幕观看适配',
        description: '关于插画在手机屏幕、社交平台和动态传播中的呈现效果',
        positive: '如果国潮插画在手机屏幕和社交媒体中依然清晰醒目，您的感受是？',
        negative: '如果国潮插画在手机屏幕中细节难辨、传播展示效果较差，您的感受是？',
        expectedType: 'O',
        reason: '青年群体接触插画的重要场景通常包含移动端和社交媒体。',
      },
      {
        dimension: '应用延展',
        name: '文创产品与商业应用适配',
        description: '关于插画是否适合用于服饰、包装、海报、文具或数字周边',
        positive: '如果国潮插画适合延展到文创产品、包装或数字周边中，您的感受是？',
        negative: '如果国潮插画难以应用到实际产品或传播物料中，您的感受是？',
        expectedType: 'A',
        reason: '应用延展会影响设计价值和消费转化潜力。',
      },
      {
        dimension: '原创性',
        name: '原创表达与同质化区分',
        description: '关于作品是否避免模板化、拼贴化和同质化国潮表达',
        positive: '如果国潮插画具有较强原创性，能区别于常见模板化国潮作品，您的感受是？',
        negative: '如果国潮插画明显同质化，像常见素材拼贴或模板作品，您的感受是？',
        expectedType: 'O',
        reason: '原创性影响作品的新鲜感、专业评价和长期传播价值。',
      },
      {
        dimension: '审美协调',
        name: '整体风格统一与视觉完成度',
        description: '关于色彩、造型、符号、构图之间是否协调统一',
        positive: '如果国潮插画整体风格统一、视觉完成度较高，您的感受是？',
        negative: '如果国潮插画各元素拼接感强、整体风格不协调，您的感受是？',
        expectedType: 'M',
        reason: '整体协调性是插画作品获得基本认可的重要条件。',
      },
    ]
  }

  if (/非遗|短视频/.test(text)) {
    return [
      {
        dimension: '视觉呈现',
        name: '非遗视觉符号的清晰呈现',
        description: '关于非遗纹样、器物、工艺步骤等视觉识别元素',
        positive: '如果短视频能清晰展示非遗纹样、器物、工艺步骤或代表性视觉符号，您的感受是？',
        negative: '如果短视频几乎看不清非遗视觉符号，只保留笼统画面，您的感受是？',
        expectedType: 'M',
        reason: '非遗视觉符号是内容识别的基础，缺失会直接影响理解。',
      },
      {
        dimension: '真实性表达',
        name: '非遗技艺真实性与原生语境保留',
        description: '关于非遗内容是否保留真实技艺、传承人、地域语境和工艺细节',
        positive: '如果短视频能够呈现真实的非遗技艺过程、传承人身份或地域文化语境，您的感受是？',
        negative: '如果短视频弱化真实技艺过程，只以流行化包装替代非遗原有语境，您的感受是？',
        expectedType: 'M',
        reason: '真实性是非遗传播可信度和文化认同形成的基础条件。',
      },
      {
        dimension: '文化说明',
        name: '创作过程与文化背景讲解',
        description: '关于工艺过程、历史来源或文化含义的解释',
        positive: '如果短视频在展示画面的同时补充工艺过程、历史来源或文化含义，您的感受是？',
        negative: '如果短视频只展示结果，不说明工艺过程或文化背景，您的感受是？',
        expectedType: 'O',
        reason: '讲解越充分，越能提高文化理解和传播意愿。',
      },
      {
        dimension: '视听质量',
        name: '画面质感与声音设计',
        description: '关于镜头清晰度、色彩风格、音乐音效和整体视听完成度',
        positive: '如果短视频具有清晰画面、稳定镜头、适配音乐和较高视听完成度，您的感受是？',
        negative: '如果短视频画面粗糙、声音杂乱或剪辑完成度较低，您的感受是？',
        expectedType: 'O',
        reason: '视听质量会影响青年用户的观看体验和停留意愿。',
      },
      {
        dimension: '叙事节奏',
        name: '适合青年观看的节奏与叙事',
        description: '关于剪辑节奏、故事化表达和观看门槛',
        positive: '如果短视频用更紧凑的节奏、故事化剪辑和年轻化表达呈现非遗内容，您的感受是？',
        negative: '如果短视频节奏拖沓、叙事平淡，不符合青年用户观看习惯，您的感受是？',
        expectedType: 'O',
        reason: '青年化叙事直接影响观看体验，越适配越有利于传播。',
      },
      {
        dimension: '情感共鸣',
        name: '个体故事与情感连接',
        description: '关于传承人故事、用户生活经验和情感记忆的连接方式',
        positive: '如果短视频通过传承人故事、生活场景或情感化表达增强您对非遗的共鸣，您的感受是？',
        negative: '如果短视频只罗列信息，缺少人物故事或情感连接，您的感受是？',
        expectedType: 'A',
        reason: '情感共鸣不是基本信息条件，但能显著提升主动分享和讨论意愿。',
      },
      {
        dimension: '互动传播',
        name: '评论、转发与二创参与引导',
        description: '关于评论话题、转发提示或二创挑战等互动机制',
        positive: '如果短视频设置评论话题、转发提示或二创挑战来鼓励参与传播，您的感受是？',
        negative: '如果短视频没有任何互动或转发引导，只让用户被动观看，您的感受是？',
        expectedType: 'A',
        reason: '互动引导不是基本内容条件，但能带来额外参与动机。',
      },
      {
        dimension: '平台适配',
        name: '平台算法与社交传播适配',
        description: '关于话题标签、热点结合、封面标题和平台推荐机制适配',
        positive: '如果短视频能通过合适的话题标签、封面标题和热点结合提升被看见与转发的可能，您的感受是？',
        negative: '如果短视频缺少平台化表达，标题、封面和标签都难以吸引点击，您的感受是？',
        expectedType: 'A',
        reason: '平台适配会提高传播效率，但通常属于额外增益型要素。',
      },
    ]
  }

  if (/数字人|虚拟人|形象|IP/.test(text)) {
    return [
      {
        dimension: '形象识别',
        name: '角色外观与身份设定',
        description: '关于虚拟数字人的外观、服饰和身份记忆点',
        positive: '如果虚拟数字人的外观、服饰和身份设定具有清晰辨识度，您的感受是？',
        negative: '如果虚拟数字人的外观和身份设定较模糊，难以形成记忆点，您的感受是？',
        expectedType: 'O',
        reason: '识别度越高，越容易建立角色记忆和传播基础。',
      },
      {
        dimension: '交互表现',
        name: '表情动作与语音互动',
        description: '关于虚拟数字人的表情、动作、语音和反馈自然度',
        positive: '如果虚拟数字人具备自然的表情、动作和语音互动能力，您的感受是？',
        negative: '如果虚拟数字人的表情动作僵硬，互动反馈不自然，您的感受是？',
        expectedType: 'M',
        reason: '自然互动是虚拟数字人体验的基础条件。',
      },
      {
        dimension: '场景适配',
        name: '内容场景适配',
        description: '关于直播、展览、导览或传播场景中的表达调整',
        positive: '如果虚拟数字人的形象能根据直播、展览、导览或传播场景调整表达方式，您的感受是？',
        negative: '如果虚拟数字人在不同场景中都使用同一套僵化表达，您的感受是？',
        expectedType: 'A',
        reason: '场景化适配能带来超出基础使用的体验增益。',
      },
    ]
  }

  const concreteFromOutline = Array.from(text.matchAll(/\d+(?:\.\d+)*\s*([^\n：:]{4,24})/g))
    .map(match => match[1].trim())
    .filter(item => !/研究|方法|意义|背景|综述|结论|数据|分析/.test(item))
    .slice(0, 12)

  if (concreteFromOutline.length >= 2) {
    return concreteFromOutline.map(item => ({
      dimension: item,
      name: item,
      description: `关于${item}的具体设计或功能呈现`,
      positive: `如果研究对象在“${item}”方面有明确设计或功能呈现，您的感受是？`,
      negative: `如果研究对象缺少“${item}”方面的设计或功能呈现，您的感受是？`,
      expectedType: 'O' as const,
      reason: '该项来自论文大纲，需通过回收数据验证实际需求类型。',
    }))
  }

  return [
    {
      dimension: '待补充',
      name: '待补充的具体功能或设计触点',
      description: '当前大纲缺少可用于 KANO 的具体功能项',
      positive: '如果该功能/设计触点被清晰提供，您的感受是？',
      negative: '如果该功能/设计触点完全缺失，您的感受是？',
      expectedType: 'I',
      reason: '需先补充功能项或设计触点，否则不建议直接发放问卷。',
    },
  ]
}

function getKanoResearchObject(title: string): string {
  if (/国潮|插画/.test(title)) return '国潮插画视觉元素'
  if (/非遗/.test(title)) return '非遗内容视觉呈现'
  if (/短视频/.test(title)) return '短视频内容呈现'
  const quoted = title.match(/《([^》]+)》/)
  if (quoted?.[1]) return quoted[1]
  return title
    .replace(/(——|--).*/, '')
    .replace(/(的)?(影响研究|实证研究|分析调查问卷|调查问卷|研究|分析|探析|探究)$/g, '')
    .trim() || title
}

function formatKanoQuestionnaire(title: string, features: KanoFeature[]): string {
  const researchObject = getKanoResearchObject(title)
  const audience = /青年/.test(title) ? '18-35岁、对研究对象有接触或兴趣的青年群体' : '对研究对象有接触经验或兴趣的目标用户'
  return [
    '【问卷正文】',
    `问卷标题：${title}调查问卷`,
    `研究题目：${title}`,
    `调研对象：${audience}`,
    `核心题项：${features.length} 组 KANO 正反题，共 ${features.length * 2} 题；另含筛选题、基本信息、接触经验、态度/满意度/传播意愿联动量表与注意力检测题。`,
    '',
    '【问卷说明】',
    `您好！本问卷旨在了解“${researchObject}”相关视觉/内容/体验要素对受众满意度、文化认同或传播意愿的影响。问卷仅用于学术研究，采用匿名方式收集数据，所有答案没有对错之分，请您根据真实接触经验和主观感受作答。预计填写时间约为 8-12 分钟。`,
    '',
    '【一、筛选题】',
    `S1. 您是否了解、浏览、购买或关注过与“${researchObject}”相关的作品、产品或内容？`,
    'A. 是',
    'B. 否（选择此项可结束问卷）',
    '',
    `S2. 您接触“${researchObject}”相关内容或产品的频率是？`,
    'A. 经常',
    'B. 偶尔',
    'C. 听说过但很少接触',
    'D. 从未接触（选择此项可结束问卷或作为低接触样本单独标记）',
    '',
    `S3. 您是否愿意根据真实感受评价“${researchObject}”中的具体视觉、文化和体验要素？`,
    'A. 愿意',
    'B. 不愿意（选择此项可结束问卷）',
    '',
    '【二、基本信息】',
    'D1. 您的性别：男 / 女 / 其他 / 不便透露',
    'D2. 您的年龄：18岁以下 / 18-25岁 / 26-30岁 / 31-35岁 / 36岁及以上',
    'D3. 您的最高学历：高中及以下 / 专科 / 本科 / 硕士及以上',
    'D4. 您目前的身份：在校学生 / 企业职员 / 自由职业 / 文创或艺术相关从业者 / 其他',
    '',
    'D5. 您是否具有艺术、设计、传播、文创或相关学习/工作背景：是 / 否',
    '',
    '【三、接触经验与使用情境】',
    `U1. 您接触“${researchObject}”相关内容或产品的主要渠道：社交媒体 / 电商平台 / 展览活动 / 课程学习 / 朋友推荐 / 线下消费 / 其他`,
    `U2. 您接触“${researchObject}”相关内容或产品的频率：几乎不接触 / 偶尔接触 / 有时接触 / 经常接触`,
    'U3. 您最常见的接触形式：海报或平面作品 / 文创产品 / 包装设计 / 数字媒体内容 / 展览展示 / 其他',
    'U4. 您关注此类内容时最看重：审美效果 / 文化内涵 / 实用价值 / 社交传播 / 情感共鸣 / 价格或可获得性',
    'U5. 您是否曾经点赞、收藏、购买、评论或转发过类似内容：经常 / 偶尔 / 很少 / 从未',
    '',
    '【四、KANO需求题项】',
    '说明：以下每组问题均包含“如果具备该特征”和“如果不具备该特征”两种情境，请分别选择您的真实感受。选项含义为：非常喜欢 / 理所当然 / 无所谓 / 勉强接受 / 非常不喜欢。',
    '',
    ...features.flatMap((feature, index) => [
      `K${index + 1}. ${feature.dimension}：${feature.name}`,
      `测量说明：${feature.description}`,
      `K${index + 1}a 正向题`,
      feature.positive,
      '非常喜欢',
      '理所当然',
      '无所谓',
      '勉强接受',
      '非常不喜欢',
      `K${index + 1}b 反向题`,
      feature.negative,
      '非常喜欢',
      '理所当然',
      '无所谓',
      '勉强接受',
      '非常不喜欢',
      '',
    ]),
    '【五、联动量表】',
    '说明：以下题项采用李克特5分制，1=非常不同意，2=不同意，3=一般，4=同意，5=非常同意。',
    '【文化认同】',
    `CI1. 如果“${researchObject}”能准确呈现传统文化内涵，我会增强对相关文化的认同感。`,
    `CI2. 如果“${researchObject}”具有清晰的文化来源和审美逻辑，我会认为其更有研究或消费价值。`,
    `CI3. 如果“${researchObject}”能把传统元素转化为现代语言，我会觉得传统文化更贴近当代生活。`,
    `CI4. 总体而言，优秀的“${researchObject}”能够提升我对本土文化表达的好感。`,
    '【审美满意度】',
    `SA1. “${researchObject}”的视觉风格会影响我对作品/产品的整体评价。`,
    `SA2. 当“${researchObject}”具有较高视觉完成度时，我会更愿意停留观看或进一步了解。`,
    `SA3. 如果“${researchObject}”元素拼贴感较强或同质化明显，我的满意度会降低。`,
    `SA4. 总体而言，我会因为视觉审美质量更高而更喜欢该类内容或产品。`,
    '【传播/使用意愿】',
    `W1. 如果“${researchObject}”具有鲜明识别度，我愿意点赞、收藏或保存。`,
    `W2. 如果“${researchObject}”能清楚传达文化内涵，我愿意推荐给朋友或同学。`,
    `W3. 如果“${researchObject}”具有情感共鸣或新鲜表达，我愿意在社交平台分享。`,
    `W4. 如果“${researchObject}”适合实际产品或生活场景，我愿意尝试购买、使用或持续关注。`,
    '',
    '【六、注意力检测】',
    'C1. 为保证问卷质量，请您在本题选择“同意”。',
    'C2. 以下陈述用于检测认真作答，请选择“非常不同意”。',
    '',
    '【七、开放题】',
    `O1. 您认为当前“${researchObject}”相关作品或产品最需要改进的地方是什么？`,
    `O2. 哪类“${researchObject}”最容易让您产生收藏、购买、评论或分享意愿？请简要说明原因。`,
    `O3. 请写出一个您印象较深的“${researchObject}”案例，并说明吸引或不吸引您的原因。`,
  ].join('\n')
}

function formatKanoAnalysis(features: KanoFeature[]): string {
  return [
    '【Kano分析框架】',
    'Kano模型将需求分为四类：必备型M（缺少会不满）、期望型O（越多越好）、魅力型A（有则惊喜）、无差异型I（有无无所谓）。通过正反向题组合判断，填入下表。',
    '',
    '【Kano结果判断矩阵】',
    '正向问题（行）× 反向问题（列）→ 对应格即需求类型',
    '',
    '正向 \\ 反向\t非常喜欢\t理所当然\t无所谓\t勉强接受\t非常不喜欢',
    '非常喜欢\t可疑Q\t魅力A\t魅力A\t魅力A\t期望O',
    '理所当然\t可疑Q\t无差异I\t无差异I\t无差异I\t必备M',
    '无所谓\t可疑Q\t无差异I\t无差异I\t无差异I\t必备M',
    '勉强接受\t可疑Q\t无差异I\t无差异I\t无差异I\t必备M',
    '非常不喜欢\t反向R\t反向R\t反向R\t反向R\t可疑Q',
    '',
    '【各维度预期需求类型参考】',
    '维度\t设计要素\t预期类型\t理由',
    ...features.map(feature => `${feature.dimension}\t${feature.name}\t${feature.expectedType}\t${feature.reason}`),
    '',
    '【数据处理步骤】',
    '① 个体分类：每位受访者每组题目 → 对照判断矩阵 → 得出该维度的需求类型（M/O/A/I）。',
    '② 频次汇总：每个维度统计各类型人数比例，取最多的类型为该维度结论。',
    '③ Better-Worse 系数：Better=(A+O)/(A+O+M+I)，Worse=-(O+M)/(A+O+M+I)，用于判断该要素对满意提升和不满降低的作用强度。',
    '④ 优先级排序：结合需求类型、Better-Worse 系数和传播意愿均值，判断哪些要素应优先进入内容优化策略。',
    '⑤ 与传播意愿量表联动：将 W1-W5 求均值作为“传播意愿”变量，可进一步与Kano分类结果做交叉分析或分组比较。',
    '⑥ 与案例分析对照：将Kano结果与具体非遗短视频案例结合，检验高优先级要素是否在优秀案例中得到体现。',
    '',
    '【使用建议】',
    '建议正式样本量不少于 100 份；若用于课程论文或本科论文，可先进行 30 份左右预测试，检查题项理解度、无效样本比例和开放题反馈。正式论文中建议报告样本结构、Kano分类频次、Better-Worse系数、传播意愿描述统计及典型开放回答。',
  ].join('\n')
}

function splitKanoText(text: string, view: ResultView): string {
  if (view === 'full') return text
  const questionnaireStart = text.indexOf('【问卷正文】')
  const analysisStart = text.indexOf('【Kano分析框架】')
  if (view === 'questionnaire' && questionnaireStart >= 0) {
    return text.slice(questionnaireStart, analysisStart >= 0 ? analysisStart : undefined).trim()
  }
  if (view === 'analysis' && analysisStart >= 0) {
    return text.slice(analysisStart).trim()
  }
  return text
}

function buildResearchTool(mode: ToolMode, title: string, source: SourceContext, route: InferredRoute): { text: string; data: unknown } {
  if (mode === 'survey') {
    const scale = buildScale(title, route)
    return { text: formatScale(scale, route, source.label), data: scale }
  }

  if (mode === 'interview') {
    const questions = [
      `您如何理解“${title}”中的核心研究对象？`,
      `您在接触该研究对象时，最先注意到哪些视觉、叙事、交互或文化特征？`,
      `这些特征是否会影响您的认同、参与或传播意愿？请结合具体经历说明。`,
      `您认为当前研究对象在传播或设计实践中最需要改进的部分是什么？`,
      `如果要进一步优化，您期待哪些功能、表达方式或体验变化？`,
    ]
    return {
      data: { mode, questions, source: source.label },
      text: [
        `【访谈提纲】${title}`,
        '',
        '【访谈对象】与研究对象有接触经验的用户、创作者、设计从业者或相关专业学生。',
        '',
        '【核心问题】',
        ...questions.map((question, index) => `${index + 1}. ${question}`),
        '',
        '【整理口径】后续可按“开放编码 - 主轴编码 - 选择编码”整理访谈文本，并提取典型语句作为论文质性材料。',
        '',
        `生成依据：${source.label}`,
      ].join('\n'),
    }
  }

  if (mode === 'kano') {
    const features = inferKanoFeatures(title, source.text)
    const questionnaire = formatKanoQuestionnaire(title, features)
    const analysis = formatKanoAnalysis(features)
    return {
      data: { mode, features, source: source.label },
      text: [
        `【KANO 问卷】${title}`,
        '',
        '【生成说明】KANO 必须围绕“具体功能项/设计触点”提问，不能直接拿审美表现、功能体验、文化表达这类抽象变量当题目。',
        '确认方向：调研对象=普通读者/消费者；用途=作为论文研究方法的数据来源；输出=可直接发放的问卷正文 + Kano分析框架。',
        '',
        questionnaire,
        '',
        analysis,
      ].join('\n'),
    }
  }

  if (mode === 'ahp') {
    const criteria = route.variables.independent.length ? route.variables.independent : ['审美表现', '功能体验', '文化表达', '传播效果']
    return {
      data: { mode, criteria, source: source.label },
      text: [
        `【AHP 专家评分表】${title}`,
        '',
        '目标层：研究对象综合评价',
        `准则层：${criteria.join('、')}`,
        '',
        '指标层：',
        ...criteria.flatMap((criterion, index) => [
          `${index + 1}. ${criterion}`,
          `   ${index + 1}.1 表现完整性`,
          `   ${index + 1}.2 用户感知强度`,
          `   ${index + 1}.3 研究对象适配度`,
        ]),
        '',
        '评分方式：采用 1-9 标度法构建判断矩阵。上传专家评分模板后，系统输出权重、CI/CR 一致性检验和指标排序。',
      ].join('\n'),
    }
  }

  return {
    data: { mode, source: source.label },
    text: [
      `【文本编码表】${title}`,
      '',
      '字段：文本编号 / 原文片段 / 开放编码 / 主轴编码 / 选择编码 / 情感倾向 / 典型语句 / 备注',
      '',
      '开放编码：从原文中提取概念或行动词。',
      '主轴编码：合并相近概念，形成范畴关系。',
      '选择编码：提炼核心范畴，构建研究框架。',
      '情感倾向：正向 / 中性 / 负向 / 矛盾。',
      '',
      '后续使用：上传访谈文本、评论文本或案例材料后，系统可辅助输出编码树和频次统计。',
    ].join('\n'),
  }
}

function downloadText(fileName: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseCsv(text: string): ParsedDataset {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return { rows: [], headers: [] }
  const headers = lines[0].split(',').map(item => item.trim())
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(item => item.trim())
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {})
  })
  return { headers, rows }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function analyzeDataset(fileName: string, text: string): string {
  const parsed = parseCsv(text)
  const itemHeaders = parsed.headers.filter(header => /^[XMYV]\d+\d+$/i.test(header))
  const rows = parsed.rows
  const itemStats = itemHeaders.map(header => {
    const values = rows.map(row => Number(row[header])).filter(value => Number.isFinite(value) && value > 0)
    const mean = average(values)
    return `${header}：有效样本 ${values.length}，Mean=${mean.toFixed(2)}`
  })

  return [
    `【数据分析结果】${fileName}`,
    '',
    `样本量：${rows.length}`,
    `识别题项：${itemHeaders.length ? itemHeaders.join('、') : '未识别到量表题项列'}`,
    '',
    '【描述性统计】',
    ...(itemStats.length ? itemStats : ['当前文件已上传，但暂未识别标准题项列。请使用系统导出的数据模板，或保持题项列名如 X11、X12、M11、Y11。']),
    '',
    '【论文写作提示】',
    rows.length > 0
      ? `本研究共回收 ${rows.length} 份样本数据。后续可基于各变量题项均值进一步开展信度、效度、相关、回归及中介效应分析。`
      : '当前数据为空，需重新上传有效数据表。',
  ].join('\n')
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function reviewQuestionnaire(fileName: string, text: string, source: SourceContext): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const questionLines = lines.filter(line => /^(Q?\d+[.、\s]|第.+题|如果|我认为|我愿意)/.test(line))
  const duplicateHints = questionLines.filter((line, index) =>
    questionLines.findIndex(other => other.replace(/\s/g, '') === line.replace(/\s/g, '')) !== index
  )
  const leadingHints = questionLines.filter(line => /显然|必须|一定|非常优秀|不可或缺|毫无疑问/.test(line))
  const doubleHints = questionLines.filter(line => /和|以及|同时|并且/.test(line) && line.length > 24)
  const dimensionHints = ['研究对象', '变量关系', '维度覆盖', '题项表述', '反向题', '计分方式']

  return [
    `【问卷优化报告】${fileName}`,
    '',
    `生成依据：${source.label}`,
    `识别题目行：${questionLines.length || '未明显识别，请确认问卷是否为逐行题目格式'}`,
    '',
    '【一、总体判断】',
    questionLines.length >= 8
      ? '当前问卷已经具备基本题项规模，可进一步检查维度覆盖、题项表达和后续数据分析适配性。'
      : '当前问卷题项较少或格式不清晰，建议先补足题项结构，再进入正式数据收集。',
    '',
    '【二、主要问题】',
    duplicateHints.length ? `1. 存在疑似重复题：${duplicateHints.slice(0, 3).join('；')}` : '1. 暂未发现完全重复题。',
    leadingHints.length ? `2. 存在疑似引导性表述：${leadingHints.slice(0, 3).join('；')}` : '2. 暂未发现明显引导性题目。',
    doubleHints.length ? `3. 存在疑似双重问题：${doubleHints.slice(0, 3).join('；')}` : '3. 暂未发现明显双重问题。',
    '4. 维度覆盖仍需结合论文变量和研究模型人工确认。',
    '',
    '【三、优化建议】',
    ...dimensionHints.map((item, index) => `${index + 1}. ${item}：建议与当前论文大纲和研究路线保持一致，避免出现与论文无关的题项。`),
    '',
    '【四、适配后续分析】',
    '如计划做信度、效度、相关、回归或中介效应分析，建议每个核心变量至少保留 3 个同向题项，并明确反向题和计分规则。',
    '',
    '【五、下一步】',
    '可将本报告作为问卷修订记录保存；修订后的正式问卷应另存为新版本，再导出问卷星可粘贴格式或数据模板。',
  ].join('\n')
}

function buildDataTemplate(asset: ResearchAsset | null): string {
  if (!asset || !asset.structuredData) return ''
  if (asset.type === 'kano_result') {
    const data = asset.structuredData as { features?: KanoFeature[] }
    const features = data.features ?? []
    const headers = [
      'respondent_id',
      'S1_platform_use',
      'S2_heritage_exposure',
      'gender',
      'age',
      'education',
      'occupation',
      'daily_usage',
      'heritage_video_frequency',
      'main_platform',
      'access_path',
      ...features.flatMap((_, index) => [`K${index + 1}a_positive`, `K${index + 1}b_negative`]),
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'C1_attention_check',
      'O1_problem',
      'O2_share_reason',
    ]
    return [
      headers.join(','),
      [
        '1',
        '是',
        '偶尔',
        '女',
        '18-25岁',
        '本科',
        '在校学生',
        '1-2小时',
        '有时观看',
        '抖音',
        '平台推荐',
        ...features.flatMap(() => ['', '']),
        '',
        '',
        '',
        '',
        '',
        '同意',
        '',
        '',
      ].join(','),
    ].join('\n')
  }
  if (asset.type !== 'survey_questionnaire') return ''
  const scale = asset.structuredData as ScaleAssetData
  const codes = scale.variables.flatMap(variable => variable.dimensions.flatMap(dimension => dimension.items.map(item => item.code)))
  return [
    ['respondent_id', 'gender', 'age', 'education', ...codes].join(','),
    ['1', '女', '18-25', '本科', ...codes.map(() => '')].join(','),
  ].join('\n')
}

function buildWjxPasteText(asset: ResearchAsset | null): string {
  if (!asset || !asset.structuredData) return ''

  if (asset.type === 'survey_questionnaire') {
    const scale = asset.structuredData as ScaleAssetData
    const likertOptions = scale.scaleType === 'likert_7'
      ? ['1 非常不同意', '2 不同意', '3 比较不同意', '4 一般', '5 比较同意', '6 同意', '7 非常同意']
      : ['1 非常不同意', '2 不同意', '3 一般', '4 同意', '5 非常同意']
    const lines = [
      scale.title,
      '',
      `您好！本问卷用于了解“${scale.researchTopic}”相关体验、态度与行为意愿。问卷仅用于论文研究，答案没有对错之分，请根据真实感受填写。`,
      '',
      '1. 您的性别是？',
      '男',
      '女',
      '其他 / 不便透露',
      '',
      '2. 您的年龄是？',
      '18岁以下',
      '18-25岁',
      '26-35岁',
      '36-45岁',
      '46岁及以上',
      '',
      '3. 您的最高学历是？',
      '高中及以下',
      '专科',
      '本科',
      '硕士及以上',
      '',
      '4. 您接触相关内容或产品的频率是？',
      '从不',
      '偶尔',
      '有时',
      '经常',
      '非常频繁',
      '',
    ]
    let questionNo = 5
    scale.variables.forEach(variable => {
      variable.dimensions.forEach(dimension => {
        dimension.items.forEach(item => {
          lines.push(`${questionNo}. ${item.text}${item.reverseScored ? '（反向题）' : ''}`)
          lines.push(...likertOptions)
          lines.push('')
          questionNo += 1
        })
      })
    })
    return lines.join('\n').trim()
  }

  if (asset.type === 'kano_result') {
    const data = asset.structuredData as { features?: KanoFeature[] }
    const features = data.features ?? []
    if (!features.length) return ''
    const kanoOptions = ['非常喜欢', '理所当然', '无所谓', '勉强接受', '非常不喜欢']
    const likertOptions = ['1 非常不同意', '2 不同意', '3 一般', '4 同意', '5 非常同意']
    const lines = [
      asset.title,
      '',
      '您好！本问卷旨在了解短视频平台中非遗内容的视觉呈现、文化表达与互动机制对青年用户传播意愿的影响。问卷仅用于学术研究，采用匿名方式收集数据，所有答案没有对错之分，请根据真实观看经验和主观感受作答。',
      '',
      '1. 您是否使用过抖音、快手、B站、小红书、视频号等短视频或视频社交平台？',
      '是',
      '否',
      '',
      '2. 您是否在短视频平台上浏览、点赞、收藏、评论或转发过非遗、传统工艺、民俗文化、传统艺术等相关内容？',
      '经常',
      '偶尔',
      '听说过但很少接触',
      '从未接触',
      '',
      '3. 您的性别是？',
      '男',
      '女',
      '其他 / 不便透露',
      '',
      '4. 您的年龄是？',
      '18岁以下',
      '18-25岁',
      '26-30岁',
      '31-35岁',
      '36岁及以上',
      '',
      '5. 您的最高学历是？',
      '高中及以下',
      '专科',
      '本科',
      '硕士及以上',
      '',
      '6. 您平均每天使用短视频平台的时长是？',
      '30分钟以内',
      '30分钟-1小时',
      '1-2小时',
      '2小时以上',
      '',
    ]
    let questionNo = 7
    features.forEach(feature => {
      lines.push(`${questionNo}. [${feature.dimension}] ${feature.positive}`)
      lines.push(...kanoOptions)
      lines.push('')
      questionNo += 1
      lines.push(`${questionNo}. [${feature.dimension}] ${feature.negative}`)
      lines.push(...kanoOptions)
      lines.push('')
      questionNo += 1
    })
    const willingnessItems = [
      '如果非遗短视频在视觉呈现上具有较强识别度，我愿意点赞或收藏该类内容。',
      '如果非遗短视频能够清楚解释文化内涵，我愿意将其推荐给朋友或同学。',
      '如果非遗短视频具有较强叙事吸引力，我愿意在评论区参与讨论。',
      '如果非遗短视频设置了合适的互动话题或二创活动，我愿意参与转发或二次创作。',
      '总体而言，我愿意持续关注并传播优质非遗短视频内容。',
    ]
    willingnessItems.forEach(item => {
      lines.push(`${questionNo}. ${item}`)
      lines.push(...likertOptions)
      lines.push('')
      questionNo += 1
    })
    lines.push(`${questionNo}. 为保证问卷质量，请您在本题选择“同意”。`)
    lines.push(...likertOptions)
    lines.push('')
    questionNo += 1
    lines.push(`${questionNo}. 您认为当前短视频平台中的非遗内容最需要改进的地方是什么？`)
    lines.push('')
    questionNo += 1
    lines.push(`${questionNo}. 哪类非遗短视频最容易让您产生转发、评论或分享的意愿？请简要说明原因。`)
    return lines.join('\n').trim()
  }

  return ''
}

function assetTypeLabel(type: ResearchAssetType): string {
  const labels: Record<ResearchAssetType, string> = {
    research_design: '设计',
    scale_schema: '量表',
    survey_questionnaire: '问卷',
    questionnaire_review: '优化',
    hypothesis_model: '假设',
    quant_dataset: '数据',
    quant_analysis_result: '分析',
    kano_result: 'KANO',
    ahp_result: 'AHP',
    qualitative_coding: '编码',
    chapter_text: '正文',
  }
  return labels[type]
}

function researchAssetSectionTitle(asset: ResearchAsset) {
  if (asset.type === 'quant_analysis_result') return '第四章 数据分析结果'
  if (asset.type === 'survey_questionnaire' || asset.type === 'scale_schema') return '问卷设计与变量测量'
  if (asset.type === 'kano_result') return 'KANO需求分析'
  if (asset.type === 'ahp_result') return 'AHP评价指标体系'
  if (asset.type === 'qualitative_coding') return '质性编码分析'
  if (asset.type === 'questionnaire_review') return '问卷优化说明'
  return '研究工具设计'
}

function researchAssetOrder(asset: ResearchAsset) {
  if (asset.type === 'quant_analysis_result') return 4
  if (asset.type === 'survey_questionnaire' || asset.type === 'scale_schema') return 3
  if (asset.type === 'kano_result' || asset.type === 'ahp_result') return 4
  if (asset.type === 'qualitative_coding') return 4
  return 3
}

export default function ResearchCenter() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const project = projectStore.ensure(params.projectId)
  const isAssetPage = location.pathname.endsWith('/assets')
  const sourceOptions = useMemo(() => getSourceOptions(project.id), [project.id])
  const defaultSourceKind = sourceOptions.find(option => option.available)?.kind ?? 'stage1'
  const [stage1ResearchPlan, setStage1ResearchPlan] = useState<ResearchPlan | undefined>(project.context.researchPlan)
  const [sourceKind, setSourceKind] = useState<SourceKind>(defaultSourceKind)
  const source = sourceOptions.find(option => option.kind === sourceKind && option.available)
    ?? sourceOptions.find(option => option.available)
    ?? sourceOptions[2]
  const route = useMemo(() => {
    const fallback = inferRoute(project.title, source.text)
    return routeFromResearchPlan(stage1ResearchPlan, fallback)
  }, [project.title, source.text, stage1ResearchPlan])
  const [purpose, setPurpose] = useState<WorkspacePurpose>('generate')
  const [mode, setMode] = useState<ToolMode>(route.preferredMode)
  const [isEditingMethod, setIsEditingMethod] = useState(false)
  const [methodDraft, setMethodDraft] = useState<MethodDraft>(() => createMethodDraft(route, stage1ResearchPlan))
  const [isGeneratingTool, setIsGeneratingTool] = useState(false)
  const [isReinterpreting, setIsReinterpreting] = useState(false)
  const [isWritingToPaper, setIsWritingToPaper] = useState(false)
  const [tasks, setTasks] = useState<ResearchTask[]>(() => researchTaskStore.getByProject(project.id))
  const [assets, setAssets] = useState<ResearchAsset[]>(() => researchAssetStore.getByProject(project.id))
  const [activeAssetId, setActiveAssetId] = useState(() => assets[0]?.id ?? '')
  const [draftText, setDraftText] = useState('')
  const [uploadedName, setUploadedName] = useState('')
  const [notice, setNotice] = useState('')
  const [analysisPhase, setAnalysisPhase] = useState<AnalysisPhase>('idle')
  const [analysisError, setAnalysisError] = useState('')
  const [resultView, setResultView] = useState<ResultView>('questionnaire')

  useEffect(() => {
    queueMicrotask(() => setMode(route.preferredMode))
  }, [route.preferredMode])

  useEffect(() => {
    if (!isEditingMethod) {
      queueMicrotask(() => setMethodDraft(createMethodDraft(route, stage1ResearchPlan)))
    }
  }, [isEditingMethod, route, stage1ResearchPlan])

  const activeAsset = assets.find(asset => asset.id === activeAssetId) ?? assets[0] ?? null
  const activeText = draftText || activeAsset?.plainText || ''
  const isKanoAsset = activeAsset?.type === 'kano_result'
  const activeDisplayText = isKanoAsset && !draftText ? splitKanoText(activeText, resultView) : activeText
  const activeOption = toolOptions.find(option => option.value === mode) ?? toolOptions[0]
  const activePurpose = purposeOptions.find(option => option.value === purpose) ?? purposeOptions[0]
  const latestDataset = assets.find(asset => asset.type === 'quant_dataset')
  const latestAnalysis = assets.find(asset => asset.type === 'quant_analysis_result' || asset.type === 'qualitative_coding')
  const isAnalyzing = analysisPhase === 'planning' || analysisPhase === 'running' || analysisPhase === 'interpreting'
  const canReinterpretActiveAsset = Boolean(
    activeAsset?.structuredData
    && typeof activeAsset.structuredData === 'object'
    && 'result' in activeAsset.structuredData
    && activeAsset.type !== 'quant_dataset'
  )
  const dataTemplate = buildDataTemplate(activeAsset)
  const wjxPasteText = buildWjxPasteText(activeAsset)

  const refresh = (assetId?: string) => {
    const nextTasks = researchTaskStore.getByProject(project.id)
    const nextAssets = researchAssetStore.getByProject(project.id)
    setTasks(nextTasks)
    setAssets(nextAssets)
    if (assetId) setActiveAssetId(assetId)
    else if (!activeAssetId && nextAssets[0]) setActiveAssetId(nextAssets[0].id)
  }

  const saveMethodDraft = () => {
    const selectedTool = toolOptions.find(option => option.value === methodDraft.mode) ?? toolOptions[0]
    const nextPlan: ResearchPlan = {
      methodType: selectedTool.methodType,
      methodLabel: methodDraft.label.trim() || selectedTool.label,
      methodReason: methodDraft.reason.trim() || '由用户在研究计算页确认的研究方法路线。',
      suggestedTools: toolKeysForMode(methodDraft.mode),
      variables: route.variables,
      dataNeeds: splitDraftList(methodDraft.dataNeeds),
      outlineRequirements: splitDraftList(methodDraft.outlineRequirements),
      pendingResearchTasks: splitDraftList(methodDraft.pendingTasks),
    }
    projectStore.update(project.id, {
      context: {
        ...project.context,
        researchPlan: nextPlan,
      },
    })
    setStage1ResearchPlan(nextPlan)
    setMode(methodDraft.mode)
    setIsEditingMethod(false)
    setNotice('研究方法已更新，后续研究任务会按新的方法路线生成。')
  }

  const generateTool = async () => {
    if (isGeneratingTool) return
    setIsGeneratingTool(true)
    setNotice(`正在调用 AI 生成专业版${activeOption.label}，并进行学术质检…`)
    const task = researchTaskStore.add({
      projectId: project.id,
      title: `${activeOption.label}生成与回流`,
      methodType: activeOption.methodType,
      status: mode === 'survey' ? 'survey_ready' : 'route_planned',
      nextActionLabel: mode === 'survey' ? '导出问卷并收集数据' : '导出研究工具并收集材料',
    })
    const brief = buildResearchDesignBrief(mode, project.title, source, route)
    const generated = buildResearchTool(mode, project.title, source, route)
    let generatedText = ''
    let quality = validateResearchTool(mode, generated.text)
    try {
      setNotice(`正在调用 AI 生成专业版${activeOption.label}…`)
      const aiText = await streamResearchText(buildResearchToolPrompt(mode, project.title, source, route, generated.text, brief))
      if (aiText.length <= 700) {
        throw new Error('AI 返回内容过短，未达到正式研究工具要求。')
      }
      generatedText = aiText
      quality = validateResearchTool(mode, generatedText)
      if (!quality.ok) {
        setNotice(`正在质检并补全${activeOption.label}：${quality.issues.slice(0, 2).join('；')}`)
        const repairedText = await streamResearchText(
          buildResearchToolRepairPrompt(mode, project.title, source, route, brief, generatedText, quality.issues)
        )
        if (repairedText.length <= generatedText.length * 0.8) {
          throw new Error('AI 质检补全文本不足，未保存模板兜底结果。')
        }
        generatedText = repairedText
        quality = validateResearchTool(mode, generatedText)
      }
    } catch (error) {
      console.warn('[ResearchCenter] AI research tool generation failed', error)
      researchTaskStore.update(task.id, {
        nextActionLabel: 'AI生成失败，请重试',
      })
      setNotice(`AI 研究工具生成失败，未保存模板结果。请稍后重试或补充更多论文材料：${error instanceof Error ? error.message : String(error)}`)
      refresh()
      setIsGeneratingTool(false)
      return
    }
    const asset = researchAssetStore.add({
      projectId: project.id,
      taskId: task.id,
      type: activeOption.assetType,
      title: `${project.title}-${activeOption.label}`,
      summary: `AI依据${source.label}专用生成；${activeOption.outcome}`,
      source: 'generated_from_project',
      structuredData: {
        ...(typeof generated.data === 'object' && generated.data ? generated.data as Record<string, unknown> : { value: generated.data }),
        generatedByAI: true,
        researchDesignBrief: brief,
        qualityCheck: quality,
      },
      plainText: generatedText,
      status: 'confirmed',
    })
    setDraftText('')
    setResultView(mode === 'kano' ? 'questionnaire' : 'full')
    refresh(asset.id)
    setNotice(`已调用 AI 根据${source.label}专用生成${activeOption.label}，质检得分 ${quality.score}/100${quality.ok ? '' : `，仍建议人工复核：${quality.issues.slice(0, 2).join('；')}`}。`)
    setIsGeneratingTool(false)
  }

  const saveEditedVersion = () => {
    if (!activeAsset || !activeText.trim()) return
    const asset = researchAssetStore.add({
      projectId: project.id,
      taskId: activeAsset.taskId,
      type: activeAsset.type,
      title: `${activeAsset.title}-修订版`,
      summary: `由用户在研究计算中心编辑保存；上一版：${activeAsset.title}`,
      source: 'manual_input',
      structuredData: activeAsset.structuredData,
      plainText: activeText,
      status: 'confirmed',
    })
    setDraftText('')
    refresh(asset.id)
    setNotice('已保存为新的研究工具版本，旧版本仍保留在右侧资产列表中。')
  }

  const uploadData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)
    const text = isExcel ? '' : await file.text()
    const base64 = isExcel ? arrayBufferToBase64(await file.arrayBuffer()) : undefined
    const task = tasks[0] ?? researchTaskStore.add({
      projectId: project.id,
      title: '数据分析任务',
      methodType: 'quantitative',
      status: 'survey_ready',
      nextActionLabel: '上传数据',
    })
    const dataset = researchAssetStore.add({
      projectId: project.id,
      taskId: task.id,
      type: 'quant_dataset',
      title: file.name,
      summary: isExcel ? '已上传 Excel 数据文件' : `已上传数据文件，${text.split(/\r?\n/).filter(Boolean).length} 行`,
      source: 'uploaded_by_user',
      structuredData: { fileName: file.name, preview: text.slice(0, 2000), base64 },
      plainText: text.slice(0, 10000),
      status: 'confirmed',
    })
    researchTaskStore.update(task.id, {
      status: 'data_uploaded',
      datasetAssetId: dataset.id,
      nextActionLabel: '运行统计分析',
    })
    setUploadedName(file.name)
    setAnalysisPhase('uploaded')
    setAnalysisError('')
    refresh(dataset.id)
    setNotice('数据已上传。现在可以先生成初步分析结果，再把结果插入 Stage3。')
  }

  const uploadQuestionnaireForReview = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    const task = researchTaskStore.add({
      projectId: project.id,
      title: '已有问卷优化任务',
      methodType: route.preferredMode === 'interview' ? 'qualitative' : 'quantitative',
      status: 'scale_drafting',
      nextActionLabel: '根据检查报告修订问卷',
    })
    const report = reviewQuestionnaire(file.name, text, source)
    const asset = researchAssetStore.add({
      projectId: project.id,
      taskId: task.id,
      type: 'questionnaire_review',
      title: `${file.name}-问卷优化报告`,
      summary: '基于用户上传问卷生成的检查与优化建议，可作为问卷修订记录。',
      source: 'uploaded_by_user',
      structuredData: { fileName: file.name, originalPreview: text.slice(0, 3000) },
      plainText: report,
      status: 'confirmed',
    })
    setUploadedName(file.name)
    setDraftText('')
    refresh(asset.id)
    setNotice('已生成问卷优化报告，并保存到研究资产。')
  }

  const runAnalysis = async () => {
    if (!latestDataset) {
      setNotice('请先上传 CSV/Excel/TXT 数据文件，系统识别到最新数据后才能生成分析结果。研究计算是全文初稿后的补强步骤，也可以先回到文章生成继续完善正文。')
      return
    }
    const task = latestDataset.taskId ? researchTaskStore.get(latestDataset.taskId) : tasks[0]
    const isQualitative = mode === 'interview' || mode === 'coding' || /\.txt$/i.test(latestDataset.title)
    setAnalysisPhase('planning')
    setAnalysisError('')
    setNotice('AI 正在识别数据结构和适合的研究方法…')
    let analysisText = ''
    let structuredResult: unknown = null
    let confirmedPlan: Awaited<ReturnType<typeof researchAPI.analysisPlan>>['plan'] | null = null
    let usedBrowserFallback = false
    let usedInterpretFallback = false
    try {
      const data = latestDataset.structuredData as { base64?: string } | null
      const intent = {
        projectId: project.id,
        userRequest: isQualitative
          ? '对上传的访谈、开放题或文本材料进行开放编码、主轴编码、主题归纳和证据摘录。'
          : '对上传的问卷或统计数据生成论文可用的数据分析方案、图表和结果解释。',
        purpose: isQualitative ? '质性编码分析' : '论文数据分析',
        capabilityTier: 'partial_loop',
        recommendedMethods: isQualitative ? ['descriptive'] : ['descriptive', 'cronbach_alpha', 'correlation', 'anova', 'efa'],
        expectedPackage: ['method', 'statistics', 'figure', 'analysis'],
        notes: [],
      } satisfies Parameters<typeof researchAPI.analysisPlan>[0]['intent']
      const planResult = await researchAPI.analysisPlan({
        intent,
        fileName: latestDataset.title,
        text: latestDataset.plainText,
        base64: data?.base64,
        method: isQualitative ? 'qualitative_coding' : undefined,
        userRequest: intent.userRequest,
      })
      confirmedPlan = planResult.plan
      setAnalysisPhase('running')
      setNotice(isQualitative ? '正在执行质性编码并生成主题图表…' : '正在执行统计计算并生成论文图表…')
      const result = await researchAPI.analyze({
        fileName: latestDataset.title,
        text: latestDataset.plainText,
        base64: data?.base64,
        method: isQualitative ? 'qualitative_coding' : undefined,
        confirmedPlan,
      })
      setAnalysisPhase('interpreting')
      structuredResult = result
      usedInterpretFallback = result.interpretationProvider === 'fallback'
      analysisText = [
        result.methodText ? `【研究方法说明】\n${result.methodText}` : '',
        '【数据分析结果】',
        result.plainText,
        result.analysisText ? `\n【论文结果表述】\n${result.analysisText}` : '',
        usedInterpretFallback ? '\n【写作提示】\n统计计算已完成，但 AI 论文解释暂时不可用，系统已使用规则兜底生成保守表述。可稍后重新生成分析结果或直接插入正文后再润色。' : '',
        result.cautions.length ? `\n【环境提示】\n${result.cautions.join('\n')}` : '',
      ].filter(Boolean).join('\n')
      setAnalysisPhase('ready')
    } catch (error) {
      console.warn('[ResearchCenter] Python analysis failed, fallback to browser analysis', error)
      usedBrowserFallback = true
      analysisText = [
        '【数据分析结果】',
        analyzeDataset(latestDataset.title, latestDataset.plainText),
        '',
        '【错误恢复提示】',
        '后端统计/AI 分析暂时失败，系统已生成浏览器端兜底结果。请检查数据格式、列名和缺失值；也可以稍后点击“生成分析结果”重新运行，或先插入正文后人工调整。',
      ].join('\n')
      structuredResult = { fallback: true, error: error instanceof Error ? error.message : String(error) }
      setAnalysisPhase('error')
      setAnalysisError(error instanceof Error ? error.message : String(error))
    }
    const asset = researchAssetStore.add({
      projectId: project.id,
      taskId: latestDataset.taskId,
      type: isQualitative ? 'qualitative_coding' : 'quant_analysis_result',
      title: `${latestDataset.title}-分析结果`,
      summary: isQualitative ? '基于上传文本生成的质性编码结果，可插入论文研究结果章节。' : '基于上传数据生成的统计分析结果，可插入论文第四章。',
      source: 'generated_from_project',
      structuredData: { datasetAssetId: latestDataset.id, confirmedPlan, result: structuredResult },
      plainText: analysisText,
      status: 'confirmed',
    })
    if (task) {
      researchTaskStore.update(task.id, {
        status: 'analysis_done',
        analysisAssetId: asset.id,
        nextActionLabel: '插入 Stage3 生成论文表述',
      })
    }
    refresh(asset.id)
    setNotice(usedBrowserFallback
      ? '后端分析失败，已保存浏览器兜底结果；可检查数据后重新生成。'
      : usedInterpretFallback
        ? '计算已完成，AI 解释使用兜底表述；可稍后重新生成或直接插入正文。'
        : '已生成统计分析结果，并保存为研究资产。')
  }

  const reinterpretActiveAnalysis = async () => {
    if (!activeAsset || isReinterpreting) return
    const structured = activeAsset.structuredData && typeof activeAsset.structuredData === 'object'
      ? activeAsset.structuredData as { result?: unknown; confirmedPlan?: unknown; datasetAssetId?: string }
      : null
    const result = structured?.result && typeof structured.result === 'object'
      ? structured.result as Record<string, unknown>
      : null
    if (!result || result.fallback) {
      setNotice('当前资产没有可重新解释的结构化计算结果，请重新运行数据分析。')
      return
    }
    setIsReinterpreting(true)
    setAnalysisPhase('interpreting')
    setAnalysisError('')
    setNotice('正在保留计算结果，并重新生成论文表述…')
    try {
      const interpreted = await researchAPI.interpret({
        result,
        fileName: activeAsset.title,
        paperTitle: project.title,
        userRequest: '请基于已有统计/编码结果，重新生成可直接写入论文的研究方法说明和结果分析文字。',
        confirmedPlan: structured?.confirmedPlan as never,
      })
      const nextResult = interpreted.result
      const nextText = [
        nextResult.methodText ? `【研究方法说明】\n${nextResult.methodText}` : '',
        '【数据分析结果】',
        nextResult.plainText,
        nextResult.analysisText ? `\n【论文结果表述】\n${nextResult.analysisText}` : '',
        nextResult.interpretationProvider === 'fallback' ? '\n【写作提示】\nAI 论文解释暂时不可用，系统已使用规则兜底生成保守表述。' : '',
        nextResult.cautions?.length ? `\n【环境提示】\n${nextResult.cautions.join('\n')}` : '',
      ].filter(Boolean).join('\n')
      researchAssetStore.update(activeAsset.id, {
        structuredData: { ...(structured ?? {}), result: nextResult },
        plainText: nextText,
        summary: nextResult.interpretationProvider === 'fallback'
          ? `${activeAsset.summary}（论文表述已用规则兜底重生成）`
          : `${activeAsset.summary}（论文表述已重新生成）`,
      })
      refresh(activeAsset.id)
      setAnalysisPhase('ready')
      setNotice(nextResult.interpretationProvider === 'fallback'
        ? '计算结果未变，论文表述已用规则兜底重新生成。'
        : '计算结果未变，论文表述已重新生成。')
    } catch (error) {
      setAnalysisPhase('error')
      setAnalysisError(error instanceof Error ? error.message : String(error))
      setNotice('重新解释失败：计算结果仍保留，可稍后重试或直接插入正文。')
    } finally {
      setIsReinterpreting(false)
    }
  }

  type ResearchInsertRole = 'method' | 'result' | 'discussion'

  const componentInsertRole = (component: ResearchPackageComponent): ResearchInsertRole => {
    if (component.type === 'method') return 'method'
    if (component.type === 'analysis' && /策略|建议|优化|讨论/.test(`${component.title ?? ''}\n${component.content}`)) return 'discussion'
    return 'result'
  }

  const researchInsertTitle = (role: ResearchInsertRole, asset: ResearchAsset) => {
    if (role === 'method') return '研究方法与数据来源'
    if (role === 'discussion') return '讨论与优化策略'
    return researchAssetSectionTitle(asset)
  }

  const researchInsertOrder = (role: ResearchInsertRole, asset: ResearchAsset) => {
    if (role === 'method') return 30
    if (role === 'discussion') return 50
    return researchAssetOrder(asset)
  }

  const findResearchTargetSection = (asset: ResearchAsset, role: ResearchInsertRole) => {
    const sections = sectionStore.getByProject(project.id)
    const keywords = role === 'method'
      ? ['研究方法', '研究设计', '数据来源', '研究对象', '第三章']
      : role === 'discussion'
        ? ['设计策略', '优化策略', '讨论', '建议', '启示', '第五章']
        : asset.type === 'quant_analysis_result' || asset.type === 'qualitative_coding'
          ? ['数据分析', '结果分析', '研究结果', '实证分析', '第四章']
          : ['研究结果', '数据分析', '第四章']
    return sections
      .map(section => ({
        section,
        score: keywords.reduce((sum, keyword) => sum + (section.title.includes(keyword) ? 3 : 0) + (section.content.includes(keyword) ? 1 : 0), 0),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.section ?? null
  }

  const insertIntoPaper = async () => {
    if (!activeAsset || !activeText.trim() || isWritingToPaper) return
    setIsWritingToPaper(true)
    setNotice('AI 正在判断研究结果最适合写入哪些论文章节...')
    try {
      const pkg = createPackageFromAsset({
        projectId: project.id,
        asset: { ...activeAsset, plainText: activeText },
        intentSummary: `从研究计算页面写入 Stage3：${activeAsset.title}`,
      })
      const fallbackGrouped = pkg.components.reduce((map, component) => {
        const role = componentInsertRole(component)
        map.set(role, [...(map.get(role) ?? []), component.id])
        return map
      }, new Map<ResearchInsertRole, string[]>())
      const fallbackPlacements: ResearchWritePlanPlacement[] = (['method', 'result', 'discussion'] as ResearchInsertRole[])
        .map(role => {
          const componentIds = fallbackGrouped.get(role) ?? []
          const targetSection = findResearchTargetSection(activeAsset, role)
          return {
            targetSectionId: targetSection?.id,
            targetSectionTitle: targetSection?.title ?? researchInsertTitle(role, activeAsset),
            role,
            insertPosition: 'append' as const,
            reason: targetSection ? '根据章节语义自动匹配' : '未找到明确章节，创建论文常用章节承接',
            componentIds,
          }
        })
        .filter(placement => placement.componentIds.length > 0)

      let placements = fallbackPlacements
      try {
        const currentSections = sectionStore.getByProject(project.id)
        const planResult = await researchAPI.writePlan({
          paperTitle: project.title,
          assetTitle: activeAsset.title,
          assetSummary: activeAsset.summary,
          sections: currentSections.map(section => ({
            id: section.id,
            title: section.title,
            content: section.content.slice(0, 1200),
          })),
          components: pkg.components.map(component => ({
            id: component.id,
            type: component.type,
            title: component.title,
            content: component.content.slice(0, 1200),
          })),
        })
        if (planResult.plan.placements.length > 0) {
          placements = planResult.plan.placements
        }
      } catch (error) {
        console.warn('[ResearchCenter] write plan unavailable, using local fallback', error)
        setNotice('AI 写入规划暂时不可用，已改用本地章节语义匹配继续写入。')
      }

      const insertedSectionIds: string[] = []
      const insertedSectionTitles: string[] = []
      const insertedComponentIds: string[] = []
      const validComponentIds = new Set(pkg.components.map(component => component.id))

      placements.forEach((placement, index) => {
        const componentIds = placement.componentIds.filter(id => validComponentIds.has(id))
        if (!componentIds.length) return
        const currentSections = sectionStore.getByProject(project.id)
        const targetSection = currentSections.find(section => section.id === placement.targetSectionId)
          ?? currentSections.find(section => section.title === placement.targetSectionTitle)
          ?? currentSections.find(section => section.title.includes(placement.targetSectionTitle) || placement.targetSectionTitle.includes(section.title))
          ?? null
        const role = placement.role === 'method' || placement.role === 'discussion' || placement.role === 'result'
          ? placement.role
          : 'result'
        const sectionId = targetSection?.id ?? `research-${role}-${activeAsset.id}-${Date.now()}-${index}`
        const researchNodes = researchPackageToPaperNodes(pkg, componentIds)

        if (targetSection) {
          const sourceDoc = ensurePaperEditorDoc(targetSection.content, targetSection.editorDoc)
          const editorDoc = {
            ...sourceDoc,
            content: [...(sourceDoc.content ?? []), ...researchNodes],
          }
          sectionStore.update(targetSection.id, {
            content: editorDocToPlainText(editorDoc),
            editorDoc,
            status: 'done',
            sourceRefs: Array.from(new Set([...(targetSection.sourceRefs ?? []), activeAsset.id, pkg.id])),
            generationPlan: `研究计算结果已由 AI 规划并写入：${activeAsset.title}`,
          })
          insertedSectionTitles.push(targetSection.title)
        } else {
          const title = placement.targetSectionTitle || researchInsertTitle(role, activeAsset)
          sectionStore.add({
            id: sectionId,
            projectId: project.id,
            title,
            content: editorDocToPlainText({ type: 'doc', content: researchNodes }),
            editorDoc: {
              type: 'doc',
              content: researchNodes,
            },
            status: 'done',
            order: researchInsertOrder(role, activeAsset),
            sourceRefs: [activeAsset.id, pkg.id],
            generationPlan: `由研究计算资产《${activeAsset.title}》经 AI 规划写入`,
          })
          insertedSectionTitles.push(title)
        }
        insertedComponentIds.push(...componentIds)
        insertedSectionIds.push(sectionId)
      })

      researchPackageStore.markInserted(pkg.id, insertedComponentIds)
      researchAssetStore.update(activeAsset.id, {
        status: 'used_in_paper',
        linkedSectionIds: Array.from(new Set([...(activeAsset.linkedSectionIds ?? []), ...insertedSectionIds])),
      })
      if (activeAsset.taskId) {
        researchTaskStore.update(activeAsset.taskId, {
          status: 'inserted_into_paper',
          nextActionLabel: '在 Stage3 润色并整合',
        })
      }
      refresh(activeAsset.id)
      setNotice(`已按论文结构写入 Stage3：${Array.from(new Set(insertedSectionTitles)).join('、')}。`)
      navigate(`/projects/${project.id}/stage3`, { state: { insertedSectionId: insertedSectionIds[0] } })
    } finally {
      setIsWritingToPaper(false)
    }
  }

  if (isAssetPage) {
    return (
      <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TopBar
            currentStep={3}
            right={
              <button onClick={() => navigate(`/projects/${project.id}/research`)} style={secondaryButtonStyle}>
                返回研究流程
                <ArrowRight size={13} />
              </button>
            }
          />
          <main style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <section style={panelStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 800, letterSpacing: '0.05em' }}>研究资产库</div>
                    <h1 style={{ margin: '6px 0 6px', fontSize: 20, color: 'var(--color-ink)' }}>{project.title}</h1>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                      这里集中保存问卷、量表、上传数据、统计结果和可写入正文的研究文本。
                    </div>
                  </div>
                  <span style={badgeStyle}>共 {assets.length} 个资产</span>
                </div>
              </section>

              <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
                <section style={panelStyle}>
                  <div style={titleStyle}>全部资产</div>
                  {assets.length === 0 ? (
                    <div style={emptyStyle}>暂无资产。回到研究流程生成问卷、上传数据或生成分析后，会自动进入这里。</div>
                  ) : (
                    <div style={{ ...assetListStyle, maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
                      {assets.map(asset => (
                        <button
                          key={asset.id}
                          onClick={() => {
                            setActiveAssetId(asset.id)
                            setDraftText('')
                          }}
                          style={{
                            width: '100%',
                            border: `1px solid ${asset.id === activeAsset?.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            borderRadius: 8,
                            background: asset.id === activeAsset?.id ? 'var(--color-accent-light)' : 'transparent',
                            padding: 10,
                            textAlign: 'left',
                            cursor: 'pointer',
                            fontFamily: 'var(--font-sans)',
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {asset.title}
                            </div>
                            <span style={assetChipStyle}>{assetTypeLabel(asset.type)}</span>
                          </div>
                          <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.5, color: 'var(--color-ink-3)' }}>{asset.summary}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section style={panelStyle}>
                  {!activeAsset ? (
                    <div style={emptyStyle}>请选择左侧资产查看内容。</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 850, color: 'var(--color-ink)' }}>{activeAsset.title}</div>
                          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.6 }}>{activeAsset.summary}</div>
                        </div>
                        <span style={assetChipStyle}>{assetTypeLabel(activeAsset.type)}</span>
                      </div>
                      <textarea
                        value={activeDisplayText}
                        readOnly={isKanoAsset && resultView !== 'full' && !draftText}
                        onChange={event => setDraftText(event.target.value)}
                        style={{ ...editorStyle, minHeight: 'calc(100vh - 390px)' }}
                      />
                      <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <button onClick={() => downloadText(`${activeAsset.title}.txt`, activeText)} style={secondaryButtonStyle}>
                          <Download size={13} />
                          导出文本
                        </button>
                        <button onClick={saveEditedVersion} disabled={!activeText.trim()} style={secondaryButtonStyle}>
                          <Save size={13} />
                          保存新版本
                        </button>
                        <button onClick={() => void insertIntoPaper()} disabled={isWritingToPaper} style={{ ...primaryButtonStyle, opacity: isWritingToPaper ? 0.65 : 1, cursor: isWritingToPaper ? 'not-allowed' : 'pointer' }}>
                          <CheckCircle2 size={13} />
                          {isWritingToPaper ? '正在规划写入...' : 'AI 写入论文'}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar
          currentStep={3}
          right={
            <button onClick={() => navigate(`/projects/${project.id}/stage3`)} style={secondaryButtonStyle}>
              回到文章生成
              <ArrowRight size={13} />
            </button>
          }
        />

        <main style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          <div style={{ maxWidth: 1280, margin: '0 auto 14px', border: '1px solid rgba(45, 90, 61, 0.18)', borderRadius: 8, padding: '10px 12px', background: 'var(--color-accent-light)', color: 'var(--color-accent)', fontSize: 12, lineHeight: 1.7 }}>
            独立研究页现在定位为早期规划入口。若论文已经开始写作，建议回到 Stage3 对应章节点击「插入研究支撑」，系统会带入当前章节上下文，变量映射和结果文字会更贴合正文。
          </div>
          <section style={{ ...panelStyle, maxWidth: 1280, margin: '0 auto 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 800, letterSpacing: '0.05em' }}>
                  当前论文研究方法
                </div>
                <h1 style={{ margin: '6px 0 8px', fontSize: 18, color: 'var(--color-ink)' }}>{project.title}</h1>
                <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-ink-3)' }}>
                  {stage1ResearchPlan
                    ? '已读取 Stage1 的定性/定量判断。下方研究任务会优先沿用这个方法建议，不需要用户重复提供题目、大纲或材料。'
                    : '当前项目还没有 Stage1 方法建议。系统会先根据题目、大纲和已有正文做临时判断，后续可回到 Stage1 重新确认。'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={badgeStyle}>{stage1ResearchPlan ? '已确认' : '临时判断'}</span>
                <button
                  onClick={() => {
                    setMethodDraft(createMethodDraft(route, stage1ResearchPlan))
                    setIsEditingMethod(value => !value)
                  }}
                  style={secondaryButtonStyle}
                >
                  <Pencil size={13} />
                  修改方法
                </button>
                <button onClick={() => navigate(`/projects/${project.id}/research/assets`)} style={secondaryButtonStyle}>
                  <FileSpreadsheet size={13} />
                  资产库
                </button>
              </div>
            </div>
            {isEditingMethod && (
              <div style={methodEditorStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 10 }}>
                  <label style={fieldLabelStyle}>
                    研究工具
                    <select
                      value={methodDraft.mode}
                      onChange={event => {
                        const nextMode = event.target.value as ToolMode
                        const selectedTool = toolOptions.find(option => option.value === nextMode) ?? toolOptions[0]
                        setMethodDraft(draft => ({
                          ...draft,
                          mode: nextMode,
                          label: selectedTool.label,
                        }))
                      }}
                      style={selectStyle}
                    >
                      {toolOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={fieldLabelStyle}>
                    方法名称
                    <input
                      value={methodDraft.label}
                      onChange={event => setMethodDraft(draft => ({ ...draft, label: event.target.value }))}
                      style={inputStyle}
                    />
                  </label>
                </div>
                <label style={fieldLabelStyle}>
                  方法理由
                  <textarea
                    value={methodDraft.reason}
                    onChange={event => setMethodDraft(draft => ({ ...draft, reason: event.target.value }))}
                    style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  <label style={fieldLabelStyle}>
                    需要收集
                    <textarea
                      value={methodDraft.dataNeeds}
                      onChange={event => setMethodDraft(draft => ({ ...draft, dataNeeds: event.target.value }))}
                      style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
                    />
                  </label>
                  <label style={fieldLabelStyle}>
                    适用章节
                    <textarea
                      value={methodDraft.outlineRequirements}
                      onChange={event => setMethodDraft(draft => ({ ...draft, outlineRequirements: event.target.value }))}
                      style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
                    />
                  </label>
                  <label style={fieldLabelStyle}>
                    后续任务
                    <textarea
                      value={methodDraft.pendingTasks}
                      onChange={event => setMethodDraft(draft => ({ ...draft, pendingTasks: event.target.value }))}
                      style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setIsEditingMethod(false)} style={secondaryButtonStyle}>取消</button>
                  <button onClick={saveMethodDraft} style={primaryButtonStyle}>保存方法</button>
                </div>
              </div>
            )}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <MiniInfo label="推荐方法" value={stage1ResearchPlan?.methodLabel || route.label} />
              <MiniInfo label="适用章节" value={stage1ResearchPlan?.outlineRequirements.join('；') || '研究方法 / 数据分析 / 结果讨论'} />
              <MiniInfo label="需要收集" value={stage1ResearchPlan?.dataNeeds.join('；') || '根据所选工具生成问卷、访谈或编码材料'} />
              <MiniInfo label="下一步任务" value={stage1ResearchPlan?.pendingResearchTasks.join('；') || '生成研究工具并等待用户收集数据'} />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.75, color: 'var(--color-ink-2)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
              <strong>方法理由：</strong>{stage1ResearchPlan?.methodReason || route.reason}
            </div>
          </section>
          <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(680px, 1fr)', gap: 14, alignItems: 'start' }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <section style={stepPanelStyle}>
                <StepTitle number="1" icon={<ClipboardList size={15} />} title="选择目的" />
                <div style={purposeGridStyle}>
                  {purposeOptions.map(option => (
                    <button
                      key={option.value}
                      onClick={() => setPurpose(option.value)}
                      style={{
                        border: `1px solid ${purpose === option.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        borderRadius: 8,
                        background: purpose === option.value ? 'var(--color-accent-light)' : 'transparent',
                        padding: 12,
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 800, color: purpose === option.value ? 'var(--color-accent)' : 'var(--color-ink)' }}>{option.label}</div>
                      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: 'var(--color-ink-3)' }}>{option.action}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section style={stepPanelStyle}>
                <StepTitle number="2" icon={<FileText size={15} />} title="确认论文上下文" />
                <div style={sourceChoiceGridStyle}>
                  {sourceOptions.map(option => (
                    <button
                      key={option.kind}
                      onClick={() => option.available && setSourceKind(option.kind)}
                      disabled={!option.available}
                      style={{
                        border: `1px solid ${source.kind === option.kind ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        borderRadius: 8,
                        background: source.kind === option.kind ? 'var(--color-accent-light)' : 'transparent',
                        opacity: option.available ? 1 : 0.48,
                        padding: 12,
                        textAlign: 'left',
                        cursor: option.available ? 'pointer' : 'not-allowed',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 850, color: source.kind === option.kind ? 'var(--color-accent)' : 'var(--color-ink)' }}>{option.label}</div>
                      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: 'var(--color-ink-3)' }}>{option.available ? option.description : '暂无可用内容'}</div>
                    </button>
                  ))}
                </div>
                <div style={sourceCardStyle}>
                  <div style={sourceHeaderStyle}>
                    <div>
                      <div style={sourceEyebrowStyle}>当前使用来源</div>
                      <strong style={{ fontSize: 14, color: 'var(--color-ink)' }}>{source.label}</strong>
                      <div style={sourceRouteHintStyle}>系统据此判断：{route.label}</div>
                    </div>
                    <span style={badgeStyle}>{source.confidence === 'high' ? '推荐' : source.confidence === 'medium' ? '可用' : '不足'}</span>
                  </div>
                  <div style={compactSourcePreviewStyle}>{source.text}</div>
                </div>
              </section>

              <section style={stepPanelStyle}>
                <StepTitle number="3" icon={<Pencil size={15} />} title="生成或查看当前结果" />
                <div style={taskBlockStyle}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-ink)' }}>{activePurpose.label}</div>
                    <p style={leadStyle}>{activePurpose.desc}</p>
                  </div>
                  {purpose === 'generate' && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
                        {toolOptions.map(option => (
                          <button
                            key={option.value}
                            onClick={() => {
                              setMode(option.value)
                              if (option.value === 'kano') setResultView('questionnaire')
                            }}
                            style={{
                              minHeight: 54,
                              border: `1px solid ${mode === option.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                              borderRadius: 8,
                              background: mode === option.value ? 'var(--color-accent-light)' : 'var(--color-surface)',
                              color: mode === option.value ? 'var(--color-accent)' : 'var(--color-ink-2)',
                              padding: 8,
                              textAlign: 'center',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-sans)',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 800 }}>{option.label}</div>
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--color-ink-3)' }}>{activeOption.outcome}</div>
                      {mode === 'kano' && (
                        <div style={kanoConfirmStyle}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-ink)' }}>KANO 生成前默认确认</div>
                          <div style={confirmGridStyle}>
                            <MiniInfo label="调研对象" value="普通读者 / 消费者" />
                            <MiniInfo label="问卷用途" value="作为论文研究方法的数据来源" />
                            <MiniInfo label="输出形式" value="问卷正文 + Kano分析框架" />
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => void generateTool()}
                        disabled={isGeneratingTool}
                        style={{ ...primaryButtonStyle, width: 'fit-content', opacity: isGeneratingTool ? 0.65 : 1 }}
                      >
                        {isGeneratingTool ? 'AI 正在生成…' : `根据${source.label}生成${activeOption.label}`}
                      </button>
                    </>
                  )}
                  {purpose === 'analyze' && (
                    <div style={inlineActionRowStyle}>
                      <label style={{ ...primaryButtonStyle, justifyContent: 'center' }}>
                        <Upload size={13} />
                        上传已有数据或材料
                        <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={uploadData} style={{ display: 'none' }} />
                      </label>
                      <button
                        onClick={runAnalysis}
                        disabled={!latestDataset || isAnalyzing}
                        title={latestDataset ? '基于最新上传数据生成分析结果' : '请先上传 CSV/TXT 数据文件'}
                        style={{
                          ...secondaryButtonStyle,
                          opacity: latestDataset && !isAnalyzing ? 1 : 0.62,
                          cursor: latestDataset && !isAnalyzing ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <BarChart3 size={13} />
                        {isAnalyzing ? '正在生成分析结果…' : '基于最新数据生成分析结果'}
                      </button>
                      <button
                        onClick={() => void reinterpretActiveAnalysis()}
                        disabled={!canReinterpretActiveAsset || isReinterpreting}
                        title={canReinterpretActiveAsset ? '保留计算结果，只重新生成论文方法和结果表述' : '需要先生成结构化分析结果'}
                        style={{
                          ...secondaryButtonStyle,
                          opacity: canReinterpretActiveAsset && !isReinterpreting ? 1 : 0.62,
                          cursor: canReinterpretActiveAsset && !isReinterpreting ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Pencil size={13} />
                        {isReinterpreting ? '正在重新解释…' : '重新解释结果'}
                      </button>
                    </div>
                  )}
                  {purpose === 'optimize' && (
                    <label style={{ ...primaryButtonStyle, justifyContent: 'center', width: 'fit-content' }}>
                      <Upload size={13} />
                      上传已有问卷
                      <input type="file" accept=".txt,.csv" onChange={uploadQuestionnaireForReview} style={{ display: 'none' }} />
                    </label>
                  )}
                  {notice && <div style={{ fontSize: 12, color: 'var(--color-accent)' }}>{notice}</div>}
                  {purpose === 'analyze' && <AnalysisProgress phase={analysisPhase} error={analysisError} />}
                </div>

                <div style={resultPreviewStyle}>
                  {!activeAsset ? (
                    <div style={emptyStyle}>还没有当前结果。完成上方生成或上传后，结果会在这里出现，并进入右侧资产记录。</div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-ink)' }}>{activeAsset.title}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-ink-3)' }}>{activeAsset.summary}</div>
                      </div>
                      {isKanoAsset && (
                        <div style={tabListStyle}>
                          {([
                            { key: 'questionnaire', label: '问卷正文' },
                            { key: 'analysis', label: 'Kano分析框架' },
                            { key: 'full', label: '完整文本' },
                          ] as const).map(tab => (
                            <button
                              key={tab.key}
                              onClick={() => setResultView(tab.key)}
                              style={{
                                ...tabButtonStyle,
                                background: resultView === tab.key ? 'var(--color-accent)' : 'transparent',
                                color: resultView === tab.key ? '#fff' : 'var(--color-ink-2)',
                                borderColor: resultView === tab.key ? 'var(--color-accent)' : 'var(--color-border)',
                              }}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={activeDisplayText}
                        readOnly={isKanoAsset && resultView !== 'full' && !draftText}
                        onChange={event => setDraftText(event.target.value)}
                        style={editorStyle}
                      />
                    </>
                  )}
                </div>
              </section>

              <section style={stepPanelStyle}>
                <StepTitle number="4" icon={<CheckCircle2 size={15} />} title="选择结果功能" />
                {!activeAsset ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px dashed var(--color-border)', borderRadius: 8, padding: 12, background: 'var(--color-bg)' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                      研究计算建议放在全文初稿之后使用。如果暂时不需要量表、问卷、KANO、AHP 或编码结果，可以回到文章生成继续完善正文。
                    </div>
                    <button onClick={() => navigate(`/projects/${project.id}/stage3`)} style={{ ...primaryButtonStyle, flexShrink: 0 }}>
                      回到文章生成
                      <ArrowRight size={13} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={actionGroupGridStyle}>
                      <ActionGroup title="导出与收集">
                        <button onClick={() => downloadText(`${activeAsset.title}.txt`, activeText)} style={secondaryButtonStyle}>
                          <Download size={13} />
                          导出文本
                        </button>
                        <button
                          onClick={() => wjxPasteText && downloadText(`${activeAsset.title}-问卷星粘贴版.txt`, wjxPasteText)}
                          disabled={!wjxPasteText}
                          style={secondaryButtonStyle}
                        >
                          <ClipboardList size={13} />
                          问卷星格式
                        </button>
                        <button
                          onClick={() => dataTemplate && downloadText(`${activeAsset.title}-数据模板.csv`, `\uFEFF${dataTemplate}`, 'text/csv;charset=utf-8')}
                          disabled={!dataTemplate}
                          style={secondaryButtonStyle}
                        >
                          <FileSpreadsheet size={13} />
                          数据模板
                        </button>
                      </ActionGroup>
                      <ActionGroup title="数据分析">
                        <label style={{ ...secondaryButtonStyle, justifyContent: 'center' }}>
                          <Upload size={13} />
                          上传回收数据
                          <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={uploadData} style={{ display: 'none' }} />
                        </label>
                        <button
                          onClick={runAnalysis}
                          disabled={!latestDataset || isAnalyzing}
                          title={latestDataset ? '基于最新上传数据生成分析结果' : '请先上传 CSV/TXT 数据文件'}
                          style={{
                            ...secondaryButtonStyle,
                            opacity: latestDataset && !isAnalyzing ? 1 : 0.62,
                            cursor: latestDataset && !isAnalyzing ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <BarChart3 size={13} />
                          {isAnalyzing ? '正在生成…' : '生成分析结果'}
                        </button>
                        <button
                          onClick={() => void reinterpretActiveAnalysis()}
                          disabled={!canReinterpretActiveAsset || isReinterpreting}
                          title={canReinterpretActiveAsset ? '保留计算结果，只重新生成论文方法和结果表述' : '需要先生成结构化分析结果'}
                          style={{
                            ...secondaryButtonStyle,
                            opacity: canReinterpretActiveAsset && !isReinterpreting ? 1 : 0.62,
                            cursor: canReinterpretActiveAsset && !isReinterpreting ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <Pencil size={13} />
                          {isReinterpreting ? '正在重新解释…' : '重新解释结果'}
                        </button>
                      </ActionGroup>
                      <ActionGroup title="写入论文">
                        <button onClick={() => void insertIntoPaper()} disabled={isWritingToPaper} style={{ ...primaryButtonStyle, opacity: isWritingToPaper ? 0.65 : 1, cursor: isWritingToPaper ? 'not-allowed' : 'pointer' }}>
                          <CheckCircle2 size={13} />
                          {isWritingToPaper ? '正在规划写入...' : 'AI 写入论文'}
                        </button>
                        <button onClick={() => navigate(`/projects/${project.id}/stage3`)} style={secondaryButtonStyle}>
                          回到文章生成
                          <ArrowRight size={13} />
                        </button>
                      </ActionGroup>
                      <ActionGroup title="版本留痕">
                        <button onClick={saveEditedVersion} disabled={!activeText.trim()} style={secondaryButtonStyle}>
                          <Save size={13} />
                          保存新版本
                        </button>
                        {latestAnalysis && (
                          <button onClick={() => setActiveAssetId(latestAnalysis.id)} style={secondaryButtonStyle}>
                            <BarChart3 size={13} />
                            查看最新分析
                          </button>
                        )}
                      </ActionGroup>
                    </div>
                    {uploadedName && <div style={resultMetaRowStyle}>已上传：{uploadedName}</div>}
                  </>
                )}
              </section>
            </section>

          </div>
        </main>
      </div>
    </div>
  )
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, background: 'var(--color-bg)' }}>
      <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45, color: 'var(--color-ink)', fontWeight: 750 }}>{value}</div>
    </div>
  )
}

function AnalysisProgress({ phase, error }: { phase: AnalysisPhase; error: string }) {
  const steps: Array<{ key: AnalysisPhase; label: string }> = [
    { key: 'uploaded', label: '已上传数据' },
    { key: 'planning', label: 'AI 已识别方法' },
    { key: 'running', label: '正在运行计算' },
    { key: 'interpreting', label: '正在生成论文表述' },
    { key: 'ready', label: '已生成论文结果' },
  ]
  const currentIndex = steps.findIndex(step => step.key === phase)
  if (phase === 'idle' && !error) return null
  return (
    <div style={analysisProgressStyle}>
      {steps.map((step, index) => {
        const done = currentIndex >= index || phase === 'ready'
        const active = step.key === phase
        return (
          <div key={step.key} style={{ ...analysisStepStyle, opacity: done || active ? 1 : 0.46 }}>
            <span style={{ ...analysisDotStyle, background: done ? 'var(--color-accent)' : '#D8D2C8' }} />
            {step.label}
          </div>
        )
      })}
      {phase === 'error' && <div style={{ fontSize: 12, color: '#A8443F' }}>分析失败：{error || '请检查数据格式后重试。'}</div>}
    </div>
  )
}

function StepTitle({ number, icon, title }: { number: string; icon: ReactNode; title: string }) {
  return (
    <div style={stepTitleStyle}>
      <span style={stepNumberStyle}>{number}</span>
      {icon}
      <span>{title}</span>
    </div>
  )
}

function ActionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={actionGroupStyle}>
      <div style={actionGroupTitleStyle}>{title}</div>
      <div style={actionGroupBodyStyle}>{children}</div>
    </div>
  )
}

const panelStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 16,
  boxShadow: 'var(--shadow-sm)',
}

const methodEditorStyle = {
  marginTop: 14,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-bg)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 10,
}

const fieldLabelStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  fontSize: 11,
  fontWeight: 800,
  color: 'var(--color-ink-3)',
}

const inputStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  color: 'var(--color-ink)',
  padding: '9px 10px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  lineHeight: 1.5,
  outline: 'none',
}

const selectStyle = {
  ...inputStyle,
  height: 38,
}

const stepPanelStyle = {
  ...panelStyle,
  padding: 14,
}

const stepTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 850,
  color: 'var(--color-ink)',
  marginBottom: 12,
}

const stepNumberStyle = {
  width: 22,
  height: 22,
  borderRadius: 999,
  background: 'var(--color-accent)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 850,
}

const purposeGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
}

const sourceChoiceGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
  marginBottom: 12,
}

const taskBlockStyle = {
  display: 'grid',
  gap: 10,
}

const inlineActionRowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  gap: 8,
}

const resultPreviewStyle = {
  marginTop: 14,
  borderTop: '1px solid var(--color-border)',
  paddingTop: 14,
}

const actionGroupGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 10,
}

const actionGroupStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 10,
  background: 'var(--color-bg)',
}

const actionGroupTitleStyle = {
  fontSize: 12,
  fontWeight: 850,
  color: 'var(--color-ink)',
  marginBottom: 8,
}

const actionGroupBodyStyle = {
  display: 'grid',
  gap: 8,
}

const titleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 14,
  fontWeight: 800,
  color: 'var(--color-ink)',
  marginBottom: 12,
}

const sourceCardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 14,
  background: 'var(--color-bg)',
  boxSizing: 'border-box' as const,
}

const sourceHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  marginBottom: 10,
}

const sourceEyebrowStyle = {
  fontSize: 11,
  color: 'var(--color-ink-3)',
  marginBottom: 4,
}

const sourceRouteHintStyle = {
  marginTop: 5,
  fontSize: 12,
  color: 'var(--color-ink-3)',
}

const resultMetaRowStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 10,
  margin: '0 0 10px',
  fontSize: 12,
  color: 'var(--color-accent)',
}

const analysisProgressStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 8,
  padding: 10,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.62)',
}

const analysisStepStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--color-ink-2)',
  minWidth: 0,
}

const analysisDotStyle = {
  width: 7,
  height: 7,
  borderRadius: 999,
  flexShrink: 0,
}

const assetListStyle = {
  display: 'grid',
  gap: 8,
  maxHeight: 560,
  overflowY: 'auto' as const,
  paddingRight: 2,
}

const assetChipStyle = {
  flex: '0 0 auto',
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '2px 6px',
  fontSize: 10,
  color: 'var(--color-accent)',
  background: 'var(--color-bg)',
}

const kanoConfirmStyle = {
  marginTop: 12,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-bg)',
  padding: 12,
}

const confirmGridStyle = {
  marginTop: 10,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
}

const tabListStyle = {
  display: 'flex',
  gap: 8,
  marginBottom: 10,
}

const tabButtonStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const badgeStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '3px 8px',
  fontSize: 11,
  color: 'var(--color-accent)',
  background: 'var(--color-accent-light)',
}

const leadStyle = {
  margin: '0 0 12px',
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--color-ink-3)',
}

const compactSourcePreviewStyle = {
  maxHeight: 96,
  overflowY: 'auto' as const,
  whiteSpace: 'pre-wrap' as const,
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--color-ink-3)',
  borderTop: '1px solid var(--color-border)',
  paddingTop: 9,
}

const primaryButtonStyle = {
  border: 'none',
  borderRadius: 6,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
}

const secondaryButtonStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-ink-2)',
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
}

const emptyStyle = {
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 8,
  padding: 14,
  color: 'var(--color-ink-3)',
  fontSize: 12,
  lineHeight: 1.7,
  background: 'var(--color-bg)',
}

const editorStyle = {
  width: '100%',
  minHeight: 420,
  maxHeight: 560,
  boxSizing: 'border-box' as const,
  resize: 'vertical' as const,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 12,
  background: 'var(--color-bg)',
  color: 'var(--color-ink-2)',
  fontSize: 12,
  lineHeight: 1.85,
  fontFamily: 'var(--font-sans)',
  outline: 'none',
}
