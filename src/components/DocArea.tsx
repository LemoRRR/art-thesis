import { useRef, useCallback, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { Sparkles } from 'lucide-react'
import SelectionToolbar from './SelectionToolbar'
import FootnoteText from './FootnoteText'
import FootnoteEditor from './FootnoteEditor'
import { formatSectionContent, isDuplicateSectionTitle, parsePaperBlocks, type PaperBlockType } from '../lib/documentFormat'
import { getFootnotesForBlock } from '../lib/footnotes'
import { sectionStore, versionStore, type DocSection, type SectionFootnote } from '../lib/storage'

interface DocAreaProps {
  projectId: string
  paperTitle: string
  sections:        DocSection[]
  activeSectionId: string | null
  onSectionClick:  (id: string) => void
  onSectionChange: (id: string, content: string) => void
  onPaperTitleChange: (title: string) => void
  onGenerateSection: (title: string) => void
  onAddFootnote?: (payload: {
    sectionId: string
    blockIndex: number
    start: number
    end: number
    anchorText: string
    noteText: string
  }) => void
  onUpdateFootnote?: (footnoteId: string, noteText: string) => void
  onDeleteFootnote?: (footnoteId: string) => void
}

const A4_WIDTH = 794
const A4_MIN_HEIGHT = 1123
const PAGE_HORIZONTAL_PADDING = 86
const PAGE_VERTICAL_PADDING = 76
const PAGE_CONTENT_HEIGHT = A4_MIN_HEIGHT - PAGE_VERTICAL_PADDING * 2 - 44
const TITLE_AREA_HEIGHT = 108
const PREVIEW_UNITS_PER_LINE = 72
const PARAGRAPH_LINE_HEIGHT = 31

interface FlowBlock {
  id: string
  sectionId: string
  sectionTitle: string
  type: PaperBlockType | 'sectionTitle' | 'hint' | 'placeholder' | 'generating'
  text: string
  blockIndex?: number
  textStart?: number
  textEnd?: number
  previousText?: string
  height: number
}

function estimateBlockHeight(text: string, type: FlowBlock['type']): number {
  if (type === 'sectionTitle') return 54
  if (type === 'hint') return 34
  if (type === 'generating' || type === 'placeholder') return 48
  if (type === 'heading2') return 44
  if (type === 'heading3') return 38
  const lines = Math.max(1, Math.ceil(measureTextUnits(text) / PREVIEW_UNITS_PER_LINE))
  return lines * PARAGRAPH_LINE_HEIGHT + 10
}

function measureTextUnits(text: string): number {
  return Array.from(text).reduce((total, char) => {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) return total + 2
    if (/\s/.test(char)) return total + 0.5
    return total + 1
  }, 0)
}

function sliceByTextUnits(text: string, maxUnits: number): string {
  let used = 0
  let result = ''
  for (const char of Array.from(text)) {
    const weight = /[\u3400-\u9fff\uf900-\ufaff]/.test(char) ? 2 : /\s/.test(char) ? 0.5 : 1
    if (used + weight > maxUnits) break
    result += char
    used += weight
  }
  return result
}

function splitParagraphForPreview(text: string): string[] {
  const maxUnits = PREVIEW_UNITS_PER_LINE * 7
  if (measureTextUnits(text) <= maxUnits) return [text]

  const chunks: string[] = []
  let remaining = text.trim()

  while (measureTextUnits(remaining) > maxUnits) {
    const windowText = sliceByTextUnits(remaining, maxUnits)
    const breakAt = Math.max(
      windowText.lastIndexOf('。'),
      windowText.lastIndexOf('；'),
      windowText.lastIndexOf('，'),
      windowText.lastIndexOf('. '),
      windowText.lastIndexOf('; '),
      windowText.lastIndexOf(', ')
    )
    const safeBreak = breakAt > windowText.length * 0.45 ? breakAt + 1 : windowText.length
    chunks.push(remaining.slice(0, safeBreak).trim())
    remaining = remaining.slice(safeBreak).trim()
  }

  if (remaining) chunks.push(remaining)
  return chunks
}

function splitTextToFit(text: string, availableHeight: number): [string, string] | null {
  const availableLines = Math.floor((availableHeight - 10) / PARAGRAPH_LINE_HEIGHT)
  if (availableLines < 3) return null

  const windowText = sliceByTextUnits(text, availableLines * PREVIEW_UNITS_PER_LINE)
  if (windowText.length < 80 || windowText.length >= text.length) return null

  const breakAt = Math.max(
    windowText.lastIndexOf('。'),
    windowText.lastIndexOf('；'),
    windowText.lastIndexOf('，'),
    windowText.lastIndexOf('. '),
    windowText.lastIndexOf('; '),
    windowText.lastIndexOf(', ')
  )
  const safeBreak = breakAt > 80 ? breakAt + 1 : windowText.length
  const head = text.slice(0, safeBreak).trim()
  const tail = text.slice(safeBreak).trim()
  return head && tail ? [head, tail] : null
}

function cloneParagraphBlock(block: FlowBlock, text: string, suffix: string): FlowBlock {
  return {
    ...block,
    id: `${block.id}-${suffix}`,
    text,
    previousText: text,
    height: estimateBlockHeight(text, block.type),
  }
}

function isKeepWithNextBlock(block: FlowBlock): boolean {
  return block.type === 'heading2' || block.type === 'heading3' || block.type === 'sectionTitle'
}

function isRepeatedHeading(
  current: { block: { type: PaperBlockType; text: string } },
  previous?: { block: { type: PaperBlockType; text: string } }
): boolean {
  if (!previous) return false
  if (current.block.type !== 'heading2' && current.block.type !== 'heading3') return false
  if (previous.block.type !== current.block.type) return false
  return previous.block.text.trim() === current.block.text.trim()
}

function buildFlowBlocks(sections: DocSection[]): FlowBlock[] {
  return sections.flatMap(section => {
    const blocks: FlowBlock[] = [{
      id: `${section.id}-title`,
      sectionId: section.id,
      sectionTitle: section.title,
      type: 'sectionTitle',
      text: section.title,
      height: estimateBlockHeight(section.title, 'sectionTitle'),
    }]

    if (section.content) {
      blocks.push({
        id: `${section.id}-hint`,
        sectionId: section.id,
        sectionTitle: section.title,
        type: 'hint',
        text: 'AI 建议：选中词语后点「添加脚注」，可在页脚显示引用说明。这与 @ 资料调用是两套功能。',
        height: estimateBlockHeight('', 'hint'),
      })
    }

    if (section.status === 'generating') {
      blocks.push({
        id: `${section.id}-generating`,
        sectionId: section.id,
        sectionTitle: section.title,
        type: 'generating',
        text: 'AI 正在生成…',
        height: estimateBlockHeight('', 'generating'),
      })
      return blocks
    }

    const contentBlocks = parsePaperBlocks(section.content)
      .map((block, originalIndex) => ({ block, originalIndex }))
      .filter(({ block }, index) => index > 0 || !isDuplicateSectionTitle(block.text, section.title))
      .filter((item, index, list) => !isRepeatedHeading(item, list[index - 1]))

    if (contentBlocks.length === 0) {
      blocks.push({
        id: `${section.id}-empty`,
        sectionId: section.id,
        sectionTitle: section.title,
        type: 'placeholder',
        text: '点击此处直接输入，或在左侧对话框说这一节的标题让 AI 生成',
        blockIndex: 0,
        height: estimateBlockHeight('', 'placeholder'),
      })
      return blocks
    }

    contentBlocks.forEach(({ block, originalIndex }) => {
      const previewChunks = block.type === 'paragraph'
        ? splitParagraphForPreview(block.text)
        : [block.text]

      previewChunks.forEach((chunk, chunkIndex) => {
        const textStart = previewChunks.slice(0, chunkIndex).reduce((sum, item) => sum + item.length, 0)
        blocks.push({
          id: `${section.id}-${originalIndex}-${chunkIndex}`,
          sectionId: section.id,
          sectionTitle: section.title,
          type: block.type,
          text: chunk,
          previousText: chunk,
          blockIndex: originalIndex,
          textStart,
          textEnd: textStart + chunk.length,
          height: estimateBlockHeight(chunk, block.type),
        })
      })
    })

    return blocks
  })
}

function paginateBlocks(blocks: FlowBlock[], firstPageReservedHeight = 0): FlowBlock[][] {
  const pages: FlowBlock[][] = []
  let page: FlowBlock[] = []
  let usedHeight = firstPageReservedHeight
  const queue = [...blocks]

  while (queue.length > 0) {
    const block = queue.shift()!
    const nextBlock = queue[0]
    const remainingHeight = PAGE_CONTENT_HEIGHT - usedHeight
    const keepWithNextHeight = nextBlock && isKeepWithNextBlock(block)
      ? block.height + Math.min(nextBlock.height, 92)
      : block.height

    if (
      page.length > 0 &&
      remainingHeight < 150 &&
      keepWithNextHeight > remainingHeight &&
      isKeepWithNextBlock(block)
    ) {
      pages.push(page)
      page = []
      usedHeight = 0
    }

    const freshRemainingHeight = PAGE_CONTENT_HEIGHT - usedHeight
    if (
      block.type === 'paragraph' &&
      page.length > 0 &&
      block.height > freshRemainingHeight &&
      freshRemainingHeight >= 130
    ) {
      const split = splitTextToFit(block.text, freshRemainingHeight)
      if (split) {
        const [head, tail] = split
        const fitBlock = cloneParagraphBlock(block, head, 'fit')
        const restBlock = cloneParagraphBlock(block, tail, 'rest')
        page.push(fitBlock)
        pages.push(page)
        page = []
        usedHeight = 0
        queue.unshift(restBlock)
        continue
      }
    }

    const shouldBreak = page.length > 0 && usedHeight + block.height > PAGE_CONTENT_HEIGHT
    if (shouldBreak) {
      pages.push(page)
      page = []
      usedHeight = 0
    }
    page.push(block)
    usedHeight += block.height
  }

  if (page.length > 0) pages.push(page)
  return pages
}

export default function DocArea({
  projectId,
  paperTitle,
  sections,
  activeSectionId,
  onSectionClick,
  onSectionChange,
  onPaperTitleChange,
  onGenerateSection,
  onAddFootnote,
  onUpdateFootnote,
  onDeleteFootnote,
}: DocAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const snapshotTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const undoStack = useRef<Record<string, string[]>>({})
  const undoDebounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const undoPauseOpen = useRef<Record<string, boolean>>({})
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingFootnote, setEditingFootnote] = useState<SectionFootnote | null>(null)
  const [footnoteDraft, setFootnoteDraft] = useState('')
  const [footnoteEditorPos, setFootnoteEditorPos] = useState({ top: 0, left: 0 })

  const openFootnoteEditor = useCallback((footnote: SectionFootnote, clientX: number, clientY: number) => {
    if (!onUpdateFootnote && !onDeleteFootnote) return
    setEditingFootnote(footnote)
    setFootnoteDraft(footnote.noteText)
    setFootnoteEditorPos({ top: clientY + 8, left: clientX - 120 })
  }, [onDeleteFootnote, onUpdateFootnote])

  const persistSectionContent = useCallback((sectionId: string, content: string) => {
    const nextSections = sections.map(section =>
      section.id === sectionId ? { ...section, content, status: 'done' as const, lastModified: Date.now() } : section
    )
    sectionStore.saveForProject(projectId, nextSections)
    onSectionChange(sectionId, content)
  }, [onSectionChange, projectId, sections])

  const pushUndoState = useCallback((sectionId: string, content: string) => {
    const last = undoStack.current[sectionId]?.[undoStack.current[sectionId].length - 1]
    if (last === content) return
    undoStack.current[sectionId] = [
      ...(undoStack.current[sectionId] ?? []),
      content,
    ].slice(-80)
  }, [])

  const buildUpdatedSectionContent = useCallback((sectionId: string, blockIndex: number, text: string, previousText?: string) => {
    const section = sections.find(item => item.id === sectionId)
    if (!section) return ''
    const blocks = parsePaperBlocks(section.content)
    if (blocks.length === 0) return formatSectionContent(text)
    const nextText = formatSectionContent(text)
    const oldText = blocks[blockIndex]?.text ?? ''
    blocks[blockIndex] = {
      ...blocks[blockIndex],
      text: previousText && oldText.includes(previousText)
        ? oldText.replace(previousText, nextText)
        : nextText,
    }
    return blocks.map(block => block.text).join('\n\n')
  }, [sections])

  const handleBlockInput = useCallback((block: FlowBlock, el: HTMLDivElement) => {
    if (block.blockIndex === undefined) return
    const key = block.id
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key])
    if (snapshotTimers.current[block.sectionId]) clearTimeout(snapshotTimers.current[block.sectionId])
    debounceTimers.current[key] = setTimeout(() => {
      const content = buildUpdatedSectionContent(block.sectionId, block.blockIndex!, el.innerText, block.previousText)
      if (content) persistSectionContent(block.sectionId, content)
    }, 900)
    snapshotTimers.current[block.sectionId] = setTimeout(() => {
      versionStore.snapshot(`手动编辑：${block.sectionTitle.slice(0, 20)}`, projectId)
    }, 3500)
  }, [buildUpdatedSectionContent, persistSectionContent, projectId])

  const handleBlockBlur = useCallback((block: FlowBlock, el: HTMLDivElement) => {
    if (block.blockIndex === undefined) return
    const key = block.id
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key])
    if (snapshotTimers.current[block.sectionId]) clearTimeout(snapshotTimers.current[block.sectionId])
    const content = buildUpdatedSectionContent(block.sectionId, block.blockIndex, el.innerText, block.previousText)
    if (content) {
      persistSectionContent(block.sectionId, content)
      versionStore.snapshot(`手动编辑：${block.sectionTitle.slice(0, 20)}`, projectId)
    }
  }, [buildUpdatedSectionContent, persistSectionContent, projectId])

  const findEditableBlock = useCallback((node: Node | null): HTMLElement | null => {
    if (!node) return null
    const element = node instanceof HTMLElement ? node : node.parentElement
    return element?.closest<HTMLElement>('[data-section-id][data-block-index]') ?? null
  }, [])

  const handleEditBeforeInput = useCallback((pageBlocks: FlowBlock[]) => {
    const selection = window.getSelection()
    const blockElement = selection?.rangeCount
      ? findEditableBlock(selection.getRangeAt(0).startContainer)
      : null
    const block = pageBlocks.find(item => item.id === blockElement?.dataset.blockId)
    if (!block) return

    const section = sections.find(item => item.id === block.sectionId)
    if (!section) return

    if (!undoPauseOpen.current[block.sectionId]) {
      pushUndoState(block.sectionId, section.content)
      undoPauseOpen.current[block.sectionId] = true
    }

    if (undoDebounceTimers.current[block.sectionId]) {
      clearTimeout(undoDebounceTimers.current[block.sectionId])
    }
    undoDebounceTimers.current[block.sectionId] = setTimeout(() => {
      undoPauseOpen.current[block.sectionId] = false
    }, 1200)
  }, [findEditableBlock, pushUndoState, sections])

  const getPointInBlock = useCallback((node: Node, offset: number) => {
    const element = findEditableBlock(node)
    if (!element) return null
    const sectionId = element.dataset.sectionId
    const blockIndex = Number.parseInt(element.dataset.blockIndex ?? '', 10)
    const textStart = Number.parseInt(element.dataset.textStart ?? '0', 10)
    if (!sectionId || Number.isNaN(blockIndex)) return null

    const range = document.createRange()
    range.selectNodeContents(element)
    range.setEnd(node, offset)
    const localOffset = range.toString().length
    range.detach()

    return { element, sectionId, blockIndex, textStart, offset: localOffset }
  }, [findEditableBlock])

  const replaceStructuredSelection = useCallback((replacementText: string, snapshotLabel: string) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false

    const range = selection.getRangeAt(0)
    const start = getPointInBlock(range.startContainer, range.startOffset)
    const end = getPointInBlock(range.endContainer, range.endOffset)
    if (!start || !end || start.sectionId !== end.sectionId) return false

    const crossesEditableBlocks = start.element !== end.element
    if (!crossesEditableBlocks) return false

    const section = sections.find(item => item.id === start.sectionId)
    if (!section) return false

    const blocks = parsePaperBlocks(section.content)
    if (blocks.length === 0) return false

    const fromIndex = Math.min(start.blockIndex, end.blockIndex)
    const toIndex = Math.max(start.blockIndex, end.blockIndex)
    const fromOffset = start.textStart + start.offset
    const toOffset = end.textStart + end.offset
    const firstBlock = blocks[fromIndex]
    const lastBlock = blocks[toIndex]
    if (!firstBlock || !lastBlock) return false

    const before = blocks.slice(0, fromIndex).map(block => block.text)
    const after = blocks.slice(toIndex + 1).map(block => block.text)
    const mergedText = `${firstBlock.text.slice(0, fromOffset)}${replacementText}${lastBlock.text.slice(toOffset)}`
    const nextContent = formatSectionContent([...before, mergedText, ...after].filter(Boolean).join('\n\n'))

    pushUndoState(start.sectionId, section.content)

    onSectionClick(start.sectionId)
    setEditingSectionId(start.sectionId)
    persistSectionContent(start.sectionId, nextContent)
    versionStore.snapshot(snapshotLabel, projectId)
    selection.removeAllRanges()
    return true
  }, [getPointInBlock, onSectionClick, persistSectionContent, projectId, pushUndoState, sections])

  const handleDocKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey
    if (isUndo) {
      const selection = window.getSelection()
      const sectionId = selection?.rangeCount
        ? findEditableBlock(selection.getRangeAt(0).startContainer)?.dataset.sectionId ?? editingSectionId
        : editingSectionId
      const previous = sectionId ? undoStack.current[sectionId]?.pop() : undefined
      if (sectionId && previous !== undefined) {
        event.preventDefault()
        Object.values(debounceTimers.current).forEach(timer => clearTimeout(timer))
        debounceTimers.current = {}
        if (snapshotTimers.current[sectionId]) clearTimeout(snapshotTimers.current[sectionId])
        if (undoDebounceTimers.current[sectionId]) clearTimeout(undoDebounceTimers.current[sectionId])
        undoPauseOpen.current[sectionId] = false
        onSectionClick(sectionId)
        persistSectionContent(sectionId, previous)
      }
      return
    }

    if ((event.key === 'Backspace' || event.key === 'Delete') && replaceStructuredSelection('', '手动删除：跨段文本')) {
      event.preventDefault()
    }
  }, [editingSectionId, findEditableBlock, onSectionClick, persistSectionContent, replaceStructuredSelection])

  const handleEditablePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    if (replaceStructuredSelection(text, '手动粘贴：跨段文本')) return
    const selection = window.getSelection()
    const sectionId = selection?.rangeCount
      ? findEditableBlock(selection.getRangeAt(0).startContainer)?.dataset.sectionId
      : undefined
    const section = sectionId ? sections.find(item => item.id === sectionId) : undefined
    if (section) pushUndoState(section.id, section.content)
    document.execCommand('insertText', false, text)
  }, [findEditableBlock, pushUndoState, replaceStructuredSelection, sections])

  const handlePageInput = useCallback((pageBlocks: FlowBlock[]) => {
    const selection = window.getSelection()
    const blockElement = selection?.rangeCount
      ? findEditableBlock(selection.getRangeAt(0).startContainer)
      : null
    const block = pageBlocks.find(item => item.id === blockElement?.dataset.blockId)
    if (!block || block.blockIndex === undefined || !blockElement) return
    handleBlockInput(block, blockElement as HTMLDivElement)
  }, [findEditableBlock, handleBlockInput])

  const handlePageBlur = useCallback((pageBlocks: FlowBlock[], pageEl: HTMLDivElement) => {
    pageBlocks.forEach(block => {
      if (block.blockIndex === undefined) return
      const blockElement = pageEl.querySelector<HTMLDivElement>(`[data-block-id="${block.id}"]`)
      if (!blockElement || blockElement.innerText === block.text) return
      handleBlockBlur(block, blockElement)
    })
  }, [handleBlockBlur])

  if (sections.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-ink-3)',
          gap: 12,
          padding: 40,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 32 }}>📄</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink-2)' }}>
          文档还是空的
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          在左侧对话框说章节标题，AI 会自动生成内容出现在这里<br />
          或点击右上角「添加章节」手动输入
        </div>
      </div>
    )
  }

  const pages = paginateBlocks(buildFlowBlocks(sections), TITLE_AREA_HEIGHT)
  const totalPages = pages.length

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>

      {/* 框选工具栏（全局一个，根据选区位置浮动）*/}
      <SelectionToolbar
        projectId={projectId}
        containerRef={containerRef}
        sections={sections}
        activeSectionId={activeSectionId}
        onContentUpdate={(id, newContent) => {
          persistSectionContent(id, newContent)
          versionStore.snapshot('AI 修改：选中文本', projectId)
        }}
        onAddFootnote={onAddFootnote}
      />

      {/* 文档滚动区 */}
      <div
        ref={containerRef}
        id="doc-scroll-area"
        onKeyDown={handleDocKeyDown}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '32px 0 64px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          background: '#E7E3DD',
        }}
      >
        {pages.map((pageBlocks, pageIndex) => {
          const pageNo = pageIndex + 1
          const isFirstPage = pageIndex === 0
          const activeOnPage = pageBlocks.some(block => block.sectionId === activeSectionId)
          const pageFootnotes = pageBlocks.flatMap(block => {
            if (block.blockIndex === undefined) return [] as SectionFootnote[]
            const section = sections.find(item => item.id === block.sectionId)
            return getFootnotesForBlock(section, block.blockIndex).filter(footnote => {
              if (block.textStart === undefined || block.textEnd === undefined) return true
              return footnote.end > block.textStart && footnote.start < block.textEnd
            })
          }).filter((footnote, index, list) => list.findIndex(item => item.id === footnote.id) === index)
            .sort((a, b) => a.number - b.number)

          return (
            <div
              key={`page-${pageIndex}`}
              className="doc-page"
              style={{
                position: 'relative',
                width: A4_WIDTH,
                height: A4_MIN_HEIGHT,
                minHeight: A4_MIN_HEIGHT,
                flexShrink: 0,
                boxSizing: 'border-box',
                border: `1px solid ${activeOnPage ? 'var(--color-accent)' : '#D8D2C8'}`,
                background: '#fff',
                boxShadow: activeOnPage
                  ? '0 18px 42px rgba(45, 90, 61, 0.18)'
                  : '0 16px 38px rgba(38, 32, 24, 0.14)',
                padding: `${PAGE_VERTICAL_PADDING}px ${PAGE_HORIZONTAL_PADDING}px`,
                overflow: 'hidden',
                transition: 'box-shadow 0.2s, border-color 0.2s',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 32,
                  right: PAGE_HORIZONTAL_PADDING,
                  fontSize: 11,
                  color: '#A59B8D',
                }}
              >
                第 {pageNo} 页 / 共 {totalPages} 页
              </div>

              {isFirstPage && (
                <div
                  contentEditable={false}
                  style={{
                    minHeight: TITLE_AREA_HEIGHT,
                    textAlign: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <textarea
                    value={paperTitle}
                    onChange={event => onPaperTitleChange(event.target.value.replace(/\n/g, ' '))}
                    placeholder="请输入论文标题"
                    rows={2}
                    style={{
                      width: '100%',
                      minHeight: 76,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      textAlign: 'center',
                      color: 'var(--color-ink)',
                      fontFamily: 'var(--font-serif)',
                      fontSize: 24,
                      fontWeight: 700,
                      lineHeight: 1.45,
                      resize: 'none',
                      overflow: 'hidden',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  />
                </div>
              )}

              <div
                contentEditable
                suppressContentEditableWarning
                onBeforeInput={() => handleEditBeforeInput(pageBlocks)}
                onInput={() => handlePageInput(pageBlocks)}
                onPaste={handleEditablePaste}
                onBlur={event => handlePageBlur(pageBlocks, event.currentTarget)}
                style={{
                  outline: 'none',
                  minHeight: PAGE_CONTENT_HEIGHT - (isFirstPage ? TITLE_AREA_HEIGHT : 0) - 120,
                  cursor: 'text',
                  userSelect: 'text',
                }}
              >
              {pageBlocks.map(block => {
                const isEditable = block.blockIndex !== undefined && block.type !== 'placeholder'
                const section = sections.find(item => item.id === block.sectionId)
                const blockFootnotes = block.blockIndex === undefined
                  ? []
                  : getFootnotesForBlock(section, block.blockIndex)
                    .filter(footnote => {
                      if (block.textStart === undefined || block.textEnd === undefined) return true
                      return footnote.end > block.textStart && footnote.start < block.textEnd
                    })
                    .map(footnote => ({
                      ...footnote,
                      start: block.textStart === undefined
                        ? footnote.start
                        : Math.max(0, footnote.start - block.textStart),
                      end: block.textStart === undefined
                        ? footnote.end
                        : Math.min(block.text.length, footnote.end - block.textStart),
                    }))

                if (block.type === 'sectionTitle') {
                  const section = sections.find(item => item.id === block.sectionId)
                  return (
                    <div
                      key={block.id}
                      data-section-id={block.sectionId}
                      contentEditable={false}
                      onClick={() => onSectionClick(block.sectionId)}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        margin: '8px 0 22px',
                        padding: '0 70px',
                        textAlign: 'center',
                      }}
                    >
                      <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.6, fontFamily: 'var(--font-serif)', color: 'var(--color-ink)', fontWeight: 700 }}>
                        {block.text}
                      </h2>
                      {section && (
                        section.status === 'pending' || !section.content ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onGenerateSection(section.title)
                            }}
                            style={{ position: 'absolute', right: 0, top: 2, display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-accent)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 500 }}
                          >
                            <Sparkles size={11} />
                            AI 生成
                          </button>
                        ) : null
                      )}
                    </div>
                  )
                }

                if (block.type === 'hint') {
                  return (
                    <div
                      key={block.id}
                      data-section-id={block.sectionId}
                      contentEditable={false}
                      style={{ fontSize: 11, color: '#B27A3A', background: '#FFF8EA', borderLeft: '2px solid #E5B76E', padding: '4px 8px', marginBottom: 12 }}
                    >
                      {block.text}
                    </div>
                  )
                }

                if (block.type === 'generating') {
                  return (
                    <div key={block.id} data-section-id={block.sectionId} contentEditable={false} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[0, 1, 2].map(i => (
                          <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-gpt)', animation: 'bounce 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                        ))}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--color-gpt)' }}>AI 正在生成…</span>
                    </div>
                  )
                }

                return (
                  <div
                    key={block.id}
                    suppressContentEditableWarning
                    data-section-id={block.sectionId}
                    data-block-id={block.id}
                    data-block-index={block.blockIndex}
                    data-text-start={block.textStart ?? 0}
                    data-text-end={block.textEnd ?? block.text.length}
                    onClick={() => onSectionClick(block.sectionId)}
                    onFocus={() => setEditingSectionId(block.sectionId)}
                    style={{
                      minHeight: block.type === 'placeholder' ? 42 : undefined,
                      margin: block.type === 'heading2' ? '18px 0 10px' : block.type === 'heading3' ? '14px 0 8px' : '0 0 12px',
                      fontSize: block.type === 'heading2' ? 15.5 : block.type === 'heading3' ? 14.5 : 14.5,
                      lineHeight: block.type === 'paragraph' ? 2 : 1.8,
                      color: block.type === 'placeholder' ? 'var(--color-ink-3)' : 'var(--color-ink-2)',
                      fontFamily: 'var(--font-serif)',
                      fontWeight: block.type === 'heading2' || block.type === 'heading3' ? 650 : 400,
                      outline: 'none',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      cursor: isEditable ? 'text' : 'default',
                      userSelect: 'text',
                      textAlign: block.type === 'paragraph' ? 'justify' : 'left',
                      textIndent: block.type === 'paragraph' ? '2em' : 0,
                    }}
                  >
                    {editingSectionId === block.sectionId && isEditable
                      ? block.text
                      : <FootnoteText
                          text={block.text}
                          footnotes={blockFootnotes}
                          onFootnoteClick={(footnote, event) => openFootnoteEditor(footnote, event.clientX, event.clientY)}
                        />}
                  </div>
                )
              })}
              </div>

              {pageFootnotes.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: PAGE_HORIZONTAL_PADDING,
                    right: PAGE_HORIZONTAL_PADDING,
                    bottom: 68,
                    borderTop: '1px solid #D8D2C8',
                    paddingTop: 8,
                    fontSize: 10.5,
                    lineHeight: 1.65,
                    color: '#6E655B',
                  }}
                >
                  {pageFootnotes.map(footnote => (
                    <div
                      key={footnote.id}
                      onClick={event => openFootnoteEditor(footnote, event.clientX, event.clientY)}
                      style={{
                        marginBottom: 4,
                        cursor: onUpdateFootnote || onDeleteFootnote ? 'pointer' : 'default',
                      }}
                    >
                      <sup style={{ marginRight: 4, fontWeight: 650 }}>[{footnote.number}]</sup>
                      {footnote.noteText}
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  position: 'absolute',
                  left: PAGE_HORIZONTAL_PADDING,
                  right: PAGE_HORIZONTAL_PADDING,
                  bottom: 34,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: '#A59B8D',
                  borderTop: '1px solid #E7E0D6',
                  paddingTop: 10,
                }}
              >
                <span>{paperTitle || '未命名论文'}</span>
                <span>{pageNo}</span>
              </div>
            </div>
          )
        })}

        {/* 底部留白 */}
        <div style={{ height: 80 }} />
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

      {/* Hover 样式注入 */}
      <style>{`
        .doc-section-wrapper:hover .section-hover-actions {
          opacity: 1 !important;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
