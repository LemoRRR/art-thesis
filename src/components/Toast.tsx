// Renders the global toast stack. Mount once near the app root.
import { useEffect, useState, type CSSProperties } from 'react'
import { subscribeToasts, dismissToast, type ToastItem, type ToastType } from '../lib/toast'

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribeToasts(setItems), [])
  if (!items.length) return null
  return (
    <div style={containerStyle}>
      {items.map(item => (
        <div
          key={item.id}
          style={itemStyle(item.type)}
          role="status"
          onClick={() => dismissToast(item.id)}
          title="点击关闭"
        >
          {item.message}
        </div>
      ))}
    </div>
  )
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxWidth: 'min(92vw, 520px)',
  pointerEvents: 'none',
}

const palette: Record<ToastType, { bg: string; fg: string; border: string }> = {
  info: { bg: '#EEF2FF', fg: '#334155', border: '#C7D2FE' },
  success: { bg: '#EAF3DE', fg: '#3B6D11', border: '#C9E2A6' },
  warning: { bg: '#FFFBEB', fg: '#92591A', border: '#FCE2A6' },
  error: { bg: '#FEF2F2', fg: '#A8443F', border: '#F6C6C2' },
}

function itemStyle(type: ToastType): CSSProperties {
  const c = palette[type]
  return {
    pointerEvents: 'auto',
    cursor: 'pointer',
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    lineHeight: 1.6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
    wordBreak: 'break-word',
  }
}
