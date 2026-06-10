import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BookMarked, BookOpen, Check, FileText, Layers, Search, Tag, X } from 'lucide-react'
import {
  libraryStore,
  projectStore,
  referenceStore,
  sectionStore,
  type ReferenceSelection,
  type WorkflowStage,
} from '../lib/storage'

interface ReferencePanelProps {
  projectId: string
  stage: WorkflowStage
  open: boolean
  onClose: () => void
  onChange?: (selection: ReferenceSelection) => void
}

export default function ReferencePanel({ projectId, stage, open, onClose, onChange }: ReferencePanelProps) {
  const [selection, setSelection] = useState<ReferenceSelection>(() => referenceStore.get(projectId, stage))
  const [query, setQuery] = useState('')
  const project = projectStore.ensure(projectId)
  const libraryItems = libraryStore.getAll()
  const sections = sectionStore.getByProject(projectId)
  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return libraryItems
    return libraryItems.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }, [libraryItems, query])
  const filteredReferenceItems = filteredLibrary.filter(item => item.type !== 'style' && item.type !== 'case')
  const filteredStyleItems = filteredLibrary.filter(item => item.type === 'style')
  const filteredCaseItems = filteredLibrary.filter(item => item.type === 'case')
  const selectedReferenceCount = selection.libraryItemIds.filter(id => {
    const item = libraryStore.get(id)
    return item && item.type !== 'style' && item.type !== 'case'
  }).length
  const selectedStyleCount = selection.libraryItemIds.filter(id => {
    const item = libraryStore.get(id)
    return item?.type === 'style'
  }).length
  const selectedCaseCount = selection.libraryItemIds.filter(id => {
    const item = libraryStore.get(id)
    return item?.type === 'case'
  }).length

  const saveSelection = (next: ReferenceSelection) => {
    setSelection(next)
    referenceStore.save(next)
    onChange?.(next)
  }

  const toggleLibrary = (id: string) => {
    const exists = selection.libraryItemIds.includes(id)
    saveSelection({
      ...selection,
      libraryItemIds: exists
        ? selection.libraryItemIds.filter(itemId => itemId !== id)
        : [...selection.libraryItemIds, id],
    })
  }

  const toggleSection = (id: string) => {
    const exists = selection.sectionIds.includes(id)
    saveSelection({
      ...selection,
      sectionIds: exists
        ? selection.sectionIds.filter(sectionId => sectionId !== id)
        : [...selection.sectionIds, id],
    })
  }

  const toggleFlag = (key: 'includeProjectContext' | 'includeConversationSummary') => {
    saveSelection({ ...selection, [key]: !selection[key] })
  }

  if (!open) return null

  return (
    <aside
      style={{
        width: 300,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 200,
      }}
    >
      <div
        style={{
          height: 48,
          padding: '0 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-ink)' }}>引用上下文</div>
          <div style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>{project.title}</div>
        </div>
        <button
          onClick={onClose}
          style={{ border: 'none', background: 'transparent', color: 'var(--color-ink-3)', cursor: 'pointer' }}
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 8px',
            background: 'var(--color-bg)',
          }}
        >
          <Search size={13} color="var(--color-ink-3)" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索库资料"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 12,
              fontFamily: 'var(--font-sans)',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <SectionTitle icon={<Layers size={13} />} label="项目上下文" />
        <ToggleRow
          checked={selection.includeProjectContext}
          title="项目理解模型"
          subtitle={project.context.rawSummary || '研究对象、边界、学段等信息'}
          onClick={() => toggleFlag('includeProjectContext')}
        />
        <ToggleRow
          checked={selection.includeConversationSummary}
          title="阶段对话摘要"
          subtitle="将最近对话作为本次 AI 的背景"
          onClick={() => toggleFlag('includeConversationSummary')}
        />

        <SectionTitle icon={<BookOpen size={13} />} label="库资料" />
        {filteredReferenceItems.length === 0 ? (
          <EmptyText text="库里还没有匹配资料" />
        ) : (
          filteredReferenceItems.map(item => {
            const checked = selection.libraryItemIds.includes(item.id)

            return (
              <ToggleRow
                key={item.id}
                checked={checked}
                title={item.title}
                subtitle={item.summary || item.text.slice(0, 48)}
                onClick={() => toggleLibrary(item.id)}
              />
            )
          })
        )}

        <SectionTitle icon={<Tag size={13} />} label="风格标签" />
        {filteredStyleItems.length === 0 ? (
          <EmptyText text="还没有风格标签，去库里提取" />
        ) : (
          filteredStyleItems.map(item => {
            const checked = selection.libraryItemIds.includes(item.id)

            return (
              <ToggleRow
                key={item.id}
                checked={checked}
                title={item.title}
                subtitle={item.summary || item.text.slice(0, 48)}
                onClick={() => toggleLibrary(item.id)}
              />
            )
          })
        )}

        <SectionTitle icon={<BookMarked size={13} />} label="案例参考" />
        {filteredCaseItems.length === 0 ? (
          <EmptyText text="还没有案例标签，去库里提取" />
        ) : (
          filteredCaseItems.map(item => {
            const checked = selection.libraryItemIds.includes(item.id)

            return (
              <ToggleRow
                key={item.id}
                checked={checked}
                title={item.title}
                subtitle={item.summary || item.text.slice(0, 48)}
                onClick={() => toggleLibrary(item.id)}
              />
            )
          })
        )}

        <SectionTitle icon={<FileText size={13} />} label="项目内容" />
        {sections.length === 0 ? (
          <EmptyText text="项目里还没有章节" />
        ) : (
          sections.map(section => (
            <ToggleRow
              key={section.id}
              checked={selection.sectionIds.includes(section.id)}
              title={section.title}
              subtitle={section.content || '暂无正文'}
              onClick={() => toggleSection(section.id)}
            />
          ))
        )}
      </div>

      <div
        style={{
          padding: '9px 12px',
          borderTop: '1px solid var(--color-border)',
          fontSize: 11,
          color: 'var(--color-ink-3)',
          lineHeight: 1.6,
        }}
      >
        已选 {selectedReferenceCount} 条资料 · {selectedStyleCount} 个风格标签 · {selectedCaseCount} 个案例 · {selection.sectionIds.length} 个章节
      </div>
    </aside>
  )
}

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 7px', fontSize: 11, fontWeight: 650, color: 'var(--color-ink-3)' }}>
      {icon}
      {label}
    </div>
  )
}

function ToggleRow({
  checked,
  title,
  subtitle,
  onClick,
}: {
  checked: boolean
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        background: checked ? 'var(--color-accent-light)' : 'transparent',
        padding: 9,
        marginBottom: 7,
        display: 'flex',
        gap: 8,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <span
        style={{
          width: 17,
          height: 17,
          borderRadius: 4,
          border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          background: checked ? 'var(--color-accent)' : 'transparent',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {checked && <Check size={11} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-ink)' }}>
          {title}
        </span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 10, lineHeight: 1.45, color: 'var(--color-ink-3)', maxHeight: 30, overflow: 'hidden' }}>
          {subtitle}
        </span>
      </span>
    </button>
  )
}

function EmptyText({ text }: { text: string }) {
  return (
    <div style={{ padding: '8px 4px', fontSize: 11, color: 'var(--color-ink-3)' }}>
      {text}
    </div>
  )
}
