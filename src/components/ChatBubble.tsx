import { memo } from 'react'

interface ChatBubbleProps {
  role: 'ai' | 'user'
  content: string
  isStreaming?: boolean   // AI 正在输出时显示光标动画
}

function ChatBubble({ role, content, isStreaming }: ChatBubbleProps) {
  const isAI = role === 'ai'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isAI ? 'row' : 'row-reverse',
        alignItems: 'flex-start',
        gap: 8,
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'visible',
      }}
    >
      {/* 头像 */}
      {isAI && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--color-accent-light)',
            border: '1.5px solid var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontFamily: 'var(--font-serif)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-accent)',
          }}
        >
          文
        </div>
      )}

      {/* 气泡 */}
      <div
        style={{
          maxWidth: isAI ? 'calc(100% - 40px)' : '92%',
          minWidth: 0,
          padding: '10px 13px',
          borderRadius: isAI ? '2px 10px 10px 10px' : '10px 2px 10px 10px',
          background: isAI ? 'var(--color-surface)' : 'var(--color-accent)',
          color: isAI ? 'var(--color-ink)' : '#fff',
          fontSize: 13,
          lineHeight: 1.65,
          border: isAI ? '1px solid var(--color-border)' : 'none',
          boxShadow: isAI ? 'var(--shadow-sm)' : 'none',
          fontFamily: 'var(--font-sans)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          overflow: 'visible',
        }}
      >
        {content}
        {isStreaming && (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 14,
              background: isAI ? 'var(--color-accent)' : '#fff',
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              animation: 'blink 0.8s step-end infinite',
            }}
          />
        )}
      </div>
    </div>
  )
}

export default memo(ChatBubble)
