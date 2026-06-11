import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BookOpen, ChevronDown, ChevronRight, Edit2, GripVertical, History, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import ChatBubble from '../components/ChatBubble'
import MentionInput, { type MentionRef } from '../components/MentionInput'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import VersionPanel from '../components/VersionPanel'
import { callGPT } from '../lib/ai'
import { buildMentionContext } from '../lib/context'
import { promptGenerateOutline, promptReviseOutline, type AcademicLevel } from '../lib/prompts'
import {
  chatStore,
  outlineStore,
  projectStore,
  versionStore,
  type ChatMessage,
  type Outline,
  type OutlineSection,
  type Project,
} from '../lib/storage'

const uid = () => Math.random().toString(36).slice(2, 9)
type DropPosition = 'before' | 'after' | 'inside'

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

function normalizeTitleKey(title: string): string {
  return title.replace(/\s+/g, '').toLowerCase()
}

function mergeOutlineIds(nextSections: OutlineSection[], previousSections: OutlineSection[]): OutlineSection[] {
  return nextSections.map(section => {
    const match = section.id
      ? findNodeInfo(previousSections, section.id)?.node
      : previousSections.find(item =>
        item.order === section.order ||
        normalizeTitleKey(item.title) === normalizeTitleKey(section.title)
      )

    return {
      ...section,
      id: match?.id ?? section.id ?? uid(),
      children: section.children?.length
        ? mergeOutlineIds(section.children, match?.children ?? [])
        : undefined,
    }
  })
}

function countSections(sections: OutlineSection[]): number {
  return sections.reduce((total, section) => total + 1 + (section.children ? countSections(section.children) : 0), 0)
}

function isAbstractOutlineSection(section: OutlineSection): boolean {
  return section.order === '0' || /^(摘要|abstract|中英文摘要)/i.test(section.title.trim())
}

function createAbstractOutlineSection(): OutlineSection {
  return {
    id: uid(),
    order: '0',
    level: 1,
    title: '摘要',
  }
}

function ensureAbstractOutlineSection(sections: OutlineSection[]): OutlineSection[] {
  const abstractSection = sections.find(isAbstractOutlineSection)
  const bodySections = sections.filter(section => !isAbstractOutlineSection(section))
  return [
    {
      ...(abstractSection ?? createAbstractOutlineSection()),
      order: '0',
      level: 1,
      title: '摘要',
      children: undefined,
    },
    ...renumberOutline(bodySections),
  ]
}

function renumberOutline(sections: OutlineSection[], parentOrder = ''): OutlineSection[] {
  if (!parentOrder && sections.some(isAbstractOutlineSection)) {
    return ensureAbstractOutlineSection(sections)
  }

  return sections.map((section, index) => {
    const order = parentOrder ? `${parentOrder}.${index + 1}` : `${index + 1}`
    const level = Math.min(order.split('.').length, 3) as 1 | 2 | 3
    return {
      ...section,
      order,
      level,
      children: section.children?.length ? renumberOutline(section.children, order) : undefined,
    }
  })
}

function getTreeDepth(section: OutlineSection): number {
  if (!section.children?.length) return 1
  return 1 + Math.max(...section.children.map(getTreeDepth))
}

function containsNode(section: OutlineSection, id: string): boolean {
  if (section.id === id) return true
  return section.children?.some(child => containsNode(child, id)) ?? false
}

function findNodeInfo(
  sections: OutlineSection[],
  id: string,
  path: number[] = []
): { node: OutlineSection; path: number[] } | null {
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]
    const nextPath = [...path, index]
    if (section.id === id) return { node: section, path: nextPath }
    const childResult = section.children ? findNodeInfo(section.children, id, nextPath) : null
    if (childResult) return childResult
  }
  return null
}

function removeNodeById(
  sections: OutlineSection[],
  id: string
): { sections: OutlineSection[]; node: OutlineSection | null } {
  let removed: OutlineSection | null = null

  const nextSections = sections
    .filter(section => {
      if (section.id !== id) return true
      removed = section
      return false
    })
    .map(section => {
      if (removed || !section.children?.length) return section
      const childResult = removeNodeById(section.children, id)
      removed = childResult.node
      return { ...section, children: childResult.sections }
    })

  return { sections: nextSections, node: removed }
}

function insertNodeAtTarget(
  sections: OutlineSection[],
  targetId: string,
  node: OutlineSection,
  position: DropPosition
): { sections: OutlineSection[]; inserted: boolean } {
  const nextSections: OutlineSection[] = []
  let inserted = false

  sections.forEach(section => {
    if (section.id === targetId) {
      if (position === 'before') {
        nextSections.push(node, section)
      } else if (position === 'after') {
        nextSections.push(section, node)
      } else {
        nextSections.push({
          ...section,
          children: [...(section.children ?? []), node],
        })
      }
      inserted = true
      return
    }

    if (section.children?.length) {
      const childResult = insertNodeAtTarget(section.children, targetId, node, position)
      if (childResult.inserted) {
        nextSections.push({ ...section, children: childResult.sections })
        inserted = true
        return
      }
    }

    nextSections.push(section)
  })

  return { sections: nextSections, inserted }
}

function moveOutlineNode(
  sections: OutlineSection[],
  dragId: string,
  targetId: string,
  position: DropPosition
): { sections: OutlineSection[]; error?: string } {
  if (dragId === targetId) return { sections }

  const dragInfo = findNodeInfo(sections, dragId)
  const targetInfo = findNodeInfo(sections, targetId)
  if (!dragInfo || !targetInfo) return { sections, error: '没有找到要移动的大纲标题。' }
  if (containsNode(dragInfo.node, targetId)) {
    return { sections, error: '不能把标题拖进自己的子标题里。' }
  }

  const targetDepth = targetInfo.path.length
  const nextRootDepth = position === 'inside' ? targetDepth + 1 : targetDepth
  if (nextRootDepth + getTreeDepth(dragInfo.node) - 1 > 3) {
    return { sections, error: '当前大纲最多支持三级标题，移动后会超过三级。' }
  }

  const removed = removeNodeById(sections, dragId)
  if (!removed.node) return { sections, error: '移动失败，请重试。' }

  const inserted = insertNodeAtTarget(removed.sections, targetId, removed.node, position)
  if (!inserted.inserted) return { sections, error: '没有找到目标位置。' }
  return { sections: inserted.sections }
}

function hasOutlineContent(outline: Outline | null): outline is Outline {
  return Boolean(outline?.sections?.length)
}

function extractLineValue(content: string, label: string): string {
  const match = content.match(new RegExp(`${label}[:：]\\s*([^\\n]+)`))
  return match?.[1]?.trim() ?? ''
}

function getOutlineSource(project: Project): {
  summary: string
  academicLevel: AcademicLevel
  title?: string
  researchObject?: string
  writingBoundary?: string
  rawAcademicLevel?: string
} {
  if (project.context.rawSummary) {
    return {
      summary: project.context.rawSummary,
      academicLevel: normalizeAcademicLevel(project.context.academicLevel),
    }
  }

  const completedMessage = [...chatStore.getByProject(project.id, 'stage1')]
    .reverse()
    .find(message => message.role === 'ai' && message.content.includes('【理解完成'))

  if (!completedMessage) {
    return { summary: '', academicLevel: normalizeAcademicLevel(project.context.academicLevel) }
  }

  const researchObject = extractLineValue(completedMessage.content, '研究对象')
  const writingBoundary = extractLineValue(completedMessage.content, '写作边界')
  const academicLevel = extractLineValue(completedMessage.content, '学段判断') || extractLineValue(completedMessage.content, '学段')
  const coreClaims = extractLineValue(completedMessage.content, '核心论点')
  const title = extractLineValue(completedMessage.content, '论文标题')
  const summary = [
    researchObject ? `研究对象：${researchObject}` : '',
    writingBoundary ? `写作边界：${writingBoundary}` : '',
    academicLevel ? `学段：${academicLevel}` : '',
    coreClaims ? `核心论点：${coreClaims}` : '',
  ].filter(Boolean).join('\n')

  return {
    summary,
    academicLevel: normalizeAcademicLevel(academicLevel || project.context.academicLevel),
    title,
    researchObject,
    writingBoundary,
    rawAcademicLevel: academicLevel,
  }
}

const OutlineNode = memo(function OutlineNode({
  section,
  onEdit,
  onDelete,
  onAddChild,
  onMove,
}: {
  section: OutlineSection
  onEdit: (id: string, newTitle: string) => void
  onDelete: (id: string) => void
  onAddChild: (parentId: string) => void
  onMove: (dragId: string, targetId: string, position: DropPosition) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(section.title)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
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

  const getDropPosition = (event: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    if (offsetY < rect.height * 0.28) return 'before'
    if (offsetY > rect.height * 0.72) return 'after'
    return section.level < 3 ? 'inside' : 'after'
  }

  return (
    <div style={{ marginBottom: section.level === 1 ? 12 : 4 }}>
      <div
        className="outline-row"
        onDragOver={event => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropPosition(getDropPosition(event))
        }}
        onDragLeave={() => setDropPosition(null)}
        onDrop={event => {
          event.preventDefault()
          const dragId = event.dataTransfer.getData('text/plain')
          if (dragId) onMove(dragId, section.id, dropPosition ?? getDropPosition(event))
          setDropPosition(null)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 'var(--radius-sm)',
          boxShadow: dropPosition === 'before'
            ? 'inset 0 2px 0 var(--color-accent)'
            : dropPosition === 'after'
              ? 'inset 0 -2px 0 var(--color-accent)'
              : dropPosition === 'inside'
                ? 'inset 0 0 0 1px var(--color-accent)'
                : 'none',
          background: dropPosition === 'inside' ? 'var(--color-accent-light)' : undefined,
          ...(levelStyle[section.level] ?? levelStyle[3]),
        }}
      >
        <span
          draggable={!editing}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', section.id)
          }}
          title="拖拽移动整段大纲"
          style={{ display: 'flex', color: 'var(--color-ink-3)', cursor: editing ? 'default' : 'grab' }}
        >
          <GripVertical size={13} />
        </span>

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
          <span
            onClick={() => setEditing(true)}
            title="点击编辑标题"
            style={{ flex: 1, cursor: 'text', minHeight: 22, display: 'inline-flex', alignItems: 'center' }}
          >
            {section.title}
          </span>
        )}

        <div className="outline-actions" style={{ display: 'flex', gap: 3, opacity: 0.35, transition: 'opacity 0.1s' }}>
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
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  )
})

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
  const [mentions, setMentions] = useState<MentionRef[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const outlineSource = useMemo(() => getOutlineSource(project), [project])
  const canGenerateOutline = Boolean(outlineSource.summary)
  const outlineNodeCount = useMemo(
    () => hasOutlineContent(outline) ? countSections(outline.sections) : 0,
    [outline]
  )
  const outlinePreview = useMemo(() => {
    if (!hasOutlineContent(outline)) return ''
    const text = outlineToText(outline.sections)
    return `${text.slice(0, 90)}${text.length > 90 ? '…' : ''}`
  }, [outline])

  const saveStageMessages = useCallback((nextMessages: ChatMessage[]) => {
    chatStore.saveForProject(project.id, 'stage2', nextMessages.map(message => ({
      ...message,
      flow: 'outline',
    })))
  }, [project.id])

  useEffect(() => {
    if (!project.context.rawSummary && outlineSource.summary) {
      projectStore.update(project.id, {
        title: outlineSource.title || project.title,
        context: {
          ...project.context,
          researchObject: outlineSource.researchObject || project.context.researchObject,
          writingBoundary: outlineSource.writingBoundary || project.context.writingBoundary,
          academicLevel: outlineSource.rawAcademicLevel || project.context.academicLevel,
          rawSummary: outlineSource.summary,
        },
      })
      if (outlineSource.title) queueMicrotask(() => setProjectTitle(outlineSource.title!))
    }
  }, [outlineSource, project.context, project.id, project.title])

  const autoGenerateOutline = useCallback((force = false) => {
    const existingOutline = outlineStore.get(project.id)
    if (!force && hasOutlineContent(existingOutline)) {
      const normalizedOutline = {
        ...existingOutline,
        sections: ensureAbstractOutlineSection(existingOutline.sections),
      }
      setOutline(normalizedOutline)
      if (normalizedOutline.sections !== existingOutline.sections) {
        outlineStore.save(normalizedOutline)
      }
      return
    }

    const source = getOutlineSource(projectStore.ensure(project.id))
    const comprehensionSummary = source.summary
    if (!comprehensionSummary || isGenerating) {
      if (!comprehensionSummary) {
        const errMsg: ChatMessage = {
          id: `s2_${uid()}`,
          role: 'ai',
          content: '还没有足够的材料理解信息。请先回到阶段一完成研究对象、写作边界和学段确认。',
          timestamp: Date.now(),
          projectId: project.id,
          stage: 'stage2',
          flow: 'outline',
        }
        setMessages(prev => {
          const next = [...prev, errMsg]
          saveStageMessages(next)
          return next
        })
      }
      return
    }

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
      promptGenerateOutline(comprehensionSummary, source.academicLevel),
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
              sections: ensureAbstractOutlineSection(addIds(parsed.sections ?? [])),
              updatedAt: Date.now(),
            }
            setOutline(newOutline)
            outlineStore.save(newOutline)
            versionStore.snapshotOutline('AI 生成大纲', newOutline)

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
  }, [isGenerating, project.id, saveStageMessages])

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return

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

      if (hasOutlineContent(savedOutline)) {
        const normalizedOutline = {
          ...savedOutline,
          sections: ensureAbstractOutlineSection(savedOutline.sections),
        }
        setOutline(normalizedOutline)
        if (normalizedOutline.sections !== savedOutline.sections) {
          outlineStore.save(normalizedOutline)
        }
      }

      setInitialLoadDone(true)
      projectStore.update(project.id, { currentStage: 'stage2' })
    })

    return () => {
      cancelled = true
    }
  }, [project.id, saveStageMessages])

  useEffect(() => {
    if (initialLoadDone && !hasOutlineContent(outline) && !isGenerating && canGenerateOutline) {
      queueMicrotask(() => autoGenerateOutline(true))
    }
  }, [autoGenerateOutline, canGenerateOutline, initialLoadDone, isGenerating, outline])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading || !outline) return
    setInputText('')
    const mentionContext = buildMentionContext(mentions)
    setMentions([])

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
    const revisionContext = [project.context.rawSummary, mentionContext].filter(Boolean).join('\n\n---\n\n')

    callGPT(
      promptReviseOutline(currentOutlineJSON, text, revisionContext),
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
              sections: ensureAbstractOutlineSection(mergeOutlineIds(addIds(parsed.sections ?? []), outline.sections)),
              updatedAt: Date.now(),
            }
            setOutline(updatedOutline)
            outlineStore.save(updatedOutline)
            versionStore.snapshotOutline('AI 调整大纲', updatedOutline)

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
  }, [inputText, isLoading, mentions, messages, outline, project.context.rawSummary, project.id, saveStageMessages])

  const saveOutline = useCallback((nextSections: OutlineSection[], description = '手动编辑大纲') => {
    if (!outline) return
    const updated = {
      ...outline,
      sections: ensureAbstractOutlineSection(renumberOutline(nextSections)),
      updatedAt: Date.now(),
    }
    setOutline(updated)
    outlineStore.save(updated)
    versionStore.snapshotOutline(description, updated)
  }, [outline])

  const handleEditTitle = useCallback((id: string, newTitle: string) => {
    if (!outline) return
    const editNode = (sections: OutlineSection[]): OutlineSection[] => {
      return sections.map(section => {
        if (section.id === id) return { ...section, title: newTitle }
        if (section.children) return { ...section, children: editNode(section.children) }
        return section
      })
    }
    saveOutline(editNode(outline.sections), '修改大纲标题')
  }, [outline, saveOutline])

  const handleDeleteNode = useCallback((id: string) => {
    if (!outline) return
    if (!confirm('确认删除这个大纲标题及其子标题？')) return
    const deleteNode = (sections: OutlineSection[]): OutlineSection[] => {
      return sections
        .filter(section => section.id !== id)
        .map(section => section.children ? { ...section, children: deleteNode(section.children) } : section)
    }
    saveOutline(deleteNode(outline.sections), '删除大纲标题')
  }, [outline, saveOutline])

  const handleAddChild = useCallback((parentId: string) => {
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
    saveOutline(addChild(outline.sections), '新增子标题')
  }, [outline, saveOutline])

  const handleMoveNode = useCallback((dragId: string, targetId: string, position: DropPosition) => {
    if (!outline) return
    const result = moveOutlineNode(outline.sections, dragId, targetId, position)
    if (result.error) {
      alert(result.error)
      return
    }
    saveOutline(result.sections, '拖拽调整大纲结构')
  }, [outline, saveOutline])

  const handleAddRootSection = () => {
    if (!outline) return
    const section: OutlineSection = {
      id: uid(),
      level: 1,
      title: '新章节',
      order: `${outline.sections.filter(section => !isAbstractOutlineSection(section)).length + 1}`,
      children: [],
    }
    saveOutline([...outline.sections, section], '新增一级标题')
  }

  const confirmOutline = () => {
    if (!hasOutlineContent(outline)) return
    outlineStore.confirm(project.id)
    sessionStorage.setItem(`outline_to_draft_transition_${project.id}`, String(Date.now()))
    navigate(`/projects/${project.id}/stage3?transition=outline`, { state: { fromOutline: true } })
  }

  const handleRegenerate = () => {
    if (hasOutlineContent(outline) && !confirm('确认重新生成大纲？当前大纲会被清空。')) return
    outlineStore.clear(project.id)
    setOutline(null)
    autoGenerateOutline(true)
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
        <TopBar
          currentStep={1}
          right={
            <button
              onClick={() => setShowHistory(value => !value)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: `1px solid ${showHistory ? 'var(--color-accent)' : 'var(--color-border)'}`, background: showHistory ? 'var(--color-accent-light)' : 'transparent', color: showHistory ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 12, cursor: 'pointer' }}
            >
              <History size={13} />
              版本历史
            </button>
          }
        />

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
              <MentionInput
                value={inputText}
                onChange={setInputText}
                mentions={mentions}
                onMentionsChange={setMentions}
                onKeyDown={handleKeyDown}
                placeholder="如：第二章加一节关于 TAM 模型，或输入 @ 引用资料维度…"
                rows={3}
                disabled={isLoading || isGenerating || !outline}
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
                {hasOutlineContent(outline) ? `共 ${outline.sections.filter(section => !isAbstractOutlineSection(section)).length} 章 · ${outlineNodeCount} 个标题节点` : isGenerating ? '生成中…' : '尚未生成大纲'}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
              {isGenerating ? (
                <div style={{ color: 'var(--color-ink-3)', fontSize: 13, lineHeight: 2 }}>
                  正在生成大纲，请稍候…
                </div>
              ) : hasOutlineContent(outline) ? (
                <>
                  <style>{`
                    .outline-row:hover { background: var(--color-bg); }
                    .outline-row:hover .outline-actions,
                    .outline-row:focus-within .outline-actions { opacity: 1 !important; }
                  `}</style>
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleAddRootSection}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-ink-2)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                    >
                      <Plus size={12} />
                      新增一级标题
                    </button>
                  </div>
                  {outline.sections.map(section => (
                    <OutlineNode
                      key={section.id}
                      section={section}
                      onEdit={handleEditTitle}
                      onDelete={handleDeleteNode}
                      onAddChild={handleAddChild}
                      onMove={handleMoveNode}
                    />
                  ))}
                </>
              ) : (
                <div style={{ color: 'var(--color-ink-3)', fontSize: 13, lineHeight: 1.8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                  <span>还没有大纲内容。请确认阶段一已完成材料理解，然后点击下方按钮生成。</span>
                  <button
                    onClick={() => autoGenerateOutline(true)}
                    disabled={isGenerating || !canGenerateOutline}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', borderRadius: 'var(--radius-sm)', background: !isGenerating && canGenerateOutline ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: 12, cursor: !isGenerating && canGenerateOutline ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-sans)' }}
                  >
                    <RefreshCw size={13} />
                    生成大纲
                  </button>
                </div>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--color-ink-3)', whiteSpace: 'pre-wrap' }}>
                {hasOutlineContent(outline) ? `确认大纲后，AI 将按大纲逐章生成正文。\n${outlinePreview}` : '等待大纲生成'}
              </span>
              <button
                onClick={confirmOutline}
                disabled={!hasOutlineContent(outline) || isGenerating}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', border: 'none', borderRadius: 'var(--radius-md)', background: !hasOutlineContent(outline) || isGenerating ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: !hasOutlineContent(outline) || isGenerating ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)' }}
              >
                进入全文生成
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          {showHistory && (
            <VersionPanel
              projectId={project.id}
              onClose={() => setShowHistory(false)}
              onRestore={(snapshot) => {
                if (snapshot.outline) {
                  const restoredOutline = {
                    ...snapshot.outline,
                    projectId: project.id,
                    updatedAt: Date.now(),
                  }
                  setOutline(restoredOutline)
                  outlineStore.save(restoredOutline)
                  return
                }
                versionStore.restore(snapshot, project.id)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
