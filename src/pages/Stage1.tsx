import { useState, useEffect, useRef, useCallback } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Paperclip, Send, ArrowRight, RefreshCw } from 'lucide-react'
import ReferencePanel from '../components/ReferencePanel'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import ChatBubble from '../components/ChatBubble'
import ModelTag from '../components/ModelTag'
import { callDoubao, callGPT } from '../lib/ai'
import { buildAIContext } from '../lib/context'
import { promptChatFollowup } from '../lib/prompts'
import {
  chatStore,
  createEmptyProjectContext,
  projectStore,
  type ChatMessage,
  type ComprehensionModel,
} from '../lib/storage'
import type { Message } from '../lib/ai'

type ChatModel = 'gpt' | 'doubao'

// AI 第一句话
const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'ai',
  content:
    '你好，我是你的论文写作助手。\n\n先把论文背景告诉我——可以直接粘贴题目、大纲或研究框架，也可以点左边的📎上传已有的论文原文（PDF 或 Word）。\n\n我不会学你的语言风格，只是理解研究方向和写作边界，为后续每一节的生成做准备。',
  timestamp: Date.now(),
}

export default function Stage1() {
  const navigate = useNavigate()
  const params = useParams()
  const project = projectStore.ensure(params.projectId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  const [messages,     setMessages]     = useState<ChatMessage[]>([])
  const [inputText,    setInputText]    = useState('')
  const [isLoading,    setIsLoading]    = useState(false)
  const [streamingId,  setStreamingId]  = useState<string | null>(null)
  const [isCompleted,  setIsCompleted]  = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [showReferences, setShowReferences] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ChatModel>('gpt')
  const [comprehension, setComprehension] = useState<ComprehensionModel | null>(null)

  // 初始化：从 localStorage 读取历史记录
  useEffect(() => {
    const saved = chatStore.getByProject(project.id, 'stage1')
    const savedComprehension = project.context.rawSummary
      ? {
          researchObject: project.context.researchObject,
          writingBoundary: project.context.writingBoundary,
          academicLevel: project.context.academicLevel,
          rawSummary: project.context.rawSummary,
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
  }, [project.id])

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 发送消息
  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading) return

    setInputText('')

    // 构建用户消息
    const userMsg: ChatMessage = {
      id:        Date.now().toString(),
      role:      'user',
      content:   uploadedFile ? `[已上传文件：${uploadedFile.name}]\n\n${text}` : text,
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
    const contextualText = buildAIContext({ projectId: project.id, stage: 'stage1', userInput: text })
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
          const finalMessages = [...newMessages, { ...aiMsg, content: fullContent }]
          chatStore.saveForProject(project.id, 'stage1', finalMessages)
          setMessages(finalMessages)

          // 检测理解完成，直接从当前回复里解析 JSON
          if (fullContent.includes('【理解完成】') || fullContent.includes('【理解完成')) {
            setIsCompleted(true)
            try {
              const jsonMatch = fullContent.match(/\{[\s\S]*"researchObject"[\s\S]*?\}/)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                const rawSummary = [
                  `研究对象：${parsed.researchObject}`,
                  `写作边界：${parsed.writingBoundary}`,
                  `学段：${parsed.academicLevel}`,
                  parsed.coreClaims ? `核心论点：${parsed.coreClaims}` : '',
                ].filter(Boolean).join('\n')
                const model: ComprehensionModel = {
                  researchObject: parsed.researchObject ?? '',
                  writingBoundary: parsed.writingBoundary ?? '',
                  academicLevel: parsed.academicLevel ?? '本科',
                  rawSummary,
                }
                projectStore.update(project.id, {
                  context: {
                    ...project.context,
                    researchObject: model.researchObject,
                    writingBoundary: model.writingBoundary,
                    academicLevel: model.academicLevel,
                    rawSummary: model.rawSummary,
                  },
                  currentStage: 'stage2',
                })
                setComprehension(model)
              }
            } catch {
              // 解析失败不影响流程，用户仍可手动进入阶段二
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
  }, [inputText, messages, isLoading, uploadedFile, project.context, project.id, selectedModel])

  // 文件上传处理
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadedFile(file)
    // 把文件名填入输入框作为提示
    setInputText(prev => prev || `我上传了论文原文《${file.name}》，请学习文章的基本内容和研究方向。`)
    e.target.value = ''
  }

  // Enter 发送（Shift+Enter 换行）
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
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
                  理解模型
                </div>
                {[
                  { label: '研究对象', value: comprehension.researchObject },
                  { label: '写作边界', value: comprehension.writingBoundary },
                  { label: '学段判断', value: comprehension.academicLevel },
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
                可以开始撰写正文了
              </span>
            </div>
            <button
              onClick={() => navigate(`/projects/${project.id}/stage2`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--color-accent)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                boxShadow: 'var(--shadow-sm)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-accent)')}
            >
              进入撰写阶段
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
                已选择：{uploadedFile.name}
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
                  cursor: 'pointer',
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
                />
              </label>

              {/* 文字输入框 */}
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入题目、大纲、研究框架，或直接描述你的论文内容……（Enter 发送，Shift+Enter 换行）"
                rows={1}
                style={{
                  flex: 1,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 12px',
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: 'none',
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--color-ink)',
                  background: 'var(--color-bg)',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                  minHeight: 38,
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                onInput={e => {
                  // 自动撑高
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = Math.min(t.scrollHeight, 120) + 'px'
                }}
              />

              {/* 发送按钮 */}
              <button
                onClick={sendMessage}
                disabled={isLoading || !inputText.trim()}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: isLoading || !inputText.trim()
                    ? 'var(--color-border)'
                    : 'var(--color-accent)',
                  color: '#fff',
                  cursor: isLoading || !inputText.trim() ? 'not-allowed' : 'pointer',
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
                材料理解 · 不会模仿你的语言风格
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
