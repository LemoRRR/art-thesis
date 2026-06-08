import { useState, useEffect, useRef, useCallback } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Wand2, Minimize2, Maximize2, BookOpen, X, Check } from 'lucide-react'
import { callDoubao } from '../lib/ai'
import { formatSectionContent } from '../lib/documentFormat'
import { promptQuickAction, promptRewriteSelection, type QuickAction } from '../lib/prompts'
import { revisionStore, type DocSection, type RevisionChange } from '../lib/storage'
import type { Message } from '../lib/ai'

interface SelectionToolbarProps {
  projectId: string
  containerRef:  RefObject<HTMLDivElement | null>
  sections:      DocSection[]
  activeSectionId: string | null
  onContentUpdate: (sectionId: string, newContent: string) => void
}

interface ToolbarPosition {
  top:  number
  left: number
}

interface PendingRevision {
  sectionId: string
  beforeText: string
  afterText: string
  instruction: string
  type: RevisionChange['type']
}

export default function SelectionToolbar({
  projectId,
  containerRef,
  sections,
  activeSectionId: _activeSectionId,
  onContentUpdate,
}: SelectionToolbarProps) {
  const [visible,     setVisible]     = useState(false)
  const [position,    setPosition]    = useState<ToolbarPosition>({ top: 0, left: 0 })
  const [isLoading,   setIsLoading]   = useState(false)
  const [showInput,   setShowInput]   = useState(false)     // AI 改写的自定义输入
  const [customInput, setCustomInput] = useState('')
  const [done,        setDone]        = useState(false)     // 操作完成提示
  const [pendingRevision, setPendingRevision] = useState<PendingRevision | null>(null)

  // 保存当前选区（fetch 期间选区可能消失）
  const savedRangeRef    = useRef<Range | null>(null)
  const savedSectionId   = useRef<string | null>(null)
  const savedContext     = useRef<string>('')
  const savedSelectedText = useRef<string>('')
  const abortRef         = useRef<AbortController | null>(null)
  const toolbarRef       = useRef<HTMLDivElement>(null)

  // ── 监听 mouseup：检测选区 ──────────────────────────────────
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // 如果点击的是工具栏本身，不处理
      if (toolbarRef.current?.contains(e.target as Node)) return

      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const selectedText = selection.toString().trim()
        if (selectedText.length < 3) {
          setVisible(false)
          setShowInput(false)
          return
        }

        // 检查选区是否在文档区内
        const range = selection.getRangeAt(0)
        const container = containerRef.current
        if (!container || !container.contains(range.commonAncestorContainer)) {
          setVisible(false)
          return
        }

        // 找到选区属于哪个 Section
        let node: Node | null = range.commonAncestorContainer
        let sectionId: string | null = null
        while (node && node !== container) {
          if (node instanceof HTMLElement) {
            const id = node.getAttribute('data-section-id')
            if (id) { sectionId = id; break }
          }
          node = node.parentNode
        }

        if (!sectionId) { setVisible(false); return }

        // 保存选区信息
        savedRangeRef.current = range.cloneRange()
        savedSectionId.current = sectionId
        savedSelectedText.current = selectedText

        // 获取上下文（选中文字前后各 150 字）
        const section = sections.find(s => s.id === sectionId)
        if (section) {
          const idx = section.content.indexOf(selectedText)
          const safeIdx = idx === -1 ? 0 : idx
          const start = Math.max(0, safeIdx - 150)
          const end = Math.min(section.content.length, safeIdx + selectedText.length + 150)
          savedContext.current = section.content.slice(start, end)
        }

        // 计算工具栏位置（使用视口坐标，避免被文档容器裁切）
        const rect = range.getBoundingClientRect()
        const toolbarWidth = 520
        const safeLeft = Math.min(
          Math.max(12, rect.left + rect.width / 2 - toolbarWidth / 2),
          window.innerWidth - toolbarWidth - 12
        )
        setPosition({
          top:  Math.max(12, rect.bottom + 10),
          left: safeLeft,
        })
        setVisible(true)
        setDone(false)
        setShowInput(false)
        setCustomInput('')
      }, 10)
    }

    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [sections, containerRef])

  // ── 执行替换 ─────────────────────────────────────────────────
  const acceptRevision = useCallback(() => {
    if (!pendingRevision) return
    const section = sections.find(item => item.id === pendingRevision.sectionId)
    if (!section) return

    const newContent = formatSectionContent(
      section.content.replace(pendingRevision.beforeText, pendingRevision.afterText)
    )
    const change = revisionStore.add({
      projectId,
      sectionId: pendingRevision.sectionId,
      type: pendingRevision.type,
      beforeText: pendingRevision.beforeText,
      afterText: pendingRevision.afterText,
      instruction: pendingRevision.instruction,
    })
    revisionStore.accept(change.id)
    onContentUpdate(pendingRevision.sectionId, newContent)

    const el = document.querySelector(`[data-section-id="${pendingRevision.sectionId}"]`) as HTMLDivElement | null
    if (el) el.innerText = newContent

    setPendingRevision(null)
    setDone(true)
    setTimeout(() => {
      setVisible(false)
      setDone(false)
    }, 1500)
  }, [onContentUpdate, pendingRevision, projectId, sections])

  const doReplace = useCallback(async (
    messages: Message[],
    type: RevisionChange['type'],
    instruction: string
  ) => {
    if (isLoading) return
    if (!savedRangeRef.current || !savedSectionId.current) return

    setIsLoading(true)
    setShowInput(false)
    setPendingRevision(null)

    let result = ''
    const abort = new AbortController()
    abortRef.current = abort

    callDoubao(
      messages,
      {
        onChunk: (chunk) => { result += chunk },
        onDone: () => {
          setIsLoading(false)
          setPendingRevision({
            sectionId: savedSectionId.current!,
            beforeText: savedSelectedText.current,
            afterText: formatSectionContent(result),
            instruction,
            type,
          })
        },
        onError: (err) => {
          setIsLoading(false)
          console.error('SelectionToolbar error:', err)
        },
      },
      abort.signal
    )
  }, [isLoading])

  // 快捷操作（缩短/扩写/学术化）
  const handleQuickAction = (action: QuickAction) => {
    const typeMap: Record<QuickAction, RevisionChange['type']> = {
      '缩短': 'shorten',
      '扩写': 'expand',
      '学术化': 'academic',
    }
    doReplace(promptQuickAction(action, savedSelectedText.current, savedContext.current), typeMap[action], action)
  }

  // 自定义改写
  const handleCustomRewrite = () => {
    if (!customInput.trim()) return
    doReplace(
      promptRewriteSelection(customInput, savedSelectedText.current, savedContext.current),
      'custom',
      customInput
    )
    setCustomInput('')
  }

  if (!visible) return null

  return (
    <div
      ref={toolbarRef}
      style={{
        position:    'fixed',
        top:         position.top,
        left:        position.left,
        zIndex:      1000,
        background:  'var(--color-surface)',
        border:      '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow:   'var(--shadow-lg)',
        display:     'flex',
        flexDirection: 'column',
        gap:         0,
        overflow:    'hidden',
        width:       520,
        maxWidth:    'calc(100vw - 24px)',
        maxHeight:   'min(70vh, 560px)',
        transition:  'opacity 0.1s',
        userSelect:  'none',
      }}
    >
      {done ? (
        // 完成状态
        <div
          style={{
            padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--color-accent)',
          }}
        >
          <Check size={14} />
          替换完成
        </div>
      ) : (
        <>
          {/* 操作按钮行 */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--color-ink-3)', padding: '0 4px', whiteSpace: 'nowrap' }}>
              已选中 {savedSelectedText.current.length} 字
            </span>
            <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

            {/* AI 改写（自定义）*/}
            <ToolbarBtn
              icon={<Wand2 size={12} />}
              label="AI 改写"
              active={showInput}
              loading={isLoading && showInput}
              onClick={() => setShowInput(v => !v)}
            />

            {/* 快捷操作 */}
            <ToolbarBtn icon={<Minimize2 size={12} />} label="缩短" loading={isLoading} onClick={() => handleQuickAction('缩短')} />
            <ToolbarBtn icon={<Maximize2 size={12} />} label="扩写" loading={isLoading} onClick={() => handleQuickAction('扩写')} />
            <ToolbarBtn icon={<BookOpen size={12} />} label="学术化" loading={isLoading} onClick={() => handleQuickAction('学术化')} />

            <div style={{ flex: 1 }} />

            {/* 关闭 */}
            <button
              onClick={() => setVisible(false)}
              style={{
                padding: 4, border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'var(--color-ink-3)',
                borderRadius: 4, display: 'flex', alignItems: 'center',
              }}
            >
              <X size={12} />
            </button>
          </div>

          {/* AI 改写自定义输入 */}
          {showInput && (
            <div
              style={{
                borderTop: '1px solid var(--color-border)',
                padding: '8px 10px',
                display: 'flex', gap: 6,
              }}
            >
              <input
                autoFocus
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomRewrite()}
                placeholder="说改写要求，如：更简洁、去掉重复"
                style={{
                  flex: 1, border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)', padding: '5px 8px',
                  fontSize: 12, outline: 'none', fontFamily: 'var(--font-sans)',
                  color: 'var(--color-ink)', background: 'var(--color-bg)',
                }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              />
              <button
                onClick={handleCustomRewrite}
                disabled={!customInput.trim() || isLoading}
                style={{
                  padding: '5px 12px', border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: !customInput.trim() || isLoading ? 'var(--color-border)' : 'var(--color-accent)',
                  color: '#fff', fontSize: 12, cursor: !customInput.trim() || isLoading ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {isLoading ? '…' : '确认'}
              </button>
            </div>
          )}

          {isLoading && !pendingRevision && (
            <div
              style={{
                borderTop: '1px solid var(--color-border)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                background: 'var(--color-bg)',
                color: 'var(--color-ink-3)',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 4 }}>
                {[0, 1, 2].map(index => (
                  <span
                    key={index}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'var(--color-accent)',
                      animation: 'selectionLoadingDot 1s ease-in-out infinite',
                      animationDelay: `${index * 0.15}s`,
                    }}
                  />
                ))}
              </div>
              <span>AI 正在生成修改建议，完成后会显示删除/新增对比…</span>
            </div>
          )}

          {pendingRevision && (
            <div style={{ borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ padding: '10px 10px 6px', fontSize: 11, color: 'var(--color-ink-3)', flexShrink: 0 }}>AI 修改建议</div>
              <div style={{ padding: '0 10px 10px', fontSize: 12, lineHeight: 1.7, overflowY: 'auto', minHeight: 0 }}>
                <div style={{ color: '#A8443F', background: '#FFF1EF', border: '1px solid #F0C5C0', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>删除</span>
                  <div style={{ textDecoration: 'line-through', whiteSpace: 'pre-wrap' }}>{pendingRevision.beforeText}</div>
                </div>
                <div style={{ color: 'var(--color-accent)', background: 'var(--color-accent-light)', border: '1px solid #B8D9C0', borderRadius: 6, padding: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>新增</span>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{pendingRevision.afterText}</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: 10, borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', flexShrink: 0 }}>
                <button
                  onClick={() => setPendingRevision(null)}
                  style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-ink-3)', padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  onClick={acceptRevision}
                  style={{ border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  接受修改
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <style>{`
        @keyframes selectionLoadingDot {
          0%, 100% { transform: translateY(0); opacity: 0.35; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// 工具栏按钮子组件
function ToolbarBtn({
  icon, label, active, loading, onClick
}: {
  icon: ReactNode
  label: string
  active?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', borderRadius: 'var(--radius-sm)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
        background: active ? 'var(--color-accent-light)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-ink-2)',
        fontSize: 11, cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-sans)', opacity: loading ? 0.6 : 1,
        whiteSpace: 'nowrap', transition: 'all 0.12s',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
