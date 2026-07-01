import type { Message } from './ai'

export type PromptModuleKey =
  | 'stage1'
  | 'library'
  | 'outline'
  | 'draft'
  | 'selection'
  | 'scholar'
  | 'references'
  | 'research_tools'
  | 'research_analysis'

export type PromptRuntime = 'client' | 'server' | 'catalog'

export interface PromptCatalogItem {
  key: string
  module: PromptModuleKey
  moduleLabel: string
  name: string
  trigger: string
  location: string
  runtime: PromptRuntime
  editableFocus: string
  defaultInstruction: string
}

export interface PromptOverride {
  key: string
  enabled: boolean
  instruction: string
  updatedAt: number
}

const STORAGE_KEY = 'pai_prompt_overrides'

export const PROMPT_MODULES: Array<{ key: PromptModuleKey; label: string; description: string }> = [
  { key: 'stage1', label: '材料理解', description: '上传材料、识别题目、判断研究路线。' },
  { key: 'library', label: '资料/风格/案例', description: '资料库、风格档案、案例和背景材料提取。' },
  { key: 'outline', label: '大纲生成', description: '论文大纲、学校格式、研究章节预留。' },
  { key: 'draft', label: '正文生成', description: '全文计划、摘要、逐章正文、收尾和研究资产融入。' },
  { key: 'selection', label: '选区改写', description: '框选后的改写、缩短、扩写、学术化。' },
  { key: 'research_tools', label: '问卷/AHP/KANO', description: '问卷、访谈、KANO、AHP、编码表生成。' },
  { key: 'research_analysis', label: '研究解释', description: '统计/编码结果解释、图表说明、插入章节规划。' },
  { key: 'scholar', label: '文献证据包', description: '检索词、文献筛选、章节证据包。' },
  { key: 'references', label: '引用增强', description: '后补引用、观点绑定文献、脚注策略。' },
]

function item(
  key: string,
  module: PromptModuleKey,
  name: string,
  trigger: string,
  location: string,
  runtime: PromptRuntime,
  editableFocus: string,
  defaultInstruction: string,
): PromptCatalogItem {
  const moduleLabel = PROMPT_MODULES.find(item => item.key === module)?.label ?? module
  return { key, module, moduleLabel, name, trigger, location, runtime, editableFocus, defaultInstruction }
}

export const PROMPT_CATALOG: PromptCatalogItem[] = [
  item('promptUnderstandFromText', 'stage1', '材料正文理解', 'Stage1 上传/粘贴正文材料', 'src/lib/prompts.ts', 'client', '题目识别、研究对象、学段判断、JSON 字段。', '保持论文写作助手语气，优先准确识别研究对象和写作边界，不模仿原文风格。'),
  item('promptUnderstandFromOutline', 'stage1', '已有大纲理解', 'Stage1 上传/粘贴已有大纲', 'src/lib/prompts.ts', 'client', '大纲识别、已有结构保留、下一步建议。', '判断是否已有可用大纲，并给出后续正文生成建议。'),
  item('promptChatFollowup', 'stage1', '材料理解追问', 'Stage1 左侧对话', 'src/lib/prompts.ts', 'client', '追问方式、研究路线建议、输出长度。', '先读懂用户材料，再给可执行写作建议；信息不足时也要给谨慎建议。'),

  item('promptExtractStyle', 'library', '旧风格提取', '资料库风格提取', 'src/lib/prompts.ts', 'client', '句式、段落、用词、风格维度。', '只分析语言习惯，不复用观点、案例或原句。'),
  item('promptExtractStyleProfile', 'library', '风格档案', '风格档案页', 'src/lib/prompts.ts', 'client', '风格画像字段、禁用表达、示例风格。', '生成可复用的表达方式画像，明确禁止内容复用。'),
  item('promptExtractCases', 'library', '案例解析', '资料库案例解析', 'src/lib/prompts.ts', 'client', '案例数量、案例字段、章节调用建议。', '提取与当前论文主题直接相关的案例、角度和可写材料。'),
  item('promptExtractBackgroundMaterial', 'library', '背景材料解析', '资料库背景资料', 'src/lib/prompts.ts', 'client', '背景摘要、理论概念、引用风险。', '区分背景理解和可直接写入论文的论点，提醒需要核验的内容。'),
  item('buildExtractPrompt', 'library', '后端文档提取', '文件上传解析兜底', 'server/lib/extract.ts', 'server', '文档结构化字段、摘要方式。', '把上传文本结构化为后续理解和写作可用的资料。'),

  item('promptGenerateOutline', 'outline', '生成大纲', 'Stage2 生成大纲', 'src/lib/prompts.ts', 'client', '学校格式、摘要节点、章节层级、研究计算承载位。', '默认生成包含“0 摘要”的规范论文大纲，并为研究计算预留方法和结果章节。'),
  item('promptReviseOutline', 'outline', '修改大纲', 'Stage2 根据意见修改大纲', 'src/lib/prompts.ts', 'client', '修改原则、保留结构、编号规则。', '只修改用户明确要求的部分，保持 JSON 结构和编号稳定。'),

  item('promptWriteSection', 'draft', '单节正文生成', '旧章节生成/兼容入口', 'src/lib/prompts.ts', 'client', '单节字数、禁用词、风格和案例调用。', '围绕章节标题生成自然、清晰、符合学段的正文。'),
  item('promptGeneratePaperPlan', 'draft', '全文写作计划', 'Stage3 点击生成全文', 'src/lib/prompts.ts', 'client', '全文结构、章节分工、引用策略、研究结果承载计划。', '先形成总论点、章节分工和引用策略，再逐章写作。'),
  item('promptGenerateFrontMatter', 'draft', '摘要/Abstract', 'Stage3 生成摘要节点', 'src/lib/prompts.ts', 'client', '摘要长度、关键词数量、英文摘要风格。', '中文摘要客观概括背景、对象、方法、发现和意义；英文摘要符合英文学术习惯。'),
  item('promptGenerateChapter', 'draft', '逐章正文生成', 'Stage3 逐章生成正文', 'src/lib/prompts.ts', 'client', '论证密度、学术语气、引用标记、研究结果预留。', '每节形成观点-依据-分析-小结链条，不编造研究计算结果。'),
  item('promptSummarizeGeneratedChapter', 'draft', '章节摘要', '每章生成后', 'src/lib/prompts.ts', 'client', '摘要粒度、后文承接。', '压缩已生成章节，帮助后续章节避免重复。'),
  item('promptReviseSection', 'draft', '章节意见修改', 'Stage3 按意见修改章节', 'src/lib/prompts.ts', 'client', '修改口吻、保留原文程度、禁用套话。', '严格按用户意见修改，保持原文结构和自然学术表达。'),
  item('promptFinishDraft', 'draft', '收尾生成', 'Stage3 收尾生成', 'src/lib/prompts.ts', 'client', '结论、研究不足、展望写法。', '补齐摘要、引言、结语等收尾内容，避免过度拔高。'),
  item('promptAdjustFinish', 'draft', '调整收尾', 'Stage3 调整收尾内容', 'src/lib/prompts.ts', 'client', '调整范围、结构保持。', '只修改用户指出的部分，其余结构保持不变。'),
  item('promptGenerateResearchAssetSection', 'draft', '研究资产融入正文', 'Stage3 插入研究资产', 'src/pages/Stage3.tsx', 'client', '表图前后说明、结果融入段落。', '把研究结果写成论文段落，而不是独立模块。'),
  item('promptPolishResearchAssetIntoSection', 'draft', '研究资产润色', 'Stage3 研究资产插入后润色', 'src/pages/Stage3.tsx', 'client', '段落连贯性、章节语气统一。', '让研究结果与当前章节上下文自然衔接。'),

  item('promptRewriteSelection', 'selection', '选区自定义改写', '框选文字后 AI 改写', 'src/lib/prompts.ts', 'client', '改写强度、保留原意、学术化程度。', '只处理选中文字，不修改上下文。'),
  item('promptQuickAction', 'selection', '选区快捷动作', '缩短/扩写/学术化', 'src/lib/prompts.ts', 'client', '快捷动作定义、输出长度。', '快捷处理选中文字，保持上下文连贯。'),

  item('buildResearchToolPrompt', 'research_tools', '生成研究工具', '研究计算：没有数据时生成问卷/访谈/AHP/KANO/编码表', 'src/lib/researchToolQuality.ts', 'client', '题量、维度、KANO/AHP 规则、访谈问题、编码表字段。', '研究工具必须贴合当前论文，不输出泛模板，宁可完整偏长。'),
  item('buildResearchToolRepairPrompt', 'research_tools', '研究工具自动修复', '研究工具质检不通过后', 'src/lib/researchToolQuality.ts', 'client', '补题规则、修复标准、最终版格式。', '根据质检问题补全题量、变量、编码和后续分析说明。'),

  item('researchInterpret', 'research_analysis', '研究结果解释', '/api/research/interpret', 'server/routes/research.ts', 'server', '结果解释风格、图表前后说明、保守表述。', '只依据输入结果写，不编造显著性、系数、样本量或结论。'),
  item('researchIntent', 'research_analysis', '研究意图识别', '/api/research/intent', 'server/routes/research.ts', 'server', '方法识别标准、能力边界。', '判断用户研究目的和推荐方法，识别工具箱外能力。'),
  item('researchAnalysisPlan', 'research_analysis', '分析方案生成', '/api/research/analysis-plan', 'server/routes/research.ts', 'server', '变量角色、方法选择、输出包。', '根据数据画像选择可执行统计/编码方法。'),
  item('researchWritePlan', 'research_analysis', '研究结果写入规划', '/api/research/write-plan', 'server/routes/research.ts', 'server', '图表插入章节、信效度位置、讨论位置。', '根据论文大纲判断研究组件应写入哪个章节。'),

  item('generateSearchQueries', 'scholar', '文献检索词生成', '/api/scholar/prepare', 'server/routes/scholar.ts', 'server', '检索词数量、中英文比例、学科关键词。', '根据题目、大纲和研究对象生成学术检索式。'),
  item('selectSourcesWithAI', 'scholar', '文献筛选', '文献候选筛选', 'server/routes/scholar.ts', 'server', '筛选标准、年份偏好、中英文比例。', '筛出真正可用于论文论证的来源。'),
  item('buildEvidencePackWithAI', 'scholar', '证据包生成', '章节证据包', 'server/routes/scholar.ts', 'server', '证据分类、章节引用计划、引用数量。', '把来源整理为理论、综述、方法、案例和章节证据。'),
  item('buildEnhancementPrompt', 'references', '引用增强', '/api/references/enhance', 'server/routes/references.ts', 'server', '引用密度、观点绑定文献、是否改写。', '只使用提供来源，找出需要引用的位置并补脚注。'),
]

function readOverrides(): PromptOverride[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isPromptOverride) : []
  } catch {
    return []
  }
}

function writeOverrides(items: PromptOverride[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event('pai-prompt-overrides-updated'))
}

function isPromptOverride(value: unknown): value is PromptOverride {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.key === 'string' &&
    typeof item.enabled === 'boolean' &&
    typeof item.instruction === 'string' &&
    typeof item.updatedAt === 'number'
}

export const promptOverrideStore = {
  getAll: readOverrides,
  get(key: string) {
    return readOverrides().find(item => item.key === key)
  },
  save(key: string, instruction: string, enabled = true) {
    const items = readOverrides()
    const next = {
      key,
      enabled,
      instruction,
      updatedAt: Date.now(),
    }
    const index = items.findIndex(item => item.key === key)
    if (index >= 0) items[index] = next
    else items.push(next)
    writeOverrides(items)
    return next
  },
  setEnabled(key: string, enabled: boolean) {
    const current = this.get(key)
    this.save(key, current?.instruction ?? '', enabled)
  },
  reset(key: string) {
    writeOverrides(readOverrides().filter(item => item.key !== key))
  },
  importAll(items: PromptOverride[]) {
    writeOverrides(items.filter(isPromptOverride))
  },
}

export function getPromptInstruction(key: string) {
  const override = promptOverrideStore.get(key)
  if (!override?.enabled || !override.instruction.trim()) return ''
  return override.instruction.trim()
}

export function withPromptSetting(key: string, messages: Message[]): Message[] {
  const instruction = getPromptInstruction(key)
  if (!instruction) return messages
  const note = `\n\n【后台 Prompt 设置补充规则】\n${instruction}\n`
  const systemIndex = messages.findIndex(message => message.role === 'system')
  if (systemIndex < 0) {
    return [{ role: 'system', content: note.trim() }, ...messages]
  }
  return messages.map((message, index) => (
    index === systemIndex ? { ...message, content: `${message.content}${note}` } : message
  ))
}
