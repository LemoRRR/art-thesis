import { useRef, useEffect, useCallback } from 'react'
import { Sparkles, Edit3 } from 'lucide-react'
import SelectionToolbar from './SelectionToolbar'
import { formatSectionContent } from '../lib/documentFormat'
import { versionStore, type DocSection } from '../lib/storage'

interface DocAreaProps {
  projectId: string
  sections:        DocSection[]
  activeSectionId: string | null
  onSectionClick:  (id: string) => void
  onSectionChange: (id: string, content: string) => void
  onGenerateSection: (title: string) => void
}

export default function DocArea({
  projectId,
  sections,
  activeSectionId,
  onSectionClick,
  onSectionChange,
  onGenerateSection,
}: DocAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // 每个节对应的 ref（用于 contenteditable DOM 操作）
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 当 AI 生成内容时，同步更新 contenteditable 的 DOM
  // （因为 contenteditable 不受 React 控制，需要手动同步）
  useEffect(() => {
    sections.forEach(section => {
      const el = sectionRefs.current[section.id]
      if (!el) return
      // 只有当 DOM 内容与 state 不同时才更新（避免覆盖用户输入）
      const formattedContent = formatSectionContent(section.content)
      if (el.innerText !== formattedContent && document.activeElement !== el) {
        el.innerText = formattedContent
      }
    })
  }, [sections])

  // 处理 contenteditable 的输入（debounce 1s 后保存）
  const handleInput = useCallback((id: string, el: HTMLDivElement) => {
    const content = formatSectionContent(el.innerText)

    // 清除旧的 debounce 定时器
    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id])
    }

    debounceTimers.current[id] = setTimeout(() => {
      onSectionChange(id, content)
    }, 1000)
  }, [onSectionChange])

  // blur 时立即保存 + 生成版本快照
  const handleBlur = useCallback((id: string, title: string, el: HTMLDivElement) => {
    const content = formatSectionContent(el.innerText)

    // 清除 debounce，立即保存
    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id])
    }
    onSectionChange(id, content)
    versionStore.snapshot(`手动编辑：${title.slice(0, 20)}`, projectId)
  }, [onSectionChange, projectId])

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

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex' }}>

      {/* 框选工具栏（全局一个，根据选区位置浮动）*/}
      <SelectionToolbar
        projectId={projectId}
        containerRef={containerRef}
        sections={sections}
        activeSectionId={activeSectionId}
        onContentUpdate={(id, newContent) => {
          const el = sectionRefs.current[id]
          if (el) el.innerText = newContent
          onSectionChange(id, newContent)
          versionStore.snapshot('AI 修改：选中文本', projectId)
        }}
      />

      {/* 文档滚动区 */}
      <div
        ref={containerRef}
        id="doc-scroll-area"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '26px 34px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          background: '#F8F6F1',
        }}
      >
        {sections.map(section => {
          const isActive = section.id === activeSectionId

          return (
            <div
              key={section.id}
              id={`section-${section.id}`}
              className="doc-section-wrapper"
              onClick={() => onSectionClick(section.id)}
              style={{
                position: 'relative',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
                boxShadow: isActive ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                padding: '16px 18px 16px 20px',
                borderLeft: `4px solid ${
                  isActive
                    ? 'var(--color-accent)'
                    : section.status === 'generating'
                    ? 'var(--color-gpt)'
                    : 'var(--color-border)'
                }`,
                transition: 'box-shadow 0.2s, border-color 0.2s',
              }}
            >
              {/* 章节标题 */}
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                  marginBottom: 10,
                  fontFamily: 'var(--font-serif)',
                  letterSpacing: '0.01em',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{section.title}</span>

                {/* Hover 操作按钮 */}
                <div
                  className="section-hover-actions"
                  style={{
                    display: 'flex',
                    gap: 5,
                    opacity: 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {section.status === 'pending' || !section.content ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onGenerateSection(section.title)
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 9px', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-accent)',
                        fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                        fontWeight: 500,
                      }}
                    >
                      <Sparkles size={11} />
                      AI 生成
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        sectionRefs.current[section.id]?.focus()
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '3px 9px', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-ink-2)',
                        fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      }}
                    >
                      <Edit3 size={11} />
                      手动编辑
                    </button>
                  )}
                </div>
              </div>

              {section.content && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#B27A3A',
                    background: '#FFF8EA',
                    borderLeft: '2px solid #E5B76E',
                    padding: '4px 8px',
                    marginBottom: 8,
                  }}
                >
                  AI 删除修改：优化句式结构，突出研究对象与问题导向。
                </div>
              )}

              {/* 章节正文（contenteditable）*/}
              {section.status === 'generating' ? (
                // 生成中动画
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: 'var(--color-gpt)',
                          animation: 'bounce 1.2s ease-in-out infinite',
                          animationDelay: `${i * 0.2}s`,
                        }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-gpt)' }}>AI 正在生成…</span>
                </div>
              ) : (
                <div
                  ref={el => { sectionRefs.current[section.id] = el }}
                  contentEditable
                  suppressContentEditableWarning
                  data-section-id={section.id}
                  data-placeholder={
                    section.content
                      ? undefined
                      : '点击此处直接输入，或在左侧对话框说「写这一节」让 AI 生成'
                  }
                  onInput={e => handleInput(section.id, e.currentTarget)}
                  onBlur={e => handleBlur(section.id, section.title, e.currentTarget)}
                  style={{
                    minHeight: 56,
                    fontSize: 14,
                    lineHeight: 1.85,
                    color: section.content ? 'var(--color-ink-2)' : 'var(--color-ink-3)',
                    fontFamily: 'var(--font-sans)',
                    outline: 'none',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    cursor: 'text',
                  }}
                  // placeholder 样式通过 CSS 实现
                />
              )}

              {/* 内容为空时的 placeholder 样式 */}
              {!section.content && section.status !== 'generating' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 40,
                    left: 24,
                    fontSize: 13,
                    color: 'var(--color-ink-3)',
                    fontStyle: 'italic',
                    pointerEvents: 'none',
                    lineHeight: 1.6,
                  }}
                >
                  点击此处直接输入，或在左侧对话框说这一节的标题让 AI 生成
                </div>
              )}
            </div>
          )
        })}

        {/* 底部留白 */}
        <div style={{ height: 80 }} />
      </div>

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
