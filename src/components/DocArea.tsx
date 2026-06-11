import { useCallback, useEffect, useRef, useState } from 'react'
import FootnoteEditor from './FootnoteEditor'
import PaperEditor from './PaperEditor'
import type { PaperEditorDoc } from '../lib/editorDocument'
import type { DocSection, SectionFootnote } from '../lib/storage'

interface DocAreaProps {
  projectId: string
  paperTitle: string
  sections: DocSection[]
  isPreparing?: boolean
  activeSectionId: string | null
  onSectionClick: (id: string) => void
  onSectionChange: (
    id: string,
    content: string,
    editorDoc?: PaperEditorDoc,
    footnotes?: SectionFootnote[],
    snapshotLabel?: string,
    title?: string
  ) => void
  onPaperTitleChange: (title: string) => void
  onGenerateSection: (title: string) => void
  onUpdateFootnote?: (footnoteId: string, noteText: string) => void
  onDeleteFootnote?: (footnoteId: string) => void
}

const A4_WIDTH = 794
const A4_MIN_HEIGHT = 1123
const PAGE_HORIZONTAL_PADDING = 86
const PAGE_VERTICAL_PADDING = 76

export default function DocArea({
  projectId,
  paperTitle,
  sections,
  isPreparing = false,
  activeSectionId,
  onSectionClick,
  onSectionChange,
  onPaperTitleChange,
  onGenerateSection,
  onUpdateFootnote,
  onDeleteFootnote,
}: DocAreaProps) {
  const [editingFootnote, setEditingFootnote] = useState<SectionFootnote | null>(null)
  const [footnoteDraft, setFootnoteDraft] = useState('')
  const [footnoteEditorPos, setFootnoteEditorPos] = useState({ top: 0, left: 0 })
  const contentRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(1)

  const openFootnoteEditor = useCallback((footnote: SectionFootnote, clientX: number, clientY: number) => {
    if (!onUpdateFootnote && !onDeleteFootnote) return
    setEditingFootnote(footnote)
    setFootnoteDraft(footnote.noteText)
    setFootnoteEditorPos({ top: clientY + 8, left: clientX - 120 })
  }, [onDeleteFootnote, onUpdateFootnote])

  const footnotes = sections
    .flatMap(section => section.footnotes ?? [])
    .sort((a, b) => a.number - b.number)

  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    const updatePageCount = () => {
      const height = Math.max(content.scrollHeight, content.offsetHeight, A4_MIN_HEIGHT)
      setPageCount(Math.max(1, Math.ceil(height / A4_MIN_HEIGHT)))
    }

    updatePageCount()
    const observer = new ResizeObserver(updatePageCount)
    observer.observe(content)
    window.addEventListener('resize', updatePageCount)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePageCount)
    }
  }, [paperTitle, sections])

  if (sections.length === 0) {
    const emptyTitle = isPreparing ? '正在准备正文' : '文档还是空的'
    const emptyText = isPreparing
      ? '已读取确认大纲，正在整理全文计划并准备逐章生成正文。'
      : '先在阶段二确认大纲，或在左侧对话框说明章节标题，AI 会生成正文出现在这里。'

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
          background: isPreparing ? 'linear-gradient(180deg, #FBFAF7 0%, #F4F0E8 100%)' : 'transparent',
        }}
      >
        {isPreparing ? (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2px solid rgba(46, 125, 76, 0.18)',
              borderTopColor: 'var(--color-accent)',
              animation: 'doc-loading-spin 0.8s linear infinite',
            }}
            aria-hidden="true"
          />
        ) : (
          <div style={{ fontSize: 32 }}>□</div>
        )}
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink-2)' }}>{emptyTitle}</div>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          {emptyText}
        </div>
        <style>{`
          @keyframes doc-loading-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div className="doc-area-root">
      <div id="doc-scroll-area" className="doc-scroll-area">
        <article
          className="doc-page doc-page-continuous"
          style={{ minHeight: pageCount * A4_MIN_HEIGHT }}
        >
          <div className="paper-page-guides" aria-hidden="true">
            {Array.from({ length: pageCount }).map((_, index) => (
              <div
                key={index}
                className="paper-page-guide"
                style={{ top: index * A4_MIN_HEIGHT }}
              >
                <span>第 {index + 1} 页</span>
              </div>
            ))}
          </div>

          <div ref={contentRef} className="paper-continuous-content">
            <div className="paper-title-block">
              <textarea
                value={paperTitle}
                onChange={event => onPaperTitleChange(event.target.value.replace(/\n/g, ' '))}
                placeholder="请输入论文标题"
                rows={2}
              />
            </div>

            <div className="paper-editor-stack">
              {sections.map(section => (
                <PaperEditor
                  key={section.id}
                  projectId={projectId}
                  section={section}
                  allSections={sections}
                  active={section.id === activeSectionId}
                  onActivate={() => onSectionClick(section.id)}
                  onChange={onSectionChange}
                  onOpenFootnote={openFootnoteEditor}
                  onGenerateSection={onGenerateSection}
                />
              ))}
            </div>

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

      <style>{`
        .doc-area-root {
          flex: 1;
          position: relative;
          overflow: hidden;
          display: flex;
        }

        .doc-empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: var(--color-ink-3);
          gap: 12px;
          padding: 40px;
          text-align: center;
        }

        .doc-scroll-area {
          flex: 1;
          overflow-y: auto;
          padding: 32px 0 64px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          background: #E7E3DD;
        }

        .doc-page {
          position: relative;
          width: ${A4_WIDTH}px;
          min-height: ${A4_MIN_HEIGHT}px;
          box-sizing: border-box;
          border: 1px solid #D8D2C8;
          background: #fff;
          box-shadow: 0 16px 38px rgba(38, 32, 24, 0.14);
        }

        .doc-page-continuous {
          height: auto;
          overflow: hidden;
          background: #fff;
        }

        .paper-continuous-content {
          position: relative;
          z-index: 1;
          min-height: ${A4_MIN_HEIGHT}px;
          box-sizing: border-box;
          padding: ${PAGE_VERTICAL_PADDING}px ${PAGE_HORIZONTAL_PADDING}px ${PAGE_VERTICAL_PADDING + 28}px;
        }

        .paper-page-guides {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }

        .paper-page-guide {
          position: absolute;
          left: 0;
          right: 0;
          height: ${A4_MIN_HEIGHT}px;
        }

        .paper-page-guide span {
          position: absolute;
          top: 30px;
          right: 22px;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.82);
          font-size: 11px;
          color: #A59B8D;
          font-family: var(--font-sans);
        }

        .paper-title-block {
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

        .paper-editor-stack {
          min-height: 760px;
        }

        .paper-editor-section {
          padding: 8px 0 18px;
        }

        .paper-section-heading {
          position: relative;
          min-height: 0;
        }

        .paper-editor-content > h2:first-child {
          margin: 8px 82px 18px;
          text-align: center;
          font-size: 20px;
          font-weight: 700;
          line-height: 1.6;
        }

        .paper-generate-button {
          position: absolute;
          right: 0;
          top: 2px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-accent);
          font-size: 11px;
          cursor: pointer;
          font-family: var(--font-sans);
          font-weight: 500;
        }

        .paper-generating {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 0;
          color: var(--color-gpt);
          font-family: var(--font-sans);
          font-size: 12px;
        }

        .paper-generating span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--color-gpt);
          animation: paper-bounce 1.2s ease-in-out infinite;
        }

        .paper-generating span:nth-child(2) { animation-delay: 0.16s; }
        .paper-generating span:nth-child(3) { animation-delay: 0.32s; }

        .paper-editor-content {
          min-height: 44px;
          outline: none;
          color: var(--color-ink-2);
          font-family: var(--font-serif);
          font-size: 14.5px;
          line-height: 2;
          word-break: break-word;
        }

        .paper-editor-content p {
          margin: 0 0 12px;
          text-align: justify;
          text-indent: 2em;
        }

        .paper-editor-content p[style*="text-align: center"],
        .paper-editor-content p[style*="text-align: right"] {
          text-indent: 0;
        }

        .paper-editor-content h2,
        .paper-editor-content h3 {
          color: var(--color-ink);
          font-family: var(--font-serif);
          font-weight: 650;
          text-indent: 0;
        }

        .paper-editor-content h2 {
          margin: 18px 0 10px;
          font-size: 15.5px;
          line-height: 1.8;
        }

        .paper-editor-content h3 {
          margin: 14px 0 8px;
          font-size: 14.5px;
          line-height: 1.8;
        }

        .paper-editor-content .is-editor-empty:first-child::before {
          color: var(--color-ink-3);
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
          font-family: var(--font-sans);
          font-size: 12px;
          text-indent: 0;
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

        .paper-footnote-list sup {
          margin-right: 4px;
          font-weight: 650;
        }

        .paper-bubble-menu {
          width: 540px;
          max-width: calc(100vw - 24px);
          overflow: hidden;
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
        }

        .paper-revision-title {
          padding: 10px 10px 6px;
          color: var(--color-ink-3);
          font-size: 11px;
        }

        .paper-revision-scroll {
          max-height: min(44vh, 360px);
          overflow-y: auto;
          padding: 0 10px 10px;
          font-size: 12px;
          line-height: 1.7;
        }

        .paper-diff-box {
          margin-bottom: 6px;
          border: 1px solid rgba(0,0,0,0.08);
          border-radius: 6px;
          padding: 8px;
        }

        .paper-diff-box span {
          font-size: 10px;
          font-weight: 600;
        }

        .paper-diff-box div {
          white-space: pre-wrap;
        }

        .paper-revision-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          padding: 10px;
          border-top: 1px solid var(--color-border);
        }

        .paper-revision-actions button:first-child {
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-ink-3);
          padding: 5px 10px;
          font-size: 12px;
        }

        .paper-revision-actions button:last-child {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        @keyframes paper-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
