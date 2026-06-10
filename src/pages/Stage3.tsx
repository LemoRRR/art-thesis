import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, CheckCircle2, Copy, Download, History, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-react'
import ChatBubble from '../components/ChatBubble'
import DocumentToolbar from '../components/DocumentToolbar'
import DocArea from '../components/DocArea'
import MentionInput, { type MentionRef } from '../components/MentionInput'
import ReferencePanel from '../components/ReferencePanel'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import VersionPanel from '../components/VersionPanel'
import { callDoubao, callGPT } from '../lib/ai'
import {
  finalizeSectionWithCitations,
  formatCitableSourcesForPrompt,
  getCitationPromptRules,
  getStageCitableSources,
  stripCitationMarkers,
} from '../lib/citations'
import { buildAIContext, buildMentionContext } from '../lib/context'
import { formatSectionContent, formatSectionsForPaper, sectionsToPlainText } from '../lib/documentFormat'
import { paperTextToEditorDoc } from '../lib/editorDocument'
import { buildBibliographyContent, buildBibliographySection, deleteFootnote, getAllFootnotes, updateFootnoteNote } from '../lib/footnotes'
import {
  promptAdjustFinish,
  promptFinishDraft,
  promptGenerateChapter,
  promptGeneratePaperPlan,
  promptReviseSection,
  promptSummarizeGeneratedChapter,
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

const OUTLINE_TRANSITION_MS = 2200

const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

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

function outlineSectionTitle(section: OutlineSection): string {
  return `${section.order} ${section.title}`.trim()
}

function outlineChildrenSignature(section: OutlineSection): string {
  return outlineToText(section.children ?? [])
}

function OutlineToDraftTransition({
  title,
  current,
  total,
}: {
  title: string
  current: number
  total: number
}) {
  const progress = total > 0 ? Math.max(10, Math.min(100, (current / total) * 100)) : 18

  return (
    <div className="outline-draft-transition" aria-live="polite">
      <div className="outline-draft-panel">
        <div className="outline-draft-kicker">大纲已确认</div>
        <div className="outline-draft-title">正在把结构转成全文写作计划</div>
        <div className="outline-draft-subtitle">
          {title || '未命名论文'} · {total > 0 ? `准备生成 ${total} 章正文` : '正在读取大纲结构'}
        </div>

        <div className="outline-draft-flow" aria-hidden="true">
          <div className="outline-draft-node is-source">大纲节点</div>
          <div className="outline-draft-stream">
            <span />
            <span />
            <span />
          </div>
          <div className="outline-draft-node is-plan">全文计划</div>
          <div className="outline-draft-stream">
            <span />
            <span />
            <span />
          </div>
          <div className="outline-draft-node is-draft">逐章正文</div>
        </div>

        <div className="outline-draft-progress">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="outline-draft-status">
          {total > 0 && current > 0 ? `正在生成第 ${current} / ${total} 章…` : '正在整理章节论点、承接关系和引用策略…'}
        </div>
      </div>

      <style>{`
        .outline-draft-transition {
          position: absolute;
          inset: 0;
          z-index: 240;
          display: grid;
          place-items: center;
          background: rgba(250, 249, 245, 0.88);
          backdrop-filter: blur(8px);
          animation: outline-fade-in 0.18s ease-out both;
        }

        .outline-draft-panel {
          width: min(640px, calc(100vw - 48px));
          border: 1px solid rgba(45, 90, 61, 0.18);
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 24px 60px rgba(38, 32, 24, 0.16);
          padding: 30px 34px;
          font-family: var(--font-sans);
        }

        .outline-draft-kicker {
          color: var(--color-accent);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: 0.08em;
        }

        .outline-draft-title {
          margin-top: 8px;
          color: var(--color-ink);
          font-size: 22px;
          font-weight: 700;
        }

        .outline-draft-subtitle {
          margin-top: 8px;
          color: var(--color-ink-3);
          font-size: 13px;
        }

        .outline-draft-flow {
          margin-top: 28px;
          display: grid;
          grid-template-columns: 1fr 72px 1fr 72px 1fr;
          align-items: center;
          gap: 10px;
        }

        .outline-draft-node {
          height: 74px;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          display: grid;
          place-items: center;
          color: var(--color-ink-2);
          background: var(--color-bg);
          font-size: 13px;
          font-weight: 650;
        }

        .outline-draft-node.is-plan {
          background: var(--color-accent-light);
          color: var(--color-accent);
          border-color: rgba(45, 90, 61, 0.18);
        }

        .outline-draft-node.is-draft {
          background: var(--color-accent);
          color: #fff;
          border-color: var(--color-accent);
          box-shadow: 0 10px 26px rgba(45, 90, 61, 0.18);
        }

        .outline-draft-stream {
          display: flex;
          justify-content: center;
          gap: 5px;
          overflow: hidden;
        }

        .outline-draft-stream span {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--color-accent);
          opacity: 0.2;
          animation: outline-pulse 1.1s ease-in-out infinite;
        }

        .outline-draft-stream span:nth-child(2) { animation-delay: 0.16s; }
        .outline-draft-stream span:nth-child(3) { animation-delay: 0.32s; }

        .outline-draft-progress {
          margin-top: 28px;
          height: 5px;
          border-radius: 999px;
          background: #E8E2D8;
          overflow: hidden;
        }

        .outline-draft-progress div {
          height: 100%;
          border-radius: inherit;
          background: var(--color-accent);
          transition: width 0.35s ease;
        }

        .outline-draft-status {
          margin-top: 10px;
          color: var(--color-ink-3);
          font-size: 12px;
          text-align: right;
        }

        @keyframes outline-fade-in {
          from { opacity: 0; transform: scale(0.99); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes outline-pulse {
          0%, 100% { opacity: 0.2; transform: translateX(-6px) scale(0.82); }
          50% { opacity: 1; transform: translateX(6px) scale(1); }
        }
      `}</style>
    </div>
  )
}

function normalizeSectionTitle(title: string): string {
  return title
    .replace(/^\s*\d+(?:\.\d+)*\s*/, '')
    .replace(/\s+/g, '')
    .trim()
}

function normalizeMeaningTitle(title: string): string {
  return title
    .replace(/^\s*\d+(?:\.\d+)*\s*/, '')
    .replace(/[：:，,。.\s]/g, '')
    .trim()
}

function streamGPTText(
  messages: ReturnType<typeof promptGenerateChapter>,
  signal?: AbortSignal,
  onChunk?: (text: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullContent = ''
    callGPT(
      messages,
      {
        onChunk: (chunk) => {
          fullContent += chunk
          onChunk?.(fullContent)
        },
        onDone: () => resolve(fullContent),
        onError: reject,
      },
      signal
    )
  })
}

function BibliographyCard({
  content,
  footnoteCount,
}: {
  content: string
  footnoteCount: number
}) {
  if (!content) return null

  return (
    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>参考文献（由 {footnoteCount} 条脚注自动生成）</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(content)
            alert('参考文献已复制')
          }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-ink-3)', fontSize: 11, flexShrink: 0 }}
        >
          复制
        </button>
      </div>
      <div style={{ padding: 12, fontSize: 12, lineHeight: 1.85, color: 'var(--color-ink-2)', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
        {content}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-ink-3)' }}>
        点击正文或页脚中的 [n] 可编辑/删除脚注；导出 Word 时会附带本章参考文献。
      </div>
    </div>
  )
}

function extractFinishPart(result: string, heading: string) {
  const match = result.match(new RegExp(`【${heading}】([\\s\\S]*?)(?=\\n?【|$)`))
  return match?.[1]?.trim() ?? ''
}

function buildFinishSections(result: string, projectId: string): DocSection[] {
  const abstractParts = [
    extractFinishPart(result, '摘要') ? `【摘要】\n${extractFinishPart(result, '摘要')}` : '',
    extractFinishPart(result, '关键词') ? `【关键词】\n${extractFinishPart(result, '关键词')}` : '',
    extractFinishPart(result, 'Abstract') ? `【Abstract】\n${extractFinishPart(result, 'Abstract')}` : '',
    extractFinishPart(result, 'Keywords') ? `【Keywords】\n${extractFinishPart(result, 'Keywords')}` : '',
  ].filter(Boolean).join('\n\n')
  const introduction = extractFinishPart(result, '引言')
  const conclusion = extractFinishPart(result, '结语')
  const now = Date.now()

  const finishSections: Array<DocSection | null> = [
    abstractParts ? {
      id: 'finish-abstract-export',
      projectId,
      title: '摘要与 Abstract',
      content: formatSectionContent(abstractParts),
      status: 'done' as const,
      lastModified: now,
      order: -2,
    } : null,
    introduction ? {
      id: 'finish-introduction-export',
      projectId,
      title: '引言',
      content: formatSectionContent(introduction),
      status: 'done' as const,
      lastModified: now,
      order: -1,
    } : null,
    conclusion ? {
      id: 'finish-conclusion-export',
      projectId,
      title: '结语',
      content: formatSectionContent(conclusion),
      status: 'done' as const,
      lastModified: now,
      order: Number.MAX_SAFE_INTEGER - 1,
    } : null,
  ]

  return finishSections.filter((section): section is DocSection => section !== null)
}

export default function Stage3() {
  const navigate = useNavigate()
  const location = useLocation()
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
  const [mentions, setMentions] = useState<MentionRef[]>([])
  const [showOutlineTransition, setShowOutlineTransition] = useState(() => {
    const key = `outline_to_draft_transition_${project.id}`
    const markedAt = Number(sessionStorage.getItem(key) ?? 0)
    const state = location.state as { fromOutline?: boolean } | null
    const search = new URLSearchParams(location.search)
    return Boolean(state?.fromOutline || search.get('transition') === 'outline' || (markedAt && Date.now() - markedAt < 30_000))
  })

  const academicLevel = normalizeAcademicLevel(project.context.academicLevel)
  const footnoteCount = useMemo(() => getAllFootnotes(sections).length, [sections])
  const bibliographyContent = useMemo(() => buildBibliographyContent(sections), [sections])

  useEffect(() => {
    if (!showOutlineTransition) return
    const key = `outline_to_draft_transition_${project.id}`
    sessionStorage.removeItem(key)
    if (new URLSearchParams(location.search).get('transition') === 'outline') {
      window.history.replaceState(window.history.state, '', location.pathname)
    }
    const timer = window.setTimeout(() => setShowOutlineTransition(false), OUTLINE_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.search, project.id, showOutlineTransition])

  const persistSections = useCallback((next: DocSection[], snapshotLabel?: string) => {
    sectionStore.saveForProject(project.id, next)
    if (snapshotLabel) versionStore.snapshot(snapshotLabel, project.id)
    return next
  }, [project.id])

  const saveStageMessages = useCallback((nextMessages: ChatMessage[]) => {
    chatStore.saveForProject(project.id, 'stage3', nextMessages)
  }, [project.id])

  const buildCitationAwareContext = useCallback((baseContext: string, mentionItemIds: string[] = []) => {
    const citableSources = getStageCitableSources(project.id, mentionItemIds)
    const citationContext = [
      baseContext,
      formatCitableSourcesForPrompt(citableSources),
      `【引用脚注规则】\n${getCitationPromptRules(citableSources.length > 0)}`,
    ].filter(Boolean).join('\n\n')

    return { citationContext, citableSources }
  }, [project.id])

  const reconcileSectionsWithOutline = useCallback((sourceSections: DocSection[], outlineSections: OutlineSection[]) => {
    const usedSectionIds = new Set<string>()
    const nextSections: DocSection[] = []
    const addedOutlineSections: OutlineSection[] = []
    const removedSections: DocSection[] = []
    const notices: string[] = []

    outlineSections.forEach((outlineSection, index) => {
      const expectedTitle = outlineSectionTitle(outlineSection)
      const childrenSignature = outlineChildrenSignature(outlineSection)
      const matched = sourceSections.find(section => section.outlineNodeId === outlineSection.id) ??
        sourceSections.find(section =>
          !usedSectionIds.has(section.id) &&
          normalizeSectionTitle(section.title) === normalizeSectionTitle(expectedTitle)
        )

      if (!matched) {
        addedOutlineSections.push(outlineSection)
        notices.push(`新增章节「${expectedTitle}」将单独生成正文。`)
        return
      }

      usedSectionIds.add(matched.id)
      const oldTitleMeaning = normalizeMeaningTitle(matched.title)
      const newTitleMeaning = normalizeMeaningTitle(expectedTitle)
      const titleChanged = matched.title !== expectedTitle
      const meaningChanged = oldTitleMeaning !== newTitleMeaning
      const childChanged = Boolean(matched.outlineChildrenSignature) && matched.outlineChildrenSignature !== childrenSignature

      if (titleChanged && !meaningChanged) {
        notices.push(`章节「${matched.title}」已同步为「${expectedTitle}」。`)
      } else if (titleChanged && meaningChanged) {
        notices.push(`章节「${matched.title}」标题含义变为「${expectedTitle}」，建议稍后用 AI 对该章做一次定向调整。`)
      }

      if (childChanged) {
        notices.push(`章节「${expectedTitle}」的小节结构发生变化，原正文已保留，建议对新增/变化小节进行补写或局部重写。`)
      }

      nextSections.push({
        ...matched,
        title: expectedTitle,
        outlineNodeId: outlineSection.id,
        outlineOrder: outlineSection.order,
        outlineChildrenSignature: childrenSignature,
        order: index,
        lastModified: titleChanged ? Date.now() : matched.lastModified,
      })
    })

    sourceSections.forEach(section => {
      if (!usedSectionIds.has(section.id)) removedSections.push(section)
    })

    return { nextSections, addedOutlineSections, removedSections, notices }
  }, [])

  const startFullGeneration = useCallback(async (outlineSections: OutlineSection[]) => {
    if (hasStartedGenerationRef.current || outlineSections.length === 0) return
    hasStartedGenerationRef.current = true
    setIsGeneratingFull(true)
    setAllGenerated(false)
    setGeneratingProgress({ current: 0, total: outlineSections.length })

    const currentProject = projectStore.ensure(project.id)
    const { citationContext, citableSources } = buildCitationAwareContext(
      buildAIContext({ projectId: project.id, stage: 'stage3' })
    )
    const fullOutlineSummary = outlineToText(outlineSections)
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const styleGuide = currentProject.context.stylePreference || undefined
    const generatedSections: DocSection[] = []
    let paperPlan = ''
    const chapterSummaries: string[] = []

    const startMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `已确认大纲，先生成全文写作计划，再按 ${outlineSections.length} 章逐章生成正文。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = prev.length > 0 ? [...prev, startMsg] : [startMsg]
      saveStageMessages(next)
      return next
    })

    try {
      paperPlan = await streamGPTText(
        promptGeneratePaperPlan(
          fullOutlineSummary,
          comprehensionSummary,
          citationContext,
          academicLevel,
          styleGuide
        )
      )
    } catch {
      paperPlan = ''
    }

    for (let index = 0; index < outlineSections.length; index += 1) {
      const chapter = outlineSections[index]
      setGeneratingProgress({ current: index + 1, total: outlineSections.length })

      const section: DocSection = {
        id: uid(),
        projectId: project.id,
        outlineNodeId: chapter.id,
        outlineOrder: chapter.order,
        outlineChildrenSignature: outlineChildrenSignature(chapter),
        generationPlan: paperPlan,
        title: outlineSectionTitle(chapter),
        content: '',
        status: 'generating',
        lastModified: Date.now(),
        order: index,
      }

      generatedSections.push(section)
      setSections([...generatedSections])
      if (index === 0) setActiveSectionId(section.id)

      const abort = new AbortController()
      abortRef.current = abort
      let fullContent = ''
      try {
        fullContent = await streamGPTText(
          promptGenerateChapter(
            outlineSectionTitle(chapter),
            chapterChildrenToText(chapter),
            fullOutlineSummary,
            comprehensionSummary,
            citationContext,
            bannedPhrases,
            academicLevel,
            styleGuide,
            undefined,
            paperPlan,
            chapterSummaries.join('\n\n'),
            outlineSections[index + 1] ? outlineSectionTitle(outlineSections[index + 1]) : undefined
          ),
          abort.signal,
          (streamed) => {
            setSections(prev => prev.map(item =>
              item.id === section.id ? { ...item, content: stripCitationMarkers(streamed) } : item
            ))
          }
        )

        let chapterSummary = ''
        try {
          chapterSummary = await streamGPTText(promptSummarizeGeneratedChapter(outlineSectionTitle(chapter), stripCitationMarkers(fullContent)))
          chapterSummaries.push(`${outlineSectionTitle(chapter)}：${chapterSummary}`)
        } catch {
          chapterSummary = stripCitationMarkers(fullContent).slice(0, 220)
          chapterSummaries.push(`${outlineSectionTitle(chapter)}：${chapterSummary}`)
        }

        const finalizedSections = finalizeSectionWithCitations(
          generatedSections,
          section.id,
          fullContent,
          citableSources
        )
        const doneSection = {
          ...finalizedSections[index],
          outlineNodeId: chapter.id,
          outlineOrder: chapter.order,
          outlineChildrenSignature: outlineChildrenSignature(chapter),
          generationPlan: paperPlan,
          generatedSummary: chapterSummary,
          editorDoc: paperTextToEditorDoc(finalizedSections[index].content),
          status: 'done' as const,
          lastModified: Date.now(),
        }
        generatedSections[index] = doneSection
        setSections(prev => prev.map(item => item.id === section.id ? doneSection : item))
        sectionStore.saveForProject(project.id, generatedSections)
        versionStore.snapshot(`AI 生成：${chapter.title}`, project.id)
      } catch {
        const failedSection = { ...section, status: 'pending' as const, lastModified: Date.now() }
        generatedSections[index] = failedSection
        setSections(prev => prev.map(item => item.id === section.id ? failedSection : item))
      }
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
  }, [academicLevel, buildCitationAwareContext, project.id, saveStageMessages])

  const generateAdditionalSections = useCallback(async (
    newOutlineSections: OutlineSection[],
    startIndex: number,
    existingSections: DocSection[],
    allOutlineSections: OutlineSection[]
  ) => {
    if (newOutlineSections.length === 0) return

    setIsGeneratingFull(true)
    setGeneratingProgress({ current: 0, total: newOutlineSections.length })

    const currentProject = projectStore.ensure(project.id)
    const { citationContext, citableSources } = buildCitationAwareContext(
      buildAIContext({ projectId: project.id, stage: 'stage3' })
    )
    const fullOutlineSummary = outlineToText(allOutlineSections)
    const comprehensionSummary = currentProject.context.rawSummary ?? ''
    const bannedPhrases = currentProject.context.bannedPhrases ?? []
    const styleGuide = currentProject.context.stylePreference || undefined
    const nextSections = [...existingSections]
    const paperPlan = existingSections.find(section => section.generationPlan)?.generationPlan ?? ''
    const chapterSummaries = existingSections
      .filter(section => section.generatedSummary)
      .map(section => `${section.title}：${section.generatedSummary}`)

    const startMsg: ChatMessage = {
      id: `s3_${uid()}`,
      role: 'ai',
      content: `检测到大纲新增 ${newOutlineSections.length} 个章节，开始只生成新增部分；已有正文不会被覆盖。`,
      timestamp: Date.now(),
      projectId: project.id,
      stage: 'stage3',
    }
    setMessages(prev => {
      const next = [...prev, startMsg]
      saveStageMessages(next)
      return next
    })

    for (let index = 0; index < newOutlineSections.length; index += 1) {
      const chapter = newOutlineSections[index]
      const outlineIndex = allOutlineSections.findIndex(item => item.id === chapter.id)
      const sectionIndex = outlineIndex === -1 ? startIndex + index : Math.min(outlineIndex, nextSections.length)
      setGeneratingProgress({ current: index + 1, total: newOutlineSections.length })

      const section: DocSection = {
        id: uid(),
        projectId: project.id,
        outlineNodeId: chapter.id,
        outlineOrder: chapter.order,
        outlineChildrenSignature: outlineChildrenSignature(chapter),
        generationPlan: paperPlan,
        title: outlineSectionTitle(chapter),
        content: '',
        status: 'generating',
        lastModified: Date.now(),
        order: sectionIndex,
      }

      nextSections.splice(sectionIndex, 0, section)
      setSections([...nextSections])
      setActiveSectionId(section.id)

      await new Promise<void>((resolve) => {
        let fullContent = ''
        const abort = new AbortController()
        abortRef.current = abort

        callGPT(
          promptGenerateChapter(
            outlineSectionTitle(chapter),
            chapterChildrenToText(chapter),
            fullOutlineSummary,
            comprehensionSummary,
            citationContext,
            bannedPhrases,
            academicLevel,
            styleGuide,
            undefined,
            paperPlan,
            chapterSummaries.join('\n\n'),
            allOutlineSections[sectionIndex + 1] ? outlineSectionTitle(allOutlineSections[sectionIndex + 1]) : undefined
          ),
          {
            onChunk: (chunk) => {
              fullContent += chunk
              setSections(prev => prev.map(item =>
                item.id === section.id ? { ...item, content: stripCitationMarkers(fullContent) } : item
              ))
            },
            onDone: () => {
              const finalizedSections = finalizeSectionWithCitations(
                nextSections,
                section.id,
                fullContent,
                citableSources
              )
              const doneSection = {
                ...(finalizedSections.find(item => item.id === section.id) ?? section),
                outlineNodeId: chapter.id,
                outlineOrder: chapter.order,
                outlineChildrenSignature: outlineChildrenSignature(chapter),
                generationPlan: paperPlan,
                editorDoc: paperTextToEditorDoc((finalizedSections.find(item => item.id === section.id) ?? section).content),
                status: 'done' as const,
                lastModified: Date.now(),
              }
              const currentIndex = nextSections.findIndex(item => item.id === section.id)
              if (currentIndex !== -1) nextSections[currentIndex] = doneSection
              setSections([...nextSections])
              sectionStore.saveForProject(project.id, nextSections)
              versionStore.snapshot(`AI 生成新增章节：${chapter.title}`, project.id)
              resolve()
            },
            onError: () => {
              const failedSection = { ...section, status: 'pending' as const, lastModified: Date.now() }
              const currentIndex = nextSections.findIndex(item => item.id === section.id)
              if (currentIndex !== -1) nextSections[currentIndex] = failedSection
              setSections([...nextSections])
              resolve()
            },
          },
          abort.signal
        )
      })
    }

    setIsGeneratingFull(false)
    setAllGenerated(nextSections.every(section => section.status === 'done'))
    sectionStore.saveForProject(project.id, nextSections)
  }, [academicLevel, buildCitationAwareContext, project.id, saveStageMessages])

  useEffect(() => {
    const savedMessages = chatStore.getByProject(project.id, 'stage3')
    const savedSections = sectionStore.getByProject(project.id)
    const outline = outlineStore.get(project.id)

    if (savedMessages.length > 0) setMessages(savedMessages)

    if (savedSections.length > 0) {
      let formattedSections = formatSectionsForPaper(savedSections)

      if (outline?.sections?.length) {
        let syncSnapshotDescription = ''
        const {
          nextSections,
          addedOutlineSections,
          removedSections,
          notices,
        } = reconcileSectionsWithOutline(formattedSections, outline.sections)

        formattedSections = nextSections

        if (removedSections.length > 0) {
          const shouldRemove = confirm(`检测到大纲删除了 ${removedSections.length} 个正文章节。\n\n为避免误删，当前不会自动硬删。是否将这些章节从正文视图移除并写入版本历史？\n\n将移除：${removedSections.map(section => section.title).join('、')}`)
          if (!shouldRemove) {
            formattedSections = [
              ...formattedSections,
              ...removedSections.map((section, index) => ({
                ...section,
                order: formattedSections.length + index,
              })),
            ]
          } else {
            syncSnapshotDescription = '根据大纲归档删除正文章节'
          }
        }

        if (notices.length > 0) {
          const noticeMsg: ChatMessage = {
            id: `s3_outline_sync_${Date.now()}`,
            role: 'ai',
            content: `已根据大纲同步正文结构：\n${notices.map(item => `- ${item}`).join('\n')}`,
            timestamp: Date.now(),
            projectId: project.id,
            stage: 'stage3',
          }
          setMessages(prev => {
            const next = prev.some(message => message.id === noticeMsg.id) ? prev : [...prev, noticeMsg]
            saveStageMessages(next)
            return next
          })
          syncSnapshotDescription ||= '根据大纲同步正文结构'
        }

        setSections(formattedSections)
        setActiveSectionId(formattedSections[0]?.id ?? null)
        setAllGenerated(formattedSections.every(section => section.status === 'done'))
        sectionStore.saveForProject(project.id, formattedSections)
        if (syncSnapshotDescription) versionStore.snapshot(syncSnapshotDescription, project.id)

        if (
          addedOutlineSections.length > 0 &&
          confirm(`检测到新增大纲 ${addedOutlineSections.length} 个章节，是否生成新增章节？\n\n将生成：${addedOutlineSections.map(outlineSectionTitle).join('、')}`)
        ) {
          void generateAdditionalSections(
            addedOutlineSections,
            formattedSections.length,
            formattedSections,
            outline.sections
          )
        }
      } else {
        setSections(formattedSections)
        setActiveSectionId(formattedSections[0]?.id ?? null)
        setAllGenerated(formattedSections.every(section => section.status === 'done'))
      }
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
  }, [generateAdditionalSections, project.id, reconcileSectionsWithOutline, saveStageMessages, startFullGeneration])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (sections.length > 0) {
      sectionStore.saveForProject(project.id, sections)
    }
  }, [project.id, sections])

  const handleReviseMode = useCallback(async (
    opinion: string,
    currentMessages: ChatMessage[],
    mentionContext = '',
    mentionItemIds: string[] = []
  ) => {
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

    const baseReferenceContext = [
      buildAIContext({
        projectId: project.id,
        stage: 'stage3',
        userInput: opinion,
        currentSectionId: activeSection.id,
      }),
      mentionContext,
    ].filter(Boolean).join('\n\n---\n\n')
    const { citationContext, citableSources } = buildCitationAwareContext(baseReferenceContext, mentionItemIds)
    const bannedPhrases = project.context.bannedPhrases ?? []
    let fullContent = ''
    const abort = new AbortController()
    abortRef.current = abort

    callDoubao(
      promptReviseSection(opinion, activeSection.content, citationContext, bannedPhrases),
      {
        onChunk: (chunk) => {
          fullContent += chunk
          setSections(prev => prev.map(section =>
            section.id === activeSectionId ? { ...section, content: stripCitationMarkers(fullContent) } : section
          ))
          setMessages(prev => prev.map(message =>
            message.id === aiMsgId ? { ...message, content: `正在修改「${activeSection.title}」…` } : message
          ))
        },
        onDone: () => {
          setIsLoading(false)
          setStreamingId(null)
          setSections(prev => finalizeSectionWithCitations(
            prev,
            activeSection.id,
            fullContent,
            citableSources
          ).map(section =>
            section.id === activeSection.id
              ? { ...section, editorDoc: paperTextToEditorDoc(section.content), status: 'done', lastModified: Date.now() }
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
  }, [activeSectionId, buildCitationAwareContext, project.context.bannedPhrases, project.id, saveStageMessages, sections])

  const sendMessage = useCallback(async () => {
    const rawText = inputText.trim()
    if ((!rawText && mentions.length === 0) || isLoading) return
    const text = rawText || `请结合 ${mentions.map(item => `@${item.title}`).join('、')} 为当前章节补充可引用论据，并按 [1]、[2] 的参考文献格式插入引用。`
    setInputText('')
    const mentionContext = buildMentionContext(mentions)
    const mentionItemIds = mentions.map(item => item.itemId)
    setMentions([])

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
    await handleReviseMode(text, newMessages, mentionContext, mentionItemIds)
  }, [handleReviseMode, inputText, isLoading, mentions, messages, project.id, saveStageMessages])

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

  const buildCompleteSections = () => {
    const finishSections = finishResult ? buildFinishSections(finishResult, project.id) : []
    const frontSections = finishSections.filter(section => section.title !== '结语')
    const backSections = finishSections.filter(section => section.title === '结语')
    const baseSections = [...frontSections, ...sections, ...backSections]

    const bibliographySection = buildBibliographySection(sections, project.id)
    if (bibliographySection) baseSections.push(bibliographySection)

    return baseSections
  }

  const copyAll = async () => {
    await navigator.clipboard.writeText(sectionsToPlainText(buildCompleteSections(), projectTitle))
    alert('全文已复制到剪贴板')
  }

  const exportWord = async () => {
    const exportSections = buildCompleteSections()
    if (exportSections.length === 0) return
    try {
      const { exportSectionsToDocx } = await import('../lib/docxExport')
      await exportSectionsToDocx(projectTitle, exportSections)
    } catch (error) {
      alert(`Word 导出失败：${error instanceof Error ? error.message : '请刷新后重试'}`)
    }
  }

  const updateProjectTitle = (title: string) => {
    setProjectTitle(title)
    projectStore.update(project.id, { title: title.trim() || '未命名论文' })
  }

  const handleUpdateFootnote = useCallback((footnoteId: string, noteText: string) => {
    setSections(prev => persistSections(
      updateFootnoteNote(prev, footnoteId, noteText),
      '更新脚注'
    ))
  }, [persistSections])

  const handleDeleteFootnote = useCallback((footnoteId: string) => {
    setSections(prev => persistSections(
      deleteFootnote(prev, footnoteId),
      '删除脚注'
    ))
  }, [persistSections])

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

  const syncSectionsToCloud = async () => {
    try {
      const cachedSections = sectionStore.getByProject(project.id)
      const sourceSections = sections.length > 0 ? sections : cachedSections
      if (sourceSections.length === 0) {
        alert('当前没有可同步的正文。请先生成全文，或确认本地正文没有被清空。')
        return
      }
      sectionStore.saveForProject(project.id, sourceSections)
      const count = await sectionStore.syncProject(project.id)
      alert(`已同步 ${count} 个章节到 Supabase`)
    } catch (error) {
      alert(`同步失败：${error instanceof Error ? error.message : String(error)}`)
    }
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
                onClick={syncSectionsToCloud}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-accent)', fontSize: 12, cursor: 'pointer' }}
              >
                <CheckCircle2 size={13} />
                同步云端
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

        {showOutlineTransition && (
          <OutlineToDraftTransition
            title={projectTitle}
            current={generatingProgress.current}
            total={generatingProgress.total}
          />
        )}

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

                {footnoteCount > 0 && (
                  <div style={{ padding: '0 10px 10px', flexShrink: 0 }}>
                    <BibliographyCard content={bibliographyContent} footnoteCount={footnoteCount} />
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--color-border)', padding: 10, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <MentionInput
                    value={inputText}
                    onChange={setInputText}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    onKeyDown={handleKeyDown}
                    placeholder={allGenerated ? '说修改意见，或输入 @ 引用资料维度' : '等待全文生成完成…'}
                    rows={3}
                    disabled={!allGenerated || isLoading}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!allGenerated || isLoading || (!inputText.trim() && mentions.length === 0)}
                    style={{ width: '100%', padding: '8px', borderRadius: 'var(--radius-sm)', border: 'none', background: allGenerated && !isLoading && (inputText.trim() || mentions.length > 0) ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', fontSize: 13, fontWeight: 500, cursor: allGenerated && !isLoading && (inputText.trim() || mentions.length > 0) ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    {isLoading ? <><Sparkles size={13} /> 修改中…</> : <><Send size={13} /> 提交修改</>}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                  基于完整正文，生成中文摘要、英文 Abstract、关键词、引言和结语。
                </div>
                <button
                  onClick={runFinish}
                  disabled={!allGenerated || finishLoading}
                  style={{ width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: allGenerated && !finishLoading ? 'var(--color-accent)' : 'var(--color-border)', color: '#fff', padding: '9px 0', fontSize: 12, fontWeight: 500, cursor: allGenerated && !finishLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Sparkles size={13} />
                  {finishLoading ? '生成中…' : '生成摘要 / Abstract / 引言 / 结语'}
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
                          placeholder="追加调整，如：英文摘要更像论文 Abstract、关键词改成影视空间叙事、结语别拔高…"
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

                <BibliographyCard content={bibliographyContent} footnoteCount={footnoteCount} />
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
                paperTitle={projectTitle}
                sections={sections}
                activeSectionId={activeSectionId}
                onSectionClick={id => setActiveSectionId(id)}
                onSectionChange={(id, content, editorDoc, footnotes, snapshotLabel, title) => {
                  setSections(prev => persistSections(prev.map(section =>
                    section.id === id
                      ? {
                          ...section,
                          title: title?.trim() || section.title,
                          content,
                          editorDoc: editorDoc ?? section.editorDoc,
                          footnotes: footnotes ?? section.footnotes,
                          status: 'done',
                          lastModified: Date.now(),
                        }
                      : section
                  ), snapshotLabel))
                }}
                onPaperTitleChange={updateProjectTitle}
                onGenerateSection={() => {}}
                onUpdateFootnote={handleUpdateFootnote}
                onDeleteFootnote={handleDeleteFootnote}
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
