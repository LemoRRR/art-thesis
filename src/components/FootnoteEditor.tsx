import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { SectionFootnote } from '../lib/storage'

interface FootnoteEditorProps {
  footnote: SectionFootnote
  draft: string
  position: { top: number; left: number }
  onDraftChange: (value: string) => void
  onSave: () => void
  onDelete: () => void
  onClose: () => void
}

export default function FootnoteEditor({
  footnote,
  draft,
  position,
  onDraftChange,
  onSave,
  onDelete,
  onClose,
}: FootnoteEditorProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return
      onClose()
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: Math.min(position.top, window.innerHeight - 260),
        left: Math.min(Math.max(12, position.left), window.innerWidth - 320),
        width: 300,
        zIndex: 1100,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        padding: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-ink)', marginBottom: 6 }}>
        编辑脚注 [{footnote.number}]
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginBottom: 8 }}>
        引用词：{footnote.anchorText}
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={event => onDraftChange(event.target.value)}
        rows={4}
        placeholder="作者. 书名. 出版社, 年份, 页码."
        style={{
          width: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 8px',
          fontSize: 12,
          outline: 'none',
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-ink)',
          background: 'var(--color-bg)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        <button
          onClick={onDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            border: '1px solid #E8B4B0',
            borderRadius: 'var(--radius-sm)',
            background: '#FFF5F4',
            color: '#A8443F',
            padding: '5px 10px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={12} />
          删除
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--color-ink-3)',
              padding: '5px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={!draft.trim()}
            style={{
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: draft.trim() ? 'var(--color-accent)' : 'var(--color-border)',
              color: '#fff',
              padding: '5px 12px',
              fontSize: 11,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
