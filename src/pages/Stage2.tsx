import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, Edit2, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import ChatBubble from '../components/ChatBubble'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { callGPT } from '../lib/ai'
import { promptGenerateOutline, promptReviseOutline, type AcademicLevel } from '../lib/prompts'
import {
  chatStore,
  outlineStore,
  projectStore,
  type ChatMessage,
  type Outline,
  type OutlineSection,
} from '../lib/storage'

const uid = () => Math.random().toString(36).slice(2, 9)

const normalizeAcademicLevel = (level: string): AcademicLevel => {
  return level === '硕士' || level === '期刊' ? level : '本科'
}

const cleanJSON = (content: string) => {
  const withoutFence = content.replace(/```json|```/g, '').trim()
  const match = withoutFence.match(/\{[\s\S]*\}/)
  return match ? match[0] : withoutFence
}

function outlineToText(sections: OutlineSection[], depth = 0): string {
  return sections.map(section => {
    const indent = '  '.repeat(depth)
    const children = section.children ? outlineToText(section.children, depth + 1) : ''
    return `${indent}${section.order} ${section.title}${children ? `\n${children}` : ''}`
  }).join('\n')
}

function addIds(sections: OutlineSection[]): OutlineSection[] {
  return sections.map(section => ({
    ...section,
    id: section.id || uid(),
    level: section.level,
    children: section.children ? addIds(section.children) : undefined,
  }))
}

function countSections(sections: OutlineSection[]): number {
  return sections.reduce((total, section) => total + 1 + (section.children ? countSections(section.children) : 0), 0)
}

function OutlineNode({
  section,
  onEdit,
  onDelete,
  onAddChild,
}: {
  section: OutlineSection
  onEdit: (id: string, newTitle: string) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(section.title)
  const hasChildren = Boolean(section.children?.length)
  const levelStyle: Record<number, CSSProperties> = {
    1: { fontSize: 15, fontWeight: 650, color: 'var(--color-ink)', paddingLeft: 0 },
    2: { fontSize: 13, fontWeight: 500, color: 'var(--color-ink-2)', paddingLeft: 16 },
    3: { fontSize: 12, fontWeight: 400, color: 'var(--color-ink-3)', paddingLeft: 32 },
  }

  const commitEdit = () => {
    const nextTitle = editValue.trim()
    if (nextTitle && nextTitle !== section.title) {
      onEdit(section.id, nextTitle)
    } else {
      setEditValue(section.title)
    }
    setEditing(false)
  }

  return (
    <div style={{ marginBottom: section.level === 1 ? 12 : 4 }}>
      <div
        className="outline-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 'var(--radius-sm)',
          ...(levelStyle[section.level] ?? levelStyle[3]),
        }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(value => !value)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 0, display: 'flex' }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span style={{ width: 13 }} />
        )}

        <span style={{ color: 'var(--color-ink-3)', fontSize: 11, flexShrink: 0, minWidth: 36 }}>
          {section.order}
        </span>

        {editing ? (
          <input
            autoFocus
            value={editValue}
            onChange={event => setEditValue(event.target.value)}
            onBlur={commitEdit}
            onKeyDown={event => {
              if (event.key === 'Enter') commitEdit()
              if (event.key === 'Escape') {
                setEditValue(section.title)
                setEditing(false)
              }
            }}
            style={{
              flex: 1,
              border: '1px solid var(--color-accent)',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 'inherit',
              fontFamily: 'var(--font-sans)',
              outline: 'none',
              background: 'var(--color-bg)',
            }}
          />
        ) : (
          <span style={{ flex: 1 }}>{section.title}</span>
        )}

        <div className="outline-actions" style={{ display: 'flex', gap: 3, opacity: 0, transition: 'opacity 0.1s' }}>
          <button
            onClick={() => setEditing(true)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 2, display: 'flex' }}
          >
            <Edit2 size={11} />
          </button>
          {section.level < 3 && (
            <button
              onClick={() => onAddChild(section.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 2, display: 'flex' }}
            >
              <Plus size={11} />
            </button>
          )}
          <button
            onClick={() => onDelete(section.id)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', padding: 2, display: 'flex' }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {section.children!.map(child => (
            <OutlineNode
              key={child.id}
              section={child}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Stage2() {
  const navigate = useNavigate()
  const params = useParams()
  const project = projectStore.ensure(params.projectId)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [outline, setOutline] = useState<Outline | null>(null)
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [projectTitle, setProjectTitle] = useState(project.title)

  const academicLevel = normalizeAcademicLevel(project.context.academicLevel)

  const saveStageMessages = useCallback((nextMessages: ChatMessage[]) => {
    chatStore.saveForProject(project.id, 'stage2', nextMessages.map(message => ({
      ...message,
      flow: 'outline',
    })))
  }, [project.id])

  const autoGenerateOutline = useCallback(() => {
    const existingOutline = outlineStore.get(project.id)
    if (existingOutline) {
      setOutline(existingOutline)
      return
    }

    const comprehensionSummary = project.context.rawSummary
    if (!comprehensionSummary || isGenerating) return

    setIsGenerating(true)

    const thinkingMsg: ChatMessage = {
      id: `s2_${uid()}`,
      role: 'ai',
      content: '正在根据你的论文背景生成大纲，请稍候…',
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage2',
      flow: 'outline',
    }

    setMessages(prev => [...prev, thinkingMsg])

    let jsonContent = ''
    const abort = new AbortController()
    abortRef.current = abort

    callGPT(
      promptGenerateOutline(comprehensionSummary, academicLevel),
      {
        onChunk: (chunk) => {
          jsonContent += chunk
        },
        onDone: () => {
          setIsGenerating(false)
          try {
            const parsed = JSON.parse(cleanJSON(jsonContent))
            const newOutline: Outline = {
              projectId: project.id,
              sections: addIds(parsed.sections ?? []),
              updatedAt: Date.now(),
            }
            setOutline(newOutline)
            outlineStore.save(newOutline)

            const doneMsg: ChatMessage = {
              id: `s2_${uid()}`,
              role: 'ai',
              content: `大纲已生成，共 ${countSections(newOutline.sections)} 个标题节点。\n\n你可以直接在右侧点击标题进行编辑，或者在这里告诉我需要调整的地方。确认后点击右下角「进入全文生成」。`,
              timestamp: Date.now(),
              projectId: project.id,
              stage: 'stage2',
              flow: 'outline',
            }
            setMessages(prev => {
              const next = [...prev.filter(message => message.id !== thinkingMsg.id), doneMsg]
              saveStageMessages(next)
              return next
            })
          } catch {
            const errMsg: ChatMessage = {
              id: `s2_${uid()}`,
              role: 'ai',
              content: '大纲生成失败，请重试，或先补充更清晰的论文背景。',
              timestamp: Date.now(),
              projectId: project.id,
              stage: 'stage2',
              flow: 'outline',
            }
            setMessages(prev => {
              const next = [...prev.filter(message => message.id !== thinkingMsg.id), errMsg]
              saveStageMessages(next)
              return next
            })
          }
        },
        onError: (err) => {
          setIsGenerating(false)
          const errMsg: ChatMessage = {
            id: `s2_${uid()}`,
            role: 'ai',
            content: `大纲生成出错：${err.message}`,
            timestamp: Date.now(),
            projectId: project.id,
            stage: 'stage2',
            flow: 'outline',
          }
          setMessages(prev => {
            const next = [...prev.filter(message => message.id !== thinkingMsg.id), errMsg]
            saveStageMessages(next)
            return next
          })
        },
      },
      abort.signal
    )
  }, [academicLevel, isGenerating, project.context.rawSummary, project.id, saveStageMessages])

  useEffect(() => {
    const savedMsgs = chatStore.getByProject(project.id, 'stage2').filter(message => message.flow === 'outline')
    const savedOutline = outlineStore.get(project.id)

    if (savedMsgs.length > 0) {
      setMessages(savedMsgs)
    } else {
      const welcome: ChatMessage = {
        id: 's2_welcome',
        role: 'ai',
        content: '已完成材料理解。我将根据你的论文背景生成完整大纲，你可以在右侧直接编辑标题，也可以在这里告诉我需要调整的地方。',
        timestamp: Date.now(),
        projectId: project.id,
        stage: 'stage2',
        flow: 'outline',
      }
      setMessages([welcome])
      saveStageMessages([welcome])
    }

    if (savedOutline) {
      setOutline(savedOutline)
    }

    setInitialLoadDone(true)
    projectStore.update(project.id, { currentStage: 'stage2' })
  }, [project.id, saveStageMessages])

  useEffect(() => {
    if (initialLoadDone && !outline && !isGenerating && project.context.rawSummary) {
      autoGenerateOutline()
    }
  }, [autoGenerateOutline, initialLoadDone, isGenerating, outline, project.context.rawSummary])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading || !outline) return
    setInputText('')

    const userMsg: ChatMessage = {
      id: `s2_${uid()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage2',
      flow: 'outline',
    }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    saveStageMessages(newMessages)

    const aiMsgId = `s2_${uid()}`
    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: 'ai',
      content: '',
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage2',
      flow: 'outline',
    }
    setMessages(prev => [...prev, aiMsg])
    setIsLoading(true)

    let jsonContent = ''
    const abort = new AbortController()
    abortRef.current = abort
    const currentOutlineJSON = JSON.stringify({ sections: outline.sections }, null, 2)

    callGPT(
      promptReviseOutline(currentOutlineJSON, text, project.context.rawSummary),
      {
        onChunk: (chunk) => {
          jsonContent += chunk
          setMessages(prev => prev.map(message =>
            message.id === aiMsgId ? { ...message, content: '正在调整大纲…' } : message
          ))
        },
        onDone: () => {
          setIsLoading(false)
          try {
            const parsed = JSON.parse(cleanJSON(jsonContent))
            const updatedOutline: Outline = {
              ...outline,
              sections: addIds(parsed.sections ?? []),
              updatedAt: Date.now(),
            }
            setOutline(updatedOutline)
            outlineStore.save(updatedOutline)

            const finalMessages = [...newMessages, { ...aiMsg, content: '大纲已更新，请在右侧查看。还有需要调整的地方吗？' }]
            setMessages(finalMessages)
            saveStageMessages(finalMessages)
          } catch {
            const errMessages = [...newMessages, { ...aiMsg, content: '调整失败，请重新描述你的需求。' }]
            setMessages(errMessages)
            saveStageMessages(errMessages)
          }
        },
        onError: (err) => {
          setIsLoading(false)
          const errMessages = [...newMessages, { ...aiMsg, content: `出错了：${err.message}` }]
          setMessages(errMessages)
          saveStageMessages(errMessages)
        },
      },
      abort.signal
    )
  }, [inputText, isLoading, messages, outline, project.context.rawSummary, project.id, saveStageMessages])

  const saveOutline = (nextSections: OutlineSection[]) => {
    if (!outline) return
    const updated = { ...outline, sections: nextSections, updatedAt: Date.now() }
    setOutline(updated)
    outlineStore.save(updated)
  }

  const handleEditTitle = (id: string, newTitle: string) => {
    if (!outline) return
    const editNode = (sections: OutlineSection[]): OutlineSection[] => {
      return sections.map(section => {
        if (section.id === id) return { ...section, title: newTitle }
        if (section.children) return { ...section, children: editNode(section.children) }
        return section
      })
    }
    saveOutline(editNode(outline.sections))
  }

  const handleDeleteNode = (id: string) => {
    if (!outline) return
    const deleteNode = (sections: OutlineSection[]): OutlineSection[] => {
      return sections
        .filter(section => section.id !== id)
        .map(section => section.children ? { ...section, children: deleteNode(section.children) } : section)
    }
    saveOutline(deleteNode(outline.sections))
  }

  const handleAddChild = (parentId: string) => {
    if (!outline) return
    const addChild = (sections: OutlineSection[]): OutlineSection[] => {
      return sections.map(section => {
        if (section.id === parentId) {
          const level = Math.min(section.level + 1, 3) as 1 | 2 | 3
          const child: OutlineSection = {
            id: uid(),
            level,
            title: '新章节',
            order: `${section.order}.${(section.children?.length ?? 0) + 1}`,
          }
          return { ...section, children: [...(section.children ?? []), child] }
        }
        if (section.children) return { ...section, children: addChild(section.children) }
        return section
      })
    }
    saveOutline(addChild(outline.sections))
  }

  const confirmOutline = () => {
    if (!outline) return
    outlineStore.confirm(project.id)
    navigate(`/projects/${project.id}/stage3`)
  }

  const handleRegenerate = () => {
    if (!confirm('确认重新生成大纲？当前大纲会被清空。')) return
    outlineStore.clear(project.id)
    setOutline(null)
    autoGenerateOutline()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const updateProjectTitle = (title: string) => {
    setProjectTitle(title)
    projectStore.update(project.id, { title: title.trim() || '未命名论文' })
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar currentStep={1} />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BookOpen size={14} />
                大纲调整
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 2 }}>告诉我需要修改哪里，或直接在右侧编辑标题</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.map(message => (
                <ChatBubble key={message.id} role={message.role} content={message.content} isStreaming={false} />
              ))}
              <div ref={bottomRef} />
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', padding: 10, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                value={inputText}
                onChange={event => setInputText(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="如：第二章加一节关于 TAM 模型、把第三章拆成两章…"
                rows={3}
                disabled={isLoading || isGenerating || !outline}
                style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', fontSize: 12, resize: 'none', fontFamily: 'var(--font-sans)', outline: 'none', boxSizing: 'border-box' }}
                onFocus={event => (event.currentTarget.style.borderColor = 'var(--color-accent)')}
                onBlur={event => (event.currentTarget.style.borderColor = 'var(--color-border)')}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleRegenerate}
                  disabled={isLoading || isGenerating}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-ink-3)', fontSize: 12, cursor: isLoading || isGenerating ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
                >
                  <RefreshCw size={12} />
                  重新生成
                </button>
                <button
                  onClick={sendMessage}
                  disabled={isLoading || isGenerating || !inputText.trim() || !outline}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '7px 0', border: 'none', borderRadius: 'var(--radius-sm)', background: isLoading || isGenerating || !inputText.trim() || !outline ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', fontSize: 12, cursor: isLoading || isGenerating || !inputText.trim() || !outline ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
                >
                  <Send size={12} />
                  {isLoading ? '调整中…' : '发送'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '0 20px', height: 48, borderBottom: '1px solid var(--color-border)', background: '#FBFAF7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
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
              <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
                {outline ? `共 ${outline.sections.length} 章 · ${countSections(outline.sections)} 个标题节点` : '生成中…'}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
              {isGenerating ? (
                <div style={{ color: 'var(--color-ink-3)', fontSize: 13, lineHeight: 2 }}>
                  正在生成大纲，请稍候…
                </div>
              ) : outline ? (
                <>
                  <style>{`
                    .outline-row:hover { background: var(--color-bg); }
                    .outline-row:hover .outline-actions { opacity: 1 !important; }
                  `}</style>
                  {outline.sections.map(section => (
                    <OutlineNode
                      key={section.id}
                      section={section}
                      onEdit={handleEditTitle}
                      onDelete={handleDeleteNode}
                      onAddChild={handleAddChild}
                    />
                  ))}
                </>
              ) : (
                <div style={{ color: 'var(--color-ink-3)', fontSize: 13, lineHeight: 1.8 }}>
                  还没有大纲内容。请确认阶段一已完成材料理解，或点击左侧重新生成。
                </div>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--color-ink-3)', whiteSpace: 'pre-wrap' }}>
                {outline ? `确认大纲后，AI 将按大纲逐章生成正文。\n${outlineToText(outline.sections).slice(0, 90)}${outlineToText(outline.sections).length > 90 ? '…' : ''}` : '等待大纲生成'}
              </span>
              <button
                onClick={confirmOutline}
                disabled={!outline || isGenerating}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', border: 'none', borderRadius: 'var(--radius-md)', background: !outline || isGenerating ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: !outline || isGenerating ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
              >
                进入全文生成
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
