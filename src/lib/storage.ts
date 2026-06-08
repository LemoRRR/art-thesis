// localStorage 持久化封装
// Demo 阶段所有数据存本地，完整版替换为 API 调用即可

const KEYS = {
  CHAT:          'pai_chat_history',
  SECTIONS:      'pai_doc_sections',
  VERSIONS:      'pai_version_history',
  COMPREHENSION: 'pai_comprehension',
  STYLE:         'pai_style_profile',
  DOC_TITLE:     'pai_doc_title',
  LIBRARY:       'pai_library_items',
  PROJECTS:      'pai_projects',
  ACTIVE_PROJECT:'pai_active_project',
  REFERENCES:    'pai_reference_selections',
  OUTLINE:       'pai_outline',
  REVISIONS:     'pai_revision_changes',
} as const

// ── 通用读写 ──────────────────────────────────────────────────
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('[Storage] 写入失败', key, e)
  }
}

// ── 类型定义 ──────────────────────────────────────────────────
export interface ChatMessage {
  id: string
  role: 'ai' | 'user'
  content: string
  timestamp: number
  projectId?: string
  stage?: WorkflowStage
  flow?: 'outline' | 'draft'
}

export type SectionStatus = 'pending' | 'generating' | 'done'
export type WorkflowStage = 'stage1' | 'stage2' | 'stage3'
export type LibraryItemType = 'pdf' | 'docx' | 'doc' | 'txt' | 'note' | 'style' | 'case' | 'other'
export type IndexStatus = 'pending' | 'ready' | 'failed'

export interface DocSection {
  id: string
  projectId?: string
  title: string
  content: string
  status: SectionStatus
  lastModified: number
  order?: number
  sourceRefs?: string[]
}

export interface VersionSnapshot {
  id: string
  projectId?: string
  timestamp: number
  description: string
  sections: DocSection[]
}

export interface OutlineSection {
  id: string
  level: 1 | 2 | 3
  title: string
  order: string
  children?: OutlineSection[]
}

export interface Outline {
  projectId: string
  sections: OutlineSection[]
  confirmedAt?: number
  updatedAt: number
}

export interface RevisionChange {
  id: string
  projectId: string
  sectionId: string
  type: 'rewrite' | 'shorten' | 'expand' | 'academic' | 'custom'
  beforeText: string
  afterText: string
  instruction: string
  createdAt: number
  acceptedAt?: number
}

export interface ComprehensionModel {
  researchObject: string
  writingBoundary: string
  academicLevel: string
  rawSummary: string   // 给 Prompt 用的自然语言描述
}

export interface LibraryItem {
  id: string
  title: string
  type: LibraryItemType
  fileName?: string
  fileSize?: number
  text: string
  summary: string
  tags: string[]
  createdAt: number
  updatedAt: number
  indexStatus: IndexStatus
}

export interface ProjectContext {
  researchObject: string
  writingBoundary: string
  academicLevel: string
  writingRequirements: string[]
  bannedPhrases: string[]
  stylePreference: string
  rawSummary: string
}

export interface Project {
  id: string
  title: string
  description: string
  currentStage: WorkflowStage
  libraryItemIds: string[]
  context: ProjectContext
  createdAt: number
  updatedAt: number
}

export interface ProjectThread {
  projectId: string
  stage: WorkflowStage
  messages: ChatMessage[]
}

export interface ReferenceSelection {
  id: string
  projectId: string
  stage: WorkflowStage
  libraryItemIds: string[]
  sectionIds: string[]
  includeProjectContext: boolean
  includeConversationSummary: boolean
  updatedAt: number
}

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`

export function createEmptyProjectContext(): ProjectContext {
  return {
    researchObject: '',
    writingBoundary: '',
    academicLevel: '本科',
    writingRequirements: [],
    bannedPhrases: ['不仅', '这一', '不再', '这种'],
    stylePreference: '',
    rawSummary: '',
  }
}

export function createDefaultProject(): Project {
  const now = Date.now()
  return {
    id: 'default-project',
    title: docTitleStore.get(),
    description: '默认论文项目，用于承载当前 Demo 的完整工作流。',
    currentStage: 'stage1',
    libraryItemIds: [],
    context: createEmptyProjectContext(),
    createdAt: now,
    updatedAt: now,
  }
}

// ── 对话记录 ──────────────────────────────────────────────────
export const chatStore = {
  getAll: (): ChatMessage[] => read<ChatMessage[]>(KEYS.CHAT) ?? [],
  save:   (msgs: ChatMessage[]) => write(KEYS.CHAT, msgs),
  getByProject: (projectId: string, stage?: WorkflowStage): ChatMessage[] => {
    return chatStore.getAll().filter(msg =>
      msg.projectId === projectId && (!stage || msg.stage === stage)
    )
  },
  saveForProject: (projectId: string, stage: WorkflowStage, msgs: ChatMessage[]) => {
    const other = chatStore.getAll().filter(msg =>
      msg.projectId !== projectId || msg.stage !== stage
    )
    chatStore.save([...other, ...msgs.map(msg => ({ ...msg, projectId, stage }))])
  },
  append: (msg: ChatMessage) => {
    const msgs = chatStore.getAll()
    chatStore.save([...msgs, msg])
  },
  clear: () => localStorage.removeItem(KEYS.CHAT),
}

// ── 文档章节 ──────────────────────────────────────────────────
export const sectionStore = {
  getAll: (): DocSection[] => read<DocSection[]>(KEYS.SECTIONS) ?? [],
  getByProject: (projectId: string): DocSection[] => {
    const sections = sectionStore.getAll()
    return sections.filter(section => section.projectId === projectId)
  },
  save:   (sections: DocSection[]) => write(KEYS.SECTIONS, sections),
  saveForProject: (projectId: string, sections: DocSection[]) => {
    const other = sectionStore.getAll().filter(section => section.projectId !== projectId && section.projectId)
    const scoped = sections.map((section, index) => ({ ...section, projectId, order: section.order ?? index }))
    sectionStore.save([...other, ...scoped])
  },
  update: (id: string, patch: Partial<DocSection>) => {
    const sections = sectionStore.getAll()
    const idx = sections.findIndex(s => s.id === id)
    if (idx !== -1) {
      sections[idx] = { ...sections[idx], ...patch, lastModified: Date.now() }
      sectionStore.save(sections)
    }
  },
  add: (section: Omit<DocSection, 'lastModified'>) => {
    const sections = sectionStore.getAll()
    sectionStore.save([...sections, { ...section, lastModified: Date.now() }])
  },
  clear: () => localStorage.removeItem(KEYS.SECTIONS),
}

// ── 大纲 ──────────────────────────────────────────────────────
export const outlineStore = {
  getAll: (): Outline[] => read<Outline[]>(KEYS.OUTLINE) ?? [],
  get: (projectId: string): Outline | null => {
    return outlineStore.getAll().find(outline => outline.projectId === projectId) ?? null
  },
  save: (outline: Outline) => {
    const all = outlineStore.getAll()
    const idx = all.findIndex(item => item.projectId === outline.projectId)
    const next = { ...outline, updatedAt: Date.now() }
    if (idx === -1) {
      write(KEYS.OUTLINE, [next, ...all])
    } else {
      all[idx] = next
      write(KEYS.OUTLINE, all)
    }
  },
  confirm: (projectId: string) => {
    const outline = outlineStore.get(projectId)
    if (!outline) return
    outlineStore.save({ ...outline, confirmedAt: Date.now() })
  },
  clear: (projectId: string) => {
    write(KEYS.OUTLINE, outlineStore.getAll().filter(outline => outline.projectId !== projectId))
  },
}

// ── 修订记录 ──────────────────────────────────────────────────
export const revisionStore = {
  getAll: (): RevisionChange[] => read<RevisionChange[]>(KEYS.REVISIONS) ?? [],
  getByProject: (projectId: string): RevisionChange[] => {
    return revisionStore.getAll().filter(change => change.projectId === projectId)
  },
  add: (change: Omit<RevisionChange, 'id' | 'createdAt'>) => {
    const next: RevisionChange = {
      ...change,
      id: uid('revision'),
      createdAt: Date.now(),
    }
    write(KEYS.REVISIONS, [next, ...revisionStore.getAll()].slice(0, 100))
    return next
  },
  accept: (id: string) => {
    write(KEYS.REVISIONS, revisionStore.getAll().map(change =>
      change.id === id ? { ...change, acceptedAt: Date.now() } : change
    ))
  },
  clearProject: (projectId: string) => {
    write(KEYS.REVISIONS, revisionStore.getAll().filter(change => change.projectId !== projectId))
  },
}

// ── 版本历史 ──────────────────────────────────────────────────
export const versionStore = {
  getAll: (): VersionSnapshot[] => read<VersionSnapshot[]>(KEYS.VERSIONS) ?? [],
  getByProject: (projectId: string): VersionSnapshot[] => {
    return versionStore.getAll().filter(snapshot => snapshot.projectId === projectId || !snapshot.projectId)
  },
  snapshot: (description: string, projectId?: string) => {
    const all = versionStore.getAll()
    const snap: VersionSnapshot = {
      id:          Date.now().toString(),
      projectId,
      timestamp:   Date.now(),
      description,
      sections:    projectId ? sectionStore.getByProject(projectId) : sectionStore.getAll(),
    }
    // 最多保留 30 条
    write(KEYS.VERSIONS, [snap, ...all].slice(0, 30))
  },
  restore: (snapshot: VersionSnapshot, projectId?: string) => {
    if (projectId) {
      // 只恢复当前项目的章节，其他项目不受影响
      const other = sectionStore.getAll().filter(
        section => section.projectId !== projectId && section.projectId
      )
      const restored = snapshot.sections.map(section => ({ ...section, projectId }))
      sectionStore.save([...other, ...restored])
      return
    }

    sectionStore.save(snapshot.sections)
  },
  clear: () => localStorage.removeItem(KEYS.VERSIONS),
}

// ── 理解模型 ──────────────────────────────────────────────────
export const comprehensionStore = {
  get:   () => read<ComprehensionModel>(KEYS.COMPREHENSION),
  save:  (model: ComprehensionModel) => write(KEYS.COMPREHENSION, model),
  clear: () => localStorage.removeItem(KEYS.COMPREHENSION),
}

// ── 语言风格 ──────────────────────────────────────────────────
export const styleStore = {
  get:   () => read<string>(KEYS.STYLE),
  save:  (summary: string) => write(KEYS.STYLE, summary),
  clear: () => localStorage.removeItem(KEYS.STYLE),
}

// ── 文档标题 ──────────────────────────────────────────────────
export const docTitleStore = {
  get:   () => read<string>(KEYS.DOC_TITLE) ?? '未命名论文',
  save:  (title: string) => write(KEYS.DOC_TITLE, title),
}

// ── 资料库 ────────────────────────────────────────────────────
export const libraryStore = {
  getAll: (): LibraryItem[] => read<LibraryItem[]>(KEYS.LIBRARY) ?? [],
  save: (items: LibraryItem[]) => write(KEYS.LIBRARY, items),
  get: (id: string) => libraryStore.getAll().find(item => item.id === id) ?? null,
  add: (item: Omit<LibraryItem, 'id' | 'createdAt' | 'updatedAt' | 'indexStatus'>) => {
    const now = Date.now()
    const next: LibraryItem = {
      ...item,
      id: uid('lib'),
      createdAt: now,
      updatedAt: now,
      indexStatus: 'ready',
    }
    libraryStore.save([next, ...libraryStore.getAll()])
    return next
  },
  update: (id: string, patch: Partial<LibraryItem>) => {
    libraryStore.save(libraryStore.getAll().map(item =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
    ))
  },
  remove: (id: string) => {
    libraryStore.save(libraryStore.getAll().filter(item => item.id !== id))
    projectStore.save(projectStore.getAll().map(project => ({
      ...project,
      libraryItemIds: project.libraryItemIds.filter(itemId => itemId !== id),
    })))
  },
  clear: () => localStorage.removeItem(KEYS.LIBRARY),
}

// ── 项目 ──────────────────────────────────────────────────────
export const projectStore = {
  getAll: (): Project[] => {
    const projects = read<Project[]>(KEYS.PROJECTS) ?? []
    if (projects.length > 0) return projects
    const fallback = createDefaultProject()
    write(KEYS.PROJECTS, [fallback])
    return [fallback]
  },
  save: (projects: Project[]) => write(KEYS.PROJECTS, projects),
  get: (id: string): Project | null => projectStore.getAll().find(project => project.id === id) ?? null,
  getActiveId: (): string => read<string>(KEYS.ACTIVE_PROJECT) ?? projectStore.getAll()[0].id,
  setActiveId: (id: string) => write(KEYS.ACTIVE_PROJECT, id),
  ensure: (id?: string): Project => {
    const projects = projectStore.getAll()
    const target = id ? projects.find(project => project.id === id) : projects[0]
    if (target) {
      projectStore.setActiveId(target.id)
      return target
    }
    const fallback = createDefaultProject()
    projectStore.save([fallback, ...projects])
    projectStore.setActiveId(fallback.id)
    return fallback
  },
  add: (title: string, description = '') => {
    const now = Date.now()
    const next: Project = {
      id: uid('project'),
      title,
      description,
      currentStage: 'stage1',
      libraryItemIds: [],
      context: createEmptyProjectContext(),
      createdAt: now,
      updatedAt: now,
    }
    projectStore.save([next, ...projectStore.getAll()])
    projectStore.setActiveId(next.id)
    return next
  },
  update: (id: string, patch: Partial<Project>) => {
    projectStore.save(projectStore.getAll().map(project =>
      project.id === id ? { ...project, ...patch, updatedAt: Date.now() } : project
    ))
  },
  bindLibraryItem: (projectId: string, itemId: string) => {
    const project = projectStore.get(projectId)
    if (!project || project.libraryItemIds.includes(itemId)) return
    projectStore.update(projectId, { libraryItemIds: [...project.libraryItemIds, itemId] })
  },
  unbindLibraryItem: (projectId: string, itemId: string) => {
    const project = projectStore.get(projectId)
    if (!project) return
    projectStore.update(projectId, {
      libraryItemIds: project.libraryItemIds.filter(id => id !== itemId),
    })
  },
}

// ── 引用选择 ──────────────────────────────────────────────────
export const referenceStore = {
  getAll: (): ReferenceSelection[] => read<ReferenceSelection[]>(KEYS.REFERENCES) ?? [],
  get: (projectId: string, stage: WorkflowStage): ReferenceSelection => {
    const existing = referenceStore.getAll().find(ref => ref.projectId === projectId && ref.stage === stage)
    if (existing) return existing
    return {
      id: uid('ref'),
      projectId,
      stage,
      libraryItemIds: [],
      sectionIds: [],
      includeProjectContext: true,
      includeConversationSummary: stage === 'stage2',
      updatedAt: Date.now(),
    }
  },
  save: (selection: ReferenceSelection) => {
    const all = referenceStore.getAll()
    const idx = all.findIndex(ref => ref.projectId === selection.projectId && ref.stage === selection.stage)
    const next = { ...selection, updatedAt: Date.now() }
    if (idx === -1) {
      write(KEYS.REFERENCES, [next, ...all])
    } else {
      all[idx] = next
      write(KEYS.REFERENCES, all)
    }
  },
}

// ── 清除所有数据（重新开始）──────────────────────────────────
export function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
}
