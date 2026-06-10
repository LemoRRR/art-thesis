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
      content: `你是一个论文写作助手，正在与用户确认论文的背景信息。
你的目标是理解：研究对象、写作边界、学段（本科/硕士/期刊）。
语言简洁友好，不要啰嗦，每次只问一个问题。
${referenceContext ? `\n用户已提供的材料信息：\n${referenceContext}\n` : ''}
当信息足够时，在回复末尾另起一行输出以下内容（不要加代码块）：
【理解完成】
{"paperTitle":"...","researchObject":"...","writingBoundary":"...","academicLevel":"本科|硕士|期刊|其他","coreClaims":"..."}`,
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
      content: `你是一个论文写作助手。请学习用户提供的完整论文正文，在充分理解研究主题和结构的基础上，完成以下四项生成任务。

研究对象：${researchObject}

学段标准：${levelGuide}

生成任务：
1. 【摘要】生成第三人称客观语气的摘要，约200字，禁止出现"本文"等第一人称表述
2. 【关键词】提炼4-5个关键词，准确概括论文研究重点，用"、"分隔
3. 【引言】生成一段具有学术规范、逻辑清晰且有吸引力的引言，约两段，引出研究背景和意义
4. 【结语】生成一个发散性、开放性的结语，用于总结研究并引出进一步思考，不要过度拔高

输出格式（严格按照以下格式，每项之间空一行）：
【摘要】
……

【关键词】
……

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
      content: `你是一个论文写作助手。用户对你上一次生成的摘要/关键词/引言/结语有调整意见。

请在上一次生成结果的基础上，只修改用户指出的部分，其余部分保持不变。

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
  additionalRequirements?: string
): Message[] {
  const levelGuide: Record<AcademicLevel, string> = {
    '本科': '本科论文：通常4-5章，每章2-4节，结构清晰完整即可',
    '硕士': '硕士论文：通常5-6章，每章3-5节，需包含文献综述、研究方法、实证分析等标准章节',
    '期刊': '期刊论文：通常3-5个一级标题，结构精炼，突出研究创新点',
  }

  return [
    {
      role: 'system',
      content: `你是一个论文写作助手。请根据论文背景信息，生成一份完整的论文大纲。

学段要求：${levelGuide[academicLevel]}
${additionalRequirements ? `\n额外要求：${additionalRequirements}` : ''}

大纲要求：
- 包含完整的三级标题结构（章 → 节 → 小节）
- 每个标题简洁准确，反映该部分的核心内容
- 章节之间逻辑递进，层次分明
- 必须包含：绪论、文献综述（或理论基础）、研究方法、核心论述章节、结论

请严格用以下 JSON 格式输出，不要输出任何其他内容：
{
  "sections": [
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

调整原则：
- 只修改用户明确提到的部分
- 保留用户未提及的章节结构
- 保持原有的 JSON 格式和字段结构不变
- 新增章节时自动补充合理的 order 编号

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

计划要求：
- 明确整篇论文的中心论点和论证路线
- 说明每一章承担的功能、核心论点、承接关系
- 标记哪些概念需要前后一致
- 给出引用资料的大致分配策略
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

【避免重复】
...`,
    },
    {
      role: 'user',
      content: '请生成全文写作计划。',
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

写作规则：
- 严格按照本章大纲结构展开，每个子节都要覆盖
- 子节标题用加粗格式输出：**X.X 标题名称**
- 本章需要服务于全文写作计划，不要像孤立文章一样重新开题
- 与前文已有内容保持承接，避免重复解释同一概念
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
