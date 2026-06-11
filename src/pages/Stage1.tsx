import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Paperclip, Send, ArrowRight, RefreshCw } from 'lucide-react'
import ReferencePanel from '../components/ReferencePanel'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import ChatBubble from '../components/ChatBubble'
import ModelTag from '../components/ModelTag'
import MentionInput, { type MentionRef } from '../components/MentionInput'
import { callDoubao, callGPT } from '../lib/ai'
import { filesAPI, libraryAPI } from '../lib/api'
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
} from '../lib/storage'
import type { Message } from '../lib/ai'

type ChatModel = 'gpt' | 'doubao'
type Stage1UploadStatus = 'uploading' | 'ready' | 'failed'
const ACADEMIC_LEVELS: AcademicLevel[] = ['本科', '硕士', '期刊']
const LEVEL_REQUIREMENT_PREFIX = '论文规格：'

interface ParsedComprehension {
  paperTitle?: string
  recommendedTitles?: string[]
  materialTopic?: string
  researchObject?: string
  possibleDirections?: string[]
  keyArguments?: string[]
  risks?: string[]
  writingBoundary?: string
  academicLevel?: string
  difficulty?: string
  coreSummary?: string
  coreClaims?: string
}

interface Stage1UploadedFile {
  fileName: string
  status: Stage1UploadStatus
  item?: LibraryItem
  error?: string
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

function getSelectedAcademicLevel(requirements: string[] = []): AcademicLevel | '' {
  const stored = requirements
    .find(item => item.startsWith(LEVEL_REQUIREMENT_PREFIX))
    ?.replace(LEVEL_REQUIREMENT_PREFIX, '')
    .trim()
  return stored === '本科' || stored === '硕士' || stored === '期刊' ? stored : ''
}

function withSelectedAcademicLevel(requirements: string[] = [], level: AcademicLevel): string[] {
  return [
    ...requirements.filter(item => !item.startsWith(LEVEL_REQUIREMENT_PREFIX)),
    `${LEVEL_REQUIREMENT_PREFIX}${level}`,
  ]
}

function buildComprehensionModel(parsed: ParsedComprehension): ComprehensionModel {
  const topic = parsed.materialTopic || parsed.researchObject || ''
  const possibleDirections = formatList(parsed.possibleDirections)
  const keyArguments = formatList(parsed.keyArguments)
  const risks = formatList(parsed.risks)
  const summary = parsed.coreSummary || parsed.coreClaims || ''
  const rawSummary = [
    topic ? `材料主题：${topic}` : '',
    summary ? `材料理解：${summary}` : '',
    possibleDirections ? `可写方向：${possibleDirections}` : '',
    keyArguments ? `可展开论点：${keyArguments}` : '',
    risks ? `材料缺口/风险：${risks}` : '',
    `建议难度：${parsed.difficulty || '待选择论文规格后细化'}`,
  ].filter(Boolean).join('\n')

  return {
    researchObject: topic,
    writingBoundary: parsed.writingBoundary || risks || '可在大纲阶段继续收束研究范围。',
    academicLevel: '待选择',
    rawSummary,
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
  const argumentsText = formatList(parsed.keyArguments)
  const risks = formatList(parsed.risks)
  const summary = parsed.coreSummary || parsed.coreClaims
  const titles = parsed.recommendedTitles?.length ? parsed.recommendedTitles.join('；') : paperTitle
  return [
    lead || '我已经读取并整理了你提供的材料，可以进入下一步。',
    '',
    '【理解完成】',
    `主题判断：${topic}`,
    summary ? `材料理解：${summary}` : '',
    directions ? `可写方向：${directions}` : '',
    argumentsText ? `可展开论点：${argumentsText}` : '',
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
  const [selectedModel, setSelectedModel] = useState<ChatModel>('gpt')
  const [comprehension, setComprehension] = useState<ComprehensionModel | null>(null)
  const [mentions, setMentions] = useState<MentionRef[]>([])
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
      setSelectedLevel(storedLevel)

      const saved = chatStore.getByProject(project.id, 'stage1')
      const savedComprehension = currentProject.context.rawSummary
        ? {
            researchObject: currentProject.context.researchObject,
            writingBoundary: currentProject.context.writingBoundary,
            academicLevel: storedLevel || '待选择',
            rawSummary: currentProject.context.rawSummary,
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
    project.context.writingBoundary,
    project.id,
    writingRequirementsKey,
  ])

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

    const callModel = selectedModel === 'gpt' ? callGPT : callDoubao

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
              const modelForDisplay = {
                ...model,
                academicLevel: selectedLevel || '待选择',
              }
              projectStore.update(project.id, {
                title: paperTitle,
                context: {
                  ...project.context,
                  researchObject: model.researchObject,
                  writingBoundary: model.writingBoundary,
                  academicLevel: selectedLevel || '',
                  rawSummary: model.rawSummary,
                },
                currentStage: selectedLevel ? 'stage2' : 'stage1',
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
  }, [inputText, isLoading, mentions, messages, project.context, project.id, selectedLevel, selectedModel, uploadedFile])

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
                  { label: '主题判断', value: comprehension.researchObject },
                  { label: '材料建议', value: comprehension.rawSummary },
                  { label: '论文规格', value: selectedLevel || '待选择' },
                ].map(item => (
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
                alignItems: 'flex-end',
              }}
            >
              {/* 文件上传按钮 */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
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
                placeholder="输入题目、材料、想法，或输入 @ 引用资料维度……（Enter 发送，Shift+Enter 换行）"
                rows={1}
                style={{ flex: 1 }}
              />

              {/* 发送按钮 */}
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputText.trim() || uploadedFile?.status === 'uploading'}
                style={{
                  width: 36,
                  height: 36,
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

            {/* 模型选择 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>模型</span>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value as ChatModel)}
                  style={{
                    height: 26,
                    minWidth: 118,
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 6,
                    background: 'var(--color-surface)',
                    color: 'var(--color-ink-2)',
                    padding: '0 28px 0 9px',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="gpt">GPT-5.5 Medium</option>
                  <option value="doubao">豆包 Ark</option>
                </select>
                <ModelTag model={selectedModel} />
              </div>
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
