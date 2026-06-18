import type { CSSProperties, ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Copy, Download, Italic, Underline } from 'lucide-react'

interface DocumentToolbarProps {
  onCopy: () => void
  onExportWord: () => void
  disabled?: boolean
}

export type PaperEditorToolbarCommand =
  | { type: 'toggleBold' }
  | { type: 'toggleItalic' }
  | { type: 'toggleUnderline' }
  | { type: 'setTextAlign'; value: 'left' | 'center' | 'right' | 'justify' }
  | { type: 'setFontFamily'; value: string }
  | { type: 'setFontSize'; value: string }

export const PAPER_EDITOR_TOOLBAR_EVENT = 'paper-editor-toolbar-command'

const fontOptions = [
  { label: '宋体', value: 'SimSun' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '黑体', value: 'SimHei' },
  { label: 'Times New Roman', value: 'Times New Roman' },
]

const sizeOptions = [
  { label: '小五', value: '14px' },
  { label: '小四', value: '16px' },
  { label: '四号', value: '18.67px' },
  { label: '三号', value: '21.33px' },
]

function dispatchEditorCommand(command: PaperEditorToolbarCommand) {
  window.dispatchEvent(new CustomEvent(PAPER_EDITOR_TOOLBAR_EVENT, { detail: command }))
}

export default function DocumentToolbar({ onCopy, onExportWord, disabled }: DocumentToolbarProps) {
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
      }}
    >
      <select
        defaultValue="SimSun"
        onChange={event => dispatchEditorCommand({ type: 'setFontFamily', value: event.target.value })}
        style={selectStyle}
        title="字体"
      >
        {fontOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        defaultValue="16px"
        onChange={event => dispatchEditorCommand({ type: 'setFontSize', value: event.target.value })}
        style={{ ...selectStyle, width: 62 }}
        title="字号"
      >
        {sizeOptions.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Divider />
      <ToolButton icon={<Bold size={14} />} label="加粗" onClick={() => dispatchEditorCommand({ type: 'toggleBold' })} />
      <ToolButton icon={<Italic size={14} />} label="斜体" onClick={() => dispatchEditorCommand({ type: 'toggleItalic' })} />
      <ToolButton icon={<Underline size={14} />} label="下划线" onClick={() => dispatchEditorCommand({ type: 'toggleUnderline' })} />
      <Divider />
      <ToolButton icon={<AlignLeft size={14} />} label="左对齐" onClick={() => dispatchEditorCommand({ type: 'setTextAlign', value: 'left' })} />
      <ToolButton icon={<AlignCenter size={14} />} label="居中" onClick={() => dispatchEditorCommand({ type: 'setTextAlign', value: 'center' })} />
      <ToolButton icon={<AlignRight size={14} />} label="右对齐" onClick={() => dispatchEditorCommand({ type: 'setTextAlign', value: 'right' })} />

      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onCopy}
        disabled={disabled}
        style={primaryButtonStyle(disabled)}
      >
        <Copy size={13} />
        复制全文
      </button>
      <button
        type="button"
        onClick={onExportWord}
        disabled={disabled}
        style={primaryButtonStyle(disabled)}
      >
        <Download size={13} />
        导出 Word
      </button>
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />
}

function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        color: 'var(--color-ink-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      {icon}
    </button>
  )
}

const selectStyle: CSSProperties = {
  height: 28,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg)',
  color: 'var(--color-ink-2)',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
  padding: '0 8px',
  outline: 'none',
}

const primaryButtonStyle = (disabled?: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  height: 30,
  padding: '0 11px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: disabled ? 'var(--color-border)' : 'var(--color-accent)',
  color: '#fff',
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'var(--font-sans)',
})
