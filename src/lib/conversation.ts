import { chatStore, projectStore, type ChatMessage } from './storage'

export function createWelcomeMessage(projectId: string): ChatMessage {
  return {
    id: `welcome-${projectId}`,
    role: 'ai',
    content:
      '你好，我是你的论文写作助手。\n\n先把论文背景告诉我——可以直接粘贴题目、大纲或研究框架，也可以点击左边的上传已有的论文原文（PDF 或 Word）。\n\n我不会学你的语言风格，只是理解研究方向和写作边界，为后续每一节的生成做准备。',
    timestamp: Date.now(),
    projectId,
    stage: 'stage1',
  }
}

export function createNewConversationProject() {
  projectStore.pruneEmptyDrafts()
  const project = projectStore.add('未命名论文对话', '从一次材料理解对话开始的新项目')
  projectStore.resetWorkspace(project.id)
  chatStore.saveForProject(project.id, 'stage1', [createWelcomeMessage(project.id)])
  projectStore.setActiveId(project.id)
  return project
}
