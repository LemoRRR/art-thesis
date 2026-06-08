import { useState } from 'react'
import { X, RotateCcw, Eye, Clock } from 'lucide-react'
import { versionStore, type VersionSnapshot } from '../lib/storage'

interface VersionPanelProps {
  projectId: string
  onClose:   () => void
  onRestore: (snapshot: VersionSnapshot) => void
}

export default function VersionPanel({ projectId, onClose, onRestore }: VersionPanelProps) {
  const versions = versionStore.getByProject(projectId)
  const [previewId, setPreviewId] = useState<string | null>(null)

  function formatTime(ts: number): string {
    const now = Date.now()
    const diff = now - ts
    if (diff < 60_000)  return '刚刚'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const handleRestore = (snapshot: VersionSnapshot) => {
    if (!confirm(`确认恢复到「${snapshot.description}」这个版本？当前内容将被覆盖。`)) return
    onRestore(snapshot)
    onClose()
  }

  return (
    <div
      style={{
        width: 230,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'slideInRight 0.2s ease-out',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={13} color="var(--color-ink-3)" />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-ink-2)' }}>
            版本历史
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            padding: 4, border: 'none', background: 'transparent',
            cursor: 'pointer', color: 'var(--color-ink-3)',
            borderRadius: 4, display: 'flex', alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* 版本列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {versions.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--color-ink-3)',
              lineHeight: 1.6,
            }}
          >
            还没有版本记录<br />
            <span style={{ fontSize: 11 }}>每次 AI 生成或你手动编辑后会自动保存版本</span>
          </div>
        ) : (
          versions.map((v, i) => (
            <div
              key={v.id}
              style={{
                margin: '10px 10px 0',
                padding: '10px 11px',
                borderBottom: '1px solid var(--color-border)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: previewId === v.id ? 'var(--color-accent-light)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => {
                if (previewId !== v.id) e.currentTarget.style.background = 'var(--color-bg)'
              }}
              onMouseLeave={e => {
                if (previewId !== v.id) e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* 版本信息 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                {i === 0 && (
                  <span
                    style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      background: 'var(--color-accent)', color: '#fff', fontWeight: 500,
                    }}
                  >
                    当前
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>
                  {formatTime(v.timestamp)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-ink-2)', lineHeight: 1.4, marginBottom: 6 }}>
                {v.description}
              </div>

              {/* 操作按钮 */}
              {i > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    onClick={() => setPreviewId(previewId === v.id ? null : v.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      justifyContent: 'center',
                      padding: '4px 7px', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)', background: 'transparent',
                      color: 'var(--color-ink-3)', fontSize: 10, cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Eye size={10} />
                    预览
                  </button>
                  <button
                    onClick={() => handleRestore(v)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      justifyContent: 'center',
                      padding: '4px 7px', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)', background: 'transparent',
                      color: 'var(--color-ink-2)', fontSize: 10, cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <RotateCcw size={10} />
                    恢复
                  </button>
                </div>
              )}

              {/* 预览内容 */}
              {previewId === v.id && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    fontSize: 11,
                    color: 'var(--color-ink-3)',
                    lineHeight: 1.55,
                    maxHeight: 120,
                    overflowY: 'auto',
                  }}
                >
                  {v.sections.map(s => (
                    <div key={s.id} style={{ marginBottom: 4 }}>
                      <span style={{ fontWeight: 500, color: 'var(--color-ink-2)' }}>
                        {s.title.slice(0, 20)}
                      </span>
                      {s.content && (
                        <span style={{ marginLeft: 4 }}>
                          · {s.content.slice(0, 40)}…
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 底部说明 */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--color-border)',
          fontSize: 10,
          color: 'var(--color-ink-3)',
          lineHeight: 1.5,
          flexShrink: 0,
        }}
      >
        最多保留 30 个版本 · 存储在本地浏览器
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
