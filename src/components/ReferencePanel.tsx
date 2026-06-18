import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BookMarked, BookOpen, Check, FileText, Layers, Search, Tag, X } from 'lucide-react'
import {
  libraryStore,
  projectStore,
  referenceStore,
  sectionStore,
  type CitationEvidenceSource,
  type ReferenceSelection,
  type WorkflowStage,
} from '../lib/storage'
import { scholarAPI, type ScholarPaper } from '../lib/api'

interface ReferencePanelProps {
  projectId: string
  stage: WorkflowStage
  open: boolean
  onClose: () => void
  onChange?: (selection: ReferenceSelection) => void
  onApplyToActiveSection?: () => void
}

interface ScholarCandidate extends ScholarPaper {
  provider?: string
  savedItemId?: string
}

function buildScholarQuery(
  projectTitle: string,
  context: { researchObject?: string; coreArguments?: string[] } | null
): string {
  return [
    projectTitle,
    context?.researchObject,
    context?.coreArguments?.slice(0, 3).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/[《》“”"'【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function scholarPaperToLibraryText(paper: ScholarPaper): string {
  return [
    `标题：${paper.title}`,
    paper.authors.length ? `作者：${paper.authors.join('；')}` : '',
    paper.year ? `年份：${paper.year}` : '',
    paper.source ? `来源：${paper.source}` : '',
    paper.doi ? `DOI：${paper.doi}` : '',
    paper.url ? `链接：${paper.url}` : '',
    paper.citedByCount !== undefined ? `OpenAlex引用次数：${paper.citedByCount}` : '',
    '',
    paper.abstract ? `摘要：\n${paper.abstract}` : '摘要：暂无公开摘要。',
    '',
    '使用提醒：该条目来自论文搜索结果，写作前建议用户核对原文、页码与最终参考文献格式。',
  ].filter(Boolean).join('\n')
}

export default function ReferencePanel({ projectId, stage, open, onClose, onChange, onApplyToActiveSection }: ReferencePanelProps) {
  const project = projectStore.ensure(projectId)
  const [selection, setSelection] = useState<ReferenceSelection>(() => referenceStore.get(projectId, stage))
  const [query, setQuery] = useState('')
  const [scholarQuery, setScholarQuery] = useState(() => buildScholarQuery(project.title, project.context))
  const [scholarResults, setScholarResults] = useState<ScholarCandidate[]>([])
  const [isSearchingScholar, setIsSearchingScholar] = useState(false)
  const [scholarNotice, setScholarNotice] = useState('')
  const showScholarSearch = stage === 'stage3'
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
  const autoSources = selection.autoSources ?? []
  const evidencePack = selection.evidencePack
  const evidencePointCount = evidencePack
    ? evidencePack.theoryConcepts.length
      + evidencePack.literatureReview.length
      + evidencePack.methodSupport.length
      + evidencePack.caseEvidence.length
      + evidencePack.chapterEvidence.reduce((total, chapter) => total + chapter.keyPoints.length, 0)
    : 0

  useEffect(() => {
    if (open) setSelection(referenceStore.get(projectId, stage))
  }, [open, projectId, stage])

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

  const toggleAutoCitation = () => {
    saveSelection({ ...selection, autoCitationEnabled: selection.autoCitationEnabled === false })
  }

  const saveAutoSourceToLibrary = (source: CitationEvidenceSource) => {
    const existing = libraryStore.getAll().find(item =>
      item.fileUrl === source.url ||
      (source.doi && item.summary.includes(source.doi)) ||
      item.title.trim() === source.title.trim()
    )
    const item = existing ?? libraryStore.add({
      title: source.title,
      type: 'other',
      fileName: source.doi || source.id,
      fileUrl: source.url,
      text: scholarPaperToLibraryText({
        id: source.id,
        title: source.title,
        authors: source.authors,
        year: source.year,
        source: source.source,
        doi: source.doi,
        url: source.url,
        citedByCount: source.citedByCount,
        abstract: source.abstract,
      }),
      summary: [
        source.authors.length ? source.authors.join('、') : '作者未详',
        source.year ? `${source.year}` : '',
        source.source || '',
        source.doi ? `DOI：${source.doi}` : '',
      ].filter(Boolean).join('；'),
      tags: ['自动文献增强', source.provider || '外部检索', ...(source.year ? [String(source.year)] : [])],
      extractStatus: 'done',
      structureExtract: 'Stage3 自动文献增强检索结果。',
      viewpointsExtract: source.relevanceReason || (source.abstract ? `摘要要点：${source.abstract.slice(0, 800)}` : ''),
    })
    projectStore.bindLibraryItem(projectId, item.id)
    if (!selection.libraryItemIds.includes(item.id)) {
      saveSelection({ ...selection, libraryItemIds: [item.id, ...selection.libraryItemIds] })
    }
  }

  const handleScholarSearch = async () => {
    const searchText = scholarQuery.trim() || buildScholarQuery(project.title, project.context)
    if (!searchText || isSearchingScholar) return

    setScholarQuery(searchText)
    setIsSearchingScholar(true)
    setScholarNotice('')

    try {
      const response = await scholarAPI.search(searchText, 8)
      setScholarResults(response.results.map(paper => ({ ...paper, provider: response.provider })))
      setScholarNotice(response.results.length
        ? `已找到 ${response.results.length} 条候选文献。加入手动来源后，AI 生成正文时会自动吸收并生成 [1][2]。`
        : '暂未搜到合适文献，可以换成英文关键词或更具体的研究对象。'
      )
    } catch (error) {
      setScholarNotice(`论文搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSearchingScholar(false)
    }
  }

  const saveScholarPaper = (paper: ScholarCandidate) => {
    if (paper.savedItemId) return
    const existing = libraryStore.getAll().find(item =>
      item.fileUrl === paper.url ||
      (paper.doi && item.summary.includes(paper.doi)) ||
      item.title.trim() === paper.title.trim()
    )
    const item = existing ?? libraryStore.add({
      title: paper.title,
      type: 'other',
      fileName: paper.doi || paper.id,
      fileUrl: paper.url,
      text: scholarPaperToLibraryText(paper),
      summary: [
        paper.authors.length ? paper.authors.join('、') : '作者未知',
        paper.year ? `${paper.year}` : '',
        paper.source || '',
        paper.doi ? `DOI：${paper.doi}` : '',
      ].filter(Boolean).join('；'),
      tags: ['论文搜索', paper.provider || '外部检索', ...(paper.year ? [String(paper.year)] : [])],
      extractStatus: 'done',
      structureExtract: '外部论文检索结果：用于建立论文搜索候选文献池。',
      viewpointsExtract: paper.abstract ? `摘要要点：${paper.abstract.slice(0, 800)}` : '',
    })

    projectStore.bindLibraryItem(projectId, item.id)
    if (!selection.libraryItemIds.includes(item.id)) {
      saveSelection({ ...selection, libraryItemIds: [item.id, ...selection.libraryItemIds] })
    }
    setScholarResults(results => results.map(result =>
      result.id === paper.id ? { ...result, savedItemId: item.id } : result
    ))
    setScholarNotice(`已加入手动来源：${paper.title}。重新生成全文或当前小节时，AI 会自动把它写入正文引用。`)
  }

  if (!open) return null

  return (
    <aside
      style={{
        width: 380,
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
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-ink)' }}>来源设置</div>
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
            placeholder="搜索资料库"
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
        {showScholarSearch && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-ink)' }}>自动文献增强</div>
                <div style={{ marginTop: 3, fontSize: 10, color: 'var(--color-ink-3)' }}>
                  生成全文时自动检索学术来源并写入引用。
                </div>
              </div>
              <button
                onClick={toggleAutoCitation}
                style={{
                  border: `1px solid ${selection.autoCitationEnabled === false ? 'var(--color-border)' : 'var(--color-accent)'}`,
                  borderRadius: 'var(--radius-sm)',
                  background: selection.autoCitationEnabled === false ? 'transparent' : 'var(--color-accent-light)',
                  color: selection.autoCitationEnabled === false ? 'var(--color-ink-3)' : 'var(--color-accent)',
                  padding: '4px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {selection.autoCitationEnabled === false ? '已关闭' : '已开启'}
              </button>
            </div>
            {autoSources.length > 0 ? (
              <div style={{ marginTop: 8, display: 'grid', gap: 7 }}>
                {evidencePack && (
                  <div style={{ border: '1px solid rgba(45, 90, 61, 0.18)', borderRadius: 'var(--radius-sm)', background: '#F8FBF8', padding: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 650, color: 'var(--color-accent)', lineHeight: 1.45 }}>
                      论文证据包已生成
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-ink-2)', lineHeight: 1.55 }}>
                      {evidencePack.summary || '系统已把自动来源整理为理论概念、研究现状、方法依据、案例依据和章节写作卡。'}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, color: 'var(--color-ink-3)' }}>
                      <span>{evidencePointCount} 个证据点</span>
                      <span>{evidencePack.chapterEvidence.length} 个章节写作卡</span>
                      {evidencePack.cautions.length > 0 && <span>{evidencePack.cautions.length} 条核对提醒</span>}
                    </div>
                  </div>
                )}
                {autoSources.slice(0, 6).map((source, index) => (
                  <div key={source.id || index} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', padding: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 650, color: 'var(--color-ink)', lineHeight: 1.45 }}>
                      [{index + 1}] {source.title}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-ink-3)', lineHeight: 1.45 }}>
                      {[source.authors?.slice(0, 2).join('、'), source.year, source.source, source.provider].filter(Boolean).join(' · ')}
                    </div>
                    {source.relevanceReason && (
                      <div style={{ marginTop: 5, fontSize: 10, color: 'var(--color-ink-2)', lineHeight: 1.5 }}>
                        {source.relevanceReason}
                      </div>
                    )}
                    <button
                      onClick={() => saveAutoSourceToLibrary(source)}
                      style={{ marginTop: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-accent)', padding: '4px 7px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                    >
                      保存到资料库
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-ink-3)', lineHeight: 1.5 }}>
                当前还没有自动来源。点击“生成全文”后会在后台自动检索。
              </div>
            )}
          </div>
        )}
        {showScholarSearch && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-ink)' }}>手动补充来源</div>
              <span style={{ fontSize: 10, color: 'var(--color-ink-3)' }}>高级选项</span>
            </div>
            <div style={{ marginTop: 5, fontSize: 10, lineHeight: 1.5, color: 'var(--color-ink-3)' }}>
              默认会自动检索；这里用于手动补充指定文献。加入后重新生成全文或当前小节，系统会在正文中插入 [1][2] 并生成参考文献。
            </div>
            <div style={{ marginTop: 7, display: 'flex', gap: 6 }}>
              <input
                value={scholarQuery}
                onChange={event => setScholarQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleScholarSearch()
                  }
                }}
                placeholder="输入关键词或题目"
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface)',
                  padding: '6px 8px',
                  fontSize: 12,
                  outline: 'none',
                  fontFamily: 'var(--font-sans)',
                }}
              />
              <button
                onClick={handleScholarSearch}
                disabled={isSearchingScholar}
                style={{
                  border: '1px solid var(--color-accent)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  padding: '0 9px',
                  fontSize: 12,
                  cursor: isSearchingScholar ? 'wait' : 'pointer',
                  opacity: isSearchingScholar ? 0.7 : 1,
                  fontFamily: 'var(--font-sans)',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSearchingScholar ? '搜索中' : '搜索'}
              </button>
            </div>
            {scholarNotice && (
              <div style={{ marginTop: 7, fontSize: 11, lineHeight: 1.5, color: scholarNotice.includes('失败') ? '#b42318' : 'var(--color-accent)' }}>
                {scholarNotice}
              </div>
            )}
            {scholarResults.length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 7, maxHeight: 300, overflowY: 'auto' }}>
                {scholarResults.map(paper => (
                  <div
                    key={paper.id}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-surface)',
                      padding: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-ink)', lineHeight: 1.45 }}>
                      {paper.title}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-ink-3)', lineHeight: 1.45 }}>
                      {[paper.authors.slice(0, 2).join('、'), paper.year, paper.source].filter(Boolean).join(' · ')}
                    </div>
                    {paper.abstract && (
                      <div style={{ marginTop: 5, fontSize: 11, color: 'var(--color-ink-2)', lineHeight: 1.5, maxHeight: 50, overflow: 'hidden' }}>
                        {paper.abstract}
                      </div>
                    )}
                    <button
                      onClick={() => saveScholarPaper(paper)}
                      disabled={Boolean(paper.savedItemId)}
                      style={{
                        width: '100%',
                        marginTop: 7,
                        border: `1px solid ${paper.savedItemId ? 'var(--color-border)' : 'var(--color-accent)'}`,
                        borderRadius: 'var(--radius-sm)',
                        background: paper.savedItemId ? 'transparent' : 'var(--color-accent-light)',
                        color: paper.savedItemId ? 'var(--color-ink-3)' : 'var(--color-accent)',
                        padding: '5px 8px',
                        fontSize: 12,
                        cursor: paper.savedItemId ? 'default' : 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {paper.savedItemId ? '已在手动来源' : '加入手动来源'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {onApplyToActiveSection && selectedReferenceCount > 0 && (
              <button
                onClick={onApplyToActiveSection}
                style={{
                  width: '100%',
                  marginTop: 8,
                  border: '1px solid var(--color-accent)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-accent)',
                  padding: '7px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                用这些来源重写当前小节
              </button>
            )}
          </div>
        )}
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

        <SectionTitle icon={<BookOpen size={13} />} label="资料库" />
        {filteredReferenceItems.length === 0 ? (
          <EmptyText text="资料库里还没有匹配资料" />
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
