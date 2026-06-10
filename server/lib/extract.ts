import { callAIOnce, type Message } from './ai'
import { createUserClient, supabase } from './supabase'

function buildExtractPrompt(text: string): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个艺术类、电影类、人文社科类论文资料库分析助手。

用户上传的资料可能是期刊论文、学位论文、格式模板、背景材料、案例材料、课堂笔记或普通文本。
你的任务不是做普通摘要，而是把资料沉淀成后续 AI 写作可以复用的“写法范式”和“调用规则”。

如果资料是期刊论文、学位论文或优秀论文，请优先分析这些内容：
1. 文章如何提出问题、限定时间窗口、重设历史分期或界定研究对象。
2. 摘要如何压缩核心判断、研究对象、材料范围和结论。
3. 正文结构如何组织，例如“前期成功 -> 后期困境 -> 当时回应 -> 后视评价”。
4. 一级标题和二级标题如何命名，是否使用时间段、判断性短语、隐喻、问题意识或概念对照。
5. 段落如何推进：判断句、史料或案例、解释、转折、小结之间如何排列。
6. 作者如何使用设问、转折、让步、总分总结构、“三点式”归纳和阶段性判断。
7. 使用了哪些材料类型：影片、年代、导演、报刊、访谈、会议、年鉴、地方志、期刊文献等。
8. 注释和参考文献习惯：脚注密度、来源类型、引用位置、哪些判断需要出处支撑。
9. 哪些内容可以作为观点引用，哪些只能学习结构和语言习惯，不能照搬。

如果资料不是论文，也要从“可复用写作规则”的角度提取，不要只做资料摘要。

请严格输出 JSON，不要输出 Markdown，不要输出任何解释文字：
{
  "rules": {
    "content_claims": "可被引用或转述的核心观点、事实判断、研究对象与材料范围。",
    "structure_pattern": "可复用的文章结构范式，说明每个部分承担的功能。",
    "argument_path": "论证路径，说明文章如何从问题推进到结论。",
    "writing_rules": "后续生成论文时可以直接调用的写作规则。"
  },
  "profile": {
    "material_type": "这份资料属于什么类型，适合作为什么素材使用。",
    "writing_style": "语言风格、学术语气、判断方式。",
    "paragraph_habits": "段落长度、句式节奏、开头与收束习惯。"
  },
  "usage": {
    "best_stages": "适合在哪些写作阶段调用，例如选题、提纲、正文、脚注、文献综述。",
    "imitation_method": "可模仿什么，不可模仿什么。",
    "generation_constraints": "生成正文时必须遵守的限制，尤其是引用和避免照搬。"
  },
  "details": {
    "material_pattern": "材料组织范式。",
    "citation_pattern": "脚注、参考文献或来源使用范式。",
    "citable_content": "可以进入正文观点或注释的内容。",
    "risk_notes": "抄袭、误引、风格误用或资料不足的风险提醒。"
  }
}

注意：
- “写法范式”优先于普通摘要，必须能指导下一次写作。
- 不要复述整篇文章，不要长篇摘抄原文。
- 不要输出“暂无”“无法判断”这类空字段；资料不足时也要给出谨慎判断。
- 可模仿的是结构、论证节奏、材料组织和语言习惯，不是原文句子。
- 如果提到可引用内容，必须提醒需要保留原文出处或使用该文作为来源。
- 总字数控制在 900-1300 字。`,
    },
    {
      role: 'user',
      content: `请分析以下上传资料，提取可复用写法范式：\n\n${text.slice(0, 18_000)}`,
    },
  ]
}

function cleanJSON(content: string): string {
  const withoutFence = content.replace(/```json|```/g, '').trim()
  const match = withoutFence.match(/\{[\s\S]*\}/)
  return match ? match[0] : withoutFence
}

function stringifyExtract(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyExtract(item))
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => {
        const text = stringifyExtract(entry)
        return text ? `【${key}】${text}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

export async function extractDimensions(itemId: string, textContent: string, accessToken?: string): Promise<void> {
  const db = accessToken ? createUserClient(accessToken) : supabase
  try {
    const raw = await callAIOnce(buildExtractPrompt(textContent), 'gpt')
    const parsed = JSON.parse(cleanJSON(raw))

    const { error } = await db
      .from('library_items')
      .update({
        structure_extract: stringifyExtract(parsed.rules),
        style_extract: stringifyExtract(parsed.profile),
        viewpoints_extract: stringifyExtract(parsed.usage),
        cases_extract: stringifyExtract(parsed.details),
        extract_status: 'done',
      })
      .eq('id', itemId)

    if (error) throw error
    console.log('[Extract] 完成', itemId)
  } catch (error) {
    await db
      .from('library_items')
      .update({ extract_status: 'failed' })
      .eq('id', itemId)
    console.error('[Extract] 提取失败', itemId, error)
    throw error
  }
}
