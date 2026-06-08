import {
  chatStore,
  libraryStore,
  projectStore,
  referenceStore,
  sectionStore,
  type WorkflowStage,
} from './storage'

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

export function buildAIContext({
  projectId,
  stage,
  userInput,
  currentSectionId,
}: BuildAIContextOptions): string {
  const project = projectStore.ensure(projectId)
  const selection = referenceStore.get(projectId, stage)
  const sections = sectionStore.getByProject(projectId)
  const libraryIds = Array.from(new Set([
    ...project.libraryItemIds,
    ...selection.libraryItemIds,
  ]))
  const libraryItems = libraryIds
    .map(id => libraryStore.get(id))
    .filter(item => item !== null)
  const styleItems = libraryItems.filter(item => item.type === 'style')
  const caseItems = libraryItems.filter(item => item.type === 'case')
  const refItems = libraryItems.filter(item => item.type !== 'style' && item.type !== 'case')
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
