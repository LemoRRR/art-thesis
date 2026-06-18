import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/core'
import { BookOpen, Check, Edit3, Maximize2, Minimize2, Quote, Sparkles, Wand2, X } from 'lucide-react'
import FootnoteEditor from './FootnoteEditor'
import { PAPER_EDITOR_TOOLBAR_EVENT, type PaperEditorToolbarCommand } from './DocumentToolbar'
import { callDoubao } from '../lib/ai'
import type { Message } from '../lib/ai'
import {
  paperDocToSections,
  sectionsToPaperDoc,
  type PaperEditorDoc,
  type PaperEditorMark,
  type PaperEditorNode,
} from '../lib/editorDocument'
import { nextFootnoteNumber } from '../lib/footnotes'
import {
  blockSourceKey,
  buildPaperLayoutBlocks,
  DEFAULT_PAPER_PAGE_SETTINGS,
  editorNodeText,
  paginatePaperBlocks,
  type PaperLayoutBlock,
} from '../lib/paperPagination'
import { promptQuickAction, promptRewriteSelection, type QuickAction } from '../lib/prompts'
import { revisionStore, type DocSection, type OutlineSection, type SectionFootnote } from '../lib/storage'

interface PaperDocumentEditorProps {
  projectId: string
  paperTitle: string
  sections: DocSection[]
  outlineSections?: OutlineSection[]
  isPreparing?: boolean
  activeSectionId: string | null
  onSectionClick: (id: string) => void
  onSectionsChange: (sections: DocSection[], snapshotLabel?: string) => void
  onPaperTitleChange: (title: string) => void
  onGenerateSection: (title: string) => void
  onUpdateFootnote?: (footnoteId: string, noteText: string) => void
  onDeleteFootnote?: (footnoteId: string) => void
  emptyTitle?: string
  emptyText?: string
}

interface PendingRevision {
  from: number
  to: number
  beforeText: string
  afterText: string
  instruction: string
  type: 'rewrite' | 'shorten' | 'expand' | 'academic' | 'custom'
}

interface InlineEditingBlock {
  block: PaperLayoutBlock
  text: string
  initialOffset?: number
}

interface InlineEditorTarget {
  pos: number
  nodeSize: number
}

interface PageFootnoteGroup {
  page: number
  top: number
  footnotes: SectionFootnote[]
}

interface SelectionToolbarState {
  top: number
  left: number
  selectedLength: number
}

interface SelectionRange {
  from: number
  to: number
}

const PAGE = DEFAULT_PAPER_PAGE_SETTINGS

const SectionHeadingAttributes = Extension.create({
  name: 'sectionHeadingAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          sectionId: {
            default: null,
            parseHTML: element => element.getAttribute('data-section-id'),
            renderHTML: attrs => attrs.sectionId ? { 'data-section-id': attrs.sectionId } : {},
          },
          outlineNodeId: {
            default: null,
            parseHTML: element => element.getAttribute('data-outline-node-id'),
            renderHTML: attrs => attrs.outlineNodeId ? { 'data-outline-node-id': attrs.outlineNodeId } : {},
          },
          sectionTitle: {
            default: false,
            parseHTML: element => element.getAttribute('data-section-title') === 'true',
            renderHTML: attrs => attrs.sectionTitle ? { 'data-section-title': 'true' } : {},
          },
          lockedLevel: {
            default: null,
            parseHTML: element => element.getAttribute('data-locked-level'),
            renderHTML: attrs => attrs.lockedLevel ? { 'data-locked-level': attrs.lockedLevel } : {},
          },
        },
      },
    ]
  },
})

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
      sourceId: {
        default: null,
        parseHTML: element => element.getAttribute('data-source-id'),
        renderHTML: attrs => attrs.sourceId ? { 'data-source-id': attrs.sourceId } : {},
      },
      noteText: {
        default: null,
        parseHTML: element => element.getAttribute('data-footnote-note'),
        renderHTML: attrs => attrs.noteText ? {
          'data-footnote-note': attrs.noteText,
          title: attrs.noteText,
        } : {},
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

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection
  return editor.state.doc.textBetween(from, to, '\n').trim()
}

function domSelectedText(editor: Editor): string {
  if (typeof window === 'undefined') return ''
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  const editorDom = editor.view.dom
  const startsInEditor = anchorNode ? editorDom.contains(anchorNode) : false
  const endsInEditor = focusNode ? editorDom.contains(focusNode) : false
  if (!startsInEditor && !endsInEditor) return ''
  return selection.toString().trim()
}

function hasVisibleEditorSelection(editor: Editor): boolean {
  if (editor.isDestroyed || editor.state.selection.empty) return false
  const proseMirrorText = selectedText(editor)
  if (!proseMirrorText) return false
  const domText = domSelectedText(editor)
  if (domText) return true
  if (proseMirrorText.length > 3000) return false
  return editor.isFocused
}

function selectedTextForDisplay(editor: Editor): string {
  const domText = domSelectedText(editor)
  const proseMirrorText = selectedText(editor)
  if (!domText) return proseMirrorText
  if (!proseMirrorText) return domText
  return domText.length < proseMirrorText.length ? domText : proseMirrorText
}

function selectedTextInRange(editor: Editor, range: SelectionRange | null): string {
  if (!range) return selectedText(editor)
  return editor.state.doc.textBetween(range.from, range.to, '\n').trim()
}

function selectedContextInRange(editor: Editor, range: SelectionRange | null): string {
  if (!range) return selectedContext(editor)
  const size = editor.state.doc.content.size
  return editor.state.doc.textBetween(Math.max(0, range.from - 220), Math.min(size, range.to + 220), '\n')
}

function bubbleMenuContainer() {
  return document.body
}

function keepEditorSelectionOnMenuMouseDown(event: MouseEvent<HTMLElement>) {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (target?.closest('input, textarea')) return
  event.preventDefault()
}

function selectionToolbarState(editor: Editor): { toolbar: SelectionToolbarState | null; range: SelectionRange | null } {
  if (editor.isDestroyed || editor.state.selection.empty) return { toolbar: null, range: null }
  const { from, to } = editor.state.selection
  const text = editor.state.doc.textBetween(from, to, '\n').trim()
  if (!text || text.length > 3000) return { toolbar: null, range: null }

  try {
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const left = Math.min(
      window.innerWidth - 280,
      Math.max(280, (start.left + end.right) / 2)
    )
    const top = Math.max(12, Math.min(start.top, end.top) - 10)
    return {
      toolbar: { top, left, selectedLength: selectedTextForDisplay(editor).length || text.length },
      range: { from, to },
    }
  } catch {
    return { toolbar: null, range: null }
  }
}

function selectedContext(editor: Editor): string {
  const { from, to } = editor.state.selection
  const size = editor.state.doc.content.size
  return editor.state.doc.textBetween(Math.max(0, from - 220), Math.min(size, to + 220), '\n')
}

function editorJson(editor: Editor): PaperEditorDoc {
  return editor.getJSON() as PaperEditorDoc
}

function findActiveSectionId(editor: Editor): string | null {
  const selectionFrom = editor.state.selection.from
  let active: string | null = null
  editor.state.doc.descendants((node, pos) => {
    if (pos > selectionFrom) return false
    const sectionId = node.attrs?.sectionId
    if (node.type.name === 'heading' && typeof sectionId === 'string') active = sectionId
    return true
  })
  return active
}

function findSectionTitleById(sections: DocSection[], id: string | null) {
  if (!id) return ''
  return sections.find(section => section.id === id)?.title ?? ''
}

function markKey(mark: PaperEditorMark, index: number) {
  return `${mark.type}-${index}-${JSON.stringify(mark.attrs ?? {})}`
}

function renderTextWithMarks(text: string, marks: PaperEditorMark[] = [], key: string): ReactNode {
  return marks.reduce<ReactNode>((child, mark, index) => {
    if (mark.type === 'bold') return <strong key={markKey(mark, index)}>{child}</strong>
    if (mark.type === 'italic') return <em key={markKey(mark, index)}>{child}</em>
    if (mark.type === 'underline') return <u key={markKey(mark, index)}>{child}</u>
    if (mark.type === 'footnote') {
      return (
        <span
          key={markKey(mark, index)}
          className="paper-footnote-anchor"
          data-footnote-id={String(mark.attrs?.footnoteId ?? '')}
          data-footnote-number={String(mark.attrs?.footnoteNumber ?? '')}
        >
          {child}
        </span>
      )
    }
    return <span key={markKey(mark, index)}>{child}</span>
  }, text || <br key={key} />)
}

function renderInlineNodes(nodes: PaperEditorNode[] | undefined, inheritedMarks: PaperEditorMark[] = []): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const marks = [...inheritedMarks, ...(node.marks ?? [])]
    if (node.type === 'text') return renderTextWithMarks(node.text ?? '', marks, `text-${index}`)
    return <span key={`${node.type}-${index}`}>{renderInlineNodes(node.content, marks)}</span>
  })
}

function blockStyle(node?: PaperEditorNode): CSSProperties {
  const textAlign = typeof node?.attrs?.textAlign === 'string' ? node.attrs.textAlign : undefined
  return textAlign ? { textAlign: textAlign as CSSProperties['textAlign'] } : {}
}

function estimateTextOffsetFromClick(block: PaperLayoutBlock, event: MouseEvent<HTMLElement>) {
  const text = block.text ?? editorNodeText(block.node)
  if (!text) return 0
  const rect = event.currentTarget.getBoundingClientRect()
  const style = window.getComputedStyle(event.currentTarget)
  const fontSize = Number.parseFloat(style.fontSize) || 14.5
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 2
  const contentWidth = Math.max(1, rect.width)
  const estimatedCharWidth = block.type === 'paragraph' ? fontSize : fontSize * 0.95
  const charsPerLine = Math.max(1, Math.floor(contentWidth / estimatedCharWidth))
  const lineIndex = Math.max(0, Math.floor((event.clientY - rect.top) / Math.max(1, lineHeight)))
  const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / contentWidth))
  const charInLine = Math.round(xRatio * charsPerLine)
  return Math.max(0, Math.min(text.length, lineIndex * charsPerLine + charInLine))
}

function inlineEditorContent(block: PaperLayoutBlock, text: string): JSONContent {
  if (block.type === 'title') {
    return {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, textAlign: 'center' },
          content: text ? [{ type: 'text', text }] : undefined,
        },
      ],
    }
  }

  if (block.node && !block.text) {
    return { type: 'doc', content: [block.node as JSONContent] }
  }

  return {
    type: 'doc',
    content: [
      {
        type: block.type === 'heading' ? 'heading' : 'paragraph',
        attrs: block.node?.attrs ?? (block.type === 'heading' ? { level: block.level ?? 2 } : undefined),
        content: text ? [{ type: 'text', text }] : undefined,
      },
    ],
  }
}

function InlineProseMirrorEditor({
  block,
  text,
  initialOffset,
  onSave,
  onCancel,
}: {
  block: PaperLayoutBlock
  text: string
  initialOffset?: number
  onSave: (doc: PaperEditorDoc) => void
  onCancel: () => void
}) {
  const isTitle = block.type === 'title'
  const isHeading = block.type === 'heading'
  const [inlineAiLoading, setInlineAiLoading] = useState(false)
  const [inlineAiError, setInlineAiError] = useState('')
  const inlineEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        underline: false,
      }),
      SectionHeadingAttributes,
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSize.configure({ types: ['textStyle'] }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: null,
      }),
      FootnoteMark,
    ],
    content: inlineEditorContent(block, text),
    editorProps: {
      attributes: {
        class: [
          'paper-inline-prosemirror-content',
          isTitle ? 'is-title' : '',
          isHeading ? 'is-heading' : '',
        ].filter(Boolean).join(' '),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
          return true
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          if (inlineEditor) onSave(inlineEditor.getJSON() as PaperEditorDoc)
          return true
        }
        return false
      },
    },
    onCreate: ({ editor }) => {
      window.setTimeout(() => {
        const plainTextLength = editor.state.doc.textContent.length
        const offset = typeof initialOffset === 'number'
          ? Math.max(0, Math.min(initialOffset, plainTextLength))
          : plainTextLength
        editor.commands.focus(Math.max(1, offset + 1))
      }, 20)
    },
    onBlur: ({ editor }) => {
      onSave(editor.getJSON() as PaperEditorDoc)
    },
  })

  const runInlineAi = useCallback((action: 'rewrite' | QuickAction) => {
    if (!inlineEditor || inlineAiLoading) return
    const { from, to } = inlineEditor.state.selection
    const beforeText = selectedText(inlineEditor)
    if (!beforeText) return

    const instruction = action === 'rewrite' ? '在保持原意基础上润色改写，使表达更自然、学术、连贯。' : action
    const messages = action === 'rewrite'
      ? promptRewriteSelection(instruction, beforeText, selectedContext(inlineEditor))
      : promptQuickAction(action, beforeText, selectedContext(inlineEditor))

    let result = ''
    setInlineAiLoading(true)
    setInlineAiError('')
    callDoubao(messages, {
      onChunk: chunk => {
        result += chunk
      },
      onDone: () => {
        setInlineAiLoading(false)
        const nextText = result.trim()
        if (!nextText) {
          setInlineAiError('AI 没有返回可用内容')
          return
        }
        inlineEditor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .insertContent(nextText)
          .run()
      },
      onError: error => {
        setInlineAiLoading(false)
        setInlineAiError(error.message || 'AI 调用失败')
      },
    })
  }, [inlineAiLoading, inlineEditor])

  return (
    <div
      key={`${block.key}-inline-editor`}
      className={[
        'paper-inline-edit',
        isTitle ? 'paper-inline-edit-title' : '',
        isHeading ? 'paper-inline-edit-heading' : '',
      ].filter(Boolean).join(' ')}
      data-measure-key={block.key}
    >
      {inlineEditor && (
        <BubbleMenu
          editor={inlineEditor}
          appendTo={bubbleMenuContainer}
          options={{ strategy: 'fixed', placement: 'top', offset: 8, shift: { padding: 12 }, flip: true }}
          shouldShow={({ editor: bubbleEditor }: { editor: Editor }) =>
            hasVisibleEditorSelection(bubbleEditor)
          }
        >
          <div className="paper-inline-ai-menu" onMouseDown={keepEditorSelectionOnMenuMouseDown}>
            <button type="button" onClick={() => runInlineAi('rewrite')} disabled={inlineAiLoading}>
              <Wand2 size={12} />
              AI 改写
            </button>
            <button type="button" onClick={() => runInlineAi('缩短')} disabled={inlineAiLoading}>缩短</button>
            <button type="button" onClick={() => runInlineAi('扩写')} disabled={inlineAiLoading}>扩写</button>
            <button type="button" onClick={() => runInlineAi('学术化')} disabled={inlineAiLoading}>学术化</button>
            <span>{inlineAiLoading ? '处理中...' : inlineAiError}</span>
          </div>
        </BubbleMenu>
      )}
      {inlineEditor && <EditorContent editor={inlineEditor} />}
    </div>
  )
}

function renderPreviewBlock(
  block: PaperLayoutBlock,
  onClick: (block: PaperLayoutBlock, event: MouseEvent<HTMLElement>) => void,
  inlineEditing?: InlineEditingBlock | null,
  onInlineSave?: (doc: PaperEditorDoc) => void,
  onInlineCancel?: () => void
) {
  if (inlineEditing?.block.key === block.key && onInlineSave && onInlineCancel) {
    return (
      <InlineProseMirrorEditor
        key={`${block.key}-inline-editor`}
        block={block}
        text={inlineEditing.text}
        initialOffset={inlineEditing.initialOffset}
        onSave={onInlineSave}
        onCancel={onInlineCancel}
      />
    )
  }

  const text = block.text ?? editorNodeText(block.node)
  if (block.type === 'title') {
    return (
      <h1
        key={block.key}
        className="paper-preview-title"
        data-measure-key={block.key}
        onClick={event => onClick(block, event)}
      >
        {text}
      </h1>
    )
  }

  const className = [
    'paper-preview-block',
    block.type === 'heading' ? 'paper-preview-heading' : 'paper-preview-paragraph',
    block.type === 'heading' && block.level === 2 ? 'paper-preview-heading-section' : '',
    block.continuation ? 'is-continuation' : '',
  ].filter(Boolean).join(' ')

  if (block.type === 'heading') {
    const Tag = block.level === 3 ? 'h3' : 'h2'
    return (
      <Tag
        key={block.key}
        className={className}
        style={blockStyle(block.node)}
        data-measure-key={block.key}
        data-section-id={block.sectionId}
        onClick={event => onClick(block, event)}
      >
        {block.node ? renderInlineNodes(block.node.content) : text}
      </Tag>
    )
  }

  return (
    <p
      key={block.key}
      className={className}
      style={blockStyle(block.node)}
      data-measure-key={block.key}
      data-section-id={block.sectionId}
      onClick={event => onClick(block, event)}
    >
      {block.node && !block.text ? renderInlineNodes(block.node.content) : text}
    </p>
  )
}

function PaperDocumentStyles() {
  return (
    <style>{`
      .paper-document-empty {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--color-ink-3);
        gap: 12px;
        padding: 40px;
        text-align: center;
        background: linear-gradient(180deg, #FBFAF7 0%, #F4F0E8 100%);
      }

      .paper-document-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(46, 125, 76, 0.18);
        border-top-color: var(--color-accent);
        animation: doc-loading-spin 0.8s linear infinite;
      }

      @keyframes doc-loading-spin {
        to { transform: rotate(360deg); }
      }

      .paper-document-root {
        flex: 1;
        min-width: 0;
        position: relative;
        overflow: hidden;
        display: flex;
        background: #E7E3DD;
      }

      .paper-document-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 30px 0 72px;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .paper-preview-toggle,
      .paper-preview-full-edit {
        position: sticky;
        top: 0;
        z-index: 6;
        align-self: flex-end;
        margin: 0 calc((100% - ${PAGE.width}px) / 2) 8px 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 9px;
        border: 1px solid #D8D2C8;
        border-radius: var(--radius-sm);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: var(--shadow-sm);
        color: var(--color-ink-3);
        cursor: pointer;
        font-family: var(--font-sans);
        font-size: 11px;
      }

      .paper-page {
        position: relative;
        width: ${PAGE.width}px;
        min-height: ${PAGE.height}px;
        box-sizing: border-box;
        margin-bottom: ${PAGE.gap}px;
        padding: ${PAGE.marginTop}px ${PAGE.marginRight}px ${PAGE.marginBottom}px ${PAGE.marginLeft}px;
        background: #fff;
        border: 1px solid #D8D2C8;
        box-shadow: 0 14px 32px rgba(38, 32, 24, 0.13);
      }

      .paper-page-body {
        min-height: ${PAGE.height - PAGE.marginTop - PAGE.marginBottom}px;
      }

      .paper-page.has-footnotes .paper-page-body {
        padding-bottom: ${PAGE.footnoteGap}px;
      }

      .paper-page-number {
        position: absolute;
        bottom: 28px;
        left: 0;
        right: 0;
        text-align: center;
        color: #A59B8D;
        font-family: var(--font-sans);
        font-size: 11px;
      }

      .paper-preview-title,
      .paper-preview-heading,
      .paper-preview-paragraph {
        color: var(--color-ink-2);
        font-family: var(--font-serif);
        word-break: break-word;
        cursor: text;
      }

      .paper-preview-title {
        margin: 0 0 42px;
        min-height: 70px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        color: var(--color-ink);
        font-size: 24px;
        font-weight: 700;
        line-height: 1.45;
      }

      .paper-preview-block:hover {
        background: rgba(45, 90, 61, 0.018);
      }

      .paper-inline-edit {
        position: relative;
        margin: 0 0 12px;
      }

      .paper-inline-prosemirror-content {
        width: 100%;
        min-height: 32px;
        box-sizing: border-box;
        border: none;
        outline: none;
        border-radius: 0;
        background: transparent;
        color: var(--color-ink-2);
        font-family: var(--font-serif);
        font-size: 14.5px;
        line-height: 2;
        padding: 0;
        text-align: justify;
        text-indent: 2em;
        box-shadow: none;
      }

      .paper-inline-prosemirror-content:focus {
        outline: none;
        background: transparent;
      }

      .paper-inline-prosemirror-content p {
        margin: 0 0 12px;
        text-indent: 2em;
        text-align: justify;
      }

      .paper-inline-prosemirror-content p:last-child {
        margin-bottom: 0;
      }

      .paper-inline-prosemirror-content h1,
      .paper-inline-prosemirror-content h2,
      .paper-inline-prosemirror-content h3 {
        margin: 0;
        color: var(--color-ink);
        font-family: var(--font-serif);
        font-weight: 650;
        text-indent: 0;
      }

      .paper-inline-edit-title {
        margin: 0 0 42px;
      }

      .paper-inline-edit-title .paper-inline-prosemirror-content {
        min-height: 76px;
        text-align: center;
        text-indent: 0;
        color: var(--color-ink);
        font-size: 24px;
        font-weight: 700;
        line-height: 1.45;
      }

      .paper-inline-edit-title .paper-inline-prosemirror-content h1 {
        text-align: center;
        font-size: 24px;
        font-weight: 700;
        line-height: 1.45;
      }

      .paper-inline-edit-heading .paper-inline-prosemirror-content h2 {
        text-align: center;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.6;
      }

      .paper-inline-edit-heading .paper-inline-prosemirror-content h3 {
        font-size: 14.5px;
        line-height: 1.8;
      }

      .paper-inline-edit-heading .paper-inline-prosemirror-content {
        color: var(--color-ink);
        font-weight: 650;
        text-indent: 0;
        line-height: 1.8;
      }

      .paper-inline-edit-heading .paper-inline-prosemirror-content p {
        text-indent: 0;
      }

      .paper-inline-ai-menu {
        position: relative;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        box-shadow: var(--shadow-lg);
        font-family: var(--font-sans);
      }

      .paper-inline-ai-menu button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--color-ink-2);
        font-size: 11px;
        white-space: nowrap;
        cursor: pointer;
      }

      .paper-inline-ai-menu button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .paper-inline-ai-menu span {
        max-width: 160px;
        color: #A8443F;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .paper-preview-paragraph {
        margin: 0 0 12px;
        text-indent: 2em;
        text-align: justify;
        font-size: 14.5px;
        line-height: 2;
      }

      .paper-preview-paragraph.is-continuation {
        text-indent: 0;
      }

      .paper-preview-heading {
        color: var(--color-ink);
        font-weight: 650;
        text-indent: 0;
      }

      .paper-preview-readonly .paper-preview-title,
      .paper-preview-readonly .paper-preview-heading,
      .paper-preview-readonly .paper-preview-paragraph {
        cursor: default;
      }

      .paper-preview-readonly .paper-preview-block:hover {
        background: transparent;
      }

      .paper-preview-heading-section {
        margin: 8px 72px 14px;
        text-align: center;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.6;
      }

      h2.paper-preview-heading:not(.paper-preview-heading-section) {
        margin: 18px 0 10px;
        font-size: 15.5px;
        line-height: 1.8;
      }

      h3.paper-preview-heading {
        margin: 14px 0 8px;
        font-size: 14.5px;
        line-height: 1.8;
      }

      .paper-page-footnotes {
        position: absolute;
        left: ${PAGE.marginLeft}px;
        right: ${PAGE.marginRight}px;
        bottom: 48px;
        border-top: 1px solid rgba(120, 111, 98, 0.42);
        padding-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .paper-page-footnotes button {
        border: none;
        background: transparent;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: #6E655B;
        font-family: var(--font-serif);
        font-size: 10px;
        line-height: 1.35;
      }

      .paper-page-footnotes sup {
        margin-right: 4px;
        font-weight: 650;
      }

      .paper-footnote-anchor {
        cursor: pointer;
        background: rgba(45, 90, 61, 0.08);
        border-radius: 3px;
        padding: 0 1px;
      }

      .paper-footnote-anchor::after {
        content: "[" attr(data-footnote-number) "]";
        vertical-align: super;
        font-size: 0.72em;
        color: var(--color-accent);
        font-family: var(--font-sans);
        margin-left: 1px;
      }

      .paper-edit-shell {
        width: ${PAGE.width}px;
        margin-bottom: ${PAGE.gap}px;
      }

      .paper-edit-toolbar {
        display: none;
      }

      .paper-active-generate {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        color: var(--color-accent);
        cursor: pointer;
        font-size: 12px;
        font-family: var(--font-sans);
      }

      .paper-edit-page {
        position: relative;
        width: ${PAGE.width}px;
        min-height: ${PAGE.height}px;
        box-sizing: border-box;
        padding: ${PAGE.marginTop}px ${PAGE.marginRight}px ${PAGE.marginBottom}px ${PAGE.marginLeft}px;
        background: #fff;
        border: 1px solid #D8D2C8;
        box-shadow: 0 14px 32px rgba(38, 32, 24, 0.13);
      }

      .paper-edit-citation-overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        pointer-events: none;
      }

      .paper-edit-content-layer {
        position: relative;
        z-index: 2;
        box-sizing: border-box;
      }

      .paper-edit-page-footnotes {
        position: absolute;
        left: ${PAGE.marginLeft}px;
        right: ${PAGE.marginRight}px;
        min-height: 42px;
        max-height: 86px;
        overflow: hidden;
        border-top: 1px solid rgba(120, 111, 98, 0.42);
        padding-top: 6px;
        background: rgba(255, 255, 255, 0.94);
        display: flex;
        flex-direction: column;
        gap: 3px;
        pointer-events: auto;
      }

      .paper-edit-page-footnotes button {
        border: none;
        background: transparent;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: #6E655B;
        font-family: var(--font-serif);
        font-size: 10px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .paper-edit-page-footnotes sup {
        margin-right: 4px;
        font-weight: 650;
      }

      .paper-title-block {
        position: relative;
        min-height: 108px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .paper-title-block textarea {
        width: 100%;
        min-height: 76px;
        border: none;
        outline: none;
        background: transparent;
        text-align: center;
        color: var(--color-ink);
        font-family: var(--font-serif);
        font-size: 24px;
        font-weight: 700;
        line-height: 1.45;
        resize: none;
        overflow: hidden;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .paper-document-editor-content {
        position: relative;
        z-index: 2;
        min-height: 760px;
        outline: none;
        color: var(--color-ink-2);
        font-family: var(--font-serif);
        font-size: 14.5px;
        line-height: 2;
        word-break: break-word;
        white-space: pre-wrap;
      }

      .paper-document-editor-content p {
        margin: 0 0 12px;
        text-align: justify;
        text-indent: 2em;
      }

      .paper-document-editor-content p[style*="text-align: center"],
      .paper-document-editor-content p[style*="text-align: right"] {
        text-indent: 0;
      }

      .paper-document-editor-content h2,
      .paper-document-editor-content h3 {
        color: var(--color-ink);
        font-family: var(--font-serif);
        font-weight: 650;
        text-indent: 0;
      }

      .paper-document-editor-content h2[data-section-title="true"] {
        margin: 8px 82px 18px;
        text-align: center;
        font-size: 20px;
        font-weight: 700;
        line-height: 1.6;
      }

      .paper-document-editor-content h2:not([data-section-title="true"]) {
        margin: 18px 0 10px;
        font-size: 15.5px;
        line-height: 1.8;
      }

      .paper-document-editor-content h3 {
        margin: 14px 0 8px;
        font-size: 14.5px;
        line-height: 1.8;
      }

      .paper-measure-root {
        position: fixed;
        left: -10000px;
        top: 0;
        width: ${PAGE.width - PAGE.marginLeft - PAGE.marginRight}px;
        visibility: hidden;
        pointer-events: none;
        z-index: -1;
      }

      .paper-measure-root .paper-page-footnotes {
        position: static;
        left: auto;
        right: auto;
        bottom: auto;
      }

      .paper-footnote-list {
        margin-top: 36px;
        border-top: 1px solid #D8D2C8;
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-serif);
        font-size: 10.5px;
        line-height: 1.65;
        color: #6E655B;
      }

      .paper-footnote-list button {
        border: none;
        background: transparent;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: inherit;
        font: inherit;
      }

      .paper-bubble-menu {
        position: relative;
        z-index: 2147483647;
        width: 540px;
        max-width: calc(100vw - 24px);
        overflow: visible;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        box-shadow: var(--shadow-lg);
        font-family: var(--font-sans);
      }

      .paper-bubble-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
      }

      .paper-bubble-count {
        padding: 0 4px;
        color: var(--color-ink-3);
        font-size: 10px;
        white-space: nowrap;
      }

      .paper-bubble-row button,
      .paper-bubble-input-row button,
      .paper-bubble-footnote button,
      .paper-revision-actions button {
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        cursor: pointer;
      }

      .paper-bubble-row button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-ink-2);
        font-size: 11px;
        white-space: nowrap;
      }

      .paper-bubble-row button.is-active {
        border-color: var(--color-accent);
        background: var(--color-accent-light);
        color: var(--color-accent);
      }

      .paper-bubble-row button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .paper-bubble-row .paper-bubble-close {
        margin-left: auto;
        border: none;
        padding: 4px;
        color: var(--color-ink-3);
      }

      .paper-bubble-input-row,
      .paper-bubble-footnote {
        border-top: 1px solid var(--color-border);
        padding: 8px 10px;
      }

      .paper-bubble-input-row {
        display: flex;
        gap: 6px;
      }

      .paper-bubble-input-row input,
      .paper-bubble-footnote textarea {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        outline: none;
        background: var(--color-bg);
        color: var(--color-ink);
        font-family: var(--font-sans);
        font-size: 12px;
        box-sizing: border-box;
      }

      .paper-bubble-input-row input {
        flex: 1;
        padding: 5px 8px;
      }

      .paper-bubble-input-row button,
      .paper-bubble-footnote button,
      .paper-revision-actions button:last-child {
        border: none;
        background: var(--color-accent);
        color: #fff;
        padding: 5px 12px;
        font-size: 12px;
      }

      .paper-bubble-input-row button:disabled,
      .paper-bubble-footnote button:disabled {
        background: var(--color-border);
        cursor: not-allowed;
      }

      .paper-bubble-footnote {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .paper-bubble-footnote textarea {
        width: 100%;
        padding: 6px 8px;
        resize: vertical;
      }

      .paper-bubble-footnote button {
        align-self: flex-end;
      }

      .paper-bubble-status,
      .paper-bubble-error {
        border-top: 1px solid var(--color-border);
        padding: 9px 12px;
        font-size: 12px;
        line-height: 1.6;
      }

      .paper-bubble-status {
        background: var(--color-bg);
        color: var(--color-ink-3);
      }

      .paper-bubble-error {
        background: #FFF1EF;
        color: #A8443F;
      }

      .paper-revision-panel {
        border-top: 1px solid var(--color-border);
        background: var(--color-bg);
      }

      .paper-revision-title {
        padding: 8px 10px 0;
        font-size: 12px;
        font-weight: 650;
        color: var(--color-ink);
      }

      .paper-revision-scroll {
        max-height: 220px;
        overflow-y: auto;
        padding: 8px 10px;
        display: grid;
        gap: 8px;
      }

      .paper-diff-box {
        border-radius: var(--radius-sm);
        padding: 8px;
        font-size: 12px;
        line-height: 1.7;
      }

      .paper-diff-box span {
        display: block;
        margin-bottom: 4px;
        font-size: 10px;
        font-family: var(--font-sans);
        opacity: 0.8;
      }

      .paper-revision-actions {
        padding: 8px 10px;
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        border-top: 1px solid var(--color-border);
      }

      .paper-revision-actions button:first-child {
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-ink-2);
        padding: 5px 12px;
        font-size: 12px;
      }
    `}</style>
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
    <button type="button" onClick={onClick} disabled={disabled} className={active ? 'is-active' : undefined}>
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

export default function PaperDocumentEditor({
  projectId,
  paperTitle,
  sections,
  outlineSections,
  isPreparing = false,
  activeSectionId,
  onSectionClick,
  onSectionsChange,
  onPaperTitleChange,
  onGenerateSection,
  onUpdateFootnote,
  onDeleteFootnote,
  emptyTitle,
  emptyText,
}: PaperDocumentEditorProps) {
  const [layoutDoc, setLayoutDoc] = useState<PaperEditorDoc>(() =>
    sectionsToPaperDoc(paperTitle, sections, outlineSections ? { sections: outlineSections } : null)
  )
  const [previewMode, setPreviewMode] = useState(false)
  const editMode = !previewMode
  const [inlineEditing, setInlineEditing] = useState<InlineEditingBlock | null>(null)
  const [measuredBlocks, setMeasuredBlocks] = useState<Record<string, number>>({})
  const [measuredFootnotes, setMeasuredFootnotes] = useState<Record<string, number>>({})
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [showFootnoteInput, setShowFootnoteInput] = useState(false)
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null)
  const [customInput, setCustomInput] = useState('')
  const [footnoteInput, setFootnoteInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingRevision, setPendingRevision] = useState<PendingRevision | null>(null)
  const [editingFootnote, setEditingFootnote] = useState<SectionFootnote | null>(null)
  const [footnoteDraft, setFootnoteDraft] = useState('')
  const [footnoteEditorPos, setFootnoteEditorPos] = useState({ top: 0, left: 0 })
  const [, setEditPageFootnotes] = useState<PageFootnoteGroup[]>([])
  const editPageRef = useRef<HTMLElement | null>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const footnoteOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleEditPageFootnotesRef = useRef<() => void>(() => undefined)
  const lastExternalDoc = useRef('')
  const previousSections = useRef(sections)
  const selectionRangeRef = useRef<SelectionRange | null>(null)

  useEffect(() => {
    previousSections.current = sections
  }, [sections])

  const initialDoc = useMemo(
    () => sectionsToPaperDoc(paperTitle, sections, outlineSections ? { sections: outlineSections } : null),
    [outlineSections, paperTitle, sections]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
      }),
      SectionHeadingAttributes,
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
        class: 'paper-document-editor-content',
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null
        const anchor = target?.closest<HTMLElement>('[data-footnote-id]')
        const footnoteId = anchor?.dataset.footnoteId
        if (!footnoteId) return false
        const footnote = sections.flatMap(section => section.footnotes ?? []).find(item => item.id === footnoteId)
        if (!footnote) return false
        openFootnoteEditor(footnote, event.clientX, event.clientY)
        return true
      },
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      const nextActive = findActiveSectionId(nextEditor)
      if (nextActive && nextActive !== activeSectionId) onSectionClick(nextActive)
      const nextToolbar = selectionToolbarState(nextEditor)
      selectionRangeRef.current = nextToolbar.range
      setSelectionToolbar(nextToolbar.toolbar)
      if (!nextToolbar.toolbar) {
        setShowCustomInput(false)
        setShowFootnoteInput(false)
        setPendingRevision(null)
        setError('')
      }
    },
    onFocus: ({ editor: nextEditor }) => {
      const nextActive = findActiveSectionId(nextEditor)
      if (nextActive) onSectionClick(nextActive)
      const nextToolbar = selectionToolbarState(nextEditor)
      selectionRangeRef.current = nextToolbar.range
      setSelectionToolbar(nextToolbar.toolbar)
    },
    onBlur: ({ editor: nextEditor }) => {
      persistEditor(nextEditor)
      setLayoutDoc(editorJson(nextEditor))
      scheduleEditPageFootnotesRef.current()
    },
    onUpdate: ({ editor: nextEditor }) => {
      const nextDoc = editorJson(nextEditor)
      setLayoutDoc(nextDoc)
      const nextToolbar = selectionToolbarState(nextEditor)
      selectionRangeRef.current = nextToolbar.range
      setSelectionToolbar(nextToolbar.toolbar)
      scheduleEditPageFootnotesRef.current()
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        persistEditor(nextEditor)
      }, 650)
    },
  })

  const openFootnoteEditor = useCallback((footnote: SectionFootnote, clientX: number, clientY: number) => {
    if (!onUpdateFootnote && !onDeleteFootnote) return
    setEditingFootnote(footnote)
    setFootnoteDraft(footnote.noteText)
    setFootnoteEditorPos({ top: clientY + 8, left: clientX - 120 })
  }, [onDeleteFootnote, onUpdateFootnote])

  const persistEditor = useCallback((nextEditor: Editor, snapshotLabel?: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const nextSections = paperDocToSections(editorJson(nextEditor), previousSections.current)
    onSectionsChange(nextSections, snapshotLabel)
  }, [onSectionsChange])

  const sourcePositions = (() => {
    if (!editor) return {}
    const positions: Record<string, number> = {}
    editor.state.doc.forEach((node, offset, index) => {
      const jsonNode = node.toJSON() as PaperEditorNode
      positions[blockSourceKey(jsonNode, index)] = offset + 1
    })
    return positions
  })()

  const footnotes = useMemo(
    () => sections.flatMap(section => section.footnotes ?? []).sort((a, b) => a.number - b.number),
    [sections]
  )

  const layoutBlocks = useMemo(
    () => buildPaperLayoutBlocks(paperTitle, layoutDoc.content ?? [], sourcePositions),
    [layoutDoc, paperTitle, sourcePositions]
  )

  const paginated = useMemo(
    () => paginatePaperBlocks(layoutBlocks, footnotes, measuredBlocks, measuredFootnotes, PAGE),
    [footnotes, layoutBlocks, measuredBlocks, measuredFootnotes]
  )

  const refreshEditPageFootnotes = useCallback(() => {
    const page = editPageRef.current
    if (!page || !editMode) {
      setEditPageFootnotes(prev => prev.length === 0 ? prev : [])
      return
    }
    const contentLayer = page.querySelector<HTMLElement>('.paper-edit-content-layer')
    const measuredContentHeight = contentLayer
      ? Array.from(contentLayer.children).reduce((height, child) => {
          const element = child as HTMLElement
          return Math.max(height, element.offsetTop + element.offsetHeight)
        }, 0)
      : 0
    const contentHeight = Math.max(measuredContentHeight + PAGE.marginBottom, PAGE.height)
    const nextPageCount = Math.max(1, Math.ceil(contentHeight / PAGE.height))
    const footnotesById = new Map(footnotes.map(footnote => [footnote.id, footnote]))
    const groups = new Map<number, SectionFootnote[]>()
    const pageRect = page.getBoundingClientRect()
    page.querySelectorAll<HTMLElement>('[data-footnote-id]').forEach(anchor => {
      const footnoteId = anchor.dataset.footnoteId
      const footnote = footnoteId ? footnotesById.get(footnoteId) : null
      if (!footnote) return
      const anchorTop = anchor.getBoundingClientRect().top - pageRect.top
      const pageNumber = Math.max(1, Math.min(nextPageCount, Math.floor(anchorTop / PAGE.height) + 1))
      const list = groups.get(pageNumber) ?? []
      if (!list.some(item => item.id === footnote.id)) list.push(footnote)
      groups.set(pageNumber, list)
    })
    const nextGroups = Array.from(groups.entries()).map(([pageNumber, items]) => ({
      page: pageNumber,
      top: (pageNumber - 1) * PAGE.height + PAGE.height - PAGE.marginBottom + 10,
      footnotes: items.slice().sort((a, b) => a.number - b.number),
    }))
    setEditPageFootnotes(prev => JSON.stringify(prev) === JSON.stringify(nextGroups) ? prev : nextGroups)
  }, [editMode, footnotes])

  const scheduleEditPageFootnotes = useCallback(() => {
    if (footnoteOverlayTimer.current) clearTimeout(footnoteOverlayTimer.current)
    footnoteOverlayTimer.current = setTimeout(refreshEditPageFootnotes, 120)
  }, [refreshEditPageFootnotes])

  useEffect(() => {
    scheduleEditPageFootnotesRef.current = scheduleEditPageFootnotes
  }, [scheduleEditPageFootnotes])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const nextDoc = sectionsToPaperDoc(paperTitle, sections, outlineSections ? { sections: outlineSections } : null)
    const nextSerialized = JSON.stringify(nextDoc)
    if (nextSerialized === lastExternalDoc.current) return
    const currentSerialized = JSON.stringify(editor.getJSON())
    if (currentSerialized === nextSerialized) return
    lastExternalDoc.current = nextSerialized
    editor.commands.setContent(nextDoc as JSONContent, { emitUpdate: false })
    window.queueMicrotask(() => {
      setInlineEditing(null)
      setLayoutDoc(nextDoc)
      refreshEditPageFootnotes()
    })
  }, [editor, outlineSections, paperTitle, refreshEditPageFootnotes, sections])

  useLayoutEffect(() => {
    const root = measureRef.current
    if (!root) return
    const outerHeight = (element: HTMLElement) => {
      const style = window.getComputedStyle(element)
      const marginTop = Number.parseFloat(style.marginTop) || 0
      const marginBottom = Number.parseFloat(style.marginBottom) || 0
      return element.getBoundingClientRect().height + marginTop + marginBottom
    }
    const nextBlocks: Record<string, number> = {}
    root.querySelectorAll<HTMLElement>('[data-measure-key]').forEach(element => {
      const key = element.dataset.measureKey
      if (key) nextBlocks[key] = outerHeight(element)
    })
    const nextFootnotes: Record<string, number> = {}
    root.querySelectorAll<HTMLElement>('[data-measure-footnote-id]').forEach(element => {
      const id = element.dataset.measureFootnoteId
      if (id) nextFootnotes[id] = outerHeight(element)
    })
    setMeasuredBlocks(prev => JSON.stringify(prev) === JSON.stringify(nextBlocks) ? prev : nextBlocks)
    setMeasuredFootnotes(prev => JSON.stringify(prev) === JSON.stringify(nextFootnotes) ? prev : nextFootnotes)
  }, [layoutBlocks, footnotes, paperTitle])

  useEffect(() => {
    if (!editor) return

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
  }, [editor])

  useEffect(() => {
    if (!editMode) {
      window.queueMicrotask(() => {
        setEditPageFootnotes(prev => prev.length === 0 ? prev : [])
      })
      return
    }
    scheduleEditPageFootnotes()
    const page = editPageRef.current
    if (!page) return
    const observer = new ResizeObserver(scheduleEditPageFootnotes)
    const mutationObserver = new MutationObserver(scheduleEditPageFootnotes)
    observer.observe(page)
    mutationObserver.observe(page, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', scheduleEditPageFootnotes)
    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', scheduleEditPageFootnotes)
    }
  }, [editMode, scheduleEditPageFootnotes, sections])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (footnoteOverlayTimer.current) clearTimeout(footnoteOverlayTimer.current)
  }, [])

  const clearTransientUi = useCallback(() => {
    setShowCustomInput(false)
    setShowFootnoteInput(false)
    setCustomInput('')
    setFootnoteInput('')
    setError('')
    setPendingRevision(null)
    setSelectionToolbar(null)
    selectionRangeRef.current = null
  }, [])

  const requestRewrite = useCallback((messages: Message[], type: PendingRevision['type'], instruction: string) => {
    if (!editor || loading) return
    const range = selectionRangeRef.current ?? editor.state.selection
    const { from, to } = range
    const beforeText = selectedTextInRange(editor, { from, to })
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
    const range = selectionRangeRef.current
    const typeMap: Record<QuickAction, PendingRevision['type']> = {
      缩短: 'shorten',
      扩写: 'expand',
      学术化: 'academic',
    }
    requestRewrite(
      promptQuickAction(action, selectedTextInRange(editor, range), selectedContextInRange(editor, range)),
      typeMap[action],
      action
    )
  }, [editor, requestRewrite])

  const customRewrite = useCallback(() => {
    if (!editor || !customInput.trim()) return
    const range = selectionRangeRef.current
    requestRewrite(
      promptRewriteSelection(customInput.trim(), selectedTextInRange(editor, range), selectedContextInRange(editor, range)),
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

    revisionStore.add({
      projectId,
      sectionId: findActiveSectionId(editor) ?? 'paper',
      type: pendingRevision.type,
      beforeText: pendingRevision.beforeText,
      afterText: pendingRevision.afterText,
      instruction: pendingRevision.instruction,
    })
    setPendingRevision(null)
    setSelectionToolbar(null)
    selectionRangeRef.current = null
  }, [editor, pendingRevision, projectId])

  const addFootnote = useCallback(() => {
    if (!editor || !footnoteInput.trim()) return
    const range = selectionRangeRef.current ?? editor.state.selection
    const { from, to } = range
    const anchorText = selectedTextInRange(editor, { from, to })
    const sectionId = findActiveSectionId(editor)
    if (!anchorText || !sectionId) return

    const footnote: SectionFootnote = {
      id: uid(),
      number: nextFootnoteNumber(sections),
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
      .setMark('footnote', { footnoteId: footnote.id, footnoteNumber: footnote.number, noteText: footnote.noteText })
      .run()

    const nextDoc = editorJson(editor)
    const nextSections = paperDocToSections(nextDoc, previousSections.current).map(section =>
      section.id === sectionId
        ? { ...section, footnotes: [...(section.footnotes ?? []), footnote] }
        : section
    )
    onSectionsChange(nextSections, `添加脚注：${anchorText.slice(0, 12)}`)
    setLayoutDoc(nextDoc)
    setFootnoteInput('')
    setShowFootnoteInput(false)
    setSelectionToolbar(null)
    selectionRangeRef.current = null
  }, [editor, footnoteInput, onSectionsChange, sections])

  const findEditorBlock = useCallback((block: PaperLayoutBlock): InlineEditorTarget | null => {
    if (!editor || !block.node) return null
    let found: InlineEditorTarget | null = null
    editor.state.doc.forEach((node, offset, index) => {
      const jsonNode = node.toJSON() as PaperEditorNode
      if (blockSourceKey(jsonNode, index) === block.sourceKey) {
        found = { pos: offset, nodeSize: node.nodeSize }
      }
    })
    return found
  }, [editor])

  const startInlineEditing = useCallback((block: PaperLayoutBlock, event?: MouseEvent<HTMLElement>) => {
    clearTransientUi()
    if (block.sectionId && block.sectionId !== activeSectionId) onSectionClick(block.sectionId)
    setInlineEditing({
      block,
      text: block.text ?? editorNodeText(block.node),
      initialOffset: event ? estimateTextOffsetFromClick(block, event) : undefined,
    })
  }, [activeSectionId, clearTransientUi, onSectionClick])

  const cancelInlineEditing = useCallback(() => {
    setInlineEditing(null)
  }, [])

  const saveInlineEditing = (inlineDoc: PaperEditorDoc) => {
    if (!inlineEditing) return
    const savedNodes = inlineDoc.content ?? []
    const nextText = savedNodes.map(node => editorNodeText(node)).join('\n').replace(/\s+$/g, '')
    if (inlineEditing.block.type === 'title') {
      onPaperTitleChange(nextText.replace(/\n+/g, ' '))
      setInlineEditing(null)
      return
    }
    if (!editor || !inlineEditing.block.node) {
      setInlineEditing(null)
      return
    }

    const target = findEditorBlock(inlineEditing.block)
    if (!target) {
      setInlineEditing(null)
      return
    }

    const nodeType = editor.schema.nodes[inlineEditing.block.node.type]
    if (!nodeType) {
      setInlineEditing(null)
      return
    }

    const attrs = inlineEditing.block.node.attrs ?? {}
    const replacementNodes = inlineEditing.block.type === 'paragraph'
      ? savedNodes
          .filter(node => node.type === 'paragraph' || node.type === 'heading')
          .map(node => node.type === 'paragraph'
            ? editor.schema.nodes.paragraph.create(node.attrs ?? {}, editorNodeText(node) ? editor.schema.text(editorNodeText(node)) : undefined)
            : editor.schema.nodes.paragraph.create({}, editorNodeText(node) ? editor.schema.text(editorNodeText(node)) : undefined)
          )
      : [nodeType.create(attrs, nextText.replace(/\n+/g, ' ').trim() ? editor.schema.text(nextText.replace(/\n+/g, ' ').trim()) : undefined)]
    const safeReplacementNodes = replacementNodes.length > 0
      ? replacementNodes
      : [nodeType.create(attrs)]
    const transaction = editor.state.tr.replaceWith(target.pos, target.pos + target.nodeSize, safeReplacementNodes)
    editor.view.dispatch(transaction)
    const nextDoc = editorJson(editor)
    persistEditor(editor, `页内编辑：${nextText.slice(0, 12)}`)
    setLayoutDoc(nextDoc)
    setInlineEditing(null)
  }

  void startInlineEditing
  void cancelInlineEditing
  void saveInlineEditing

  const openFullEdit = useCallback(() => {
    setInlineEditing(null)
    setPreviewMode(false)
    window.setTimeout(() => editor?.commands.focus(), 30)
  }, [editor])

  const showPagedPreview = () => {
    if (editor) {
      persistEditor(editor)
      setLayoutDoc(editorJson(editor))
    }
    clearTransientUi()
    setInlineEditing(null)
    setPreviewMode(true)
  }

  if (sections.length === 0) {
    const title = emptyTitle ?? (isPreparing ? '正在准备正文' : '文档还是空的')
    const text = emptyText ?? (isPreparing
      ? '已读取确认大纲，正在整理全文计划并准备逐章生成正文。'
      : '先在阶段二确认大纲，或在左侧对话框说明章节标题，AI 会生成正文出现在这里。')

    return (
      <div className="paper-document-empty">
        {isPreparing ? <div className="paper-document-spinner" aria-hidden="true" /> : <div style={{ fontSize: 32 }}>□</div>}
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink-2)' }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>{text}</div>
        <PaperDocumentStyles />
      </div>
    )
  }

  if (!editor) return null

  const selectionToolbarPortal = editMode && selectionToolbar && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="paper-bubble-menu paper-selection-toolbar-portal"
          style={{
            position: 'fixed',
            top: selectionToolbar.top,
            left: selectionToolbar.left,
            transform: 'translate(-50%, calc(-100% - 8px))',
            zIndex: 2147483647,
          }}
          onMouseDown={keepEditorSelectionOnMenuMouseDown}
        >
          <div className="paper-bubble-row">
            <span className="paper-bubble-count">已选中 {selectionToolbar.selectedLength} 字</span>
            <MenuButton icon={<Wand2 size={12} />} label="AI 改写" active={showCustomInput} disabled={loading} onClick={() => {
              setShowCustomInput(value => !value)
              setShowFootnoteInput(false)
            }} />
            <MenuButton icon={<Minimize2 size={12} />} label="缩短" disabled={loading} onClick={() => quickAction('缩短')} />
            <MenuButton icon={<Maximize2 size={12} />} label="扩写" disabled={loading} onClick={() => quickAction('扩写')} />
            <MenuButton icon={<BookOpen size={12} />} label="学术化" disabled={loading} onClick={() => quickAction('学术化')} />
            <MenuButton icon={<Quote size={12} />} label="给观点加引用" active={showFootnoteInput} disabled={loading} onClick={() => {
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
                {loading ? '处理中...' : '确认'}
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
                placeholder="为选中的观点补充来源：作者. 书名/篇名. 出版社/期刊, 年份, 页码."
              />
              <button type="button" onClick={addFootnote} disabled={!footnoteInput.trim()}>
                加到观点后
              </button>
            </div>
          )}

          {loading && <div className="paper-bubble-status">AI 正在生成修改建议...</div>}
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
        </div>,
        document.body
      )
    : null

  return (
    <>
    <div className="paper-document-root">
      <div className="paper-document-scroll">
        {editMode && (
          <button type="button" className="paper-preview-toggle" onClick={showPagedPreview}>
            <Edit3 size={12} />
            分页预览
          </button>
        )}

        {!editMode && (
          <>
            <button type="button" className="paper-preview-full-edit" onClick={openFullEdit}>
              <Edit3 size={12} />
              完整编辑
            </button>
            {paginated.pages.map(page => (
              <article key={page.number} className={`paper-page paper-preview-readonly ${page.footnotes.length > 0 ? 'has-footnotes' : ''}`}>
                <div className="paper-page-body">
                  {page.blocks.map(block => renderPreviewBlock(
                    block,
                    () => undefined
                  ))}
                </div>
                {page.footnotes.length > 0 && (
                  <div className="paper-page-footnotes">
                    {page.footnotes.map(footnote => (
                      <button
                        key={footnote.id}
                        type="button"
                        onClick={event => openFootnoteEditor(footnote, event.clientX, event.clientY)}
                      >
                        <sup>[{footnote.number}]</sup>
                        <span>{footnote.noteText}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="paper-page-number">{page.number}</div>
              </article>
            ))}
          </>
        )}

        {editMode && (
          <div className="paper-edit-shell">
            <div className="paper-edit-toolbar">
              <span>编辑模式：标题、关键词、正文都可直接修改</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {activeSectionId && (
                  <button
                    type="button"
                    onClick={() => onGenerateSection(findSectionTitleById(sections, activeSectionId))}
                  >
                    <Sparkles size={12} />
                    生成当前章节
                  </button>
                )}
                <button type="button" onClick={showPagedPreview}>
                  <Edit3 size={12} />
                  分页预览
                </button>
              </div>
            </div>

            <article className="paper-edit-page" ref={editPageRef}>
              <div className="paper-edit-content-layer">
              <div className="paper-title-block">
                <textarea
                  value={paperTitle}
                  onChange={event => onPaperTitleChange(event.target.value.replace(/\n/g, ' '))}
                  placeholder="请输入论文标题"
                  rows={2}
                />
              </div>

              <BubbleMenu
                editor={editor}
                appendTo={bubbleMenuContainer}
                options={{ strategy: 'fixed', placement: 'top', offset: 8, shift: { padding: 12 }, flip: true }}
                shouldShow={() => false}
              >
                <div className="paper-bubble-menu" onMouseDown={keepEditorSelectionOnMenuMouseDown}>
                  <div className="paper-bubble-row">
                    <span className="paper-bubble-count">已选中 {selectedTextForDisplay(editor).length} 字</span>
                    <MenuButton icon={<Wand2 size={12} />} label="AI 改写" active={showCustomInput} disabled={loading} onClick={() => {
                      setShowCustomInput(value => !value)
                      setShowFootnoteInput(false)
                    }} />
                    <MenuButton icon={<Minimize2 size={12} />} label="缩短" disabled={loading} onClick={() => quickAction('缩短')} />
                    <MenuButton icon={<Maximize2 size={12} />} label="扩写" disabled={loading} onClick={() => quickAction('扩写')} />
                    <MenuButton icon={<BookOpen size={12} />} label="学术化" disabled={loading} onClick={() => quickAction('学术化')} />
                    <MenuButton icon={<Quote size={12} />} label="给观点加引用" active={showFootnoteInput} disabled={loading} onClick={() => {
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
                        {loading ? '处理中...' : '确认'}
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
                        placeholder="为选中的观点补充来源：作者. 书名/篇名. 出版社/期刊, 年份, 页码."
                      />
                      <button type="button" onClick={addFootnote} disabled={!footnoteInput.trim()}>
                        加到观点后
                      </button>
                    </div>
                  )}

                  {loading && <div className="paper-bubble-status">AI 正在生成修改建议...</div>}
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

              {footnotes.length > 0 && (
                <div className="paper-footnote-list">
                  {footnotes.map(footnote => (
                    <button
                      key={footnote.id}
                      type="button"
                      onClick={event => openFootnoteEditor(footnote, event.clientX, event.clientY)}
                    >
                      <sup>[{footnote.number}]</sup>
                      <span>{footnote.noteText}</span>
                    </button>
                  ))}
                </div>
              )}
              </div>
            </article>
          </div>
        )}

        <div className="paper-measure-root" ref={measureRef} aria-hidden="true">
          {layoutBlocks.map(block => renderPreviewBlock(block, () => undefined))}
          <div className="paper-page-footnotes">
            {footnotes.map(footnote => (
              <button key={footnote.id} type="button" data-measure-footnote-id={footnote.id}>
                <sup>[{footnote.number}]</sup>
                <span>{footnote.noteText}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {editingFootnote && (
        <FootnoteEditor
          footnote={editingFootnote}
          draft={footnoteDraft}
          position={footnoteEditorPos}
          onDraftChange={setFootnoteDraft}
          onSave={() => {
            onUpdateFootnote?.(editingFootnote.id, footnoteDraft)
            setEditingFootnote(null)
          }}
          onDelete={() => {
            if (confirm(`确认删除脚注 [${editingFootnote.number}]？`)) {
              onDeleteFootnote?.(editingFootnote.id)
              setEditingFootnote(null)
            }
          }}
          onClose={() => setEditingFootnote(null)}
        />
      )}

      <PaperDocumentStyles />
    </div>
    {selectionToolbarPortal}
    </>
  )
}
