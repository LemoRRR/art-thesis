import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { AtSign, Search, Type } from 'lucide-react'
import { libraryAPI } from '../lib/api'
import { auth } from '../lib/auth'
import { libraryStore, styleProfileStore, type LibraryItem, type StyleProfile } from '../lib/storage'

export interface MentionRef {
  itemId?: string
  styleProfileId?: string
  title: string
  kind?: 'library' | 'styleProfile'
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
  styleProfiles?: StyleProfile[]
  selectedStyleProfileId?: string
  onStyleProfileSelect?: (profileId: string) => void
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
  styleProfiles,
  selectedStyleProfileId = '',
  onStyleProfileSelect,
}: MentionInputProps) {
  const [open, setOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [styleQuery, setStyleQuery] = useState('')
  const [results, setResults] = useState<LibraryItem[]>(() => libraryStore.getAll().slice(0, 8))
  const availableStyleProfiles = useMemo(
    () => styleProfiles ?? styleProfileStore.getAll(),
    [styleProfiles]
  )

  const selectedKeys = useMemo(
    () => new Set(mentions.map(item => item.itemId).filter((id): id is string => Boolean(id))),
    [mentions]
  )
  const selectedStyleKeys = useMemo(
    () => new Set(mentions.map(item => item.styleProfileId).filter((id): id is string => Boolean(id))),
    [mentions]
  )
  const selectedStyleProfile = useMemo(
    () => availableStyleProfiles.find(profile => profile.id === selectedStyleProfileId) ?? null,
    [availableStyleProfiles, selectedStyleProfileId]
  )
  const filteredStyleProfiles = useMemo(() => {
    const keyword = styleQuery.trim().toLowerCase()
    const list = keyword
      ? availableStyleProfiles.filter(profile =>
          profile.studentName.toLowerCase().includes(keyword) ||
          profile.editableSummary.toLowerCase().includes(keyword) ||
          profile.writingLevel.toLowerCase().includes(keyword)
        )
      : availableStyleProfiles
    return list.slice(0, 8)
  }, [availableStyleProfiles, styleQuery])

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
        // 本地资料库可用即可，远程搜索失败时不阻塞输入。
      }
    }
  }

  const handleTextChange = (next: string) => {
    onChange(next)
    if (next.endsWith('@')) {
      setStyleOpen(false)
      setOpen(true)
      void runSearch('')
    } else if (next.endsWith('/') && availableStyleProfiles.length > 0) {
      setOpen(false)
      setStyleOpen(true)
      setStyleQuery('')
    }
  }

  const addMention = (item: LibraryItem) => {
    if (!selectedKeys.has(item.id)) {
      onMentionsChange([...mentions, { itemId: item.id, title: item.title, kind: 'library' }])
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

  const addStyleProfile = (profile: StyleProfile) => {
    const label = profile.studentName || profile.profileName || '风格档案'
    onStyleProfileSelect?.(profile.id)
    if (!selectedStyleKeys.has(profile.id)) {
      onMentionsChange([...mentions, { styleProfileId: profile.id, title: label, kind: 'styleProfile' }])
    }
    const mentionText = `/${label} `
    const slashIndex = value.lastIndexOf('/')
    if (slashIndex >= 0) {
      onChange(`${value.slice(0, slashIndex)}${mentionText}`)
    } else if (!value.includes(mentionText)) {
      onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${mentionText}`)
    }
    setStyleOpen(false)
    setStyleQuery('')
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
          {mentions.map(item => {
            const key = item.itemId ?? item.styleProfileId ?? item.title
            const isStyleProfile = item.kind === 'styleProfile' || Boolean(item.styleProfileId)
            return (
              <button
                key={key}
                type="button"
                onClick={() => onMentionsChange(mentions.filter(ref => (ref.itemId ?? ref.styleProfileId ?? ref.title) !== key))}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 999,
                  background: isStyleProfile ? 'var(--color-bg)' : 'var(--color-accent-light)',
                  color: isStyleProfile ? 'var(--color-ink-2)' : 'var(--color-accent)',
                  padding: '4px 9px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {isStyleProfile ? '/' : '@'}{item.title} x
              </button>
            )
          })}
        </div>
      )}

      {selectedStyleProfile && !selectedStyleKeys.has(selectedStyleProfile.id) && (
        <div style={{ marginTop: mentions.length > 0 ? 6 : 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            onClick={() => onStyleProfileSelect?.('')}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              background: 'var(--color-bg)',
              color: 'var(--color-ink-2)',
              padding: '4px 9px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            /{selectedStyleProfile.studentName || selectedStyleProfile.profileName} x
          </button>
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
            点选资料后，系统会调用资料库里的材料、案例或写法范式。
          </div>
        </div>
      )}

      {styleOpen && (
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
              value={styleQuery}
              onChange={event => setStyleQuery(event.target.value)}
              placeholder="搜索风格档案"
              autoFocus
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--font-sans)' }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filteredStyleProfiles.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--color-ink-3)' }}>没有找到风格档案</div>
            ) : filteredStyleProfiles.map(profile => (
              <button
                key={profile.id}
                type="button"
                onClick={() => addStyleProfile(profile)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  background: profile.id === selectedStyleProfileId || selectedStyleKeys.has(profile.id) ? 'var(--color-accent-light)' : 'transparent',
                  padding: 10,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                  <Type size={13} color="var(--color-accent)" />
                  {profile.studentName || profile.profileName}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  {profile.editableSummary || profile.writingLevel || '学生风格档案'}
                </div>
              </button>
            ))}
          </div>

          <div style={{ padding: 10, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.6 }}>
            输入 / 调用风格档案；输入 @ 调用资料库，两者互不混用。
          </div>
        </div>
      )}
    </div>
  )
}
