// 所有 AI Prompt 模板
// GPT 相关：UNDERSTAND_FROM_TEXT, UNDERSTAND_FROM_OUTLINE, CHAT_FOLLOWUP,
//           WRITE_SECTION, EXTRACT_STYLE, EXTRACT_CASES, FINISH_DRAFT
// 豆包相关：REVISE_SECTION, REWRITE_SELECTION, QUICK_ACTION, ADJUST_FINISH

import type { Message } from './ai'

export type AcademicLevel = '本科' | '硕士' | '期刊'

// ─────────────────────────────────────────────────────────────
// 阶段一：材料理解
// ─────────────────────────────────────────────────────────────

export function promptUnderstandFromText(articleText: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请学习用户提供的论文原文，了解论文的研究对象、研究范围和核心论点。

注意：
- 不要学习或模仿语言风格
- 不要进行任何改写
- 该内容仅用于理解文章的整体研究背景，为后续章节的写作或修改做准备

请用以下 JSON 格式回复，不要输出任何其他内容：
{
  "paperTitle": "论文标题（简洁、学术化，适合作为最终论文标题）",
  "researchObject": "研究对象（一句话，说明研究什么）",
  "writingBoundary": "写作边界（一句话，说明论文讨论什么、不讨论什么）",
  "academicLevel": "本科|硕士|期刊|其他",
  "coreClaims": "核心论点摘要（两到三句话）"
}`,
    },
    { role: 'user', content: articleText.slice(0, 8000) },
  ]
}

export function promptUnderstandFromOutline(outlineText: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请了解用户提供的论文及作品相关信息，包括论文的研究主题、整体框架，以及实践作品的内容说明等。

注意：
- 该信息仅用于帮助你理解研究意图和创作方向
- 不需要进行任何写作或改写
- 用于为后续正文生成建立统一理解

请用以下 JSON 格式回复，不要输出任何其他内容：
{
  "paperTitle": "论文标题（简洁、学术化，适合作为最终论文标题）",
  "researchObject": "研究对象（一句话，说明研究什么）",
  "writingBoundary": "写作边界（一句话，说明论文讨论什么、不讨论什么）",
  "academicLevel": "本科|硕士|期刊|其他",
  "coreClaims": "研究框架摘要（两到三句话，描述整体结构和创作方向）"
}`,
    },
    { role: 'user', content: outlineText.slice(0, 6000) },
  ]
}

export function promptChatFollowup(
  history: Message[],
  userInput: string,
  referenceContext?: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手，正在读取用户提供的题目、材料、想法、摘要、提纲或上传文件。
你的目标不是审查用户是否已经说清“学术边界”，而是用户给什么就先读懂什么，并给出下一步可写建议。

工作方式：
- 不要强行要求用户补充研究对象或写作边界；这些可以由你根据材料先做建议判断
- 你需要给出学段建议和理由，但最终学段由用户确认
- 如果用户上传或粘贴的是已有论文，只理解研究对象、核心论点和结构，不要学习语言风格
- 如果用户只提供题目、大纲或想法，判断为从 0 生成路径
- 不要模仿上传材料的语言风格，不要改写原文
- 重点整理：路径类型、输入类型、主题判断、材料可写方向、可展开论点、材料缺口/风险、推荐题目、学段建议
- 同时判断研究方法路线：定性、定量、混合、设计评价、案例研究、理论分析或暂不建议；这一步只做建议，后续由用户确认
- 如果建议定量/设计评价，说明适合生成哪些问卷、量表、KANO、AHP、数据表；如果建议定性，说明适合访谈、编码、主题提取或案例分析
- 不需要输出“大纲生成建议”
- 只要材料或输入已经足够形成初步理解，就输出“【理解完成】”和 JSON，让界面可以进入论文规格选择
- 如果信息非常少，也先给出谨慎建议，并在风险里说明缺口，不要卡住流程
${referenceContext ? `\n用户已提供的材料信息：\n${referenceContext}\n` : ''}
回复先用简短自然语言说明你读到了什么，再在末尾另起一行输出以下内容（不要加代码块）：
【理解完成】
{"paperTitle":"最推荐的论文题目","recommendedTitles":["题目1","题目2","题目3"],"pathType":"existing_paper_revision|from_scratch_generation","inputType":"paper|outline|topic|mixed_material","hasDetectedOutline":true,"hasDetectedDraft":true,"materialTopic":"材料主题或研究对象","researchObject":"研究对象","writingBoundary":"写作边界","possibleDirections":["可写方向1","可写方向2","可写方向3"],"keyArguments":["核心论点1","核心论点2","核心论点3"],"coreArguments":["核心论点1","核心论点2","核心论点3"],"risks":["材料缺口或风险1","材料缺口或风险2"],"academicLevelSuggestion":"本科|硕士|期刊|其他","academicLevelReason":"学段建议理由","academicLevel":"待用户确认","difficulty":"建议写作难度","outlineSummary":"如果识别到大纲，概括大纲结构；没有则为空","draftSummary":"如果识别到正文，概括正文内容；没有则为空","nextStepRecommendation":"generate_outline|confirm_detected_outline|revise_existing_draft|write_from_outline","researchPlan":{"methodType":"theoretical|case_study|quantitative|qualitative|mixed|design_evaluation","methodLabel":"研究方法建议名称，如质性访谈研究/问卷量化研究/混合研究/设计评价研究/理论分析","methodReason":"为什么该论文适合这种方法，1-2句话","suggestedTools":["scale_generation|hypothesis_model|survey_analysis|mediation|kano|ahp|grounded_coding|emotion_coding|theme_extraction|case_summary"],"variables":{"independent":["自变量或影响因素"],"dependent":["因变量或结果变量"],"mediator":["中介变量"],"moderator":[],"control":[]},"dataNeeds":["用户后续需要收集的数据或材料"],"outlineRequirements":["建议放入或预留的大纲章节"],"pendingResearchTasks":["后续可在研究方法工作台创建的任务"]},"coreSummary":"对材料和写作可能性的总结，两到三句话"}`,
    },
    ...history,
    { role: 'user', content: userInput },
  ]
}

// ─────────────────────────────────────────────────────────────
// 阶段二：正文处理 — 可选步骤
// ─────────────────────────────────────────────────────────────

export function promptExtractStyle(articleText: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个语言风格分析助手。请分析文章的写作习惯和语言风格特征。

分析要点：
- 句式特征（句子长短、结构偏好，如是否多用长句、排比句等）
- 用词倾向（学术化程度、是否喜欢举例、引用习惯等）
- 段落习惯（段落展开方式，如先论点后论据、还是先现象后分析）
- 整体风格（一句话总结，用于后续写作参考）

输出格式：
句式特征：……
用词倾向：……
段落习惯：……
整体风格：……

注意：
- 只分析写作习惯，不要提取具体内容或观点
- 不要复述文章说了什么
- 总字数控制在150字以内`,
    },
    { role: 'user', content: articleText.slice(0, 4000) },
  ]
}

export function promptExtractStyleProfile(articleText: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是语言风格分析助手。请从参考文章中提取“语言水平与表达方式画像”，用于后续写作时约束表达风格。

重要边界：
- 只分析语言水平、句式、段落组织、论证节奏和过渡方式
- 不提取、复述或保存具体观点、案例、材料、结论和原句
- 不模仿具体内容，不输出可直接复用的原文表达

请只输出 JSON，不要加代码块。必须严格包含以下 8 个字段，不要新增字段，不要缺字段；无法稳定判断时写“样本不足，暂未稳定识别”：
{
  "writingLevel":"语言水平与学术化程度，40-80字",
  "sentenceStyle":"句式特征，40-80字",
  "paragraphLogic":"段落组织方式，40-80字",
  "argumentStyle":"论证节奏与分析方式，40-80字",
  "transitionStyle":"过渡和衔接方式，40-80字",
  "vocabularyStyle":"词汇与术语使用习惯，40-80字",
  "avoidContentReuseNotice":"固定写作边界提醒，40-80字，强调只模仿表达方式，不复用观点/案例/素材/原句",
  "editableSummary":"标准风格名片总结，150-220字，按语言、句式、段落、论证、过渡五个维度概括"
}`,
    },
    { role: 'user', content: articleText.slice(0, 10000) },
  ]
}

export function promptExtractCases(
  referenceText: string,
  researchContext: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请阅读用户提供的参考文章，从中提取与研究主题相关的分析要点或具体案例。

研究背景：
${researchContext}

提取要求：
- 提取与研究主题直接相关的案例、数据、分析角度
- 每条案例简洁描述，注明出处位置（如"第二章第三节"）
- 案例可在后续写作或修改中被直接调用
- 不要复述无关内容，不要提取纯理论定义

输出格式（每条案例一个段落）：
【案例1】标题或关键词
具体内容描述（2-3句话）
可用于：（建议用在哪一章节）

【案例2】……`,
    },
    {
      role: 'user',
      content: `参考文章内容：\n\n${referenceText.slice(0, 6000)}`,
    },
  ]
}

export function promptExtractBackgroundMaterial(
  backgroundText: string,
  researchContext: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个艺术类论文资料整理助手。用户提供的是写作前的背景搜集材料，可能来自搜索、AI 汇总、课堂笔记或零散摘录。

请把它整理成“背景语境资料”，用于帮助后续 AI 理解研究对象、时代背景、人物关系、理论概念和可写论点。

研究背景：
${researchContext || '未提供具体项目背景'}

整理原则：
- 不要把这类资料当成正式参考文献
- 区分“可用于理解背景”和“可直接写进论文的论点”
- 提醒哪些内容需要再找真实文献或片源核验
- 用清晰的小标题，便于后续 @ 调用
- 不要虚构原文没有的信息

输出格式：
【背景摘要】
用 2-4 句话概括这批资料提供的核心语境。

【时代线索】
按时间、阶段或历史转折整理，无法形成时间线时写“无明确时间线”。

【核心人物/作品/对象】
列出人物、作品、机构或研究对象，并说明它们在论文中的意义。

【关键词与概念】
列出关键词、理论概念、审美概念或高频表述，并解释可用于什么论证。

【可转化论点】
把材料转化成可进入论文大纲或正文的论点，每条说明适合放在哪类章节。

【章节调用建议】
说明这份背景资料适合在 Stage1 理解、Stage2 大纲、Stage3 正文哪些位置调用。

【引用风险】
指出哪些内容只是背景理解，哪些必须补充正式文献、作品细读、可核验出处后才能作为脚注或参考文献。`,
    },
    {
      role: 'user',
      content: `背景资料原文：\n\n${backgroundText.slice(0, 10000)}`,
    },
  ]
}

// ─────────────────────────────────────────────────────────────
// 阶段二：正文处理 — 核心写作
// ─────────────────────────────────────────────────────────────

const LEVEL_GUIDE: Record<AcademicLevel, string> = {
  '本科': '本科论文写作标准：论述清晰、逻辑完整、语言规范即可，不要过度学术化，避免生僻术语堆砌',
  '硕士': '硕士论文写作标准：需有一定理论深度，论证严密，引用规范，语言学术化但不晦涩',
  '期刊': '期刊论文写作标准：论点鲜明，论据充分，语言精炼，具备较高学术规范性和原创性',
}

const THESIS_FORMAT_GUIDE = `论文格式规则：
- 完整论文必须包含：中文摘要、中文关键词、英文 Abstract、英文 Keywords、正文主章节、结语、参考文献。
- 中文摘要应使用第三人称客观语气，概括研究背景、研究对象、研究方法或分析路径、核心发现与研究意义，通常 200-350 字；避免口语化和“我认为”等表达。
- 中文关键词置于摘要之后，格式为“关键词：关键词一；关键词二；关键词三”，通常 3-5 个，使用中文分号分隔。
- 英文摘要标题使用“Abstract”，内容不是逐字翻译中文摘要，而是符合英文学术摘要习惯：先交代 research background 和 object，再说明 method / analytical framework，再概括 findings / contribution；段落可分为 1-3 段，语言保持正式、清晰、紧凑。
- 英文关键词格式为“Keywords: keyword one; keyword two; keyword three”，3-5 个，使用英文分号分隔；作品名、专有名词按英文规范斜体或保留通行译名。
- 引言进入正文之前应完成问题提出、研究背景、研究意义、研究对象、文献与方法的引入；不要重复摘要句式。
- 结语应回应全文论证，概括发现、说明局限和后续研究方向，避免拔高和空泛抒情。
- 大纲阶段必须默认包含“0 摘要”作为前置节点，用于承载中文摘要、中文关键词、英文 Abstract、英文 Keywords；参考文献不进入大纲章节。`

const EVIDENCE_FIRST_WRITING_GUIDE = `检索增强写作要求：
- 写作前先理解系统提供的“可引用文献清单/本章优先证据包”，再组织论证，效果应接近 Perplexity/Consensus 的“先查后写”。
- 正文不能只空泛扩写大纲；需要把已有研究、理论概念、研究方法、案例发现或数据背景转化为具体论证。
- 引用只用于有依据的句子：概念定义、研究现状、理论依据、方法背景、案例事实、数据判断、已有研究结论。
- 只能使用系统提供的 {{cite:S编号}} 标记；不要手写 [1]，不要编造作者、年份、期刊、页码、DOI 或不存在的文献。
- 如果文献不足或与本章不匹配，可以减少引用，但必须用谨慎语气，不要伪装成已有研究共识。
- 引用要自然嵌入段落，不要堆在同一句或每句话后面。`

export function promptWriteSection(
  sectionTitle: string,
  comprehensionSummary: string,
  referenceContext: string,
  bannedPhrases: string[],
  academicLevel: AcademicLevel = '本科',
  styleGuide?: string,
  caseSummary?: string
): Message[] {
  const banned = bannedPhrases.length > 0
    ? bannedPhrases.join('、')
    : '不仅、这一、不再、这种、值得注意的是、不难发现'

  const levelGuide = LEVEL_GUIDE[academicLevel]

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请根据论文背景和引用资料，为指定章节生成正文内容。

【论文背景】
${comprehensionSummary}

【引用资料与项目上下文】
${referenceContext || '（无引用资料）'}
${caseSummary ? `\n【可用案例参考】\n${caseSummary}\n如有合适的案例，可在正文中适当引用，用于支撑论述。` : ''}
【学段写作标准】
${levelGuide}
${styleGuide ? `\n【语言风格参考】\n${styleGuide}\n请模仿以上风格特征进行写作，不要模仿具体内容和观点。` : ''}
写作规则：
- 围绕章节标题展开，内容完整、逻辑清晰
- 禁止出现：${banned}
- 高级词汇不要密集堆砌，语言自然、灵活
- 仅生成当前小节，不要生成下一节标题或内容
- 字数 600-1000 字之间
- 直接输出正文，不要加标题、不要加序号`,
    },
    {
      role: 'user',
      content: `请为以下章节生成正文内容：\n\n${sectionTitle}`,
    },
  ]
}

export function promptReviseSection(
  opinion: string,
  originalText: string,
  referenceContext: string,
  bannedPhrases: string[],
  caseSummary?: string
): Message[] {
  const banned = bannedPhrases.length > 0
    ? bannedPhrases.join('、')
    : '不仅、这一、不再、这种'

  return [
    {
      role: 'system',
      content: `你是一个论文修改助手。请根据修改意见对原文段落进行修改。

【项目上下文与引用资料】
${referenceContext || '（无引用资料）'}
${caseSummary ? `\n【可用案例参考】\n${caseSummary}\n如修改意见中需要补充案例，可从以上案例中选取合适的引用。` : ''}
修改规则：
- 严格按照修改意见的方向进行调整
- 在满足修改要求的基础上，保持语言自然、灵活
- 禁止出现：${banned}
- 保持原文的整体长度，不要大幅增减
- 直接输出修改后的完整段落，不要加任何解释、引号或前言`,
    },
    {
      role: 'user',
      content: `修改意见：${opinion}\n\n原文：\n${originalText}`,
    },
  ]
}

// ─────────────────────────────────────────────────────────────
// 阶段二：框选工具栏
// ─────────────────────────────────────────────────────────────

export function promptRewriteSelection(
  instruction: string,
  selectedText: string,
  context: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请对选中的文字按要求处理。
规则：
- 只处理"选中文字"部分，不要修改上下文
- 保持与上下文的连贯性
- 直接输出处理结果，不要加引号、解释或前言`,
    },
    {
      role: 'user',
      content: `操作要求：${instruction}

上下文（仅供参考，不要修改）：
${context}

选中文字（请处理这部分）：
${selectedText}`,
    },
  ]
}

export type QuickAction = '缩短' | '扩写' | '学术化'

export function promptQuickAction(
  action: QuickAction,
  selectedText: string,
  context: string
): Message[] {
  const instructions: Record<QuickAction, string> = {
    '缩短': '将这段文字压缩，保留核心意思，去掉冗余表达，控制在原来60%的长度',
    '扩写': '将这段文字扩展，补充论证依据和细节说明，扩展至原来150%的长度',
    '学术化': '将这段文字改写为正式学术语言，使用规范的学术表达，提升论文语气',
  }
  return promptRewriteSelection(instructions[action], selectedText, context)
}

// ─────────────────────────────────────────────────────────────
// 阶段三：生成型收尾
// ─────────────────────────────────────────────────────────────

export function promptFinishDraft(
  fullText: string,
  researchObject: string,
  academicLevel: AcademicLevel = '本科'
): Message[] {
  const levelGuide = LEVEL_GUIDE[academicLevel]

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请学习用户提供的完整论文正文，在充分理解研究主题和结构的基础上，完成论文前置与收尾部分。

研究对象：${researchObject}

学段标准：${levelGuide}

${THESIS_FORMAT_GUIDE}

生成任务：
1. 【摘要】生成中文摘要，第三人称客观语气，约 200-350 字，覆盖研究背景、研究对象、研究路径、核心发现和意义。
2. 【关键词】提炼 3-5 个中文关键词，格式为“关键词：……；……；……”。
3. 【Abstract】生成英文摘要。必须符合英文论文摘要习惯，不要逐字翻译中文摘要；需包含 background / object / method or framework / findings / contribution。
4. 【Keywords】提炼 3-5 个英文关键词，格式为“Keywords: ...; ...; ...”。
5. 【引言】生成具有学术规范、逻辑清晰且有问题意识的引言，约两段，引出研究背景、问题、对象和意义。
6. 【结语】生成克制的结语，回应全文论证，总结发现、说明局限和后续研究方向，不要过度拔高。

输出格式（严格按照以下格式，每项之间空一行）：
【摘要】
……

【关键词】
……

【Abstract】
...

【Keywords】
...

【引言】
……

【结语】
……`,
    },
    {
      role: 'user',
      content: `以下是完整论文正文，请完成生成任务：\n\n${fullText.slice(0, 10000)}`,
    },
  ]
}

export function promptAdjustFinish(
  previousResult: string,
  adjustInstruction: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。用户对你上一次生成的中文摘要、英文 Abstract、关键词、引言或结语有调整意见。

请在上一次生成结果的基础上，只修改用户指出的部分，其余部分保持不变。

${THESIS_FORMAT_GUIDE}

调整原则：
- 只修改用户明确要求调整的内容
- 保持整体结构和格式不变
- 语言自然、克制，不要过度学术化或拔高
- 直接输出调整后的完整结果，格式与上一次保持一致`,
    },
    {
      role: 'user',
      content: `上一次的生成结果：\n\n${previousResult}\n\n调整意见：${adjustInstruction}`,
    },
  ]
}

// ─────────────────────────────────────────────────────────────
// 阶段二：大纲生成与确认
// ─────────────────────────────────────────────────────────────

export function promptGenerateOutline(
  comprehensionSummary: string,
  academicLevel: AcademicLevel = '本科',
  additionalRequirements?: string,
  referenceOutlineText?: string
): Message[] {
  const lowerContext = `${comprehensionSummary}\n${additionalRequirements ?? ''}`.toLowerCase()
  const isProfessionalMaster = academicLevel === '硕士' && /专硕|专业型|专业硕士|mfa|毕业作品|毕业设计|创作实践|实践探索|创作反思/.test(lowerContext)
  const outlineType = academicLevel === '期刊'
    ? '期刊论文'
    : academicLevel === '本科'
      ? '本科论文'
      : isProfessionalMaster
        ? '专业型硕士论文'
        : '学术型硕士论文'

  const structureGuide: Record<typeof outlineType, string> = {
    '期刊论文': `期刊论文大纲规则：
- 按艺术学、电影学、传播学、设计学等领域期刊论文结构生成，不采用“第一章、第二章”形式
- 正文设置 3-4 个一级标题，每个一级标题下设置 2-3 个二级标题；一般不设置三级标题
- 一级标题应体现问题意识、理论深度与逻辑递进，避免简单对象描述
- 标题可体现概念、机制、价值、影响、重构、转向、生成等学术表达
- 二级标题围绕一级标题展开具体分析
- 不生成“结语”“结论”章节
- 语言风格参考艺术学、电影学、传播学核心期刊写法，标题具有学术性、概括性与理论张力`,
    '学术型硕士论文': `学术型硕士论文大纲规则：
- 设置“绪论”
- 绪论一般包含：研究背景/研究缘起、研究意义与研究目的、国内外研究现状、研究思路与研究方法、研究创新点与难点、主要内容
- 正文一般设置 4 章，每章设置 3 个一级小节，每个一级小节下设置 2-3 个三级标题
- 标题体现学术逻辑与递进关系，避免简单罗列研究对象
- 后续章节建议形成递进：概念界定/历史背景/媒介语境 → 实践形态/生产机制/内容特征 → 传播效果/审美经验/认知转化 → 价值意义/现实问题/发展路径
- 不生成“结语”“结论”章节`,
    '专业型硕士论文': `专业型硕士论文大纲规则：
- 适用于电影、广播电视、戏剧影视、美术与书法、设计、数字媒体艺术、动画等艺术类专业硕士/MFA
- 设置“绪论”，一般包含：研究背景与研究意义、国内外研究现状、研究思路与研究方法、研究创新点、主要内容
- 正文一般设置 4 章，每章设置 3 个一级小节，每个一级小节下设置 1-2 个三级标题
- 前三章围绕研究对象展开分析，逻辑清晰直接，避免过度理论化
- 常见分析维度包括：叙事策略、视听语言、角色塑造、影像风格、色彩设计、场景设计、镜头语言、传播特征、视觉表达、审美特征、创作方法
- 最后一章必须是实践章节，标题可为“毕业作品《XXX》的创作实践”“毕业作品《XXX》的实践探索”或“《XXX》的创作实践与反思”
- 实践章节一般包含：创作定位与前期构思、创作过程与具体实践、创作反思与优化方向
- 不生成“结语”“结论”章节`,
    '本科论文': `本科论文大纲规则：
- 适用于电影学、广播电视编导、戏剧影视文学、表演、播音主持、动画、数字媒体艺术、视觉传达、环境设计、美术学等艺术类本科论文
- 总体控制在 3-4 个一级标题，每个一级标题下设置 2-3 个二级标题；结构简洁清晰，避免过度理论化
- 标题表达通俗准确，符合本科毕业论文写作习惯
- 前几部分围绕研究对象、创作方法、表现手法、艺术特征等展开
- 如果论文涉及毕业作品/毕业设计/毕业创作，最后一部分结合实践分析与总结，包含创作构思与设计思路、创作过程与具体实践、创作反思与优化方向
- 如果不涉及毕业作品，最后一部分调整为问题分析、价值总结或发展思考
- 不生成“结语”“结论”章节`,
  }

  const researchCarrierGuide = `研究结果承载位规则：
- 如果论文背景或 Stage1 研究方法建议中出现问卷、访谈、KANO、AHP、熵权法、TOPSIS、回归、中介、信效度、EFA、编码、扎根、案例评价、用户研究、数据分析等内容，大纲必须预留研究结果承载位。
- 研究结果承载位不是让用户先做研究计算；流程上仍然是先确认大纲，再进入文章生成，研究计算放在全文初稿之后补入。
- 对需要研究计算/实证/问卷/量化/中介/信效度/设计评价的论文，「研究设计与数据来源」和「数据分析与研究结果」必须各自作为独立的一级章节（独立的“一、二、三…”级，不能合并成某一章下面的二级或三级小节），「结果讨论与优化建议」也应作为独立一级章节或紧随结果之后的一级章节。这样统计图表、信效度、相关/回归/中介等结果才有清晰的章节承接位，避免被塞进概念分析章里。
- “研究设计与数据来源”用于承接研究对象、样本/材料、变量/指标体系、问卷/编码/模型和分析流程。
- “数据分析与研究结果”用于承接后续 Python/AI 研究计算生成的统计表、图表、KANO 分类、权重、优先级矩阵、编码结果或案例结果。
- “结果讨论与优化建议”用于把研究结果转化为设计策略、优化路径、理论讨论或实践建议。
- 不要在大纲阶段生成具体数值结论；只设计可承接结果的章节位置。`

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请根据论文背景信息，生成一份完整的论文大纲。

当前大纲类型：${outlineType}
${structureGuide[outlineType]}
${additionalRequirements ? `\n额外要求：${additionalRequirements}` : ''}
${referenceOutlineText ? `\n参考大纲迁移规则：
- 用户提供的参考大纲只用于学习章节结构、逻辑层次、标题组织方式和内容展开路径
- 不要复制参考大纲的具体研究对象、案例、原句或结论
- 需要结合当前论文题目/研究对象重构为新的大纲
- 如果参考大纲与当前题目不完全匹配，保留其有效结构骨架，调整章节功能和标题表达

【参考大纲】
${referenceOutlineText.slice(0, 6000)}` : ''}

${THESIS_FORMAT_GUIDE}

${researchCarrierGuide}

大纲要求：
- 大纲第一项必须是：order 为 "0"、level 为 1、title 为 "摘要" 的前置节点；该节点不需要 children
- 摘要必须进入 sections，作为 "0 摘要"；参考文献不进入 sections
- 正文层级按当前大纲类型生成：期刊和本科可到二级标题；硕士论文通常到三级标题
- 每个标题简洁准确，反映该部分的核心内容
- 章节之间逻辑递进，层次分明
- title 字段不要包含 order 编号，编号由 order 字段承担
- 不要生成参考文献、附录、致谢
- 除非用户明确要求，正文部分不要生成“结语”“结论”章节

请严格用以下 JSON 格式输出，不要输出任何其他内容：
{
  "sections": [
    {
      "order": "0",
      "level": 1,
      "title": "摘要"
    },
    {
      "order": "1",
      "level": 1,
      "title": "绪论",
      "children": [
        {
          "order": "1.1",
          "level": 2,
          "title": "研究背景与意义",
          "children": [
            { "order": "1.1.1", "level": 3, "title": "研究背景" },
            { "order": "1.1.2", "level": 3, "title": "研究意义" }
          ]
        }
      ]
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `论文背景：\n${comprehensionSummary}`,
    },
  ]
}

export function promptReviseOutline(
  currentOutlineJSON: string,
  userOpinion: string,
  comprehensionSummary: string
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。用户对当前大纲有调整意见，请根据意见修改大纲。

论文背景：
${comprehensionSummary}

${THESIS_FORMAT_GUIDE}

调整原则：
- 只修改用户明确提到的部分
- 保留用户未提及的章节结构
- 保持原有的 JSON 格式和字段结构不变
- 新增章节时自动补充合理的 order 编号
- 保留或补足 "0 摘要" 节点；不要删除摘要节点
- 不要把参考文献新增为正文主章节

请直接输出修改后的完整 JSON，不要输出任何其他内容，格式与输入保持一致。`,
    },
    {
      role: 'user',
      content: `当前大纲：\n${currentOutlineJSON}\n\n调整意见：${userOpinion}`,
    },
  ]
}

export function promptGeneratePaperPlan(
  fullOutlineSummary: string,
  comprehensionSummary: string,
  referenceContext: string,
  academicLevel: AcademicLevel = '本科',
  styleGuide?: string
): Message[] {
  const levelGuide = LEVEL_GUIDE[academicLevel]

  return [
    {
      role: 'system',
      content: `你是论文总编。请在正式生成正文前，为整篇论文制定一份内部写作计划。

【论文背景】
${comprehensionSummary || '（暂无）'}

【完整大纲】
${fullOutlineSummary}

【引用资料与项目上下文】
${referenceContext || '（无引用资料）'}

【学段写作标准】
${levelGuide}
${styleGuide ? `\n【语言风格参考】\n${styleGuide}` : ''}

【论文格式规则】
${THESIS_FORMAT_GUIDE}

${EVIDENCE_FIRST_WRITING_GUIDE}

计划要求：
- 明确整篇论文的中心论点和论证路线
- 说明每一章承担的功能、核心论点、承接关系
- 标记哪些概念需要前后一致
- 给出引用资料的大致分配策略，并说明哪些章节最需要文献支撑
- 如果大纲包含研究设计、数据分析、研究结果、实证分析、结果讨论等章节，必须生成“研究结果承载计划”：说明方法段、数据表/图表、结果解释、讨论建议分别应写入哪些章节
- 对尚未完成的研究计算，不要编造样本量、均值、权重、p 值、分类、模型系数、编码频次或图表结论；只规划承接语和待插入位置
- 给出中文摘要、中文关键词、英文 Abstract、英文 Keywords 的写作方向和关键词候选
- 提醒哪些内容不要重复
- 这是内部计划，不要写正文

输出格式：
【总论点】
...

【章节分工】
1 ...
2 ...

【承接关系】
...

【术语与引用策略】
...

【研究结果承载计划】
...

【中英文摘要与关键词策略】
...

【避免重复】
...`,
    },
    {
      role: 'user',
      content: '请生成全文写作计划。',
    },
  ]
}

export function promptGenerateFrontMatter(
  fullOutlineSummary: string,
  comprehensionSummary: string,
  referenceContext: string,
  academicLevel: AcademicLevel = '本科',
  paperPlan?: string,
  styleGuide?: string
): Message[] {
  const levelGuide = LEVEL_GUIDE[academicLevel]

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请为整篇论文生成固定格式的前置摘要部分。

【论文背景】
${comprehensionSummary || '（暂无）'}

【完整大纲】
${fullOutlineSummary}

${paperPlan ? `【全文写作计划】\n${paperPlan}\n` : ''}

【引用资料与项目上下文】
${referenceContext || '（无引用资料）'}

【学段写作标准】
${levelGuide}
${styleGuide ? `\n【语言风格参考】\n${styleGuide}` : ''}

${THESIS_FORMAT_GUIDE}

必须严格输出以下四个部分，不要输出“0 摘要”标题，系统会自动显示标题：

【摘要】
中文摘要正文。第三人称客观语气，约 200-350 字，覆盖研究背景、研究对象、研究方法或分析路径、核心发现、研究意义。避免“本文将”“我认为”等口语或主观表达。

【关键词】
关键词：关键词一；关键词二；关键词三；关键词四

【Abstract】
English abstract. It should follow English academic abstract conventions rather than translate the Chinese abstract word-for-word. Include background, research object, method or analytical framework, findings, and contribution.

【Keywords】
Keywords: keyword one; keyword two; keyword three; keyword four`,
    },
    {
      role: 'user',
      content: '请生成论文前置摘要部分。',
    },
  ]
}

export function promptSummarizeGeneratedChapter(chapterTitle: string, chapterContent: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是论文总编助理。请把已生成章节压缩成后续章节可用的上下文摘要。

要求：
- 只总结本章已经完成的论点、关键概念、材料使用和结论
- 标出下一章应避免重复的内容
- 150-220 字
- 直接输出摘要，不要加寒暄`,
    },
    {
      role: 'user',
      content: `章节标题：${chapterTitle}\n\n章节正文：\n${chapterContent.slice(0, 6000)}`,
    },
  ]
}

export function promptGenerateChapter(
  chapterTitle: string,
  chapterOutline: string,
  fullOutlineSummary: string,
  comprehensionSummary: string,
  referenceContext: string,
  bannedPhrases: string[],
  academicLevel: AcademicLevel = '本科',
  styleGuide?: string,
  caseSummary?: string,
  paperPlan?: string,
  previousChapterSummaries?: string,
  nextChapterTitle?: string
): Message[] {
  const levelGuide: Record<AcademicLevel, string> = {
    '本科': '本科论文：语言规范清晰，论述完整，避免过度学术化',
    '硕士': '硕士论文：需有理论深度，论证严密，引用规范，语言学术化',
    '期刊': '期刊论文：论点鲜明，语言精炼，具备较高学术规范性',
  }

  const banned = bannedPhrases.length > 0
    ? bannedPhrases.join('、')
    : '不仅、这一、不再、这种、值得注意的是、不难发现'

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请根据大纲结构，为指定章节生成完整正文。

【论文背景】
${comprehensionSummary}

【完整大纲结构（供参考，了解章节上下文）】
${fullOutlineSummary}

${paperPlan ? `【全文写作计划（必须遵守，用于保持章节连贯）】\n${paperPlan}\n` : ''}

${previousChapterSummaries ? `【前文摘要（避免重复，并承接已经写过的内容）】\n${previousChapterSummaries}\n` : ''}

${nextChapterTitle ? `【下一章提示】\n下一章是「${nextChapterTitle}」。本章结尾需要自然铺垫，但不要提前展开下一章主体内容。\n` : ''}

【引用资料与项目上下文】
${referenceContext || '（无引用资料）'}
${caseSummary ? `\n【可用案例参考】\n${caseSummary}` : ''}
${styleGuide ? `\n【语言风格参考】\n${styleGuide}` : ''}
【学段写作标准】
${levelGuide[academicLevel]}

【论文格式边界】
${THESIS_FORMAT_GUIDE}

${EVIDENCE_FIRST_WRITING_GUIDE}

写作规则：
- 严格按照本章大纲结构展开，每个子节都要覆盖
- 不要重复输出本章一级标题（例如“1 绪论”），系统会自动显示章节标题
- 子节标题必须逐字使用“本章包含以下各节”里的完整标题格式；二级标题保留“（一）标题”，三级标题保留“1. 标题”。不要把“研究背景”“研究意义与目的”等三级标题写成普通段落
- 子节标题单独成行输出，不要使用 Markdown 加粗、列表符号或额外编号
- 本章需要服务于全文写作计划，不要像孤立文章一样重新开题
- 与前文已有内容保持承接，避免重复解释同一概念
- 每个子节至少形成“观点—依据—分析—小结”的段落链条，优先用本章优先证据包支撑关键判断
- 如果本章标题或子节标题涉及研究设计、数据来源、变量、指标体系、数据分析、研究结果、实证分析、KANO、熵权法、AHP、问卷、访谈、编码、信效度、相关、回归、中介、EFA 等内容，必须为后续研究计算结果保留承接位置
- 保留承接位置的写法是：先写清研究目的、分析逻辑、变量/指标关系、预期表格或图示的功能，再用一两句说明“具体结果将依据后续导入数据计算后写入”；不要输出虚假的样本量、权重、分类、均值、p 值、系数、图表编号或结论
- 对“数据分析与研究结果”“研究结果展示”等章节，可以写方法铺垫、结果解释框架和待写入位置，但不得为了完整感编造统计结果
- 如果使用文献观点，必须在该句末写 {{cite:S编号}}，系统会自动转换为脚注和参考文献
- 当前任务只生成正文主章节，不要在章节正文中插入中文摘要、Abstract、关键词、Keywords 或参考文献
- 禁止出现：${banned}
- 语言自然、灵活，高级词汇不要密集堆砌
- 每节正文 400-600 字，整章合计不少于 1500 字
- 只生成本章内容，不要生成其他章节`,
    },
    {
      role: 'user',
      content: `请生成以下章节的完整正文：

${chapterTitle}

本章包含以下各节：
${chapterOutline}`,
    },
  ]
}
