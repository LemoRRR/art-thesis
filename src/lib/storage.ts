// localStorage 持久化封装
// Demo 阶段所有数据存本地，完整版替换为 API 调用即可
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  chatAPI,
  libraryAPI,
  outlinesAPI,
  projectsAPI,
  referencesAPI,
  sectionsAPI,
  styleProfilesAPI,
  versionsAPI,
} from './api'
import { auth } from './auth'
import type { PaperEditorDoc } from './editorDocument'

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
  STYLE_PROFILES:'pai_style_profiles',
  RESEARCH_TASKS:'pai_research_tasks',
  RESEARCH_ASSETS:'pai_research_assets',
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
export type LibraryItemType = 'pdf' | 'docx' | 'doc' | 'txt' | 'note' | 'background' | 'style' | 'case' | 'other'
export type IndexStatus = 'pending' | 'ready' | 'failed'
export type ExtractStatus = 'pending' | 'processing' | 'done' | 'failed'
export type ResearchMethodType = 'theoretical' | 'case_study' | 'quantitative' | 'qualitative' | 'mixed' | 'design_evaluation'
export type ResearchToolKey =
  | 'scale_generation'
  | 'hypothesis_model'
  | 'survey_analysis'
  | 'mediation'
  | 'kano'
  | 'ahp'
  | 'grounded_coding'
  | 'emotion_coding'
  | 'theme_extraction'
  | 'case_summary'
export type ResearchTaskStatus =
  | 'route_planned'
  | 'scale_drafting'
  | 'scale_confirmed'
  | 'survey_ready'
  | 'collecting_data'
  | 'data_uploaded'
  | 'data_validated'
  | 'analysis_done'
  | 'chapter_text_ready'
  | 'inserted_into_paper'
export type ResearchAssetType =
  | 'research_design'
  | 'scale_schema'
  | 'survey_questionnaire'
  | 'questionnaire_review'
  | 'hypothesis_model'
  | 'quant_dataset'
  | 'quant_analysis_result'
  | 'kano_result'
  | 'ahp_result'
  | 'qualitative_coding'
  | 'chapter_text'

export interface SectionFootnote {
  id: string
  number: number
  blockIndex: number
  start: number
  end: number
  anchorText: string
  noteText: string
}

export interface DocSection {
  id: string
  projectId?: string
  outlineNodeId?: string
  outlineOrder?: string
  outlineChildrenSignature?: string
  generationPlan?: string
  generatedSummary?: string
  archivedAt?: number
  title: string
  content: string
  editorDoc?: PaperEditorDoc
  status: SectionStatus
  lastModified: number
  order?: number
  sourceRefs?: string[]
  footnotes?: SectionFootnote[]
}

export interface VersionSnapshot {
  id: string
  projectId?: string
  timestamp: number
  description: string
  sections: DocSection[]
  outline?: Outline
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
  pathType?: 'existing_paper_revision' | 'from_scratch_generation'
  inputType?: 'paper' | 'outline' | 'topic' | 'mixed_material'
  hasDetectedOutline?: boolean
  hasDetectedDraft?: boolean
  academicLevelSuggestion?: string
  academicLevelReason?: string
  coreArguments?: string[]
  outlineSummary?: string
  draftSummary?: string
  nextStepRecommendation?: 'generate_outline' | 'confirm_detected_outline' | 'revise_existing_draft' | 'write_from_outline'
  researchPlan?: ResearchPlan
}

export interface ResearchPlan {
  methodType: ResearchMethodType
  methodLabel: string
  methodReason: string
  suggestedTools: ResearchToolKey[]
  variables?: {
    independent?: string[]
    dependent?: string[]
    mediator?: string[]
    moderator?: string[]
    control?: string[]
  }
  dataNeeds: string[]
  outlineRequirements: string[]
  pendingResearchTasks: string[]
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
  structureExtract?: string
  styleExtract?: string
  viewpointsExtract?: string
  casesExtract?: string
  extractStatus?: ExtractStatus
  fileUrl?: string
  createdAt: number
  updatedAt: number
  indexStatus: IndexStatus
}

export interface ProjectContext {
  researchObject: string
  writingBoundary: string
  academicLevel: string
  pathType?: 'existing_paper_revision' | 'from_scratch_generation'
  inputType?: 'paper' | 'outline' | 'topic' | 'mixed_material'
  hasDetectedOutline?: boolean
  hasDetectedDraft?: boolean
  academicLevelSuggestion?: string
  academicLevelReason?: string
  coreArguments?: string[]
  outlineSummary?: string
  draftSummary?: string
  nextStepRecommendation?: 'generate_outline' | 'confirm_detected_outline' | 'revise_existing_draft' | 'write_from_outline'
  writingRequirements: string[]
  bannedPhrases: string[]
  stylePreference: string
  rawSummary: string
  researchPlan?: ResearchPlan
}

export interface ScaleItem {
  id: string
  code: string
  text: string
  reverseScored: boolean
  required: boolean
  disabled?: boolean
}

export interface ScaleDimension {
  id: string
  name: string
  definition: string
  items: ScaleItem[]
}

export interface ScaleVariable {
  id: string
  name: string
  role: 'independent' | 'dependent' | 'mediator' | 'moderator' | 'control'
  definition: string
  dimensions: ScaleDimension[]
}

export interface ScaleAssetData {
  title: string
  version: number
  basedOnVersionId?: string
  researchTopic: string
  scaleType: 'likert_5' | 'likert_7'
  variables: ScaleVariable[]
  scoringRules: string
  notes: string
}

export interface ResearchAsset {
  id: string
  projectId: string
  taskId?: string
  type: ResearchAssetType
  title: string
  summary: string
  source: 'generated_from_project' | 'created_in_stage3' | 'uploaded_by_user' | 'manual_input'
  structuredData: unknown
  plainText: string
  status: 'draft' | 'confirmed' | 'archived' | 'used_in_paper'
  linkedSectionIds?: string[]
  createdAt: number
  updatedAt: number
}

export interface ResearchTask {
  id: string
  projectId: string
  title: string
  methodType: ResearchMethodType
  status: ResearchTaskStatus
  currentScaleAssetId?: string
  datasetAssetId?: string
  analysisAssetId?: string
  chapterTextAssetId?: string
  nextActionLabel: string
  createdAt: number
  updatedAt: number
}

export interface StyleProfile {
  id: string
  userId?: string
  studentName: string
  profileName: string
  sourceFileName?: string
  sourceDocuments?: Array<{
    id: string
    fileName: string
    textLength: number
    extractedAt: number
  }>
  sourceTextLength: number
  writingLevel: string
  sentenceStyle: string
  paragraphLogic: string
  argumentStyle: string
  transitionStyle: string
  vocabularyStyle: string
  avoidContentReuseNotice: string
  editableSummary: string
  createdAt: number
  updatedAt: number
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
  autoCitationEnabled?: boolean
  autoSources?: CitationEvidenceSource[]
  evidencePack?: CitationEvidencePack
  lastAutoRunAt?: number
  updatedAt: number
}

export interface CitationEvidencePoint {
  claim: string
  sourceIds: string[]
  writingUse: string
}

export interface CitationChapterEvidence {
  chapterTitle: string
  sourceIds: string[]
  writingPlan: string
  keyPoints: CitationEvidencePoint[]
}

export interface CitationEvidencePack {
  theoryConcepts: CitationEvidencePoint[]
  literatureReview: CitationEvidencePoint[]
  methodSupport: CitationEvidencePoint[]
  caseEvidence: CitationEvidencePoint[]
  chapterEvidence: CitationChapterEvidence[]
  rejectedSourceIds: string[]
  cautions: string[]
  summary: string
}

export interface CitationEvidenceSource {
  id: string
  title: string
  authors: string[]
  year?: number
  source?: string
  doi?: string
  url?: string
  abstract?: string
  provider?: string
  citedByCount?: number
  relevanceReason?: string
}

interface DraftSnapshots {
  chats: ChatMessage[]
  sections: DocSection[]
  outlines: Outline[]
  versions: VersionSnapshot[]
  references: ReferenceSelection[]
}

const uid = (prefix?: string) => {
  void prefix
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

const STAGES: WorkflowStage[] = ['stage1', 'stage2', 'stage3']

function canUseRemote(): boolean {
  return auth.isLoggedIn()
}

function remoteTask(task: () => Promise<unknown>) {
  if (!canUseRemote()) return
  task().catch(error => {
    console.warn('[Storage] 远端同步失败，已保留本地数据', error)
  })
}

function toTime(value?: string | null): number {
  return value ? Date.parse(value) || Date.now() : Date.now()
}

function fromApiProject(row: any): Project {
  return {
    id: row.id,
    title: row.title ?? '未命名论文',
    description: row.description ?? '',
    currentStage: row.current_stage ?? 'stage1',
    libraryItemIds: row.library_item_ids ?? [],
    context: { ...createEmptyProjectContext(), ...(row.context ?? {}) },
    createdAt: toTime(row.created_at),
    updatedAt: toTime(row.updated_at),
  }
}

function toApiProject(project: Project) {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    current_stage: project.currentStage,
    library_item_ids: project.libraryItemIds,
    context: project.context,
  }
}

function toApiProjectPatch(patch: Partial<Project>) {
  return {
    title: patch.title,
    description: patch.description,
    current_stage: patch.currentStage,
    library_item_ids: patch.libraryItemIds,
    context: patch.context,
  }
}

function fromApiSection(row: any): DocSection {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title ?? '未命名章节',
    content: row.content ?? '',
    editorDoc: row.content_doc ?? undefined,
    status: row.status ?? 'pending',
    order: row.sort_order ?? 0,
    lastModified: toTime(row.updated_at ?? row.created_at),
  }
}

function toApiSection(section: DocSection) {
  return {
    id: section.id,
    project_id: section.projectId,
    title: section.title,
    content: section.content,
    content_doc: section.editorDoc,
    status: section.status,
    sort_order: section.order ?? 0,
  }
}

function fromApiOutline(row: any): Outline | null {
  if (!row) return null
  return {
    projectId: row.project_id,
    sections: row.sections ?? [],
    confirmedAt: row.confirmed_at ? toTime(row.confirmed_at) : undefined,
    updatedAt: toTime(row.updated_at ?? row.created_at),
  }
}

function toApiOutline(outline: Outline) {
  return {
    sections: outline.sections,
    confirmed_at: outline.confirmedAt ? new Date(outline.confirmedAt).toISOString() : undefined,
  }
}

function fromApiLibraryItem(row: any): LibraryItem {
  return {
    id: row.id,
    title: row.title ?? '未命名资料',
    type: row.type ?? 'note',
    fileName: row.file_name ?? undefined,
    fileSize: row.file_size ?? undefined,
    fileUrl: row.file_url ?? undefined,
    text: row.text_content ?? '',
    summary: row.summary ?? '',
    tags: row.tags ?? [],
    structureExtract: row.structure_extract ?? '',
    styleExtract: row.style_extract ?? '',
    viewpointsExtract: row.viewpoints_extract ?? '',
    casesExtract: row.cases_extract ?? '',
    extractStatus: row.extract_status ?? 'pending',
    indexStatus: row.index_status ?? 'ready',
    createdAt: toTime(row.created_at),
    updatedAt: toTime(row.updated_at),
  }
}

function toApiLibraryItem(item: LibraryItem) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    file_name: item.fileName,
    file_size: item.fileSize,
    file_url: item.fileUrl,
    text_content: item.text,
    summary: item.summary,
    tags: item.tags,
    structure_extract: item.structureExtract,
    style_extract: item.styleExtract,
    viewpoints_extract: item.viewpointsExtract,
    cases_extract: item.casesExtract,
    extract_status: item.extractStatus,
    index_status: item.indexStatus,
  }
}

function fromApiChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    role: row.role,
    content: row.content ?? '',
    timestamp: toTime(row.created_at),
  }
}

function toApiChatMessage(message: ChatMessage) {
  return {
    role: message.role,
    content: message.content,
  }
}

function fromApiVersion(row: any): VersionSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    timestamp: toTime(row.created_at),
    description: row.description ?? '',
    sections: row.sections_snapshot ?? [],
  }
}

function toApiReference(selection: ReferenceSelection) {
  return {
    library_item_ids: selection.libraryItemIds,
    section_ids: selection.sectionIds,
    include_project_context: selection.includeProjectContext,
    include_conversation_summary: selection.includeConversationSummary,
    auto_citation_enabled: selection.autoCitationEnabled ?? true,
    auto_sources: selection.autoSources ?? [],
    evidence_pack: selection.evidencePack ?? null,
    last_auto_run_at: selection.lastAutoRunAt ? new Date(selection.lastAutoRunAt).toISOString() : null,
  }
}

function fromApiReference(row: any): ReferenceSelection | null {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    libraryItemIds: row.library_item_ids ?? [],
    sectionIds: row.section_ids ?? [],
    includeProjectContext: row.include_project_context ?? true,
    includeConversationSummary: row.include_conversation_summary ?? false,
    autoCitationEnabled: row.auto_citation_enabled ?? true,
    autoSources: row.auto_sources ?? [],
    evidencePack: row.evidence_pack ?? undefined,
    lastAutoRunAt: row.last_auto_run_at ? toTime(row.last_auto_run_at) : undefined,
    updatedAt: toTime(row.updated_at),
  }
}

function mergeById<T extends { id: string }>(localItems: T[], remoteItems: T[]): T[] {
  const merged = new Map<string, T>()
  localItems.forEach(item => merged.set(item.id, item))
  remoteItems.forEach(item => merged.set(item.id, item))
  return Array.from(merged.values())
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ensureUuid(id?: string): string {
  return id && UUID_RE.test(id) ? id : uid('id')
}

function normalizeLocalIdsForRemote() {
  const projects = read<Project[]>(KEYS.PROJECTS) ?? [createDefaultProject()]
  const libraryItems = read<LibraryItem[]>(KEYS.LIBRARY) ?? []
  const sections = read<DocSection[]>(KEYS.SECTIONS) ?? []
  const outlines = read<Outline[]>(KEYS.OUTLINE) ?? []
  const chats = read<ChatMessage[]>(KEYS.CHAT) ?? []
  const versions = read<VersionSnapshot[]>(KEYS.VERSIONS) ?? []
  const refs = read<ReferenceSelection[]>(KEYS.REFERENCES) ?? []
  const styleProfiles = read<StyleProfile[]>(KEYS.STYLE_PROFILES) ?? []

  const projectIdMap = new Map(projects.map(project => [project.id, ensureUuid(project.id)]))
  const libraryIdMap = new Map(libraryItems.map(item => [item.id, ensureUuid(item.id)]))
  const sectionIdMap = new Map(sections.map(section => [section.id, ensureUuid(section.id)]))
  const styleProfileIdMap = new Map(styleProfiles.map(profile => [profile.id, ensureUuid(profile.id)]))

  const mapProjectId = (id?: string) => id ? projectIdMap.get(id) ?? id : id
  const mapLibraryId = (id: string) => libraryIdMap.get(id) ?? id
  const mapSectionId = (id: string) => sectionIdMap.get(id) ?? id

  const nextProjects = projects.map(project => ({
    ...project,
    id: mapProjectId(project.id)!,
    libraryItemIds: project.libraryItemIds.map(mapLibraryId),
  }))
  const nextLibrary = libraryItems.map(item => ({ ...item, id: mapLibraryId(item.id) }))
  const nextStyleProfiles = styleProfiles.map(profile => ({
    ...profile,
    id: styleProfileIdMap.get(profile.id) ?? profile.id,
  }))
  const nextSections = sections.map(section => ({
    ...section,
    id: mapSectionId(section.id),
    projectId: mapProjectId(section.projectId),
  }))
  const nextOutlines = outlines.map(outline => ({ ...outline, projectId: mapProjectId(outline.projectId)! }))
  const nextChats = chats.map(message => ({
    ...message,
    id: ensureUuid(message.id),
    projectId: mapProjectId(message.projectId),
  }))
  const nextVersions = versions.map(snapshot => ({
    ...snapshot,
    id: ensureUuid(snapshot.id),
    projectId: mapProjectId(snapshot.projectId),
    sections: snapshot.sections.map(section => ({
      ...section,
      id: mapSectionId(section.id),
      projectId: mapProjectId(section.projectId),
    })),
  }))
  const nextRefs = refs.map(ref => ({
    ...ref,
    id: ensureUuid(ref.id),
    projectId: mapProjectId(ref.projectId)!,
    libraryItemIds: ref.libraryItemIds.map(mapLibraryId),
    sectionIds: ref.sectionIds.map(mapSectionId),
  }))

  write(KEYS.PROJECTS, nextProjects)
  write(KEYS.LIBRARY, nextLibrary)
  write(KEYS.STYLE_PROFILES, nextStyleProfiles)
  write(KEYS.SECTIONS, nextSections)
  write(KEYS.OUTLINE, nextOutlines)
  write(KEYS.CHAT, nextChats)
  write(KEYS.VERSIONS, nextVersions)
  write(KEYS.REFERENCES, nextRefs)

  const activeId = read<string>(KEYS.ACTIVE_PROJECT)
  if (activeId && projectIdMap.has(activeId)) {
    write(KEYS.ACTIVE_PROJECT, projectIdMap.get(activeId))
  }

  return { projects: nextProjects, libraryItems: nextLibrary, styleProfiles: nextStyleProfiles, sections: nextSections, outlines: nextOutlines, chats: nextChats, versions: nextVersions, refs: nextRefs }
}

async function pushLocalDataToRemote() {
  const local = normalizeLocalIdsForRemote()

  for (const item of local.libraryItems) {
    await libraryAPI.create(toApiLibraryItem(item))
  }

  for (const profile of local.styleProfiles) {
    await styleProfilesAPI.create(toApiStyleProfile(profile))
  }

  for (const project of local.projects) {
    await projectsAPI.create(toApiProject(project))
    await sectionsAPI.saveAll(project.id, local.sections.filter(section => section.projectId === project.id).map(toApiSection))
    const outline = local.outlines.find(item => item.projectId === project.id)
    if (outline) await outlinesAPI.saveForProject(project.id, toApiOutline(outline))

    for (const stage of STAGES) {
      const messages = local.chats.filter(message => message.projectId === project.id && message.stage === stage)
      if (messages.length) await chatAPI.saveForProjectStage(project.id, stage, messages.map(toApiChatMessage))
      const ref = local.refs.find(item => item.projectId === project.id && item.stage === stage)
      if (ref) await referencesAPI.save(project.id, stage, toApiReference(ref))
    }

    for (const snapshot of local.versions.filter(item => item.projectId === project.id)) {
      await versionsAPI.create(project.id, {
        description: snapshot.description,
        sections_snapshot: snapshot.sections,
      })
    }
  }
}

export async function syncRemoteData(options: { projectIds?: string[] } = {}): Promise<void> {
  if (!canUseRemote()) return

  const localProjectsBeforeSync = read<Project[]>(KEYS.PROJECTS) ?? []
  const localStyleProfilesBeforeSync = read<StyleProfile[]>(KEYS.STYLE_PROFILES) ?? []
  const localSectionsBeforeSync = read<DocSection[]>(KEYS.SECTIONS) ?? []
  const localOutlinesBeforeSync = read<Outline[]>(KEYS.OUTLINE) ?? []
  const localChatsBeforeSync = read<ChatMessage[]>(KEYS.CHAT) ?? []
  const localVersionsBeforeSync = read<VersionSnapshot[]>(KEYS.VERSIONS) ?? []
  const localRefsBeforeSync = read<ReferenceSelection[]>(KEYS.REFERENCES) ?? []
  const remoteProjects = ((await projectsAPI.list()) as any[]).map(fromApiProject)
  if (remoteProjects.length === 0) {
    await pushLocalDataToRemote()
    return
  }

  const requestedProjectIds = new Set((options.projectIds ?? []).filter(Boolean))
  const activeId = read<string>(KEYS.ACTIVE_PROJECT)
  if (activeId) requestedProjectIds.add(activeId)
  if (requestedProjectIds.size === 0 && remoteProjects[0]) requestedProjectIds.add(remoteProjects[0].id)
  const projectsToHydrate = remoteProjects.filter(project => requestedProjectIds.has(project.id))

  const [remoteLibrary, remoteStyleProfiles, projectPayloads] = await Promise.all([
    libraryAPI.list().then(rows => (rows as any[]).map(fromApiLibraryItem)),
    styleProfilesAPI.list().then(rows => (rows as any[]).map(fromApiStyleProfile)),
    Promise.all(projectsToHydrate.map(async project => {
      const [sections, outline, versions, chatGroups, refs] = await Promise.all([
        sectionsAPI.listByProject(project.id).then(rows => (rows as any[]).map(fromApiSection)),
        outlinesAPI.getByProject(project.id).then(fromApiOutline),
        versionsAPI.listByProject(project.id).then(rows => (rows as any[]).map(fromApiVersion)),
        Promise.all(STAGES.map(stage =>
          chatAPI.listByProjectStage(project.id, stage).then(rows => (rows as any[]).map(fromApiChatMessage))
        )),
        Promise.all(STAGES.map(stage =>
          referencesAPI.get(project.id, stage).then(fromApiReference)
        )),
      ])

      return {
        projectId: project.id,
        remoteSectionCount: sections.length,
        sections: sections.length > 0
          ? sections
          : localSectionsBeforeSync.filter(section => section.projectId === project.id),
        outline,
        versions,
        chats: chatGroups.flat(),
        refs: refs.filter((item): item is ReferenceSelection => item !== null),
      }
    })),
  ])

  const mergedRemoteProjects = remoteProjects.map(remoteProject => {
    const localProject = localProjectsBeforeSync.find(project => project.id === remoteProject.id)
    return localProject
      ? {
          ...remoteProject,
          title: remoteProject.title || localProject.title,
          context: {
            ...remoteProject.context,
            rawSummary: remoteProject.context.rawSummary || localProject.context.rawSummary,
          },
        }
      : remoteProject
  })
  const mergedProjects = mergeById(localProjectsBeforeSync, mergedRemoteProjects)
  const mergedSections = projectPayloads.flatMap(item => item.sections)
  const mergedOutlines = projectPayloads
    .map(item => item.outline)
    .filter((item): item is Outline => item !== null)
  const protectedOutlines = remoteProjects.map(project => {
    const remoteOutline = mergedOutlines.find(outline => outline.projectId === project.id)
    const localOutline = localOutlinesBeforeSync.find(outline => outline.projectId === project.id)
    return remoteOutline ?? localOutline ?? null
  }).filter((item): item is Outline => item !== null)

  write(KEYS.PROJECTS, mergedProjects)
  write(KEYS.LIBRARY, remoteLibrary)
  write(KEYS.STYLE_PROFILES, mergeById(localStyleProfilesBeforeSync, remoteStyleProfiles))
  write(KEYS.SECTIONS, mergeById(localSectionsBeforeSync, mergedSections))
  write(KEYS.OUTLINE, protectedOutlines)
  write(KEYS.VERSIONS, mergeById(localVersionsBeforeSync, projectPayloads.flatMap(item => item.versions)))
  write(KEYS.CHAT, mergeById(localChatsBeforeSync, projectPayloads.flatMap(item => item.chats)))
  write(KEYS.REFERENCES, mergeById(localRefsBeforeSync, projectPayloads.flatMap(item => item.refs)))

  if (!activeId || !mergedProjects.some(project => project.id === activeId)) {
    write(KEYS.ACTIVE_PROJECT, mergedProjects[0].id)
  }

  for (const payload of projectPayloads) {
    const localFallbackSections = localSectionsBeforeSync.filter(section => section.projectId === payload.projectId)
    if (payload?.remoteSectionCount === 0 && localFallbackSections.length > 0) {
      sectionStore.saveForProject(payload.projectId, localFallbackSections)
    }
  }
}

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
    id: uid('project'),
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
    const scoped = msgs.map(msg => ({ ...msg, projectId, stage }))
    chatStore.save([...other, ...scoped])
    remoteTask(() => chatAPI.saveForProjectStage(projectId, stage, scoped.map(toApiChatMessage)))
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
  saveForProject: (projectId: string, sections: DocSection[], options: { syncRemote?: boolean } = {}) => {
    const { syncRemote = true } = options
    const other = sectionStore.getAll().filter(section => section.projectId !== projectId && section.projectId)
    const scoped = sections.map((section, index) => ({
      ...section,
      id: ensureUuid(section.id),
      projectId,
      order: section.order ?? index,
    }))
    sectionStore.save([...other, ...scoped])
    if (syncRemote) {
      remoteTask(() => sectionsAPI.saveAll(projectId, scoped.map(toApiSection)))
    }
  },
  syncProject: async (projectId: string): Promise<number> => {
    const sections = sectionStore.getByProject(projectId)
    const other = sectionStore.getAll().filter(section => section.projectId !== projectId && section.projectId)
    const scoped = sections.map((section, index) => ({
      ...section,
      id: ensureUuid(section.id),
      projectId,
      order: section.order ?? index,
    }))
    sectionStore.save([...other, ...scoped])
    await sectionsAPI.saveAll(projectId, scoped.map(toApiSection))
    return scoped.length
  },
  update: (id: string, patch: Partial<DocSection>) => {
    const sections = sectionStore.getAll()
    const idx = sections.findIndex(s => s.id === id)
    if (idx !== -1) {
      sections[idx] = { ...sections[idx], ...patch, lastModified: Date.now() }
      sectionStore.save(sections)
      const projectId = sections[idx].projectId
      if (projectId) {
        remoteTask(() => sectionsAPI.saveAll(projectId, sectionStore.getByProject(projectId).map(toApiSection)))
      }
    }
  },
  add: (section: Omit<DocSection, 'lastModified'>) => {
    const sections = sectionStore.getAll()
    const next = { ...section, lastModified: Date.now() }
    sectionStore.save([...sections, next])
    if (next.projectId) {
      remoteTask(() => sectionsAPI.saveAll(next.projectId!, sectionStore.getByProject(next.projectId!).map(toApiSection)))
    }
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
    remoteTask(() => outlinesAPI.saveForProject(next.projectId, toApiOutline(next)))
  },
  confirm: (projectId: string) => {
    const outline = outlineStore.get(projectId)
    if (!outline) return
    outlineStore.save({ ...outline, confirmedAt: Date.now() })
  },
  clear: (projectId: string) => {
    write(KEYS.OUTLINE, outlineStore.getAll().filter(outline => outline.projectId !== projectId))
    remoteTask(() => outlinesAPI.clear(projectId))
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
function renumberOutlineSnapshot(sections: OutlineSection[], parentOrder = ''): OutlineSection[] {
  return sections.map((section, index) => {
    const order = parentOrder ? `${parentOrder}.${index + 1}` : `${index + 1}`
    const level = Math.min(order.split('.').length, 3) as 1 | 2 | 3
    return {
      ...section,
      order,
      level,
      children: section.children?.length ? renumberOutlineSnapshot(section.children, order) : undefined,
    }
  })
}

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
    if (projectId) {
      remoteTask(() => versionsAPI.create(projectId, {
        description,
        sections_snapshot: snap.sections,
      }))
    }
  },
  snapshotOutline: (description: string, outline: Outline) => {
    const all = versionStore.getAll()
    const snap: VersionSnapshot = {
      id:          Date.now().toString(),
      projectId:   outline.projectId,
      timestamp:   Date.now(),
      description,
      sections:    [],
      outline:     { ...outline, sections: renumberOutlineSnapshot(outline.sections), updatedAt: Date.now() },
    }
    write(KEYS.VERSIONS, [snap, ...all].slice(0, 30))
  },
  restore: (snapshot: VersionSnapshot, projectId?: string) => {
    if (projectId && snapshot.outline) {
      outlineStore.save({ ...snapshot.outline, projectId, updatedAt: Date.now() })
      if (snapshot.sections.length === 0) return
    }

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

export const styleProfileStore = {
  getAll: (): StyleProfile[] => read<StyleProfile[]>(KEYS.STYLE_PROFILES) ?? [],
  save: (profiles: StyleProfile[]) => write(KEYS.STYLE_PROFILES, profiles),
  get: (id: string): StyleProfile | null => styleProfileStore.getAll().find(profile => profile.id === id) ?? null,
  add: (profile: Omit<StyleProfile, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const next: StyleProfile = {
      ...profile,
      id: uid('style_profile'),
      createdAt: now,
      updatedAt: now,
    }
    styleProfileStore.save([next, ...styleProfileStore.getAll()].slice(0, 50))
    remoteTask(() => styleProfilesAPI.create(toApiStyleProfile(next)))
    return next
  },
  update: (id: string, patch: Partial<StyleProfile>) => {
    const nextProfiles = styleProfileStore.getAll().map(profile =>
      profile.id === id ? { ...profile, ...patch, updatedAt: Date.now() } : profile
    )
    styleProfileStore.save(nextProfiles)
    const next = nextProfiles.find(profile => profile.id === id)
    if (next) remoteTask(() => styleProfilesAPI.update(id, toApiStyleProfile(next)))
  },
  remove: (id: string) => {
    styleProfileStore.save(styleProfileStore.getAll().filter(profile => profile.id !== id))
    remoteTask(() => styleProfilesAPI.delete(id))
  },
  clear: () => localStorage.removeItem(KEYS.STYLE_PROFILES),
}

// ── 研究计算中心 ──────────────────────────────────────────────
export const researchTaskStore = {
  getAll: (): ResearchTask[] => read<ResearchTask[]>(KEYS.RESEARCH_TASKS) ?? [],
  save: (tasks: ResearchTask[]) => write(KEYS.RESEARCH_TASKS, tasks),
  getByProject: (projectId: string): ResearchTask[] =>
    researchTaskStore.getAll()
      .filter(task => task.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  get: (id: string): ResearchTask | null =>
    researchTaskStore.getAll().find(task => task.id === id) ?? null,
  add: (task: Omit<ResearchTask, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const next: ResearchTask = {
      ...task,
      id: uid('research_task'),
      createdAt: now,
      updatedAt: now,
    }
    researchTaskStore.save([next, ...researchTaskStore.getAll()])
    return next
  },
  update: (id: string, patch: Partial<ResearchTask>) => {
    researchTaskStore.save(researchTaskStore.getAll().map(task =>
      task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task
    ))
  },
  remove: (id: string) => {
    researchTaskStore.save(researchTaskStore.getAll().filter(task => task.id !== id))
  },
  clear: () => localStorage.removeItem(KEYS.RESEARCH_TASKS),
}

export const researchAssetStore = {
  getAll: (): ResearchAsset[] => read<ResearchAsset[]>(KEYS.RESEARCH_ASSETS) ?? [],
  save: (assets: ResearchAsset[]) => write(KEYS.RESEARCH_ASSETS, assets),
  getByProject: (projectId: string): ResearchAsset[] =>
    researchAssetStore.getAll()
      .filter(asset => asset.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  getByTask: (taskId: string): ResearchAsset[] =>
    researchAssetStore.getAll()
      .filter(asset => asset.taskId === taskId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  get: (id: string): ResearchAsset | null =>
    researchAssetStore.getAll().find(asset => asset.id === id) ?? null,
  add: (asset: Omit<ResearchAsset, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const next: ResearchAsset = {
      ...asset,
      id: uid('research_asset'),
      createdAt: now,
      updatedAt: now,
    }
    researchAssetStore.save([next, ...researchAssetStore.getAll()])
    return next
  },
  update: (id: string, patch: Partial<ResearchAsset>) => {
    researchAssetStore.save(researchAssetStore.getAll().map(asset =>
      asset.id === id ? { ...asset, ...patch, updatedAt: Date.now() } : asset
    ))
  },
  archiveConfirmedScaleAssets: (projectId: string, exceptId: string) => {
    researchAssetStore.save(researchAssetStore.getAll().map(asset =>
      asset.projectId === projectId && asset.type === 'scale_schema' && asset.id !== exceptId && asset.status === 'confirmed'
        ? { ...asset, status: 'archived', updatedAt: Date.now() }
        : asset
    ))
  },
  remove: (id: string) => {
    researchAssetStore.save(researchAssetStore.getAll().filter(asset => asset.id !== id))
  },
  clear: () => localStorage.removeItem(KEYS.RESEARCH_ASSETS),
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
  upsertRemote: (row: any) => {
    const next = fromApiLibraryItem(row)
    const exists = libraryStore.get(next.id)
    libraryStore.save(exists
      ? libraryStore.getAll().map(item => item.id === next.id ? next : item)
      : [next, ...libraryStore.getAll()]
    )
    return next
  },
  add: (item: Omit<LibraryItem, 'id' | 'createdAt' | 'updatedAt' | 'indexStatus'>) => {
    const now = Date.now()
    const next: LibraryItem = {
      ...item,
      id: uid('lib'),
      createdAt: now,
      updatedAt: now,
      indexStatus: 'ready',
      extractStatus: item.extractStatus ?? 'pending',
    }
    libraryStore.save([next, ...libraryStore.getAll()])
    remoteTask(() => libraryAPI.create(toApiLibraryItem(next)))
    return next
  },
  update: (id: string, patch: Partial<LibraryItem>) => {
    const nextItems = libraryStore.getAll().map(item =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
    )
    libraryStore.save(nextItems)
    const next = nextItems.find(item => item.id === id)
    if (next) remoteTask(() => libraryAPI.update(id, toApiLibraryItem(next)))
  },
  remove: (id: string) => {
    libraryStore.save(libraryStore.getAll().filter(item => item.id !== id))
    remoteTask(() => libraryAPI.delete(id))
    projectStore.save(projectStore.getAll().map(project => ({
      ...project,
      libraryItemIds: project.libraryItemIds.filter(itemId => itemId !== id),
    })))
  },
  clear: () => localStorage.removeItem(KEYS.LIBRARY),
}

// ── 项目 ──────────────────────────────────────────────────────
function createDraftSnapshots(): DraftSnapshots {
  return {
    chats: chatStore.getAll(),
    sections: sectionStore.getAll(),
    outlines: outlineStore.getAll(),
    versions: versionStore.getAll(),
    references: referenceStore.getAll(),
  }
}

function fromApiStyleProfile(row: any): StyleProfile {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    studentName: row.student_name ?? '',
    profileName: row.profile_name ?? '',
    sourceFileName: row.source_file_name ?? undefined,
    sourceDocuments: row.source_documents ?? [],
    sourceTextLength: row.source_text_length ?? 0,
    writingLevel: row.writing_level ?? '',
    sentenceStyle: row.sentence_style ?? '',
    paragraphLogic: row.paragraph_logic ?? '',
    argumentStyle: row.argument_style ?? '',
    transitionStyle: row.transition_style ?? '',
    vocabularyStyle: row.vocabulary_style ?? '',
    avoidContentReuseNotice: row.avoid_content_reuse_notice ?? '',
    editableSummary: row.editable_summary ?? '',
    createdAt: toTime(row.created_at),
    updatedAt: toTime(row.updated_at),
  }
}

function toApiStyleProfile(profile: StyleProfile) {
  return {
    id: profile.id,
    student_name: profile.studentName,
    profile_name: profile.profileName,
    source_file_name: profile.sourceFileName,
    source_documents: profile.sourceDocuments ?? [],
    source_text_length: profile.sourceTextLength,
    writing_level: profile.writingLevel,
    sentence_style: profile.sentenceStyle,
    paragraph_logic: profile.paragraphLogic,
    argument_style: profile.argumentStyle,
    transition_style: profile.transitionStyle,
    vocabulary_style: profile.vocabularyStyle,
    avoid_content_reuse_notice: profile.avoidContentReuseNotice,
    editable_summary: profile.editableSummary,
  }
}

export const projectStore = {
  getAll: (): Project[] => {
    const projects = read<Project[]>(KEYS.PROJECTS) ?? []
    if (projects.length > 0) return projects
    const fallback = createDefaultProject()
    write(KEYS.PROJECTS, [fallback])
    return [fallback]
  },
  save: (projects: Project[]) => {
    write(KEYS.PROJECTS, projects)
    projects.forEach(project => {
      remoteTask(async () => {
        try {
          await projectsAPI.update(project.id, toApiProjectPatch(project))
        } catch {
          await projectsAPI.create(toApiProject(project))
        }
      })
    })
  },
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
    const projects = [next, ...projectStore.getAll()]
    write(KEYS.PROJECTS, projects)
    remoteTask(() => projectsAPI.create(toApiProject(next)))
    projectStore.setActiveId(next.id)
    return next
  },
  resetWorkspace: (projectId: string) => {
    write(KEYS.SECTIONS, sectionStore.getAll().filter(section => section.projectId !== projectId))
    write(KEYS.OUTLINE, outlineStore.getAll().filter(outline => outline.projectId !== projectId))
    write(KEYS.CHAT, chatStore.getAll().filter(message => message.projectId !== projectId))
    write(KEYS.VERSIONS, versionStore.getAll().filter(snapshot => snapshot.projectId !== projectId))
    write(KEYS.REFERENCES, referenceStore.getAll().filter(selection => selection.projectId !== projectId))
    write(KEYS.RESEARCH_TASKS, researchTaskStore.getAll().filter(task => task.projectId !== projectId))
    write(KEYS.RESEARCH_ASSETS, researchAssetStore.getAll().filter(asset => asset.projectId !== projectId))
    projectStore.update(projectId, { context: createEmptyProjectContext(), currentStage: 'stage1' })
  },
  update: (id: string, patch: Partial<Project>) => {
    const nextProjects = projectStore.getAll().map(project =>
      project.id === id ? { ...project, ...patch, updatedAt: Date.now() } : project
    )
    write(KEYS.PROJECTS, nextProjects)
    const nextProject = nextProjects.find(project => project.id === id)
    remoteTask(async () => {
      try {
        await projectsAPI.update(id, toApiProjectPatch(patch))
      } catch {
        if (nextProject) await projectsAPI.create(toApiProject(nextProject))
      }
    })
  },
  remove: (id: string) => {
    const nextProjects = projectStore.getAll().filter(project => project.id !== id)
    write(KEYS.PROJECTS, nextProjects)
    write(KEYS.SECTIONS, sectionStore.getAll().filter(section => section.projectId !== id))
    write(KEYS.OUTLINE, outlineStore.getAll().filter(outline => outline.projectId !== id))
    write(KEYS.CHAT, chatStore.getAll().filter(message => message.projectId !== id))
    write(KEYS.VERSIONS, versionStore.getAll().filter(snapshot => snapshot.projectId !== id))
    write(KEYS.REFERENCES, referenceStore.getAll().filter(selection => selection.projectId !== id))
    write(KEYS.RESEARCH_TASKS, researchTaskStore.getAll().filter(task => task.projectId !== id))
    write(KEYS.RESEARCH_ASSETS, researchAssetStore.getAll().filter(asset => asset.projectId !== id))
    const activeId = read<string>(KEYS.ACTIVE_PROJECT)
    if (activeId === id && nextProjects[0]) {
      projectStore.setActiveId(nextProjects[0].id)
    }
    remoteTask(() => projectsAPI.delete(id))
  },
  getDraftSnapshots: createDraftSnapshots,
  isEmptyDraft: (project: Project, snapshots: DraftSnapshots = createDraftSnapshots()) => {
    const unnamed = !project.title || project.title === '未命名论文' || project.title === '未命名论文对话'
    if (!unnamed) return false
    if (project.libraryItemIds.length > 0) return false
    const context = project.context ?? createEmptyProjectContext()
    const hasContext = Boolean(
      context.researchObject?.trim()
      || context.writingBoundary?.trim()
      || context.stylePreference?.trim()
      || context.rawSummary?.trim()
      || context.writingRequirements?.length
    )
    if (hasContext) return false
    if (snapshots.chats.some(message => message.projectId === project.id && message.role === 'user')) return false
    if (snapshots.sections.some(section =>
      section.projectId === project.id && (section.title.trim() || section.content.trim() || section.editorDoc)
    )) return false
    const outline = snapshots.outlines.find(item => item.projectId === project.id)
    if (outline?.sections?.length) return false
    if (snapshots.versions.some(snapshot => snapshot.projectId === project.id)) return false
    if (snapshots.references.some(selection =>
      selection.projectId === project.id && (selection.libraryItemIds.length > 0 || selection.sectionIds.length > 0)
    )) return false
    return true
  },
  pruneEmptyDrafts: (exceptId?: string) => {
    const snapshots = createDraftSnapshots()
    const emptyIds = projectStore
      .getAll()
      .filter(project => project.id !== exceptId && projectStore.isEmptyDraft(project, snapshots))
      .map(project => project.id)
    emptyIds.forEach(id => projectStore.remove(id))
    return emptyIds.length
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
      autoCitationEnabled: true,
      autoSources: [],
      evidencePack: undefined,
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
    remoteTask(() => referencesAPI.save(next.projectId, next.stage, toApiReference(next)))
  },
}

// ── 清除所有数据（重新开始）──────────────────────────────────
export function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
}
