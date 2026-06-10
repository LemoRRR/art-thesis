import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Mark, mergeAttributes } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/core'
import { BookOpen, Check, Maximize2, Minimize2, Quote, Sparkles, Wand2, X } from 'lucide-react'
import { callDoubao } from '../lib/ai'
import type { Message } from '../lib/ai'
import { editorDocToPlainText, ensurePaperEditorDoc, type PaperEditorDoc } from '../lib/editorDocument'
import { nextFootnoteNumber } from '../lib/footnotes'
import { promptQuickAction, promptRewriteSelection, type QuickAction } from '../lib/prompts'
import { revisionStore, type DocSection, type SectionFootnote } from '../lib/storage'
import { PAPER_EDITOR_TOOLBAR_EVENT, type PaperEditorToolbarCommand } from './DocumentToolbar'

interface PaperEditorProps {
  projectId: string
  section: DocSection
  allSections: DocSection[]
  active: boolean
  onActivate: () => void
  onChange: (
    sectionId: string,
    content: string,
    editorDoc: PaperEditorDoc,
    footnotes?: SectionFootnote[],
    snapshotLabel?: string
  ) => void
  onOpenFootnote: (footnote: SectionFootnote, clientX: number, clientY: number) => void
  onGenerateSection: (title: string) => void
}

interface PendingRevision {
  from: number
  to: number
  beforeText: string
  afterText: string
  instruction: string
  type: 'rewrite' | 'shorten' | 'expand' | 'academic' | 'custom'
}

const FootnoteMark = Mark.create({
  name: 'footnote',

  addAttributes() {
    return {
      footnoteId: {
        default: null,
        parseHTML: element => element.getAttribute('data-footnote-id'),
        renderHTML: attrs => ({ 'data-footnote-id': attrs.footnoteId }),
      },
      footnoteNumber: {
        default: null,
        parseHTML: element => element.getAttribute('data-footnote-number'),
        renderHTML: attrs => ({ 'data-footnote-number': attrs.footnoteNumber }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-footnote-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'paper-footnote-anchor' }), 0]
  },
})

function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function editorJson(editor: Editor): PaperEditorDoc {
  return editor.getJSON() as PaperEditorDoc
}

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

function selectedContext(editor: Editor): string {
  const { from, to } = editor.state.selection
  const size = editor.state.doc.content.size
  return editor.state.doc.textBetween(Math.max(0, from - 220), Math.min(size, to + 220), '\n')
}

function activeFootnoteIds(editor: Editor): Set<string> {
  const ids = new Set<string>()
  editor.state.doc.descendants(node => {
    node.marks.forEach(mark => {
      if (mark.type.name === 'footnote' && mark.attrs.footnoteId) {
        ids.add(String(mark.attrs.footnoteId))
      }
    })
  })
  return ids
}

function removeDeletedFootnoteMarks(editor: Editor, footnotes: SectionFootnote[] | undefined) {
  const validIds = new Set((footnotes ?? []).map(footnote => footnote.id))
  const markType = editor.schema.marks.footnote
  if (!markType) return

  let tr = editor.state.tr
  editor.state.doc.descendants((node, pos) => {
    node.marks.forEach(mark => {
      if (mark.type !== markType) return
      const footnoteId = String(mark.attrs.footnoteId ?? '')
      if (!validIds.has(footnoteId)) {
        tr = tr.removeMark(pos, pos + node.nodeSize, markType)
      }
    })
  })

  if (tr.docChanged) editor.view.dispatch(tr)
}

export default function PaperEditor({
  projectId,
  section,
  allSections,
  active,
  onActivate,
  onChange,
  onOpenFootnote,
  onGenerateSection,
}: PaperEditorProps) {
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [showFootnoteInput, setShowFootnoteInput] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [footnoteInput, setFootnoteInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingRevision, setPendingRevision] = useState<PendingRevision | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastExternalDoc = useRef('')

  const initialDoc = useMemo(
    () => ensurePaperEditorDoc(section.content, section.editorDoc),
    [section.content, section.editorDoc]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize.configure({ types: ['textStyle'] }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: null,
      }),
      Placeholder.configure({
        placeholder: '点击此处直接输入正文，或使用左侧对话让 AI 生成。',
      }),
      FootnoteMark,
    ],
    content: initialDoc as JSONContent,
    editorProps: {
      attributes: {
        class: 'paper-editor-content',
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null
        const anchor = target?.closest<HTMLElement>('[data-footnote-id]')
        const footnoteId = anchor?.dataset.footnoteId
        if (!footnoteId) return false
        const footnote = section.footnotes?.find(item => item.id === footnoteId)
        if (!footnote) return false
        onOpenFootnote(footnote, event.clientX, event.clientY)
        return true
      },
    },
    onFocus: onActivate,
    onUpdate: ({ editor: nextEditor }) => {
      const nextDoc = editorJson(nextEditor)
      const nextContent = editorDocToPlainText(nextDoc)
      const usedFootnoteIds = activeFootnoteIds(nextEditor)
      const nextFootnotes = (section.footnotes ?? []).filter(footnote => usedFootnoteIds.has(footnote.id))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onChange(section.id, nextContent, nextDoc, nextFootnotes)
      }, 650)
    },
  })

  useEffect(() => {
    if (!editor) return
    const nextDoc = ensurePaperEditorDoc(section.content, section.editorDoc)
    const nextSerialized = JSON.stringify(nextDoc)
    if (nextSerialized === lastExternalDoc.current) return
    const currentSerialized = JSON.stringify(editor.getJSON())
    if (currentSerialized === nextSerialized) return
    lastExternalDoc.current = nextSerialized
    editor.commands.setContent(nextDoc as JSONContent, { emitUpdate: false })
  }, [editor, section.content, section.editorDoc])

  useEffect(() => {
    if (!editor) return
    removeDeletedFootnoteMarks(editor, section.footnotes)
  }, [editor, section.footnotes])

  useEffect(() => {
    if (!editor || !active) return

    const runToolbarCommand = (event: Event) => {
      const command = (event as CustomEvent<PaperEditorToolbarCommand>).detail
      if (!command) return

      const chain = editor.chain().focus()
      if (command.type === 'toggleBold') chain.toggleBold().run()
      if (command.type === 'toggleItalic') chain.toggleItalic().run()
      if (command.type === 'toggleUnderline') chain.toggleUnderline().run()
      if (command.type === 'setTextAlign') chain.setTextAlign(command.value).run()
      if (command.type === 'setFontFamily') chain.setFontFamily(command.value).run()
      if (command.type === 'setFontSize') chain.setFontSize(command.value).run()
    }

    window.addEventListener(PAPER_EDITOR_TOOLBAR_EVENT, runToolbarCommand)
    return () => window.removeEventListener(PAPER_EDITOR_TOOLBAR_EVENT, runToolbarCommand)
  }, [active, editor])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const clearTransientUi = useCallback(() => {
    setShowCustomInput(false)
    setShowFootnoteInput(false)
    setCustomInput('')
    setFootnoteInput('')
    setError('')
    setPendingRevision(null)
  }, [])

  const requestRewrite = useCallback((messages: Message[], type: PendingRevision['type'], instruction: string) => {
    if (!editor || loading) return
    const { from, to } = editor.state.selection
    const beforeText = selectedText(editor)
    if (!beforeText) return

    let result = ''
    setLoading(true)
    setError('')
    setPendingRevision(null)
    setShowCustomInput(false)

    callDoubao(messages, {
      onChunk: chunk => {
        result += chunk
      },
      onDone: () => {
        setLoading(false)
        const afterText = result.trim()
        if (!afterText) {
          setError('AI 没有返回可用改写内容，请重新选中文本后再试。')
          return
        }
        setPendingRevision({ from, to, beforeText, afterText, instruction, type })
      },
      onError: err => {
        setLoading(false)
        setError(err.message || 'AI 调用失败，请稍后再试。')
      },
    })
  }, [editor, loading])

  const quickAction = useCallback((action: QuickAction) => {
    if (!editor) return
    const typeMap: Record<QuickAction, PendingRevision['type']> = {
      缩短: 'shorten',
      扩写: 'expand',
      学术化: 'academic',
    }
    requestRewrite(
      promptQuickAction(action, selectedText(editor), selectedContext(editor)),
      typeMap[action],
      action
    )
  }, [editor, requestRewrite])

  const customRewrite = useCallback(() => {
    if (!editor || !customInput.trim()) return
    requestRewrite(
      promptRewriteSelection(customInput.trim(), selectedText(editor), selectedContext(editor)),
      'custom',
      customInput.trim()
    )
    setCustomInput('')
  }, [customInput, editor, requestRewrite])

  const acceptRevision = useCallback(() => {
    if (!editor || !pendingRevision) return
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pendingRevision.from, to: pendingRevision.to })
      .insertContent(pendingRevision.afterText)
      .run()

    const nextDoc = editorJson(editor)
    const nextContent = editorDocToPlainText(nextDoc)
    const revision = revisionStore.add({
      projectId,
      sectionId: section.id,
      type: pendingRevision.type,
      beforeText: pendingRevision.beforeText,
      afterText: pendingRevision.afterText,
      instruction: pendingRevision.instruction,
    })
    revisionStore.accept(revision.id)
    onChange(section.id, nextContent, nextDoc, section.footnotes, `AI 修改：${section.title.slice(0, 16)}`)
    setPendingRevision(null)
  }, [editor, onChange, pendingRevision, projectId, section])

  const addFootnote = useCallback(() => {
    if (!editor || !footnoteInput.trim()) return
    const { from, to } = editor.state.selection
    const anchorText = selectedText(editor)
    if (!anchorText) return
    const footnote: SectionFootnote = {
      id: uid(),
      number: nextFootnoteNumber(allSections),
      blockIndex: 0,
      start: from,
      end: to,
      anchorText,
      noteText: footnoteInput.trim(),
    }
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .setMark('footnote', { footnoteId: footnote.id, footnoteNumber: footnote.number })
      .run()

    const nextDoc = editorJson(editor)
    const nextContent = editorDocToPlainText(nextDoc)
    onChange(
      section.id,
      nextContent,
      nextDoc,
      [...(section.footnotes ?? []), footnote],
      `添加脚注：${anchorText.slice(0, 12)}`
    )
    setFootnoteInput('')
    setShowFootnoteInput(false)
  }, [allSections, editor, footnoteInput, onChange, section])

  if (!editor) return null

  const hasContent = section.status !== 'pending' || Boolean(section.content.trim())

  return (
    <section
      className="paper-editor-section"
      data-section-id={section.id}
      onClick={onActivate}
      data-active={active ? 'true' : 'false'}
    >
      <div className="paper-section-heading">
        <h2>{section.title}</h2>
        {!hasContent && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation()
              onGenerateSection(section.title)
            }}
            className="paper-generate-button"
          >
            <Sparkles size={12} />
            AI 生成
          </button>
        )}
      </div>

      {section.status === 'generating' ? (
        <div className="paper-generating">
          <span />
          <span />
          <span />
          AI 正在生成…
        </div>
      ) : (
        <>
          <BubbleMenu
            editor={editor}
            options={{ placement: 'bottom', offset: 8, shift: true, flip: true }}
            shouldShow={({ editor: bubbleEditor }: { editor: Editor }) => !bubbleEditor.state.selection.empty}
          >
            <div className="paper-bubble-menu" onMouseDown={event => event.preventDefault()}>
              <div className="paper-bubble-row">
                <span className="paper-bubble-count">已选中 {selectedText(editor).length} 字</span>
                <MenuButton icon={<Wand2 size={12} />} label="AI 改写" active={showCustomInput} disabled={loading} onClick={() => {
                  setShowCustomInput(value => !value)
                  setShowFootnoteInput(false)
                }} />
                <MenuButton icon={<Minimize2 size={12} />} label="缩短" disabled={loading} onClick={() => quickAction('缩短')} />
                <MenuButton icon={<Maximize2 size={12} />} label="扩写" disabled={loading} onClick={() => quickAction('扩写')} />
                <MenuButton icon={<BookOpen size={12} />} label="学术化" disabled={loading} onClick={() => quickAction('学术化')} />
                <MenuButton icon={<Quote size={12} />} label="添加脚注" active={showFootnoteInput} disabled={loading} onClick={() => {
                  setShowFootnoteInput(value => !value)
                  setShowCustomInput(false)
                }} />
                <button type="button" onClick={clearTransientUi} className="paper-bubble-close" aria-label="关闭">
                  <X size={12} />
                </button>
              </div>

              {showCustomInput && (
                <div className="paper-bubble-input-row">
                  <input
                    autoFocus
                    value={customInput}
                    onChange={event => setCustomInput(event.target.value)}
                    onKeyDown={event => event.key === 'Enter' && customRewrite()}
                    placeholder="输入改写要求，如：更简洁、去掉重复、加强论证"
                  />
                  <button type="button" onClick={customRewrite} disabled={!customInput.trim() || loading}>
                    {loading ? '处理中…' : '确认'}
                  </button>
                </div>
              )}

              {showFootnoteInput && (
                <div className="paper-bubble-footnote">
                  <textarea
                    autoFocus
                    value={footnoteInput}
                    onChange={event => setFootnoteInput(event.target.value)}
                    rows={3}
                    placeholder="作者. 书名/篇名. 出版社/期刊, 年份, 页码."
                  />
                  <button type="button" onClick={addFootnote} disabled={!footnoteInput.trim()}>
                    插入脚注
                  </button>
                </div>
              )}

              {loading && <div className="paper-bubble-status">AI 正在生成修改建议…</div>}
              {error && <div className="paper-bubble-error">{error}</div>}

              {pendingRevision && (
                <div className="paper-revision-panel">
                  <div className="paper-revision-title">AI 修改建议</div>
                  <div className="paper-revision-scroll">
                    <DiffBox title="原文" color="#A8443F" background="#FFF1EF" text={pendingRevision.beforeText} strike />
                    <DiffBox title="修改后" color="var(--color-accent)" background="var(--color-accent-light)" text={pendingRevision.afterText} />
                  </div>
                  <div className="paper-revision-actions">
                    <button type="button" onClick={() => setPendingRevision(null)}>取消</button>
                    <button type="button" onClick={acceptRevision}>
                      <Check size={12} />
                      接受修改
                    </button>
                  </div>
                </div>
              )}
            </div>
          </BubbleMenu>

          <EditorContent editor={editor} />
        </>
      )}
    </section>
  )
}

function MenuButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={active ? 'is-active' : undefined}
    >
      {icon}
      {label}
    </button>
  )
}

function DiffBox({
  title,
  color,
  background,
  text,
  strike,
}: {
  title: string
  color: string
  background: string
  text: string
  strike?: boolean
}) {
  return (
    <div className="paper-diff-box" style={{ color, background }}>
      <span>{title}</span>
      <div style={{ textDecoration: strike ? 'line-through' : undefined }}>{text}</div>
    </div>
  )
}
