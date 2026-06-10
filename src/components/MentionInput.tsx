import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { AtSign, Search } from 'lucide-react'
import { libraryAPI } from '../lib/api'
import { auth } from '../lib/auth'
import { libraryStore, type LibraryItem } from '../lib/storage'

export interface MentionRef {
  itemId: string
  title: string
}

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  mentions: MentionRef[]
  onMentionsChange: (mentions: MentionRef[]) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
  style?: CSSProperties
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

export default function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder,
  disabled,
  rows = 3,
  style,
  onKeyDown,
}: MentionInputProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryItem[]>(() => libraryStore.getAll().slice(0, 8))

  const selectedKeys = useMemo(
    () => new Set(mentions.map(item => item.itemId)),
    [mentions]
  )

  const runSearch = async (nextQuery: string) => {
    setQuery(nextQuery)
    const local = libraryStore.getAll().filter(item =>
      item.title.toLowerCase().includes(nextQuery.toLowerCase()) ||
      item.summary.toLowerCase().includes(nextQuery.toLowerCase())
    )
    setResults(local.slice(0, 8))

    if (auth.isLoggedIn()) {
      try {
        const rows = await libraryAPI.search(nextQuery)
        const remote = (rows as unknown[]).map(row => libraryStore.upsertRemote(row))
        setResults(remote.slice(0, 8))
      } catch {
        // 本地资料库已经可用，远端搜索失败时不阻塞输入。
      }
    }
  }

  const handleTextChange = (next: string) => {
    onChange(next)
    if (next.endsWith('@')) {
      setOpen(true)
      void runSearch('')
    }
  }

  const addMention = (item: LibraryItem) => {
    if (!selectedKeys.has(item.id)) {
      onMentionsChange([...mentions, { itemId: item.id, title: item.title }])
    }
    const mentionText = `@${item.title} `
    const atIndex = value.lastIndexOf('@')
    if (atIndex >= 0) {
      onChange(`${value.slice(0, atIndex)}${mentionText}`)
    } else if (!value.includes(mentionText)) {
      onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${mentionText}`)
    }
    setOpen(false)
    setQuery('')
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      <textarea
        value={value}
        onChange={event => handleTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        style={{
          width: '100%',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 10,
          resize: 'vertical',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          lineHeight: 1.7,
          boxSizing: 'border-box',
          outline: 'none',
          background: disabled ? 'var(--color-bg)' : 'var(--color-surface)',
        }}
      />

      {mentions.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {mentions.map(item => (
            <button
              key={item.itemId}
              type="button"
              onClick={() => onMentionsChange(mentions.filter(ref => ref.itemId !== item.itemId))}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 999,
                background: 'var(--color-accent-light)',
                color: 'var(--color-accent)',
                padding: '4px 9px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              @{item.title} ×
            </button>
          ))}
        </div>
      )}

      {open && (
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: '100%',
          marginBottom: 8,
          zIndex: 50,
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-border)' }}>
            <Search size={13} color="var(--color-ink-3)" />
            <input
              value={query}
              onChange={event => void runSearch(event.target.value)}
              placeholder="搜索资料库"
              autoFocus
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font-sans)' }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-3)' }}>没有找到资料</div>
            ) : results.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => addMention(item)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  background: selectedKeys.has(item.id) ? 'var(--color-accent-light)' : 'transparent',
                  padding: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                  <AtSign size={13} color="var(--color-accent)" />
                  {item.title}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  {item.summary || item.text.slice(0, 60)}
                </div>
              </button>
            ))}
          </div>

          <div style={{ padding: 10, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.6 }}>
            点选资料后，系统默认调用它的“写法范式”模块。
          </div>
        </div>
      )}
    </div>
  )
}
