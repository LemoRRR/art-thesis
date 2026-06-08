import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BookOpen, CheckCircle2, Copy, Download, History, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-react'
import ChatBubble from '../components/ChatBubble'
import DocumentToolbar from '../components/DocumentToolbar'
import DocArea from '../components/DocArea'
import ReferencePanel from '../components/ReferencePanel'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import VersionPanel from '../components/VersionPanel'
import { callDoubao, callGPT } from '../lib/ai'
import { buildAIContext } from '../lib/context'
import { formatSectionContent, formatSectionsForPaper, sectionsToPlainText } from '../lib/documentFormat'
import {
  promptAdjustFinish,
  promptFinishDraft,
  promptGenerateChapter,
  promptReviseSection,
  type AcademicLevel,
} from '../lib/prompts'
import {
  chatStore,
  outlineStore,
  projectStore,
  sectionStore,
  versionStore,
  type ChatMessage,
  type DocSection,
  type OutlineSection,
} from '../lib/storage'

type Mode = 'revise' | 'finish'

const uid = () => Math.random().toString(36).slice(2, 9)

const normalizeAcademicLevel = (level: string): AcademicLevel => {
  return level === '硕士' || level === '期刊' ? level : '本科'
}

function outlineToText(sections: OutlineSection[], depth = 0): string {
  return sections.map(section => {
    const indent = '  '.repeat(depth)
    const children = section.children ? outlineToText(section.children, depth + 1) : ''
    return `${indent}${section.order} ${section.title}${children ? `\n${children}` : ''}`
  }).join('\n')
}

function chapterChildrenToText(section: OutlineSection): string {
  if (!section.children?.length) return section.title
  return section.children.map(child => {
    const grandchildren = child.children?.length
      ? `\n${child.children.map(grandchild => `    ${grandchild.order} ${grandchild.title}`).join('\n')}`
      : ''
    return `  ${child.order} ${child.title}${grandchildren}`
  }).join('\n')
}

export default function Stage3() {
  const navigate = useNavigate()
  const params = useParams()
  const project = projectStore.ensure(params.projectId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasStartedGenerationRef = useRef(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sections, setSections] = useState<DocSection[]>([])
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [inputText, setInputText] = useState('')
  const [mode, setMode] = useState<Mode>('revise')
  const [isLoading, setIsLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [isGeneratingFull, setIsGeneratingFull] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState({ current: 0, total: 0 })
  const [allGenerated, setAllGenerated] = useState(false)
  const [finishResult, setFinishResult] = useState('')
  const [finishLoading, setFinishLoading] = useState(false)
  const [adjustInput, setAdjustInput] = useState('')
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [projectTitle, setProjectTitle] = useState(project.title)

  const academicLevel = normalizeAcademicLevel(project.context.academicLevel)

  const saveStageMessages = useCallback((nextMessages: ChatMessage[]) => {
    chatStore.saveForProject(project.id, 'stage3', nextMessages)
  }, [project.id])

  const startFullGeneration = useCallback(async (outlineSections: OutlineSection[]) => {
    if (hasStartedGenerationRef.current || outlineSections.length === 0) return
    hasStartedGenerationRef.current = true
    setIsGeneratingFull(true)
    setAllGenerated(false)
    setGeneratingProgress({ current: 0, total: outlineSections.length })

    const currentProject = projectStore.ensure(project.id)
    const referenceContext = buildAIContext({ projectId: project.id, stage: 'stage3' })
    const fullOutlineSummary = outlineToText(outlineSections)
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const styleGuide = currentProject.context.stylePreference || undefined
    const generatedSections: DocSection[] = []

    const startMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `已确认大纲，开始按 ${outlineSections.length} 章逐章生成全文。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = prev.length > 0 ? [...prev, startMsg] : [startMsg]
      saveStageMessages(next)
      return next
    })

    for (let index = 0; index < outlineSections.length; index += 1) {
      const chapter = outlineSections[index]
      setGeneratingProgress({ current: index + 1, total: outlineSections.length })

      const section: DocSection = {
        id: `sec_${uid()}`,
        projectId: project.id,
        title: `${chapter.order} ${chapter.title}`,
        content: '',
        status: 'generating',
        lastModified: Date.now(),
        order: index,
      }

      generatedSections.push(section)
      setSections([...generatedSections])
      if (index === 0) setActiveSectionId(section.id)

      await new Promise<void>((resolve) => {
        let fullContent = ''
        const abort = new AbortController()
        abortRef.current = abort

        callGPT(
          promptGenerateChapter(
            `${chapter.order} ${chapter.title}`,
            chapterChildrenToText(chapter),
            fullOutlineSummary,
            comprehensionSummary,
            referenceContext,
            bannedPhrases,
            academicLevel,
            styleGuide
          ),
          {
            onChunk: (chunk) => {
              fullContent += chunk
              setSections(prev => prev.map(item =>
                item.id === section.id ? { ...item, content: fullContent } : item
              ))
            },
            onDone: () => {
              const cleanContent = formatSectionContent(fullContent)
              const doneSection = {
                ...section,
                content: cleanContent,
                status: 'done' as const,
                lastModified: Date.now(),
              }
              generatedSections[index] = doneSection
              setSections(prev => prev.map(item => item.id === section.id ? doneSection : item))
              sectionStore.saveForProject(project.id, generatedSections)
              versionStore.snapshot(`AI 生成：${chapter.title}`, project.id)
              resolve()
            },
            onError: () => {
              const failedSection = { ...section, status: 'pending' as const, lastModified: Date.now() }
              generatedSections[index] = failedSection
              setSections(prev => prev.map(item => item.id === section.id ? failedSection : item))
              resolve()
            },
          },
          abort.signal
        )
      })
    }

    setIsGeneratingFull(false)
    setAllGenerated(true)
    sectionStore.saveForProject(project.id, generatedSections)

    const doneMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `全文已生成完毕，共 ${outlineSections.length} 章。\n\n你可以在右侧直接查看和编辑，或在左侧对具体章节提出修改意见。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = [...prev, doneMsg]
      saveStageMessages(next)
      return next
    })
  }, [academicLevel, project.id, saveStageMessages])

  useEffect(() => {
    const savedMessages = chatStore.getByProject(project.id, 'stage3')
    const savedSections = sectionStore.getByProject(project.id)
    const outline = outlineStore.get(project.id)

    if (savedMessages.length > 0) setMessages(savedMessages)

    if (savedSections.length > 0) {
      const formattedSections = formatSectionsForPaper(savedSections)
      setSections(formattedSections)
      setActiveSectionId(formattedSections[0]?.id ?? null)
      setAllGenerated(formattedSections.every(section => section.status === 'done'))
      hasStartedGenerationRef.current = true
    } else if (outline?.confirmedAt) {
      startFullGeneration(outline.sections)
    } else {
      const waitMsg: ChatMessage = {
        id: 's3_wait_outline',
        role: 'ai',
        content: '还没有确认的大纲。请先回到阶段二生成并确认大纲。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      setMessages([waitMsg])
      saveStageMessages([waitMsg])
    }

    projectStore.update(project.id, { currentStage: 'stage3' })
  }, [project.id, saveStageMessages, startFullGeneration])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (sections.length > 0) {
      sectionStore.saveForProject(project.id, sections)
    }
  }, [project.id, sections])

  const handleReviseMode = useCallback(async (opinion: string, currentMessages: ChatMessage[]) => {
    const activeSection = sections.find(section => section.id === activeSectionId)
    if (!activeSection) {
      const errMsg: ChatMessage = {
        id: `s3_${uid()}`,
        role: 'ai',
        content: '请先在右侧点击要修改的章节，然后再输入修改意见。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage3',
      }
      const next = [...currentMessages, errMsg]
      setMessages(next)
      saveStageMessages(next)
      return
    }

    const aiMsgId = `s3_${uid()}`
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => [...prev, aiMsg])
    setIsLoading(true)
    setStreamingId(aiMsgId)
    setSections(prev => prev.map(section =>
      section.id === activeSectionId ? { ...section, status: 'generating' } : section
    ))

    const referenceContext = buildAIContext({
      projectId: project.id,
      stage: 'stage3',
      userInput: opinion,
      currentSectionId: activeSection.id,
    })
    const bannedPhrases = project.context.bannedPhrases ?? []
    let fullContent = ''
    const abort = new AbortController()
    abortRef.current = abort

    callDoubao(
      promptReviseSection(opinion, activeSection.content, referenceContext, bannedPhrases),
      {
        onChunk: (chunk) => {
          fullContent += chunk
          setSections(prev => prev.map(section =>
            section.id === activeSectionId ? { ...section, content: fullContent } : section
          ))
          setMessages(prev => prev.map(message =>
            message.id === aiMsgId ? { ...message, content: `正在修改「${activeSection.title}」…` } : message
          ))
        },
        onDone: () => {
          const cleanContent = formatSectionContent(fullContent)
          setIsLoading(false)
          setStreamingId(null)
          setSections(prev => prev.map(section =>
            section.id === activeSectionId
              ? { ...section, content: cleanContent, status: 'done', lastModified: Date.now() }
              : section
          ))
          versionStore.snapshot(`按意见修改：${activeSection.title}`, project.id)
          const finalMessages = [...currentMessages, { ...aiMsg, content: `「${activeSection.title}」修改完成。还有需要调整的地方吗？` }]
          setMessages(finalMessages)
          saveStageMessages(finalMessages)
        },
        onError: (err) => {
          setIsLoading(false)
          setStreamingId(null)
          setSections(prev => prev.map(section =>
            section.id === activeSectionId ? { ...section, status: 'done' } : section
          ))
          const errMessages = [...currentMessages, { ...aiMsg, content: `修改失败：${err.message}` }]
          setMessages(errMessages)
          saveStageMessages(errMessages)
        },
      },
      abort.signal
    )
  }, [activeSectionId, project.context.bannedPhrases, project.id, saveStageMessages, sections])

  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading) return
    setInputText('')

    const userMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    saveStageMessages(newMessages)
    await handleReviseMode(text, newMessages)
  }, [handleReviseMode, inputText, isLoading, messages, project.id, saveStageMessages])

  const runFinish = () => {
    const fullText = sectionsToPlainText(sections)
    if (!fullText || finishLoading) return
    setFinishResult('')
    setFinishLoading(true)

    const abort = new AbortController()
    abortRef.current = abort
    let result = ''

    callGPT(
      promptFinishDraft(fullText, project.context.researchObject || projectTitle, academicLevel),
      {
        onChunk: (chunk) => {
          result += chunk
          setFinishResult(result)
        },
        onDone: () => setFinishLoading(false),
        onError: () => setFinishLoading(false),
      },
      abort.signal
    )
  }

  const runAdjust = () => {
    if (!adjustInput.trim() || !finishResult || isAdjusting) return
    setIsAdjusting(true)
    const abort = new AbortController()
    abortRef.current = abort
    let result = ''

    callGPT(
      promptAdjustFinish(finishResult, adjustInput),
      {
        onChunk: (chunk) => {
          result += chunk
          setFinishResult(result)
        },
        onDone: () => {
          setIsAdjusting(false)
          setAdjustInput('')
        },
        onError: () => setIsAdjusting(false),
      },
      abort.signal
    )
  }

  const copyAll = async () => {
    await navigator.clipboard.writeText(sectionsToPlainText(sections))
    alert('全文已复制到剪贴板')
  }

  const exportWord = async () => {
    if (sections.length === 0) return
    const { exportSectionsToDocx } = await import('../lib/docxExport')
    await exportSectionsToDocx(projectTitle, sections)
  }

  const updateProjectTitle = (title: string) => {
    setProjectTitle(title)
    projectStore.update(project.id, { title: title.trim() || '未命名论文' })
  }

  const regenerateFullText = () => {
    const outline = outlineStore.get(project.id)
    if (!outline?.confirmedAt) {
      alert('请先在阶段二确认大纲，再重新生成全文。')
      return
    }
    if (isGeneratingFull) return
    if (sections.length > 0 && !confirm('确认重新生成全文？当前正文会被清空并重新按大纲生成。')) return

    abortRef.current?.abort()
    hasStartedGenerationRef.current = false
    setSections([])
    setActiveSectionId(null)
    setAllGenerated(false)
    setFinishResult('')
    setAdjustInput('')
    setIsLoading(false)
    setStreamingId(null)
    sectionStore.saveForProject(project.id, [])
    startFullGeneration(outline.sections)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const totalChars = sections.reduce((total, section) => total + section.content.replace(/\s/g, '').length, 0)

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <TopBar
          currentStep={2}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setShowReferences(value => !value)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showReferences ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showReferences ? 'var(--color-accent-light)' : 'transparent', color: showReferences ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer' }}
              >
                <BookOpen size={13} />
                引用
              </button>
              <button
                onClick={() => setShowHistory(value => !value)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showHistory ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showHistory ? 'var(--color-accent-light)' : 'transparent', color: showHistory ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer' }}
              >
                <History size={13} />
                版本历史
              </button>
              <button
                onClick={copyAll}
                disabled={sections.length === 0}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: sections.length === 0 ? 'var(--color-ink-3)' : 'var(--color-ink-2)', fontSize: 12, cursor: sections.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                <Copy size={13} />
                复制全文
              </button>
              <button
                onClick={regenerateFullText}
                disabled={isGeneratingFull}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: isGeneratingFull ? 'var(--color-ink-3)' : 'var(--color-ink-2)', fontSize: 12, cursor: isGeneratingFull ? 'not-allowed' : 'pointer' }}
              >
                <RefreshCw size={13} />
                重新生成全文
              </button>
              <button
                onClick={() => navigate(`/projects/${project.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer' }}
              >
                <Download size={13} />
                返回项目
              </button>
            </div>
          }
        />

        {isGeneratingFull && (
          <div style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 100, background: 'var(--color-accent-light)', borderBottom: '1px solid var(--color-border)', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Sparkles size={14} color="var(--color-accent)" />
            <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>
              正在生成第 {generatingProgress.current} / {generatingProgress.total} 章…
            </span>
            <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  background: 'var(--color-accent)',
                  width: `${generatingProgress.total ? (generatingProgress.current / generatingProgress.total) * 100 : 0}%`,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, padding: '0 8px' }}>
              {([
                { key: 'revise', label: '按意见修改' },
                { key: 'finish', label: '收尾生成' },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setMode(tab.key)}
                  style={{ flex: 1, padding: '10px 4px', border: 'none', borderBottom: `2px solid ${mode === tab.key ? 'var(--color-accent)' : 'transparent'}`, background: 'transparent', color: mode === tab.key ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, fontWeight: mode === tab.key ? 500 : 400, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {mode === 'revise' ? (
              <>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!allGenerated && !isGeneratingFull && (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                      全文生成完成后即可开始修改。
                    </div>
                  )}
                  {messages.map(message => (
                    <ChatBubble key={message.id} role={message.role} content={message.content} isStreaming={streamingId === message.id} />
                  ))}
                  <div ref={bottomRef} />
                </div>

                {allGenerated && activeSectionId && (
                  <div style={{ padding: '6px 10px', background: 'var(--color-doubao-light)', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-doubao)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={11} />
                    当前：{sections.find(section => section.id === activeSectionId)?.title?.slice(0, 20)}…
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--color-border)', padding: 10, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    value={inputText}
                    onChange={event => setInputText(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={allGenerated ? '说修改意见，如：这段太口语化，改成学术表达' : '等待全文生成完成…'}
                    rows={3}
                    disabled={!allGenerated || isLoading}
                    style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12, resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box' }}
                    onFocus={event => (event.currentTarget.style.borderColor = 'var(--color-accent)')}
                    onBlur={event => (event.currentTarget.style.borderColor = 'var(--color-border)')}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!allGenerated || isLoading || !inputText.trim()}
                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: allGenerated && !isLoading && inputText.trim() ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: allGenerated && !isLoading && inputText.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    {isLoading ? <><Sparkles size={13} /> 修改中…</> : <><Send size={13} /> 提交修改</>}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                  基于完整正文，生成摘要、关键词、引言和结语。
                </div>
                <button
                  onClick={runFinish}
                  disabled={!allGenerated || finishLoading}
                  style={{ width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: allGenerated && !finishLoading ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', padding: '9px 0', fontSize: 12, fontWeight: 500, cursor: allGenerated && !finishLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Sparkles size={13} />
                  {finishLoading ? '生成中…' : '生成摘要 / 引言 / 结语'}
                </button>

                {finishResult && (
                  <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{finishLoading ? '生成中…' : '生成完成 ✓'}</span>
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(finishResult)
                          alert('已复制')
                        }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 11 }}
                      >
                        复制
                      </button>
                    </div>
                    <div style={{ padding: 12, fontSize: 12, lineHeight: 1.9, color: 'var(--color-ink-2)', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                      {finishResult}
                    </div>
                    {!finishLoading && (
                      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)' }}>
                        <textarea
                          value={adjustInput}
                          onChange={event => setAdjustInput(event.target.value)}
                          placeholder="追加调整，如：摘要简短一点、结语别拔高…"
                          rows={2}
                          style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: 11, resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box' }}
                        />
                        <button
                          onClick={runAdjust}
                          disabled={!adjustInput.trim() || isAdjusting}
                          style={{ marginTop: 6, width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: adjustInput.trim() && !isAdjusting ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', padding: '7px 0', fontSize: 11, cursor: adjustInput.trim() && !isAdjusting ? 'pointer' : 'not-allowed' }}
                        >
                          {isAdjusting ? '调整中…' : '提交调整'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0 16px', height: 44, borderBottom: '1px solid var(--color-border)', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <input
                value={projectTitle}
                onChange={event => updateProjectTitle(event.target.value)}
                placeholder="输入论文标题…"
                title="点击修改论文名称"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  borderBottom: '1px dashed var(--color-border-strong)',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                  fontWeight: 500,
                  padding: '3px 0',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                {sections.filter(section => section.status === 'done').length} / {sections.length} 章已完成
              </span>
            </div>
            <DocumentToolbar
              onCopy={copyAll}
              onExportWord={exportWord}
              disabled={sections.length === 0}
            />

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              <DocArea
                projectId={project.id}
                sections={sections}
                activeSectionId={activeSectionId}
                onSectionClick={id => setActiveSectionId(id)}
                onSectionChange={(id, content) => {
                  setSections(prev => prev.map(section =>
                    section.id === id ? { ...section, content, status: 'done', lastModified: Date.now() } : section
                  ))
                }}
                onGenerateSection={() => {}}
              />

              {showHistory && (
                <VersionPanel
                  projectId={project.id}
                  onClose={() => setShowHistory(false)}
                  onRestore={(snapshot) => {
                    const restoredSections = snapshot.sections.map(section => ({ ...section, projectId: project.id }))
                    setSections(restoredSections)
                    versionStore.restore(snapshot, project.id)
                  }}
                />
              )}
            </div>

            <div style={{ padding: '5px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 5 }}>
                {allGenerated ? <><CheckCircle2 size={11} /> 全文已生成，可继续修改</> : isGeneratingFull ? '正在生成全文…' : '● 等待确认大纲'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                {totalChars} 字
              </span>
            </div>
          </div>
        </div>
      </div>

      <ReferencePanel
        projectId={project.id}
        stage="stage3"
        open={showReferences}
        onClose={() => setShowReferences(false)}
      />
    </div>
  )
}
