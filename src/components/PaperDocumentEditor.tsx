import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import type { Editor, JSONContent } from '@tiptap/core'
import { BookOpen, Check, Edit3, FlaskConical, Maximize2, Minimize2, Quote, Sparkles, Wand2, X } from 'lucide-react'
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
import { researchPackageStore, revisionStore, type DocSection, type OutlineSection, type ResearchContentPackage, type ResearchPackageComponent, type SectionFootnote } from '../lib/storage'
import { researchPackagePlainText } from '../lib/researchPackages'

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
  onInsertResearchSupport?: (title: string) => void
  onRegenerateResearchSupport?: (packageId: string) => void
  onUpdateFootnote?: (footnoteId: string, noteText: string) => void
  onDeleteFootnote?: (footnoteId: string) => void
  emptyTitle?: string
  emptyText?: string
  emptyAction?: ReactNode
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

const ResearchBlockParagraphAttributes = Extension.create({
  name: 'researchBlockParagraphAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          researchBlock: {
            default: false,
            parseHTML: element => element.getAttribute('data-research-block') === 'true',
            renderHTML: attrs => attrs.researchBlock ? { 'data-research-block': 'true' } : {},
          },
          researchPackageId: {
            default: null,
            parseHTML: element => element.getAttribute('data-research-package-id'),
            renderHTML: attrs => attrs.researchPackageId ? { 'data-research-package-id': attrs.researchPackageId } : {},
          },
          researchComponentIds: {
            default: null,
            parseHTML: element => element.getAttribute('data-research-component-ids')?.split(',').filter(Boolean) ?? null,
            renderHTML: attrs => Array.isArray(attrs.researchComponentIds) && attrs.researchComponentIds.length
              ? { 'data-research-component-ids': attrs.researchComponentIds.join(',') }
              : {},
          },
          researchFigureCaption: {
            default: false,
            parseHTML: element => element.getAttribute('data-research-figure-caption') === 'true',
            renderHTML: attrs => attrs.researchFigureCaption ? { 'data-research-figure-caption': 'true' } : {},
          },
          researchTableCaption: {
            default: false,
            parseHTML: element => element.getAttribute('data-research-table-caption') === 'true',
            renderHTML: attrs => attrs.researchTableCaption ? { 'data-research-table-caption': 'true' } : {},
          },
          researchTableRow: {
            default: false,
            parseHTML: element => element.getAttribute('data-research-table-row') === 'true',
            renderHTML: attrs => attrs.researchTableRow ? { 'data-research-table-row': 'true' } : {},
          },
        },
      },
    ]
  },
})

function selectedResearchComponents(pkg: ResearchContentPackage | null, componentIds: string[] = []) {
  if (!pkg) return [] as ResearchPackageComponent[]
  const selected = componentIds.length ? new Set(componentIds) : null
  return pkg.components.filter(component => !selected || selected.has(component.id))
}

function componentTitle(component: ResearchPackageComponent) {
  return component.label ? `${component.label} ${component.title ?? ''}`.trim() : component.title ?? ''
}

function researchFigureData(component: ResearchPackageComponent) {
  if (component.type !== 'figure' || !component.data || typeof component.data !== 'object') return null
  const data = component.data as { dataUrl?: unknown; caption?: unknown }
  return typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:image/')
    ? { dataUrl: data.dataUrl, caption: typeof data.caption === 'string' ? data.caption : component.content }
    : null
}

function researchArticleSummary(components: ResearchPackageComponent[]) {
  return components
    .filter(component => component.type === 'method' || component.type === 'analysis')
    .map(component => component.content.trim())
    .filter(Boolean)
    .join('\n\n')
}

function researchTablePreview(component: ResearchPackageComponent) {
  if (component.type !== 'statistics' && component.type !== 'table') return []
  const table = component.data && typeof component.data === 'object'
    ? component.data as { rows?: unknown[]; columns?: string[] }
    : null
  const rows = Array.isArray(table?.rows) ? table.rows : []
  const columns = Array.isArray(table?.columns) ? table.columns : []
  if (!rows.length || !columns.length) return []
  return rows.slice(0, 5).map(row =>
    columns.slice(0, 4).map(column => {
      const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : ''
      return value == null ? '' : String(value)
    }).join(' / ')
  )
}

function safeTableRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : []
}

function safeTableColumns(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return safeTableColumns(JSON.parse(value))
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function safeTableBool(value: unknown): boolean {
  return value === true || value === 'true'
}

function compactResearchTableColumns(columns: string[], title = '') {
  const rank = '\u6700\u7ec8\u8026\u5408\u4f18\u5148\u7ea7\u6392\u540d'
  const dimension = '\u8bbe\u8ba1\u7ef4\u5ea6'
  const sampleSize = '\u6837\u672c\u603b\u91cf'
  const kanoType = '\u4e3b\u5bfcKANO\u7c7b\u578b'
  const better = 'Better\u7cfb\u6570(\u6ee1\u610f\u5ea6\u63d0\u5347)'
  const worse = 'Worse\u7cfb\u6570\u7edd\u5bf9\u503c(\u4e0d\u6ee1\u964d\u4f4e)'
  const entropyScore = '\u71b5\u6743\u7efc\u5408\u5f97\u5206'
  const priorityScore = '\u8026\u5408\u4f18\u5148\u7ea7\u603b\u5f97\u5206'
  const columnSet = new Set(columns)
  const preferred = title.includes('KANO') && (title.includes('\u8026\u5408') || title.includes('\u4f18\u5148\u7ea7'))
    ? [rank, dimension, kanoType, better, worse, entropyScore, priorityScore]
    : title.includes('KANO')
      ? [dimension, sampleSize, kanoType, better, worse, rank]
      : []
  const selected = preferred.filter(column => columnSet.has(column))
  return (selected.length ? selected : columns).slice(0, 7)
}

function researchTableCellText(column: string, value: unknown) {
  const text = String(value ?? '').trim()
  const maxLength = column === '\u7ef4\u5ea6\u5168\u79f0' ? 18 : column === '\u8bbe\u8ba1\u7ef4\u5ea6' ? 8 : 28
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

const ResearchTableNode = Node.create({
  name: 'researchTable',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-title') ?? '',
        renderHTML: attrs => attrs.title ? { 'data-title': attrs.title } : {},
      },
      columns: {
        default: [],
        parseHTML: element => {
          try {
            return JSON.parse(element.getAttribute('data-columns') ?? '[]')
          } catch {
            return []
          }
        },
        renderHTML: attrs => ({ 'data-columns': JSON.stringify(attrs.columns ?? []) }),
      },
      columnLabels: {
        default: [],
        parseHTML: element => {
          try {
            return JSON.parse(element.getAttribute('data-column-labels') ?? '[]')
          } catch {
            return []
          }
        },
        renderHTML: attrs => ({ 'data-column-labels': JSON.stringify(attrs.columnLabels ?? []) }),
      },
      rows: {
        default: [],
        parseHTML: element => {
          try {
            return JSON.parse(element.getAttribute('data-rows') ?? '[]')
          } catch {
            return []
          }
        },
        renderHTML: attrs => ({ 'data-rows': JSON.stringify(attrs.rows ?? []) }),
      },
      note: {
        default: '',
        parseHTML: element => element.getAttribute('data-note') ?? '',
        renderHTML: attrs => attrs.note ? { 'data-note': attrs.note } : {},
      },
      truncated: {
        default: false,
        parseHTML: element => element.getAttribute('data-truncated') === 'true',
        renderHTML: attrs => attrs.truncated ? { 'data-truncated': 'true' } : {},
      },
      totalRows: {
        default: null,
        parseHTML: element => element.getAttribute('data-total-rows'),
        renderHTML: attrs => attrs.totalRows ? { 'data-total-rows': attrs.totalRows } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-research-table="true"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs ?? {}
    const title = String(attrs.title ?? HTMLAttributes['data-title'] ?? HTMLAttributes.title ?? '')
    const rawColumns = safeTableColumns(attrs.columns ?? HTMLAttributes.columns ?? HTMLAttributes['data-columns'])
    const labels = safeTableColumns(attrs.columnLabels ?? HTMLAttributes.columnLabels ?? HTMLAttributes['data-column-labels'])
    const rows = safeTableRows(attrs.rows ?? HTMLAttributes.rows ?? HTMLAttributes['data-rows'])
    const note = String(attrs.note ?? HTMLAttributes['data-note'] ?? HTMLAttributes.note ?? '')
    const truncated = safeTableBool(attrs.truncated ?? HTMLAttributes['data-truncated'] ?? HTMLAttributes.truncated)
    const totalRows = String(attrs.totalRows ?? HTMLAttributes['data-total-rows'] ?? HTMLAttributes.totalRows ?? '')
    const columns = compactResearchTableColumns(rawColumns, title)
    const labelByColumn = new Map(rawColumns.map((column, index) => [column, labels[index] || column]))
    const headerLabels = columns.map(column => labelByColumn.get(column) || column)
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-research-table': 'true',
        class: 'paper-research-table-figure',
        contenteditable: 'false',
      }),
      ...(title ? [['figcaption', { class: 'paper-research-table-title' }, title]] : []),
      ['table', { class: 'paper-research-table' },
        ['thead', {}, ['tr', {}, ...headerLabels.map(label => ['th', {}, label])]],
        ['tbody', {}, ...rows.map(row => ['tr', {}, ...columns.map(column => ['td', {}, researchTableCellText(column, row[column])])])],
      ],
      ...(note || truncated ? [['figcaption', { class: 'paper-research-table-note' }, [
        note,
        truncated ? `（表内展示前 ${rows.length} 行，完整数据共 ${totalRows || rows.length} 行。）` : '',
      ].filter(Boolean).join('')]] : []),
    ]
  },
})

function researchTableAttrs(node: PaperEditorNode | undefined) {
  const attrs = node?.attrs ?? {}
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const rawColumns = safeTableColumns(attrs.columns)
  const rawLabels = safeTableColumns(attrs.columnLabels)
  const columns = compactResearchTableColumns(rawColumns, title)
  const labelByColumn = new Map(rawColumns.map((column, index) => [column, rawLabels[index] || column]))
  return {
    title,
    columns,
    labels: columns.map(column => labelByColumn.get(column) || column),
    rows: safeTableRows(attrs.rows).map(row => Object.fromEntries(columns.map(column => [column, researchTableCellText(column, row[column])]))),
    note: typeof attrs.note === 'string' ? attrs.note : '',
    truncated: safeTableBool(attrs.truncated),
    totalRows: attrs.totalRows == null ? '' : String(attrs.totalRows),
  }
}

function ResearchTableView({ node, measureKey, sectionId }: {
  node?: PaperEditorNode
  measureKey?: string
  sectionId?: string
}) {
  const table = researchTableAttrs(node)
  return (
    <figure
      className="paper-research-table-figure paper-preview-block"
      data-measure-key={measureKey}
      data-section-id={sectionId}
    >
      {table.title && <figcaption className="paper-research-table-title">{table.title}</figcaption>}
      <table className="paper-research-table">
        <thead>
          <tr>{table.labels.map((label, index) => <th key={`${label}-${index}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {table.columns.map(column => <td key={column}>{String(row[column] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {(table.note || table.truncated) && (
        <figcaption className="paper-research-table-note">
          {[table.note, table.truncated ? `（表内展示前 ${table.rows.length} 行，完整数据共 ${table.totalRows || table.rows.length} 行。）` : ''].filter(Boolean).join('')}
        </figcaption>
      )}
    </figure>
  )
}

const ResearchBlockNode = Node.create({
  name: 'researchBlock',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      researchPackageId: {
        default: null,
        parseHTML: element => element.getAttribute('data-research-package-id'),
        renderHTML: attrs => attrs.researchPackageId ? { 'data-research-package-id': attrs.researchPackageId } : {},
      },
      researchComponentIds: {
        default: null,
        parseHTML: element => element.getAttribute('data-research-component-ids')?.split(',').filter(Boolean) ?? null,
        renderHTML: attrs => Array.isArray(attrs.researchComponentIds) && attrs.researchComponentIds.length
          ? { 'data-research-component-ids': attrs.researchComponentIds.join(',') }
          : {},
      },
      title: {
        default: '研究结果',
        parseHTML: element => element.getAttribute('data-title') || '研究结果',
        renderHTML: attrs => attrs.title ? { 'data-title': attrs.title } : {},
      },
      previewText: {
        default: '',
        parseHTML: element => element.getAttribute('data-preview-text') || element.textContent || '',
        renderHTML: attrs => attrs.previewText ? { 'data-preview-text': attrs.previewText } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-research-block-node="true"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const title = String(HTMLAttributes['data-title'] ?? HTMLAttributes.title ?? '研究结果')
    const previewText = String(HTMLAttributes['data-preview-text'] ?? HTMLAttributes.previewText ?? '')
    const packageId = String(HTMLAttributes['data-research-package-id'] ?? HTMLAttributes.researchPackageId ?? '')
    const componentIds = String(HTMLAttributes['data-research-component-ids'] ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    const pkg = researchPackageStore.get(packageId)
    const components = selectedResearchComponents(pkg, componentIds)
    const figureComponents = components.filter(component => researchFigureData(component))
    const summary = researchArticleSummary(components) || previewText
    const tableComponent = components.find(component => component.type === 'statistics' || component.type === 'table')
    const tableLines = tableComponent ? researchTablePreview(tableComponent) : []
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-research-block-node': 'true',
        class: 'paper-research-node',
        contenteditable: 'false',
      }),
      ['div', { class: 'paper-research-node-head' },
        ['span', { class: 'paper-research-node-badge' }, '研究结果'],
        ['strong', {}, title],
        ['button', { type: 'button', 'data-research-action': 'expand' }, '展开'],
        ['button', { type: 'button', 'data-research-action': 'regenerate' }, '重新生成'],
        ['button', { type: 'button', 'data-research-action': 'solidify' }, '写入正文'],
        ['button', { type: 'button', 'data-research-action': 'delete' }, '删除'],
      ],
      ['div', { class: 'paper-research-node-body' },
        ...(summary ? [['div', { class: 'paper-research-node-preview' }, summary]] : []),
        ...figureComponents.map(figureComponent => {
          const figure = researchFigureData(figureComponent)
          return [
          'figure',
          { class: 'paper-research-node-figure' },
            ['img', { class: 'paper-research-node-preview-image', src: figure?.dataUrl ?? '', alt: componentTitle(figureComponent) || title }],
            ['figcaption', {}, figure?.caption || componentTitle(figureComponent) || '分析结果图'],
          ]
        }),
        ...(tableLines.length ? [['div', { class: 'paper-research-node-table-preview' }, tableLines.join('\n')]] : []),
      ],
    ]
  },
})

const ResearchImageNode = Node.create({
  name: 'researchImage',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: element => element.querySelector('img')?.getAttribute('src') ?? element.getAttribute('data-src'),
        renderHTML: attrs => attrs.src ? { 'data-src': attrs.src } : {},
      },
      alt: {
        default: '',
        parseHTML: element => element.querySelector('img')?.getAttribute('alt') ?? '',
        renderHTML: attrs => attrs.alt ? { 'data-alt': attrs.alt } : {},
      },
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-title') ?? '',
        renderHTML: attrs => attrs.title ? { 'data-title': attrs.title } : {},
      },
      caption: {
        default: '',
        parseHTML: element => element.querySelector('figcaption')?.textContent ?? '',
        renderHTML: attrs => attrs.caption ? { 'data-caption': attrs.caption } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-research-image="true"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes['data-src'] ?? HTMLAttributes.src ?? '')
    const alt = String(HTMLAttributes['data-alt'] ?? HTMLAttributes.alt ?? HTMLAttributes.title ?? '分析结果图')
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-research-image': 'true',
        class: 'paper-research-figure',
        contenteditable: 'false',
      }),
      ['img', { src, alt, class: 'paper-research-figure-image' }],
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
      ResearchBlockParagraphAttributes,
      ResearchBlockNode,
      ResearchTableNode,
      ResearchImageNode,
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
    block.node?.attrs?.researchBlock ? 'paper-research-block' : '',
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

  if (block.type === 'research') {
    const title = typeof block.node?.attrs?.title === 'string' ? block.node.attrs.title : '研究结果'
    const packageId = typeof block.node?.attrs?.researchPackageId === 'string' ? block.node.attrs.researchPackageId : ''
    const componentIds = Array.isArray(block.node?.attrs?.researchComponentIds)
      ? block.node.attrs.researchComponentIds.filter((item): item is string => typeof item === 'string')
      : []
    const pkg = researchPackageStore.get(packageId)
    const components = selectedResearchComponents(pkg, componentIds)
    const figureComponents = components.filter(component => researchFigureData(component))
    const summary = researchArticleSummary(components) || text
    const tableComponent = components.find(component => component.type === 'statistics' || component.type === 'table')
    const tableLines = tableComponent ? researchTablePreview(tableComponent) : []
    return (
      <div
        key={block.key}
        className="paper-preview-block paper-research-block"
        data-measure-key={block.key}
        data-section-id={block.sectionId}
        onClick={event => onClick(block, event)}
      >
        <div className="paper-research-preview-head">
          <span>研究结果</span>
          <strong>{title}</strong>
        </div>
        {summary && <div className="paper-research-preview-text">{summary}</div>}
        {figureComponents.map(figureComponent => {
          const figure = researchFigureData(figureComponent)
          if (!figure) return null
          return (
            <figure key={figureComponent.id} className="paper-research-node-figure">
              <img className="paper-research-node-preview-image" src={figure.dataUrl} alt={componentTitle(figureComponent) || title} />
              <figcaption>{figure.caption || componentTitle(figureComponent) || '分析结果图'}</figcaption>
            </figure>
          )
        })}
        {tableLines.length > 0 && <div className="paper-research-node-table-preview">{tableLines.join('\n')}</div>}
      </div>
    )
  }

  if (block.type === 'image') {
    const src = typeof block.node?.attrs?.src === 'string' ? block.node.attrs.src : ''
    const alt = typeof block.node?.attrs?.alt === 'string' ? block.node.attrs.alt : '分析结果图'
    return (
      <figure
        key={block.key}
        className="paper-preview-block paper-research-figure"
        data-measure-key={block.key}
        data-section-id={block.sectionId}
      >
        {src && <img className="paper-research-figure-image" src={src} alt={alt} />}
      </figure>
    )
  }

  if (block.type === 'table') {
    return (
      <ResearchTableView
        key={block.key}
        node={block.node}
        measureKey={block.key}
        sectionId={block.sectionId}
      />
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

      .paper-document-empty-action {
        margin-top: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
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
      .paper-preview-full-edit,
      .paper-preview-research-action {
        position: sticky;
        top: 0;
        z-index: 6;
        align-self: flex-end;
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

      .paper-preview-toggle,
      .paper-preview-full-edit {
        margin: 0 calc((100% - ${PAGE.width}px) / 2) 8px 0;
      }

      .paper-preview-action-bar {
        position: sticky;
        top: 0;
        z-index: 7;
        align-self: flex-end;
        margin: 0 calc((100% - ${PAGE.width}px) / 2) 8px 0;
        display: inline-flex;
        gap: 8px;
      }

      .paper-preview-action-bar .paper-preview-toggle,
      .paper-preview-action-bar .paper-preview-full-edit,
      .paper-preview-action-bar .paper-preview-research-action {
        position: static;
        margin: 0;
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

      .paper-research-block,
      .paper-research-node,
      .ProseMirror p[data-research-block="true"] {
        border: none;
        border-left: 2px solid rgba(45, 90, 61, 0.32);
        border-radius: 0;
        background: transparent;
        padding: 4px 0 4px 14px;
        text-indent: 0;
        white-space: pre-wrap;
      }

      .paper-research-block::before,
      .ProseMirror p[data-research-block="true"]::before {
        content: "";
        display: none;
      }

      .paper-research-node {
        margin: 14px 0 18px;
        font-family: var(--font-serif);
        white-space: normal;
      }

      .paper-research-node-head,
      .paper-research-preview-head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        margin-bottom: 8px;
        font-family: var(--font-sans);
      }

      .paper-research-node-badge,
      .paper-research-preview-head span {
        flex-shrink: 0;
        border-radius: 999px;
        background: var(--color-accent-light);
        color: var(--color-accent);
        padding: 2px 7px;
        font-size: 10px;
        font-weight: 850;
      }

      .paper-research-node-head strong,
      .paper-research-preview-head strong {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-ink);
        font-size: 12px;
      }

      .paper-research-node button {
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.88);
        color: var(--color-ink-2);
        padding: 3px 7px;
        font-size: 11px;
        cursor: pointer;
        font-family: var(--font-sans);
      }

      .paper-research-node-preview,
      .paper-research-preview-text {
        margin-top: 8px;
        color: var(--color-ink-2);
        font-size: 14.5px;
        line-height: 2;
        max-height: none;
        overflow: visible;
        white-space: pre-wrap;
        text-indent: 2em;
        text-align: justify;
      }

      .paper-research-node-body {
        display: grid;
        gap: 10px;
      }

      .paper-research-node-preview-image {
        display: block;
        width: 100%;
        max-width: 620px;
        max-height: 420px;
        object-fit: contain;
        object-position: center;
        margin: 8px auto 6px;
        border: 1px solid rgba(45, 90, 61, 0.16);
        border-radius: 4px;
        background: #fff;
      }

      .paper-research-node-figure {
        margin: 8px 0 12px;
        text-align: center;
      }

      .paper-research-node-figure figcaption {
        margin-top: 6px;
        color: var(--color-ink-3);
        font-family: var(--font-serif);
        font-size: 12px;
        line-height: 1.6;
      }

      .paper-research-node-table-preview {
        margin: 8px 0 12px;
        padding: 8px 10px;
        border: 1px solid rgba(45, 90, 61, 0.14);
        border-radius: 4px;
        background: #FAFCFA;
        color: var(--color-ink-2);
        font-family: var(--font-sans);
        font-size: 11px;
        line-height: 1.6;
        white-space: pre-wrap;
      }

      .paper-research-figure {
        margin: 18px 0 14px;
        text-align: center;
        break-inside: avoid;
      }

      .paper-research-figure-image {
        display: block;
        width: 100%;
        max-width: 620px;
        max-height: none;
        object-fit: contain;
        object-position: center;
        margin: 0 auto 8px;
        border: 1px solid rgba(30, 42, 34, 0.12);
        background: #fff;
      }

      .paper-research-figure figcaption,
      .ProseMirror p[data-research-figure-caption="true"] {
        margin: 6px 0 12px;
        color: var(--color-ink);
        font-family: var(--font-serif);
        font-size: 13px;
        line-height: 1.8;
        text-align: center;
        text-indent: 0;
      }

      .ProseMirror p[data-research-table-caption="true"] {
        text-align: center;
        text-indent: 0;
        font-weight: 650;
      }

      .ProseMirror p[data-research-table-row="true"] {
        text-align: center;
        text-indent: 0;
        font-family: var(--font-sans);
        font-size: 12px;
        line-height: 1.7;
        white-space: pre-wrap;
      }

      .paper-research-table-figure {
        margin: 18px 0 18px;
        break-inside: avoid;
      }

      .paper-research-table-title {
        margin: 0 0 8px;
        color: var(--color-ink);
        font-family: var(--font-serif);
        font-size: 13px;
        font-weight: 650;
        line-height: 1.8;
        text-align: center;
      }

      .paper-research-table {
        width: 100%;
        border-collapse: collapse;
        border-top: 1.4px solid var(--color-ink);
        border-bottom: 1.4px solid var(--color-ink);
        font-family: var(--font-serif);
        font-size: 11px;
        line-height: 1.5;
        table-layout: fixed;
      }

      .paper-research-table th {
        border-bottom: 1px solid var(--color-ink);
        padding: 4px 5px;
        font-weight: 650;
        text-align: center;
        white-space: normal;
        word-break: keep-all;
      }

      .paper-research-table td {
        padding: 4px 5px;
        text-align: center;
        vertical-align: middle;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }

      .paper-research-table th:first-child,
      .paper-research-table td:first-child {
        width: 44px;
      }

      .paper-research-table th:nth-child(2),
      .paper-research-table td:nth-child(2) {
        width: 82px;
      }

      .paper-research-table-note {
        margin: 7px 0 0;
        color: var(--color-ink-2);
        font-family: var(--font-serif);
        font-size: 11px;
        line-height: 1.7;
        text-align: left;
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

function EmptyPaperDocument({ isPreparing, emptyTitle, emptyText, emptyAction }: Pick<PaperDocumentEditorProps, 'isPreparing' | 'emptyTitle' | 'emptyText' | 'emptyAction'>) {
  const title = emptyTitle ?? (isPreparing ? '正在准备正文' : '文档还是空的')
  const text = emptyText ?? (isPreparing
    ? '已读取确认大纲，正在整理全文计划并准备逐章生成正文。'
    : '先在阶段二确认大纲，或在左侧对话框说明章节标题，AI 会生成正文出现在这里。')

  return (
    <div className="paper-document-empty">
      {isPreparing ? <div className="paper-document-spinner" aria-hidden="true" /> : <div style={{ fontSize: 32 }}>□</div>}
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink-2)' }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>{text}</div>
      {emptyAction && <div className="paper-document-empty-action">{emptyAction}</div>}
      <PaperDocumentStyles />
    </div>
  )
}

export default function PaperDocumentEditor(props: PaperDocumentEditorProps) {
  if (props.sections.length === 0) {
    return (
      <EmptyPaperDocument
        isPreparing={props.isPreparing}
        emptyTitle={props.emptyTitle}
        emptyText={props.emptyText}
        emptyAction={props.emptyAction}
      />
    )
  }

  return <PaperDocumentEditorCore {...props} />
}

function PaperDocumentEditorCore({
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
  onInsertResearchSupport,
  onRegenerateResearchSupport,
  onUpdateFootnote,
  onDeleteFootnote,
  emptyTitle,
  emptyText,
  emptyAction,
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
      ResearchBlockParagraphAttributes,
      ResearchBlockNode,
      ResearchTableNode,
      ResearchImageNode,
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
      handleClick: (view, _pos, event) => {
        const target = event.target as HTMLElement | null
        const researchAction = target?.closest<HTMLElement>('[data-research-action]')
        if (researchAction) {
          const block = researchAction.closest<HTMLElement>('[data-research-block-node]')
          const packageId = block?.dataset.researchPackageId
          const pkg = packageId ? researchPackageStore.get(packageId) : null
          const componentIds = block?.dataset.researchComponentIds?.split(',').filter(Boolean) ?? []
          if (!pkg || !packageId) return true

          let nodePos: number | null = null
          let nodeSize = 1
          view.state.doc.descendants((node, pos) => {
            if (node.type.name === 'researchBlock' && node.attrs.researchPackageId === packageId && nodePos == null) {
              nodePos = pos
              nodeSize = node.nodeSize
              return false
            }
            return true
          })

          const action = researchAction.dataset.researchAction
          if (action === 'expand') {
            alert(researchPackagePlainText(pkg, componentIds))
            return true
          }
          if (action === 'regenerate') {
            onRegenerateResearchSupport?.(packageId)
            return true
          }
          if (action === 'solidify' && nodePos != null) {
            const text = researchPackagePlainText(pkg, componentIds)
            const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean).map(part =>
              view.state.schema.nodes.paragraph.create({}, view.state.schema.text(part))
            )
            view.dispatch(view.state.tr.replaceWith(nodePos, nodePos + nodeSize, paragraphs))
            const nextDoc = view.state.doc.toJSON() as PaperEditorDoc
            onSectionsChange(paperDocToSections(nextDoc, previousSections.current), `写入研究结果正文：${pkg.title}`)
            setLayoutDoc(nextDoc)
            return true
          }
          if (action === 'delete' && nodePos != null) {
            const deleteAsset = confirm('是否同时删除关联的研究内容包？选择“取消”仅从正文删除该块。')
            view.dispatch(view.state.tr.delete(nodePos, nodePos + nodeSize))
            if (deleteAsset) researchPackageStore.remove(packageId)
            const nextDoc = view.state.doc.toJSON() as PaperEditorDoc
            onSectionsChange(paperDocToSections(nextDoc, previousSections.current), `删除研究结果：${pkg.title}`)
            setLayoutDoc(nextDoc)
            return true
          }
          return true
        }
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

  const sourcePositions = useMemo(() => {
    if (editMode) return {}
    if (!editor) return {}
    const positions: Record<string, number> = {}
    editor.state.doc.forEach((node, offset, index) => {
      const jsonNode = node.toJSON() as PaperEditorNode
      positions[blockSourceKey(jsonNode, index)] = offset + 1
    })
    return positions
  }, [editMode, editor])

  const footnotes = useMemo(
    () => sections.flatMap(section => section.footnotes ?? []).sort((a, b) => a.number - b.number),
    [sections]
  )

  const layoutBlocks = useMemo(
    () => editMode ? [] : buildPaperLayoutBlocks(paperTitle, layoutDoc.content ?? [], sourcePositions),
    [editMode, layoutDoc, paperTitle, sourcePositions]
  )

  const paginated = useMemo(
    () => editMode
      ? { pages: [], overflowWarnings: [] }
      : paginatePaperBlocks(layoutBlocks, footnotes, measuredBlocks, measuredFootnotes, PAGE),
    [editMode, footnotes, layoutBlocks, measuredBlocks, measuredFootnotes]
  )

  const refreshEditPageFootnotes = useCallback(() => undefined, [])

  const scheduleEditPageFootnotes = useCallback(() => {
    return
  }, [])

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
    if (editMode) {
      window.queueMicrotask(() => {
        setMeasuredBlocks(prev => Object.keys(prev).length === 0 ? prev : {})
        setMeasuredFootnotes(prev => Object.keys(prev).length === 0 ? prev : {})
      })
      return
    }
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
  }, [editMode, layoutBlocks, footnotes, paperTitle])

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
    window.queueMicrotask(() => {
      setEditPageFootnotes(prev => prev.length === 0 ? prev : [])
    })
  }, [editMode, sections])

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
        {emptyAction && <div className="paper-document-empty-action">{emptyAction}</div>}
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
          <div className="paper-preview-action-bar">
            <button type="button" className="paper-preview-toggle" onClick={showPagedPreview}>
              <Edit3 size={12} />
              分页预览
            </button>
            {activeSectionId && onInsertResearchSupport && (
              <button
                type="button"
                className="paper-preview-research-action"
                onClick={() => onInsertResearchSupport(findSectionTitleById(sections, activeSectionId))}
              >
                <FlaskConical size={12} />
                插入研究结果
              </button>
            )}
          </div>
        )}

        {!editMode && (
          <>
            <div className="paper-preview-action-bar">
              <button type="button" className="paper-preview-full-edit" onClick={openFullEdit}>
                <Edit3 size={12} />
                完整编辑
              </button>
              {activeSectionId && onInsertResearchSupport && (
                <button
                  type="button"
                  className="paper-preview-research-action"
                  onClick={() => onInsertResearchSupport(findSectionTitleById(sections, activeSectionId))}
                >
                  <FlaskConical size={12} />
                    插入研究结果
                </button>
              )}
            </div>
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
                {activeSectionId && onInsertResearchSupport && (
                  <button
                    type="button"
                    onClick={() => onInsertResearchSupport(findSectionTitleById(sections, activeSectionId))}
                  >
                    <FlaskConical size={12} />
                  插入研究结果
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

        {!editMode && (
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
        )}
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
