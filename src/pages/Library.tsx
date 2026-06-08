import { useMemo, useRef, useState } from 'react'
import { BookMarked, FileText, Link2, Search, Sparkles, Tag, Trash2, Upload } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import { callGPT } from '../lib/ai'
import { promptExtractCases, promptExtractStyle } from '../lib/prompts'
import {
  libraryStore,
  projectStore,
  type LibraryItem,
  type LibraryItemType,
} from '../lib/storage'

function getFileType(fileName: string): LibraryItemType {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'doc') return 'doc'
  if (ext === 'txt') return 'txt'
  return 'other'
}

export default function Library() {
  const [items, setItems] = useState<LibraryItem[]>(() => libraryStore.getAll())
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [tab, setTab] = useState<'add' | 'style' | 'case'>('add')
  const [styleText, setStyleText] = useState('')
  const [styleName, setStyleName] = useState('')
  const [styleResult, setStyleResult] = useState('')
  const [styleLoading, setStyleLoading] = useState(false)
  const [caseText, setCaseText] = useState('')
  const [caseName, setCaseName] = useState('')
  const [caseResult, setCaseResult] = useState('')
  const [caseLoading, setCaseLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const activeProject = projectStore.ensure()
  const activeItem = items.find(item => item.id === activeId) ?? null
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.summary.toLowerCase().includes(q) ||
      item.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }, [items, query])

  const refresh = () => setItems(libraryStore.getAll())

  const addTextItem = () => {
    const text = draft.trim()
    if (!text) return
    const item = libraryStore.add({
      title: title.trim() || text.slice(0, 24) || '未命名资料',
      type: 'note',
      text,
      summary: text.slice(0, 120),
      tags: ['手动输入'],
    })
    setDraft('')
    setTitle('')
    refresh()
    setActiveId(item.id)
  }

  const handleFile = async (file: File) => {
    const isText = file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')
    const text = isText
      ? await file.text()
      : `已上传文件：${file.name}\n\n当前 Demo 已记录文件名和引用入口。完整版后端会解析 PDF/Word 正文并建立检索索引。`
    const item = libraryStore.add({
      title: file.name.replace(/\.[^.]+$/, ''),
      type: getFileType(file.name),
      fileName: file.name,
      fileSize: file.size,
      text,
      summary: text.slice(0, 120),
      tags: [getFileType(file.name).toUpperCase()],
    })
    refresh()
    setActiveId(item.id)
  }

  const removeItem = (id: string) => {
    if (!confirm('确认删除这条资料？已绑定项目中的引用也会移除。')) return
    libraryStore.remove(id)
    const next = libraryStore.getAll()
    setItems(next)
    setActiveId(next[0]?.id ?? null)
  }

  const bindToProject = (itemId: string) => {
    projectStore.bindLibraryItem(activeProject.id, itemId)
    alert(`已绑定到项目「${activeProject.title}」`)
  }

  const extractStyle = () => {
    if (!styleText.trim() || styleLoading) return
    setStyleResult('')
    setStyleLoading(true)
    const abort = new AbortController()
    abortRef.current = abort
    let result = ''
    callGPT(
      promptExtractStyle(styleText),
      {
        onChunk: (chunk) => {
          result += chunk
          setStyleResult(result)
        },
        onDone: () => setStyleLoading(false),
        onError: () => setStyleLoading(false),
      },
      abort.signal
    )
  }

  const saveStyleTag = () => {
    if (!styleResult.trim()) return
    const item = libraryStore.add({
      title: styleName.trim() || '风格标签',
      type: 'style',
      text: styleResult,
      summary: styleResult.slice(0, 80),
      tags: ['风格标签'],
    })
    setStyleText('')
    setStyleName('')
    setStyleResult('')
    refresh()
    setActiveId(item.id)
  }

  const extractCase = () => {
    if (!caseText.trim() || caseLoading) return
    setCaseResult('')
    setCaseLoading(true)
    const abort = new AbortController()
    abortRef.current = abort
    let result = ''
    const researchContext = activeProject.context.rawSummary || activeProject.title
    callGPT(
      promptExtractCases(caseText, researchContext),
      {
        onChunk: (chunk) => {
          result += chunk
          setCaseResult(result)
        },
        onDone: () => setCaseLoading(false),
        onError: () => setCaseLoading(false),
      },
      abort.signal
    )
  }

  const saveCaseTag = () => {
    if (!caseResult.trim()) return
    const item = libraryStore.add({
      title: caseName.trim() || '案例参考',
      type: 'case',
      text: caseResult,
      summary: caseResult.slice(0, 80),
      tags: ['案例参考'],
    })
    setCaseText('')
    setCaseName('')
    setCaseResult('')
    refresh()
    setActiveId(item.id)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            height: 52,
            flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-ink)' }}>库</div>
            <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>长期资料池，可被任意项目和阶段引用</div>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            <Upload size={14} />
            上传资料
            <input
              type="file"
              accept=".txt,.pdf,.doc,.docx"
              style={{ display: 'none' }}
              onChange={event => {
                const file = event.target.files?.[0]
                if (file) handleFile(file)
                event.target.value = ''
              }}
            />
          </label>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <section
            style={{
              width: 330,
              flexShrink: 0,
              borderRight: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid var(--color-border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 9px',
                  background: 'var(--color-bg)',
                }}
              >
                <Search size={14} color="var(--color-ink-3)" />
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="搜索资料、标签、摘要"
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

            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {filteredItems.length === 0 ? (
                <div style={{ padding: 20, color: 'var(--color-ink-3)', fontSize: 12, lineHeight: 1.7 }}>
                  暂无资料。上传文件，或在右侧粘贴一段文本作为库资料。
                </div>
              ) : (
                filteredItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    style={{
                      width: '100%',
                      border: `1px solid ${activeId === item.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-md)',
                      background: activeId === item.id ? 'var(--color-accent-light)' : 'var(--color-surface)',
                      padding: 11,
                      marginBottom: 9,
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      {item.type === 'style' ? (
                        <Tag size={14} color="var(--color-doubao)" />
                      ) : item.type === 'case' ? (
                        <BookMarked size={14} color="#E08C4A" />
                      ) : (
                        <FileText size={14} color="var(--color-accent)" />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.55 }}>
                      {item.summary || item.text.slice(0, 70)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 24 }}>
            {activeItem ? (
              <article
                style={{
                  maxWidth: 850,
                  margin: '0 auto',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-sm)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: 18, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h1 style={{ margin: 0, fontSize: 18, color: 'var(--color-ink)' }}>{activeItem.title}</h1>
                    <div style={{ marginTop: 5, fontSize: 12, color: 'var(--color-ink-3)' }}>
                      {activeItem.type.toUpperCase()} · {new Date(activeItem.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => bindToProject(activeItem.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-accent)',
                        color: '#fff',
                        padding: '7px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <Link2 size={13} />
                      绑定到当前项目
                    </button>
                    <button
                      onClick={() => removeItem(activeItem.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        background: 'transparent',
                        color: 'var(--color-ink-3)',
                        padding: '7px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 22,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 13,
                    lineHeight: 1.85,
                    color: 'var(--color-ink-2)',
                  }}
                >
                  {activeItem.text}
                </pre>
              </article>
            ) : (
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <h1 style={{ fontSize: 22, color: 'var(--color-ink)' }}>添加一条资料</h1>
                <p style={{ fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.8 }}>
                  可先用文本模拟资料库。完整版后端会负责 PDF/Word 解析、摘要和检索索引。
                </p>
              </div>
            )}

            <div
              style={{
                maxWidth: 850,
                margin: '20px auto 0',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
                {([
                  { key: 'add',   label: '添加资料' },
                  { key: 'style', label: '提取风格' },
                  { key: 'case',  label: '提取案例' },
                ] as const).map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      flex: 1,
                      padding: '10px 0',
                      border: 'none',
                      borderBottom: `2px solid ${tab === t.key ? 'var(--color-accent)' : 'transparent'}`,
                      background: 'transparent',
                      color: tab === t.key ? 'var(--color-accent)' : 'var(--color-ink-3)',
                      fontSize: 12,
                      fontWeight: tab === t.key ? 500 : 400,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ padding: 16 }}>
                {tab === 'add' && (
                  <>
                    <input
                      value={title}
                      onChange={event => setTitle(event.target.value)}
                      placeholder="资料标题"
                      style={{
                        width: '100%',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                        fontFamily: 'var(--font-sans)',
                        marginBottom: 10,
                        fontSize: 13,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <textarea
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      placeholder="粘贴资料内容、文献摘录、访谈材料或课堂记录..."
                      rows={6}
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
                      }}
                    />
                    <button
                      onClick={addTextItem}
                      disabled={!draft.trim()}
                      style={{
                        marginTop: 10,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: draft.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                        color: '#fff',
                        padding: '8px 14px',
                        fontSize: 12,
                        cursor: draft.trim() ? 'pointer' : 'not-allowed',
                      }}
                    >
                      存入库
                    </button>
                  </>
                )}

                {tab === 'style' && (
                  <>
                    <input
                      value={styleName}
                      onChange={event => setStyleName(event.target.value)}
                      placeholder="风格标签名称（如：王老师论文风格、好的开头段）"
                      style={{
                        width: '100%',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                        fontFamily: 'var(--font-sans)',
                        marginBottom: 10,
                        fontSize: 13,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <textarea
                      value={styleText}
                      onChange={event => setStyleText(event.target.value)}
                      placeholder="粘贴参考文章或段落，AI 会提取写作习惯，不会学习具体内容..."
                      rows={5}
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
                      }}
                    />

                    <button
                      onClick={extractStyle}
                      disabled={!styleText.trim() || styleLoading}
                      style={{
                        marginTop: 10,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: styleText.trim() && !styleLoading
                          ? 'var(--color-accent)' : 'var(--color-border)',
                        color: '#fff',
                        padding: '8px 14px',
                        fontSize: 12,
                        cursor: styleText.trim() && !styleLoading ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Sparkles size={12} />
                      {styleLoading ? '提取中…' : '提取风格'}
                    </button>

                    {styleResult && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          background: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 12,
                          lineHeight: 1.8,
                          color: 'var(--color-ink-2)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        <div style={{
                          fontSize: 11,
                          color: 'var(--color-ink-3)',
                          marginBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <Tag size={11} />
                          风格特征
                        </div>
                        {styleResult}
                        {!styleLoading && (
                          <button
                            onClick={saveStyleTag}
                            style={{
                              marginTop: 10,
                              display: 'block',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--color-accent)',
                              color: '#fff',
                              padding: '7px 14px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            保存为风格标签
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {tab === 'case' && (
                  <>
                    <input
                      value={caseName}
                      onChange={event => setCaseName(event.target.value)}
                      placeholder="案例标签名称（如：《阿凡达》视觉分析案例）"
                      style={{
                        width: '100%',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                        fontFamily: 'var(--font-sans)',
                        marginBottom: 10,
                        fontSize: 13,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <textarea
                      value={caseText}
                      onChange={event => setCaseText(event.target.value)}
                      placeholder="粘贴参考文献内容，AI 会提取与你研究主题相关的分析要点或案例..."
                      rows={5}
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
                      }}
                    />

                    <button
                      onClick={extractCase}
                      disabled={!caseText.trim() || caseLoading}
                      style={{
                        marginTop: 10,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: caseText.trim() && !caseLoading
                          ? 'var(--color-accent)' : 'var(--color-border)',
                        color: '#fff',
                        padding: '8px 14px',
                        fontSize: 12,
                        cursor: caseText.trim() && !caseLoading ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Sparkles size={12} />
                      {caseLoading ? '提取中…' : '提取案例'}
                    </button>

                    {caseResult && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          background: 'var(--color-bg)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 12,
                          lineHeight: 1.8,
                          color: 'var(--color-ink-2)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        <div style={{
                          fontSize: 11,
                          color: 'var(--color-ink-3)',
                          marginBottom: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <BookMarked size={11} />
                          提取的案例
                        </div>
                        {caseResult}
                        {!caseLoading && (
                          <button
                            onClick={saveCaseTag}
                            style={{
                              marginTop: 10,
                              display: 'block',
                              border: 'none',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--color-accent)',
                              color: '#fff',
                              padding: '7px 14px',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            保存为案例标签
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
