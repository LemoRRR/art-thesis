import {
  chatStore,
  libraryStore,
  projectStore,
  referenceStore,
  sectionStore,
  type WorkflowStage,
} from './storage'
import type { MentionRef } from '../components/MentionInput'

interface BuildAIContextOptions {
  projectId: string
  stage: WorkflowStage
  userInput?: string
  currentSectionId?: string | null
}

const findClipBoundary = (text: string, max: number) => {
  const boundaryPatterns = [
    /\n\n/g,
    /[。！？!?]\s*/g,
    /[；;]\s*/g,
    /[，,]\s*/g,
    /\s+/g,
  ]
  const minUsefulLength = Math.floor(max * 0.55)

  for (const pattern of boundaryPatterns) {
    const matches = [...text.slice(0, max).matchAll(pattern)]
    const last = matches
      .map(match => (match.index ?? 0) + match[0].length)
      .filter(index => index >= minUsefulLength)
      .at(-1)

    if (last) return last
  }

  return max
}

const clip = (text: string, max = 1200) => {
  const clean = text.trim()
  if (clean.length <= max) return clean

  const boundary = findClipBoundary(clean, max)
  return `${clean.slice(0, boundary).trim()}\n……（已按上下文长度截断）`
}

function getMentionContent(itemId: string) {
  const item = libraryStore.get(itemId)
  if (!item) return ''
  const parts = [
    item.type === 'background' ? '资料定位：背景语境资料，用于建立研究对象、时代背景和概念关系；除非另有正式出处，不应直接作为论文脚注引用。' : '',
    item.structureExtract ? `写法范式：\n${item.structureExtract}` : '',
    item.styleExtract ? `风格识别：\n${item.styleExtract}` : '',
    item.viewpointsExtract ? `调用方式：\n${item.viewpointsExtract}` : '',
    item.casesExtract ? `材料与引用：\n${item.casesExtract}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n') : item.summary || item.text
}

export function buildMentionContext(mentions: MentionRef[]): string {
  if (mentions.length === 0) return ''
  const parts = mentions
    .map((mention, index) => {
      const content = getMentionContent(mention.itemId)
      if (!content.trim()) return ''
      return `${index + 1}. @${mention.title}\n${clip(content, 1400)}`
    })
    .filter(Boolean)

  return parts.length > 0 ? `【用户 @ 调用的资料写法范式】\n${parts.join('\n\n')}` : ''
}

export function buildAIContext({
  projectId,
  stage,
  userInput,
  currentSectionId,
}: BuildAIContextOptions): string {
  const project = projectStore.ensure(projectId)
  const selection = referenceStore.get(projectId, stage)
  const sections = sectionStore.getByProject(projectId)
  // Library 是全局资料库，默认不自动进入项目上下文；只有用户在引用面板或 @ 输入中显式调用时才进入 prompt。
  const libraryIds = Array.from(new Set(selection.libraryItemIds))
  const libraryItems = libraryIds
    .map(id => libraryStore.get(id))
    .filter(item => item !== null)
  const styleItems = libraryItems.filter(item => item.type === 'style')
  const caseItems = libraryItems.filter(item => item.type === 'case')
  const backgroundItems = libraryItems.filter(item => item.type === 'background')
  const refItems = libraryItems.filter(item => item.type !== 'style' && item.type !== 'case' && item.type !== 'background')
  const selectedSections = sections.filter(section =>
    selection.sectionIds.includes(section.id) || section.id === currentSectionId
  )
  const parts: string[] = []

  parts.push(`【当前项目】\n项目名称：${project.title}\n项目说明：${project.description || '未填写'}`)

  // 项目理解摘要是最核心的背景，始终带上，避免长对话截断后丢失研究对象和写作边界。
  if (project.context.rawSummary) {
    parts.push(`【项目理解摘要】\n${project.context.rawSummary}`)
  }

  if (selection.includeProjectContext) {
    if (project.context.writingRequirements.length > 0) {
      parts.push(`【写作要求】\n${project.context.writingRequirements.map(item => `- ${item}`).join('\n')}`)
    }

    if (project.context.bannedPhrases.length > 0) {
      parts.push(`【避免表达】\n${project.context.bannedPhrases.join('、')}`)
    }
  }

  if (refItems.length > 0) {
    parts.push(`【引用的库资料】\n${refItems.map((item, index) =>
      `${index + 1}. ${item.title}\n类型：${item.type}\n摘要：${item.summary || '无'}\n内容摘录：${clip(item.text)}`
    ).join('\n\n')}`)
  }

  if (backgroundItems.length > 0) {
    parts.push(`【背景语境资料】\n这些资料用于帮助理解历史背景、人物关系、概念脉络和可写论点；除非资料中已给出可核验出处，不要把它们直接作为论文脚注或正式参考文献。\n\n${backgroundItems.map((item, index) =>
      `${index + 1}. ${item.title}\n摘要：${item.summary || '无'}\n整理内容：${clip(getMentionContent(item.id), 1800)}`
    ).join('\n\n')}`)
  }

  if (styleItems.length > 0) {
    parts.push(`【写作风格参考】\n请模仿以下风格特征进行写作，不要模仿具体内容和观点：\n\n${styleItems.map(item =>
      `${item.title}：\n${item.text}`
    ).join('\n\n')}`)
  }

  if (caseItems.length > 0) {
    parts.push(`【可用案例参考】\n以下案例可在写作中适当引用，用于支撑论述：\n\n${caseItems.map(item =>
      `${item.title}：\n${item.text}`
    ).join('\n\n')}`)
  }

  if (selectedSections.length > 0) {
    parts.push(`【引用的项目内容】\n${selectedSections.map((section, index) =>
      `${index + 1}. ${section.title}\n${clip(section.content, 1000)}`
    ).join('\n\n')}`)
  }

  if (selection.includeConversationSummary) {
    const recentMessages = chatStore.getByProject(projectId, stage).slice(-8)
    if (recentMessages.length > 0) {
      parts.push(`【最近对话记录】\n${recentMessages.map(message =>
        `${message.role === 'ai' ? 'AI' : '用户'}：${clip(message.content, 300)}`
      ).join('\n')}`)
    }
  }

  if (userInput?.trim()) {
    parts.push(`【用户本次输入】\n${userInput.trim()}`)
  }

  return parts.join('\n\n---\n\n')
}
