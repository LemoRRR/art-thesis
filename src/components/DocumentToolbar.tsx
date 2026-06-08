import type { CSSProperties, ReactNode } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Copy, Download, Italic, Underline } from 'lucide-react'

interface DocumentToolbarProps {
  onCopy: () => void
  onExportWord: () => void
  disabled?: boolean
}

const runCommand = (command: string, value?: string) => {
  document.execCommand(command, false, value)
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
        defaultValue="宋体"
        onChange={event => runCommand('fontName', event.target.value)}
        style={selectStyle}
      >
        <option value="宋体">宋体</option>
        <option value="SimSun">SimSun</option>
        <option value="Microsoft YaHei">微软雅黑</option>
        <option value="Times New Roman">Times New Roman</option>
      </select>

      <select
        defaultValue="3"
        onChange={event => runCommand('fontSize', event.target.value)}
        style={{ ...selectStyle, width: 58 }}
      >
        <option value="2">小五</option>
        <option value="3">小四</option>
        <option value="4">四号</option>
        <option value="5">三号</option>
      </select>

      <Divider />
      <ToolButton icon={<Bold size={14} />} label="加粗" onClick={() => runCommand('bold')} />
      <ToolButton icon={<Italic size={14} />} label="斜体" onClick={() => runCommand('italic')} />
      <ToolButton icon={<Underline size={14} />} label="下划线" onClick={() => runCommand('underline')} />
      <Divider />
      <ToolButton icon={<AlignLeft size={14} />} label="左对齐" onClick={() => runCommand('justifyLeft')} />
      <ToolButton icon={<AlignCenter size={14} />} label="居中" onClick={() => runCommand('justifyCenter')} />
      <ToolButton icon={<AlignRight size={14} />} label="右对齐" onClick={() => runCommand('justifyRight')} />

      <div style={{ flex: 1 }} />
      <button
        onClick={onCopy}
        disabled={disabled}
        style={primaryButtonStyle(disabled)}
      >
        <Copy size={13} />
        复制全文
      </button>
      <button
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
      title={label}
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
