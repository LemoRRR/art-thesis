import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Paperclip, Send, ArrowRight, RefreshCw, Search } from 'lucide-react'
import ReferencePanel from '../components/ReferencePanel'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import ChatBubble from '../components/ChatBubble'
import MentionInput, { type MentionRef } from '../components/MentionInput'
import { callGPT } from '../lib/ai'
import { filesAPI, libraryAPI, scholarAPI, type ScholarPaper } from '../lib/api'
import { buildAIContext, buildMentionContext } from '../lib/context'
import { promptChatFollowup, type AcademicLevel } from '../lib/prompts'
import {
  chatStore,
  createEmptyProjectContext,
  libraryStore,
  projectStore,
  type ChatMessage,
  type ComprehensionModel,
  type LibraryItem,
  type ResearchMethodType,
  type ResearchPlan,
  type ResearchToolKey,
} from '../lib/storage'
import type { Message } from '../lib/ai'

type Stage1UploadStatus = 'uploading' | 'ready' | 'failed'
const ACADEMIC_LEVELS: AcademicLevel[] = ['本科', '硕士', '期刊']
const LEVEL_REQUIREMENT_PREFIX = '论文规格：'

interface ParsedComprehension {
  paperTitle?: string
  recommendedTitles?: string[]
  pathType?: 'existing_paper_revision' | 'from_scratch_generation'
  inputType?: 'paper' | 'outline' | 'topic' | 'mixed_material'
  hasDetectedOutline?: boolean
  hasDetectedDraft?: boolean
  materialTopic?: string
  researchObject?: string
  possibleDirections?: string[]
  keyArguments?: string[]
  coreArguments?: string[]
  risks?: string[]
  writingBoundary?: string
  academicLevel?: string
  academicLevelSuggestion?: string
  academicLevelReason?: string
  difficulty?: string
  coreSummary?: string
  coreClaims?: string
  outlineSummary?: string
  draftSummary?: string
  nextStepRecommendation?: 'generate_outline' | 'confirm_detected_outline' | 'revise_existing_draft' | 'write_from_outline'
  researchPlan?: Partial<ResearchPlan>
  researchMethodType?: string
  researchMethodLabel?: string
  researchMethodReason?: string
  suggestedResearchTools?: string[]
  dataToCollect?: string[]
  targetChapter?: string
  expectedFindings?: string
  researchTaskRecommendation?: string
}

interface Stage1UploadedFile {
  fileName: string
  status: Stage1UploadStatus
  item?: LibraryItem
  error?: string
}

interface ScholarCandidate extends ScholarPaper {
  savedItemId?: string
}

// AI 第一句话
const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'ai',
  content:
    '你好，我是你的论文写作助手。\n\n先把论文背景告诉我——可以直接粘贴题目、大纲或研究框架，也可以点左边的📎上传已有的论文原文（PDF 或 Word）。\n\n我不会学你的语言风格，只是理解研究方向和写作边界，为后续每一节的生成做准备。',
  timestamp: Date.now(),
}

function parseComprehensionReply(content: string): ParsedComprehension | null {
  const markerIndex = content.lastIndexOf('【理解完成】')
  const target = markerIndex >= 0 ? content.slice(markerIndex) : content
  const jsonMatch = target.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    return JSON.parse(jsonMatch[0]) as ParsedComprehension
  } catch {
    return null
  }
}

function formatList(items?: string[]): string {
  return items?.map(item => item.trim()).filter(Boolean).join('；') ?? ''
}

function buildScholarQuery(projectTitle: string, model: ComprehensionModel | null): string {
  const parts = [
    projectTitle,
    model?.researchObject,
    model?.coreArguments?.slice(0, 3).join(' '),
  ].filter(Boolean).join(' ')

  return parts
    .replace(/[《》“”"'【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function scholarPaperToLibraryText(paper: ScholarPaper): string {
  return [
    `标题：${paper.title}`,
    paper.authors.length ? `作者：${paper.authors.join('；')}` : '',
    paper.year ? `年份：${paper.year}` : '',
    paper.source ? `来源：${paper.source}` : '',
    paper.doi ? `DOI：${paper.doi}` : '',
    paper.url ? `链接：${paper.url}` : '',
    paper.citedByCount !== undefined ? `OpenAlex引用次数：${paper.citedByCount}` : '',
    '',
    paper.abstract ? `摘要：\n${paper.abstract}` : '摘要：暂无公开摘要。',
    '',
    '使用提醒：该条目来自论文搜索结果，写作前建议用户核对原文、页码与最终参考文献格式。',
  ].filter(Boolean).join('\n')
}

const PATH_LABELS: Record<string, string> = {
  existing_paper_revision: '已有论文修改',
  from_scratch_generation: '从 0 生成',
}

const INPUT_LABELS: Record<string, string> = {
  paper: '已有论文',
  outline: '大纲',
  topic: '题目/想法',
  mixed_material: '混合材料',
}

const NEXT_STEP_LABELS: Record<string, string> = {
  generate_outline: '生成大纲',
  confirm_detected_outline: '确认识别到的大纲',
  revise_existing_draft: '修改已有正文',
  write_from_outline: '按大纲写作',
}

function getSelectedAcademicLevel(requirements: string[] = []): AcademicLevel | '' {
  const stored = requirements
    .find(item => item.startsWith(LEVEL_REQUIREMENT_PREFIX))
    ?.replace(LEVEL_REQUIREMENT_PREFIX, '')
    .trim()
  return stored === '本科' || stored === '硕士' || stored === '期刊' ? stored : ''
}

function normalizeAcademicLevelCandidate(value?: string): AcademicLevel | '' {
  if (!value) return ''
  if (/期刊|投稿|发表/.test(value)) return '期刊'
  if (/本科|毕业论文|毕业设计/.test(value)) return '本科'
  if (/硕士|学硕|专硕|研究生|mfa|专业型|学术型/.test(value.toLowerCase())) return '硕士'
  return ''
}

function inferAcademicLevel(parsed: ParsedComprehension, ...sources: string[]): AcademicLevel | '' {
  const candidates = [
    parsed.academicLevelSuggestion,
    parsed.academicLevel,
    parsed.difficulty,
    ...sources,
  ]
  for (const candidate of candidates) {
    const level = normalizeAcademicLevelCandidate(candidate)
    if (level) return level
  }
  return ''
}

function withSelectedAcademicLevel(requirements: string[] = [], level: AcademicLevel): string[] {
  return [
    ...requirements.filter(item => !item.startsWith(LEVEL_REQUIREMENT_PREFIX)),
    `${LEVEL_REQUIREMENT_PREFIX}${level}`,
  ]
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(/[；;、,\n]/).map(item => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeResearchMethodType(value?: string): ResearchMethodType {
  if (!value) return 'theoretical'
  if (/混合/.test(value)) return 'mixed'
  if (/定量|量化|问卷|变量|统计|信度|效度|回归|中介/.test(value)) return 'quantitative'
  if (/定性|质性|访谈|扎根|编码|主题|文本/.test(value)) return 'qualitative'
  if (/设计评价|KANO|AHP|需求|评价模型/.test(value)) return 'design_evaluation'
  if (/案例/.test(value)) return 'case_study'
  return 'theoretical'
}

function normalizeResearchToolKey(value: string): ResearchToolKey | null {
  const lower = value.toLowerCase()
  if (/scale_generation|量表|问卷|题项/.test(lower)) return 'scale_generation'
  if (/hypothesis_model|假设|模型|变量/.test(lower)) return 'hypothesis_model'
  if (/survey_analysis|数据分析|描述统计|信度|效度|相关|回归/.test(lower)) return 'survey_analysis'
  if (/mediation|中介/.test(lower)) return 'mediation'
  if (/kano|需求分析/.test(lower)) return 'kano'
  if (/ahp|层次分析|权重/.test(lower)) return 'ahp'
  if (/grounded_coding|扎根|开放编码|主轴编码|选择编码/.test(lower)) return 'grounded_coding'
  if (/emotion_coding|情感/.test(lower)) return 'emotion_coding'
  if (/theme_extraction|主题/.test(lower)) return 'theme_extraction'
  if (/case_summary|案例/.test(lower)) return 'case_summary'
  return null
}

function buildResearchPlan(parsed: ParsedComprehension): ResearchPlan | undefined {
  const plan = parsed.researchPlan ?? {}
  const methodType = normalizeResearchMethodType(
    String(plan.methodType ?? parsed.researchMethodType ?? plan.methodLabel ?? parsed.researchMethodLabel ?? '')
  )
  const suggestedTools = toStringArray(plan.suggestedTools ?? parsed.suggestedResearchTools)
    .map(normalizeResearchToolKey)
    .filter((item): item is ResearchToolKey => Boolean(item))
  const dataNeeds = toStringArray(plan.dataNeeds ?? parsed.dataToCollect)
  const outlineRequirements = toStringArray(plan.outlineRequirements ?? parsed.targetChapter)
  const pendingResearchTasks = toStringArray(plan.pendingResearchTasks ?? parsed.researchTaskRecommendation)
  const variables = plan.variables

  if (
    methodType === 'theoretical' &&
    suggestedTools.length === 0 &&
    dataNeeds.length === 0 &&
    !plan.methodReason &&
    !parsed.researchMethodReason
  ) {
    return undefined
  }

  return {
    methodType,
    methodLabel: String(plan.methodLabel ?? parsed.researchMethodLabel ?? (
      methodType === 'quantitative' ? '量化问卷研究'
        : methodType === 'qualitative' ? '质性研究'
          : methodType === 'mixed' ? '混合研究'
            : methodType === 'design_evaluation' ? '设计评价研究'
              : methodType === 'case_study' ? '案例研究'
                : '理论分析'
    )),
    methodReason: String(plan.methodReason ?? parsed.researchMethodReason ?? parsed.expectedFindings ?? '系统根据 Stage1 材料理解给出的研究方法建议，后续可由用户确认或调整。'),
    suggestedTools,
    variables: variables && typeof variables === 'object' ? variables : undefined,
    dataNeeds,
    outlineRequirements,
    pendingResearchTasks,
  }
}

function buildComprehensionModel(parsed: ParsedComprehension): ComprehensionModel {
  const topic = parsed.materialTopic || parsed.researchObject || ''
  const possibleDirections = formatList(parsed.possibleDirections)
  const coreArguments = parsed.coreArguments?.length ? parsed.coreArguments : parsed.keyArguments
  const keyArguments = formatList(coreArguments)
  const risks = formatList(parsed.risks)
  const summary = parsed.coreSummary || parsed.coreClaims || ''
  const researchPlan = buildResearchPlan(parsed)
  const rawSummary = [
    parsed.pathType ? `路径判断：${PATH_LABELS[parsed.pathType] ?? parsed.pathType}` : '',
    parsed.inputType ? `输入类型：${INPUT_LABELS[parsed.inputType] ?? parsed.inputType}` : '',
    `识别到大纲：${parsed.hasDetectedOutline ? '是' : '否'}`,
    `识别到正文：${parsed.hasDetectedDraft ? '是' : '否'}`,
    topic ? `材料主题：${topic}` : '',
    summary ? `材料理解：${summary}` : '',
    possibleDirections ? `可写方向：${possibleDirections}` : '',
    keyArguments ? `核心论点：${keyArguments}` : '',
    parsed.academicLevelSuggestion ? `AI 学段建议：${parsed.academicLevelSuggestion}` : '',
    parsed.academicLevelReason ? `建议理由：${parsed.academicLevelReason}` : '',
    parsed.outlineSummary ? `大纲识别：${parsed.outlineSummary}` : '',
    parsed.draftSummary ? `正文识别：${parsed.draftSummary}` : '',
    parsed.nextStepRecommendation ? `建议下一步：${NEXT_STEP_LABELS[parsed.nextStepRecommendation] ?? parsed.nextStepRecommendation}` : '',
    researchPlan ? `研究方法建议：${researchPlan.methodLabel}。${researchPlan.methodReason}` : '',
    researchPlan?.dataNeeds.length ? `数据收集建议：${researchPlan.dataNeeds.join('；')}` : '',
    researchPlan?.outlineRequirements.length ? `方法章节建议：${researchPlan.outlineRequirements.join('；')}` : '',
    risks ? `材料缺口/风险：${risks}` : '',
    `建议难度：${parsed.difficulty || '待选择论文规格后细化'}`,
  ].filter(Boolean).join('\n')

  return {
    researchObject: topic,
    writingBoundary: parsed.writingBoundary || risks || '可在大纲阶段继续收束研究范围。',
    academicLevel: '待选择',
    rawSummary,
    pathType: parsed.pathType,
    inputType: parsed.inputType,
    hasDetectedOutline: parsed.hasDetectedOutline,
    hasDetectedDraft: parsed.hasDetectedDraft,
    academicLevelSuggestion: parsed.academicLevelSuggestion,
    academicLevelReason: parsed.academicLevelReason,
    coreArguments,
    outlineSummary: parsed.outlineSummary,
    draftSummary: parsed.draftSummary,
    nextStepRecommendation: parsed.nextStepRecommendation,
    researchPlan,
  }
}

function inferPaperTitle(parsed: ParsedComprehension): string {
  const explicitTitle = parsed.paperTitle?.trim()
  if (explicitTitle) return explicitTitle

  const recommendedTitle = parsed.recommendedTitles?.find(title => title.trim())?.trim()
  if (recommendedTitle) return recommendedTitle

  const researchObject = (parsed.materialTopic || parsed.researchObject)?.trim()
  if (researchObject) return `${researchObject}研究`

  return '未命名论文'
}

function formatComprehensionReply(content: string, parsed: ParsedComprehension): string {
  const lead = content.split('【理解完成】')[0].trim()
  const paperTitle = inferPaperTitle(parsed)
  const topic = parsed.materialTopic || parsed.researchObject || '未明确'
  const directions = formatList(parsed.possibleDirections)
  const argumentsText = formatList(parsed.coreArguments?.length ? parsed.coreArguments : parsed.keyArguments)
  const risks = formatList(parsed.risks)
  const summary = parsed.coreSummary || parsed.coreClaims
  const titles = parsed.recommendedTitles?.length ? parsed.recommendedTitles.join('；') : paperTitle
  const researchPlan = buildResearchPlan(parsed)
  return [
    lead || '我已经读取并整理了你提供的材料，可以进入下一步。',
    '',
    '【理解完成】',
    parsed.pathType ? `路径判断：${PATH_LABELS[parsed.pathType] ?? parsed.pathType}` : '',
    parsed.inputType ? `输入类型：${INPUT_LABELS[parsed.inputType] ?? parsed.inputType}` : '',
    `识别到大纲：${parsed.hasDetectedOutline ? '是' : '否'}`,
    `识别到正文：${parsed.hasDetectedDraft ? '是' : '否'}`,
    `主题判断：${topic}`,
    summary ? `材料理解：${summary}` : '',
    directions ? `可写方向：${directions}` : '',
    argumentsText ? `核心论点：${argumentsText}` : '',
    parsed.academicLevelSuggestion ? `AI 学段建议：${parsed.academicLevelSuggestion}` : '',
    parsed.academicLevelReason ? `建议理由：${parsed.academicLevelReason}` : '',
    researchPlan ? `研究方法建议：${researchPlan.methodLabel}` : '',
    researchPlan ? `方法理由：${researchPlan.methodReason}` : '',
    researchPlan?.dataNeeds.length ? `数据收集建议：${researchPlan.dataNeeds.join('；')}` : '',
    parsed.nextStepRecommendation ? `建议下一步：${NEXT_STEP_LABELS[parsed.nextStepRecommendation] ?? parsed.nextStepRecommendation}` : '',
    risks ? `材料缺口/风险：${risks}` : '',
    `推荐题目：${titles}`,
    `建议难度：${parsed.difficulty || '待选择论文规格后细化'}`,
  ].filter(Boolean).join('\n')
}

function buildUploadedFileContext(uploadedFile: Stage1UploadedFile | null): string {
  const item = uploadedFile?.item
  if (!item) return ''

  return [
    '【本轮上传并解析的附件】',
    `文件名：${item.fileName ?? uploadedFile.fileName}`,
    `资料标题：${item.title}`,
    item.summary ? `解析摘要：${item.summary}` : '',
    item.structureExtract ? `结构提取：\n${item.structureExtract}` : '',
    item.styleExtract ? `写法范式：\n${item.styleExtract}` : '',
    item.viewpointsExtract ? `观点与使用方式：\n${item.viewpointsExtract}` : '',
    item.casesExtract ? `案例与引用线索：\n${item.casesExtract}` : '',
    item.text ? `正文全文：\n${item.text}` : '',
  ].filter(Boolean).join('\n\n')
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function pollExtractedLibraryItem(itemId: string): Promise<LibraryItem | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1200)
    const row = await libraryAPI.get(itemId)
    const item = libraryStore.upsertRemote(row)
    if (item.extractStatus === 'done' || item.extractStatus === 'failed') return item
  }
  return libraryStore.get(itemId)
}

export default function Stage1() {
  const navigate = useNavigate()
  const params = useParams()
  const project = projectStore.ensure(params.projectId)
  const writingRequirementsKey = project.context.writingRequirements.join('\u0001')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  const [messages,     setMessages]     = useState<ChatMessage[]>([])
  const [inputText,    setInputText]    = useState('')
  const [isLoading,    setIsLoading]    = useState(false)
  const [streamingId,  setStreamingId]  = useState<string | null>(null)
  const [isCompleted,  setIsCompleted]  = useState(false)
  const [uploadedFile, setUploadedFile] = useState<Stage1UploadedFile | null>(null)
  const [showReferences, setShowReferences] = useState(false)
  const [comprehension, setComprehension] = useState<ComprehensionModel | null>(null)
  const [mentions, setMentions] = useState<MentionRef[]>([])
  const [scholarQuery, setScholarQuery] = useState(() => buildScholarQuery(project.title, null))
  const [scholarResults, setScholarResults] = useState<ScholarCandidate[]>([])
  const [isSearchingScholar, setIsSearchingScholar] = useState(false)
  const [scholarNotice, setScholarNotice] = useState('')
  const [selectedLevel, setSelectedLevel] = useState<AcademicLevel | ''>(() =>
    getSelectedAcademicLevel(project.context.writingRequirements)
  )

  // 初始化：从 localStorage 读取历史记录
  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return

      setIsCompleted(false)
      setComprehension(null)
      setInputText('')
      setUploadedFile(null)
      setIsLoading(false)
      setStreamingId(null)
      setMentions([])
      const currentProject = projectStore.ensure(project.id)
      const storedLevel = getSelectedAcademicLevel(currentProject.context.writingRequirements)
        || normalizeAcademicLevelCandidate(currentProject.context.academicLevel)
        || normalizeAcademicLevelCandidate(currentProject.context.academicLevelSuggestion)
      setSelectedLevel(storedLevel)

      const saved = chatStore.getByProject(project.id, 'stage1')
      const savedComprehension = currentProject.context.rawSummary
        ? {
            researchObject: currentProject.context.researchObject,
            writingBoundary: currentProject.context.writingBoundary,
            academicLevel: storedLevel || '待选择',
            rawSummary: currentProject.context.rawSummary,
            pathType: currentProject.context.pathType,
            inputType: currentProject.context.inputType,
            hasDetectedOutline: currentProject.context.hasDetectedOutline,
            hasDetectedDraft: currentProject.context.hasDetectedDraft,
            academicLevelSuggestion: currentProject.context.academicLevelSuggestion,
            academicLevelReason: currentProject.context.academicLevelReason,
            coreArguments: currentProject.context.coreArguments,
            outlineSummary: currentProject.context.outlineSummary,
            draftSummary: currentProject.context.draftSummary,
            nextStepRecommendation: currentProject.context.nextStepRecommendation,
            researchPlan: currentProject.context.researchPlan,
          }
        : null

      if (saved.length > 0) {
        setMessages(saved)
        // 检查是否已经完成
        const lastAI = [...saved].reverse().find(m => m.role === 'ai')
        if (lastAI?.content.includes('【理解完成')) {
          setIsCompleted(true)
        }
      } else {
        // 第一次进入，显示欢迎消息
        const welcome = { ...WELCOME_MESSAGE, projectId: project.id, stage: 'stage1' as const }
        setMessages([welcome])
        chatStore.saveForProject(project.id, 'stage1', [welcome])
      }

      if (savedComprehension) {
        setComprehension(savedComprehension)
        if (savedComprehension.rawSummary) {
          setIsCompleted(true)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    project.context.academicLevel,
    project.context.rawSummary,
    project.context.researchObject,
    project.context.researchPlan,
    project.context.writingBoundary,
    project.id,
    writingRequirementsKey,
  ])

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!scholarQuery.trim() || scholarQuery === project.title) {
      setScholarQuery(buildScholarQuery(projectStore.ensure(project.id).title, comprehension))
    }
  }, [comprehension, project.id, project.title, scholarQuery])

  // 发送消息
  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading || uploadedFile?.status === 'uploading') return

    setInputText('')
    const activeUpload = uploadedFile
    const uploadedFileContext = buildUploadedFileContext(activeUpload)
    const mentionContext = buildMentionContext(mentions)
    setMentions([])

    // 构建用户消息
    const userMsg: ChatMessage = {
      id:        Date.now().toString(),
      role:      'user',
      content:   activeUpload?.item
        ? `[已上传并解析文件：${activeUpload.fileName}，资料库ID：${activeUpload.item.id}]\n\n${text}`
        : activeUpload
          ? `[附件未完成解析：${activeUpload.fileName}]\n\n${text}`
        : text,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage1',
    }

    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    chatStore.saveForProject(project.id, 'stage1', newMessages)
    setUploadedFile(null)

    // 构建 AI 消息（流式）
    const aiMsgId = (Date.now() + 1).toString()
    const aiMsg: ChatMessage = {
      id:        aiMsgId,
      role:      'ai',
      content:   '',
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage1',
    }

    setMessages(prev => [...prev, aiMsg])
    setIsLoading(true)
    setStreamingId(aiMsgId)

    // 构建发送给 GPT 的历史（转换格式）
    const contextualText = [
      uploadedFileContext,
      buildAIContext({ projectId: project.id, stage: 'stage1', userInput: text }),
      mentionContext,
    ].filter(Boolean).join('\n\n---\n\n')
    const history: Message[] = newMessages
      .slice(1)  // 跳过欢迎消息
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }))

    let fullContent = ''
    const abort = new AbortController()
    abortRef.current = abort

    const callModel = callGPT

    callModel(
      promptChatFollowup(history.slice(0, -1), text, contextualText),
      {
        onChunk: (chunk) => {
          fullContent += chunk
          setMessages(prev =>
            prev.map(m => m.id === aiMsgId ? { ...m, content: fullContent } : m)
          )
        },
        onDone: () => {
          setIsLoading(false)
          setStreamingId(null)

          // 更新 localStorage
          const parsedComprehension = parseComprehensionReply(fullContent)
          const displayContent = parsedComprehension
            ? formatComprehensionReply(fullContent, parsedComprehension)
            : fullContent
          const finalMessages = [...newMessages, { ...aiMsg, content: displayContent }]
          chatStore.saveForProject(project.id, 'stage1', finalMessages)
          setMessages(finalMessages)

          // 检测理解完成，直接从当前回复里解析 JSON
          if (parsedComprehension || fullContent.includes('【理解完成】') || fullContent.includes('【理解完成')) {
            setIsCompleted(true)
            if (parsedComprehension) {
              const model = buildComprehensionModel(parsedComprehension)
              const paperTitle = inferPaperTitle(parsedComprehension)
              const inferredLevel = selectedLevel || inferAcademicLevel(parsedComprehension, userMsg.content, fullContent)
              if (inferredLevel) {
                setSelectedLevel(inferredLevel)
              }
              const modelForDisplay = {
                ...model,
                academicLevel: inferredLevel || '待选择',
              }
              const currentProject = projectStore.ensure(project.id)
              projectStore.update(project.id, {
                title: paperTitle,
                context: {
                  ...currentProject.context,
                  researchObject: model.researchObject,
                  writingBoundary: model.writingBoundary,
                  academicLevel: inferredLevel || '',
                  writingRequirements: inferredLevel
                    ? withSelectedAcademicLevel(currentProject.context.writingRequirements, inferredLevel)
                    : currentProject.context.writingRequirements,
                  rawSummary: model.rawSummary,
                  pathType: model.pathType,
                  inputType: model.inputType,
                  hasDetectedOutline: model.hasDetectedOutline,
                  hasDetectedDraft: model.hasDetectedDraft,
                  academicLevelSuggestion: model.academicLevelSuggestion,
                  academicLevelReason: model.academicLevelReason,
                  coreArguments: model.coreArguments,
                  outlineSummary: model.outlineSummary,
                  draftSummary: model.draftSummary,
                  nextStepRecommendation: model.nextStepRecommendation,
                  researchPlan: model.researchPlan,
                },
                currentStage: inferredLevel ? 'stage2' : 'stage1',
              })
              setComprehension(modelForDisplay)
            }
          }
        },
        onError: (err) => {
          setIsLoading(false)
          setStreamingId(null)
          setMessages(prev =>
            prev.map(m =>
              m.id === aiMsgId
                ? { ...m, content: `出错了：${err.message}\n\n请检查网络连接或 API Key 配置。` }
                : m
            )
          )
        },
      },
      abort.signal
    )
  }, [inputText, isLoading, mentions, messages, project.context, project.id, selectedLevel, uploadedFile])

  // 文件上传处理
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadedFile({ fileName: file.name, status: 'uploading' })
    setInputText(prev => prev || `我上传了材料《${file.name}》，请先读懂材料内容，整理可写方向、可展开论点、材料缺口和推荐题目。`)

    try {
      const row = await filesAPI.upload(file)
      const item = libraryStore.upsertRemote(row)
      projectStore.bindLibraryItem(project.id, item.id)
      setUploadedFile({ fileName: file.name, status: 'ready', item })

      pollExtractedLibraryItem(item.id)
        .then(freshItem => {
          if (!freshItem) return
          setUploadedFile(current =>
            current?.item?.id === item.id ? { ...current, item: freshItem } : current
          )
        })
        .catch(() => {
          // 维度提取是后台增强信息；即使轮询失败，正文和摘要也已经可用于材料理解。
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件上传解析失败'
      const isAuthError = message.includes('401') || message.includes('未登录') || message.includes('登录') || message.toLowerCase().includes('unauthorized')
      setUploadedFile({
        fileName: file.name,
        status: 'failed',
        error: isAuthError ? '请先登录后再上传附件，这样才能写入云端并解析正文。' : message,
      })
    }
  }

  // Enter 发送（Shift+Enter 换行）
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleLevelSelect = (level: AcademicLevel) => {
    const currentProject = projectStore.ensure(project.id)
    setSelectedLevel(level)
    setComprehension(current =>
      current ? { ...current, academicLevel: level } : current
    )
    projectStore.update(project.id, {
      context: {
        ...currentProject.context,
        academicLevel: level,
        writingRequirements: withSelectedAcademicLevel(currentProject.context.writingRequirements, level),
      },
      currentStage: isCompleted ? 'stage2' : currentProject.currentStage,
    })
  }

  const handleScholarSearch = async () => {
    const query = scholarQuery.trim() || buildScholarQuery(projectStore.ensure(project.id).title, comprehension)
    if (!query || isSearchingScholar) return
    setScholarQuery(query)
    setIsSearchingScholar(true)
    setScholarNotice('')
    try {
      const response = await scholarAPI.search(query, 12)
      setScholarResults(response.results)
      setScholarNotice(response.results.length
        ? `已从 ${response.provider} 搜到 ${response.results.length} 条候选文献。请勾选真正要用于论文的文献。`
        : '暂未搜到合适文献，可以换成英文关键词或更具体的研究对象。'
      )
    } catch (error) {
      setScholarNotice(`论文搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSearchingScholar(false)
    }
  }

  const saveScholarPaper = (paper: ScholarCandidate) => {
    if (paper.savedItemId) return
    const existing = libraryStore.getAll().find(item =>
      item.fileUrl === paper.url ||
      (paper.doi && item.summary.includes(paper.doi)) ||
      item.title.trim() === paper.title.trim()
    )
    const item = existing ?? libraryStore.add({
      title: paper.title,
      type: 'other',
      fileName: paper.doi || paper.id,
      fileUrl: paper.url,
      text: scholarPaperToLibraryText(paper),
      summary: [
        paper.authors.length ? paper.authors.join('、') : '作者未知',
        paper.year ? `${paper.year}` : '',
        paper.source || '',
        paper.doi ? `DOI：${paper.doi}` : '',
      ].filter(Boolean).join('；'),
      tags: ['论文搜索', 'OpenAlex', ...(paper.year ? [String(paper.year)] : [])],
      extractStatus: 'done',
      structureExtract: '外部论文检索结果：用于建立论文搜索候选文献池。',
      viewpointsExtract: paper.abstract ? `摘要要点：${paper.abstract.slice(0, 800)}` : '',
    })
    projectStore.bindLibraryItem(project.id, item.id)
    setScholarResults(results => results.map(result =>
      result.id === paper.id ? { ...result, savedItemId: item.id } : result
    ))
    setScholarNotice(`已加入资料库并绑定当前论文：${paper.title}`)
  }

  // 重新开始
  const handleReset = () => {
    if (!confirm('确认重新开始？当前所有记录将清空。')) return
    abortRef.current?.abort()
    projectStore.update(project.id, { context: createEmptyProjectContext(), currentStage: 'stage1' })
    const welcome = { ...WELCOME_MESSAGE, projectId: project.id, stage: 'stage1' as const }
    setMessages([welcome])
    chatStore.saveForProject(project.id, 'stage1', [welcome])
    setIsCompleted(false)
    setComprehension(null)
    setInputText('')
    setUploadedFile(null)
    setIsLoading(false)
    setStreamingId(null)
    setSelectedLevel('')
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 顶部导航 */}
        <TopBar
          currentStep={0}
          right={
            <>
              <button
                onClick={() => setShowReferences(v => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${showReferences ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: showReferences ? 'var(--color-accent-light)' : 'transparent',
                  color: showReferences ? 'var(--color-accent)' : 'var(--color-ink-3)',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <BookOpen size={13} />
                引用
              </button>
              <button
                onClick={handleReset}
                title="重新开始"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-ink-3)',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <RefreshCw size={13} />
                重新开始
              </button>
            </>
          }
        />

        {/* 主体：对话区 + 输入区 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* 对话消息流 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 0',
          }}
        >
          <div
            style={{
              maxWidth: 680,
              margin: '0 auto',
              padding: '0 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {messages.map(msg => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                isStreaming={streamingId === msg.id}
              />
            ))}

            {/* 理解完成后显示结构化结果 */}
            {isCompleted && comprehension && (
              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 500, letterSpacing: '0.05em' }}>
                  材料理解
                </div>
                {[
                  { label: '推荐题目', value: projectStore.ensure(project.id).title },
                  { label: '路径判断', value: comprehension.pathType ? PATH_LABELS[comprehension.pathType] : '' },
                  { label: '输入类型', value: comprehension.inputType ? INPUT_LABELS[comprehension.inputType] : '' },
                  { label: '大纲/正文', value: `大纲：${comprehension.hasDetectedOutline ? '已识别' : '未识别'}；正文：${comprehension.hasDetectedDraft ? '已识别' : '未识别'}` },
                  { label: '主题判断', value: comprehension.researchObject },
                  { label: '核心论点', value: formatList(comprehension.coreArguments) },
                  { label: 'AI 学段建议', value: [comprehension.academicLevelSuggestion, comprehension.academicLevelReason].filter(Boolean).join('：') },
                  { label: '研究方法', value: comprehension.researchPlan ? `${comprehension.researchPlan.methodLabel}：${comprehension.researchPlan.methodReason}` : '' },
                  { label: '数据收集', value: comprehension.researchPlan?.dataNeeds.join('；') },
                  { label: '后续任务', value: comprehension.researchPlan?.pendingResearchTasks.join('；') },
                  { label: '建议下一步', value: comprehension.nextStepRecommendation ? NEXT_STEP_LABELS[comprehension.nextStepRecommendation] : '' },
                  { label: '材料建议', value: comprehension.rawSummary },
                  { label: '论文规格', value: selectedLevel || '待选择' },
                ].filter(item => item.value).map(item => (
                  <div key={item.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'var(--color-accent-light)',
                        color: 'var(--color-accent)',
                        border: '0.5px solid #B8D9C0',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {item.label}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--color-ink-2)', lineHeight: 1.6 }}>
                      {item.value}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingTop: 2 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--color-ink-3)',
                      fontWeight: 500,
                      marginRight: 2,
                    }}
                  >
                    请选择后续生成规格
                  </span>
                  {ACADEMIC_LEVELS.map(level => {
                    const active = selectedLevel === level
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => handleLevelSelect(level)}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                          color: active ? '#fff' : 'var(--color-ink-2)',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        {level}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {isCompleted && (
              <div
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 500, letterSpacing: '0.05em' }}>
                      论文搜索
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.6, color: 'var(--color-ink-2)' }}>
                      根据当前题目和材料理解检索外部论文。搜索结果需要人工确认后才会进入资料库，后续正文生成才可以引用。
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--color-ink-3)', whiteSpace: 'nowrap' }}>OpenAlex</span>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={scholarQuery}
                    onChange={event => setScholarQuery(event.target.value)}
                    placeholder="输入论文关键词，例如：非遗 短视频 传播意愿 青年用户"
                    style={{
                      flex: 1,
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-ink)',
                      padding: '8px 10px',
                      fontSize: 13,
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleScholarSearch}
                    disabled={isSearchingScholar}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-accent)',
                      background: 'var(--color-accent)',
                      color: '#fff',
                      fontSize: 12,
                      cursor: isSearchingScholar ? 'wait' : 'pointer',
                      opacity: isSearchingScholar ? 0.7 : 1,
                      fontFamily: 'var(--font-sans)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Search size={13} />
                    {isSearchingScholar ? '搜索中' : '搜索论文'}
                  </button>
                </div>

                {scholarNotice && (
                  <div style={{ fontSize: 12, color: scholarNotice.includes('失败') ? '#b42318' : 'var(--color-accent)', lineHeight: 1.6 }}>
                    {scholarNotice}
                  </div>
                )}

                {scholarResults.length > 0 && (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: 2 }}>
                    {scholarResults.map(paper => (
                      <div
                        key={paper.id}
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 8,
                          padding: 10,
                          background: 'var(--color-bg)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--color-ink)', lineHeight: 1.45 }}>
                              {paper.title}
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.5 }}>
                              {[paper.authors.slice(0, 3).join('、'), paper.year, paper.source, paper.citedByCount ? `引用 ${paper.citedByCount}` : ''].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <button
                            onClick={() => saveScholarPaper(paper)}
                            disabled={Boolean(paper.savedItemId)}
                            style={{
                              flexShrink: 0,
                              padding: '5px 10px',
                              borderRadius: 'var(--radius-sm)',
                              border: `1px solid ${paper.savedItemId ? 'var(--color-border)' : 'var(--color-accent)'}`,
                              background: paper.savedItemId ? 'transparent' : 'var(--color-accent-light)',
                              color: paper.savedItemId ? 'var(--color-ink-3)' : 'var(--color-accent)',
                              fontSize: 12,
                              cursor: paper.savedItemId ? 'default' : 'pointer',
                              fontFamily: 'var(--font-sans)',
                            }}
                          >
                            {paper.savedItemId ? '已加入' : '加入资料库'}
                          </button>
                        </div>
                        {paper.abstract && (
                          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: 'var(--color-ink-2)' }}>
                            {paper.abstract.slice(0, 260)}{paper.abstract.length > 260 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* 理解完成 Banner */}
        {isCompleted && (
          <div
            style={{
              borderTop: '1px solid var(--color-border)',
              background: 'var(--color-accent-light)',
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-accent)' }}>
                材料理解完成 ✓
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-ink-3)', marginLeft: 10 }}>
                {selectedLevel ? '可以进入大纲撰写了' : '请先选择本科、硕士或期刊'}
              </span>
            </div>
            <button
              onClick={() => navigate(`/projects/${project.id}/stage2`)}
              disabled={!selectedLevel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: selectedLevel ? 'var(--color-accent)' : 'var(--color-border)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                cursor: selectedLevel ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-sans)',
                boxShadow: 'var(--shadow-sm)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                if (selectedLevel) e.currentTarget.style.background = 'var(--color-accent-hover)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = selectedLevel ? 'var(--color-accent)' : 'var(--color-border)'
              }}
            >
              进入大纲撰写
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* 输入区 */}
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            padding: '14px 20px',
          }}
        >
          <div
            style={{
              maxWidth: 680,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {/* 已上传文件提示 */}
            {uploadedFile && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--color-gpt)',
                  background: 'var(--color-gpt-light)',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid #B5D9D1',
                }}
              >
                <Paperclip size={12} />
                {uploadedFile.status === 'uploading' && `正在上传并解析：${uploadedFile.fileName}`}
                {uploadedFile.status === 'ready' && `已解析：${uploadedFile.item?.title ?? uploadedFile.fileName}`}
                {uploadedFile.status === 'failed' && `上传失败：${uploadedFile.error ?? uploadedFile.fileName}`}
                <button
                  onClick={() => setUploadedFile(null)}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 14 }}
                >
                  ×
                </button>
              </div>
            )}

            {/* 输入行 */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              {/* 文件上传按钮 */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  cursor: uploadedFile?.status === 'uploading' ? 'wait' : 'pointer',
                  color: 'var(--color-ink-3)',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)'
                  e.currentTarget.style.color = 'var(--color-accent)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-ink-3)'
                }}
                title="上传 PDF 或 Word 文件"
              >
                <Paperclip size={15} />
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                  disabled={uploadedFile?.status === 'uploading'}
                />
              </label>

              {/* 文字输入框 */}
              <MentionInput
                value={inputText}
                onChange={setInputText}
                mentions={mentions}
                onMentionsChange={setMentions}
                onKeyDown={handleKeyDown}
                placeholder="输入题目、材料、想法；@ 调用资料库，/ 调用风格档案……（Enter 发送，Shift+Enter 换行）"
                rows={1}
                style={{ flex: 1 }}
              />

              {/* 发送按钮 */}
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputText.trim() || uploadedFile?.status === 'uploading'}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: isLoading || !inputText.trim() || uploadedFile?.status === 'uploading'
                    ? 'var(--color-border)'
                    : 'var(--color-accent)',
                  color: '#fff',
                  cursor: isLoading || !inputText.trim() || uploadedFile?.status === 'uploading' ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                <Send size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                材料理解 · 读懂材料并给出写作建议
              </span>
            </div>
          </div>
        </div>
        </div>
      </div>
      <ReferencePanel
        projectId={project.id}
        stage="stage1"
        open={showReferences}
        onClose={() => setShowReferences(false)}
      />
    </div>
  )
}
