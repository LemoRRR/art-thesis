import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, BookMarked, CheckCircle2, FileText, Layers, Loader2, Search, Sparkles, Tag, Trash2, Upload, XCircle } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import { callGPT } from '../lib/ai'
import { filesAPI, libraryAPI } from '../lib/api'
import { auth } from '../lib/auth'
import { promptExtractBackgroundMaterial, promptExtractCases, promptExtractStyle } from '../lib/prompts'
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

function statusMeta(status?: LibraryItem['extractStatus']) {
  if (status === 'processing') return { label: 'AI 提取中', color: 'var(--color-accent)', icon: Loader2 }
  if (status === 'done') return { label: '已完成四维提取', color: '#2F9E44', icon: CheckCircle2 }
  if (status === 'failed') return { label: '提取失败', color: '#D9480F', icon: XCircle }
  return { label: '等待提取', color: 'var(--color-ink-3)', icon: Loader2 }
}

function isAuthExpiredError(error: unknown) {
  return error instanceof Error && error.message.includes('Token 无效或已过期')
}

const BACKGROUND_SECTION_TITLES = [
  '背景摘要',
  '时代线索',
  '核心人物/作品/对象',
  '关键词与概念',
  '可转化论点',
  '章节调用建议',
  '引用风险',
]

function extractBackgroundSection(content: string, title: string) {
  const marker = `【${title}】`
  const start = content.indexOf(marker)
  if (start < 0) return ''
  const bodyStart = start + marker.length
  let bodyEnd = content.length
  for (const sectionTitle of BACKGROUND_SECTION_TITLES) {
    if (sectionTitle === title) continue
    const sectionStart = content.indexOf(`【${sectionTitle}】`, bodyStart)
    if (sectionStart >= 0 && sectionStart < bodyEnd) bodyEnd = sectionStart
  }
  return content.slice(bodyStart, bodyEnd).trim()
}

function buildBackgroundModules(content: string) {
  const summary = extractBackgroundSection(content, '背景摘要')
  const timeline = extractBackgroundSection(content, '时代线索')
  const people = extractBackgroundSection(content, '核心人物/作品/对象')
  const concepts = extractBackgroundSection(content, '关键词与概念')
  const claims = extractBackgroundSection(content, '可转化论点')
  const usage = extractBackgroundSection(content, '章节调用建议')
  const risks = extractBackgroundSection(content, '引用风险')

  return {
    summary,
    structureExtract: [summary && `背景摘要：\n${summary}`, timeline && `时代线索：\n${timeline}`].filter(Boolean).join('\n\n'),
    styleExtract: [people && `核心人物/作品/对象：\n${people}`, concepts && `关键词与概念：\n${concepts}`].filter(Boolean).join('\n\n'),
    viewpointsExtract: usage,
    casesExtract: [claims && `可转化论点：\n${claims}`, risks && `引用风险：\n${risks}`].filter(Boolean).join('\n\n'),
  }
}

function ModuleCard({
  title,
  hint,
  content,
  onChange,
}: {
  title: string
  hint: string
  content?: string
  onChange: (value: string) => void
}) {
  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--color-bg)',
      padding: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-ink)', marginBottom: 8 }}>
        {title}
      </div>
      <textarea
        value={content ?? ''}
        onChange={event => onChange(event.target.value)}
        placeholder={hint}
        rows={4}
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          background: 'transparent',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          lineHeight: 1.75,
          color: 'var(--color-ink-2)',
          padding: 0,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function TextFallbackPreview({ title, content }: { title: string; content: string }) {
  const paragraphs = content
    .split(/\n{2,}|\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 120)

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: '#F4F1EC',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '9px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-ink-2)', fontWeight: 650 }}>
          文件预览
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>
      <div style={{ maxHeight: 520, overflowY: 'auto', padding: '22px 0' }}>
        <div
          style={{
            width: 'min(720px, calc(100% - 44px))',
            minHeight: 760,
            margin: '0 auto',
            padding: '54px 64px',
            boxSizing: 'border-box',
            background: '#fff',
            border: '1px solid #E2DDD4',
            boxShadow: '0 12px 28px rgba(45, 37, 27, 0.10)',
            color: '#1F2933',
            fontFamily: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
            fontSize: 14,
            lineHeight: 2,
          }}
        >
          {paragraphs.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--color-ink-3)' }}>暂无可预览内容</p>
          ) : paragraphs.map((paragraph, index) => {
            const isShortHeading = paragraph.length <= 28 && !/[。；;,.，]/.test(paragraph)
            return (
              <p
                key={`${paragraph}-${index}`}
                style={{
                  margin: isShortHeading ? '18px 0 10px' : '0 0 12px',
                  fontWeight: isShortHeading ? 650 : 400,
                  textAlign: isShortHeading ? 'left' : 'justify',
                  textIndent: isShortHeading ? 0 : '2em',
                }}
              >
                {paragraph}
              </p>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FilePreview({ item }: { item: LibraryItem }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState('')
  const fileType = item.type
  const canPreviewFile = Boolean(item.fileUrl) && (fileType === 'pdf' || fileType === 'docx')

  useEffect(() => {
    if (!canPreviewFile || fileType !== 'docx' || !item.fileUrl || !containerRef.current) return
    let cancelled = false
    const container = containerRef.current
    container.innerHTML = ''
    setStatus('正在渲染 Word 文件预览…')

    async function renderDocxPreview() {
      try {
        const response = await fetch(item.fileUrl!)
        if (!response.ok) throw new Error(`文件读取失败：${response.status}`)
        const blob = await response.blob()
        const { renderAsync } = await import('docx-preview')
        if (cancelled) return
        await renderAsync(blob, container, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })
        if (!cancelled) setStatus('')
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Word 预览失败')
      }
    }

    void renderDocxPreview()
    return () => {
      cancelled = true
      container.innerHTML = ''
    }
  }, [canPreviewFile, fileType, item.fileUrl])

  if (!canPreviewFile) {
    return <TextFallbackPreview title={item.fileName || item.title} content={item.text} />
  }

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: '#F4F1EC',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '9px 12px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-ink-2)', fontWeight: 650 }}>
          文件预览
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.fileName || item.title}
        </span>
      </div>

      {fileType === 'pdf' ? (
        <iframe
          title={item.title}
          src={item.fileUrl}
          style={{
            width: '100%',
            height: 680,
            border: 'none',
            background: '#fff',
          }}
        />
      ) : (
        <div style={{ maxHeight: 680, overflow: 'auto', padding: 18 }}>
          {status && (
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-ink-3)' }}>
              {status}
            </div>
          )}
          <div
            ref={containerRef}
            style={{
              background: '#fff',
              minHeight: 520,
              boxShadow: '0 12px 28px rgba(45, 37, 27, 0.10)',
            }}
          />
        </div>
      )}
    </div>
  )
}

export default function Library() {
  const [items, setItems] = useState<LibraryItem[]>(() => libraryStore.getAll())
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  const [showRawText, setShowRawText] = useState(false)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [tab, setTab] = useState<'add' | 'background' | 'style' | 'case'>('add')
  const [styleText, setStyleText] = useState('')
  const [styleName, setStyleName] = useState('')
  const [styleResult, setStyleResult] = useState('')
  const [styleLoading, setStyleLoading] = useState(false)
  const [backgroundText, setBackgroundText] = useState('')
  const [backgroundName, setBackgroundName] = useState('')
  const [backgroundResult, setBackgroundResult] = useState('')
  const [backgroundLoading, setBackgroundLoading] = useState(false)
  const [caseText, setCaseText] = useState('')
  const [caseName, setCaseName] = useState('')
  const [caseResult, setCaseResult] = useState('')
  const [caseLoading, setCaseLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'u') {
        event.preventDefault()
        fileInputRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    queueMicrotask(() => setShowRawText(false))
  }, [activeId])

  const refresh = () => setItems(libraryStore.getAll())

  const pollExtractResult = (id: string, attempt = 0) => {
    if (!auth.isLoggedIn() || attempt > 24) return
    window.setTimeout(async () => {
      try {
        const row = await libraryAPI.get(id)
        const item = libraryStore.upsertRemote(row)
        refresh()
        setActiveId(item.id)
        if (item.extractStatus === 'processing' || item.extractStatus === 'pending') {
          pollExtractResult(id, attempt + 1)
        }
      } catch (error) {
        console.warn('[Library] 轮询提取结果失败', error)
      }
    }, attempt === 0 ? 1200 : 2500)
  }

  const addLocalTextItem = (text: string) => {
    const item = libraryStore.add({
      title: title.trim() || text.slice(0, 24) || '未命名资料',
      type: 'note',
      text,
      summary: text.slice(0, 120),
      tags: ['手动输入'],
      extractStatus: 'pending',
    })
    setDraft('')
    setTitle('')
    refresh()
    setActiveId(item.id)
  }

  const addTextItem = async () => {
    const text = draft.trim()
    if (!text) return
    setUploadError('')
    if (auth.isLoggedIn()) {
      setUploading(true)
      try {
        const row = await libraryAPI.create({
          title: title.trim() || text.slice(0, 24) || '未命名资料',
          type: 'note',
          text_content: text,
          summary: text.slice(0, 120),
          tags: ['手动输入'],
        })
        const item = libraryStore.upsertRemote(row)
        setDraft('')
        setTitle('')
        refresh()
        setActiveId(item.id)
        pollExtractResult(item.id)
      } catch (error) {
        if (isAuthExpiredError(error)) {
          auth.clearSession()
          setUploadError('登录已过期。请重新登录后再添加资料，这样才能写入云端并触发 AI 提取。')
          return
        }
        console.warn('[Library] 文本资料远端保存失败，使用本地兜底', error)
        setUploadError('后端暂时连接不上，已先保存到本地库。启动后端后可重新添加以触发 AI 提取。')
        addLocalTextItem(text)
      } finally {
        setUploading(false)
      }
      return
    }

    addLocalTextItem(text)
  }

  const addLocalFileItem = async (file: File) => {
    const fileType = getFileType(file.name)
    const isText = file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')
    const text = isText
      ? await file.text()
      : `已上传文件：${file.name}\n\n当前后端未连接，已先记录文件名和调用入口。启动后端后重新上传，可解析 PDF/Word 正文并提取规则与重点。`
    const item = libraryStore.add({
      title: file.name.replace(/\.[^.]+$/, ''),
      type: fileType,
      fileName: file.name,
      fileSize: file.size,
      text,
      summary: text.slice(0, 120),
      tags: [fileType.toUpperCase()],
      extractStatus: 'pending',
    })
    refresh()
    setActiveId(item.id)
  }

  const handleFile = async (file: File) => {
    setUploadError('')
    if (!auth.isLoggedIn()) {
      setUploadError('当前未登录，文件已先保存到本地资料库。登录后重新上传，可写入云端、解析 PDF/Word 正文并提取规则与重点。')
      await addLocalFileItem(file)
      return
    }

    if (auth.isLoggedIn()) {
      setUploading(true)
      try {
        const row = await filesAPI.upload(file)
        const item = libraryStore.upsertRemote(row)
        refresh()
        setActiveId(item.id)
        pollExtractResult(item.id)
      } catch (error) {
        if (isAuthExpiredError(error)) {
          auth.clearSession()
          setUploadError('登录已过期。请重新登录后再上传文件，这样才能解析 PDF/Word 并提取规则与重点。')
          return
        }
        if (error instanceof Error && !(error instanceof TypeError)) {
          setUploadError(`云端上传失败：${error.message}`)
          return
        }
        console.warn('[Library] 文件上传远端失败，使用本地兜底', error)
        setUploadError('后端暂时连接不上，文件已先保存到本地库。启动后端后重新上传，可解析正文并进行 AI 提取。')
        await addLocalFileItem(file)
      } finally {
        setUploading(false)
      }
      return
    }
  }

  const removeItem = (id: string) => {
    if (!confirm('确认删除这条资料？已保存的引用选择也会移除。')) return
    libraryStore.remove(id)
    const next = libraryStore.getAll()
    setItems(next)
    setActiveId(next[0]?.id ?? null)
  }

  const updateActiveModule = (patch: Partial<LibraryItem>) => {
    if (!activeItem) return
    libraryStore.update(activeItem.id, patch)
    setItems(libraryStore.getAll())
  }

  const copyMentionCommand = async (item: LibraryItem) => {
    const command = `@${item.title}`
    await navigator.clipboard.writeText(command)
    alert(`已复制调用命令：${command}`)
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

  const extractBackground = () => {
    if (!backgroundText.trim() || backgroundLoading) return
    setBackgroundResult('')
    setBackgroundLoading(true)
    const abort = new AbortController()
    abortRef.current = abort
    let result = ''
    const researchContext = activeProject.context.rawSummary || activeProject.title
    callGPT(
      promptExtractBackgroundMaterial(backgroundText, researchContext),
      {
        onChunk: (chunk) => {
          result += chunk
          setBackgroundResult(result)
        },
        onDone: () => setBackgroundLoading(false),
        onError: () => setBackgroundLoading(false),
      },
      abort.signal
    )
  }

  const saveBackgroundTag = () => {
    const content = backgroundResult.trim()
    const rawText = backgroundText.trim()
    if (!content && !rawText) return
    const modules = content ? buildBackgroundModules(content) : {
      summary: rawText.slice(0, 120),
      structureExtract: rawText.slice(0, 1200),
      styleExtract: '背景语境资料：用于帮助 AI 理解研究对象、历史背景、人物关系和概念脉络。',
      viewpointsExtract: '建议在 Stage1 理解、Stage2 大纲和 Stage3 写作计划中调用；不建议直接作为正式脚注来源。',
      casesExtract: '引用风险：原始背景搜集资料需要补充真实文献、作品细读或可核验出处后，才能作为正式参考文献。',
    }
    const item = libraryStore.add({
      title: backgroundName.trim() || '背景资料',
      type: 'background',
      text: rawText || content,
      summary: modules.summary || content.slice(0, 120) || rawText.slice(0, 120),
      tags: ['背景语境', '不作正式引用'],
      structureExtract: modules.structureExtract,
      styleExtract: modules.styleExtract,
      viewpointsExtract: modules.viewpointsExtract,
      casesExtract: modules.casesExtract,
      extractStatus: content ? 'done' : 'pending',
    })
    setBackgroundText('')
    setBackgroundName('')
    setBackgroundResult('')
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
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-ink)' }}>资料库</div>
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
            {uploading ? '处理中…' : '上传资料'}
            <input
              ref={fileInputRef}
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
                  暂无资料。上传文件，或在右侧粘贴一段文本作为资料库资料。
                </div>
              ) : (
                filteredItems.map(item => {
                  const meta = statusMeta(item.extractStatus)
                  const StatusIcon = meta.icon
                  return (
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
                        ) : item.type === 'background' ? (
                          <Layers size={14} color="#4C6EF5" />
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
                      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: meta.color }}>
                        <StatusIcon size={12} />
                        {meta.label}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column' }}>
            {activeItem ? (
              <article
                style={{
                  order: 2,
                  maxWidth: 850,
                  margin: '20px auto 0',
                  width: '100%',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-sm)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: 18, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--color-ink-3)', fontWeight: 650, letterSpacing: '0.04em' }}>
                      资料详情 / 最近上传
                    </div>
                    <h1 style={{ margin: 0, fontSize: 18, color: 'var(--color-ink)' }}>{activeItem.title}</h1>
                    <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-ink-3)' }}>
                      <span>{activeItem.type.toUpperCase()} · {new Date(activeItem.createdAt).toLocaleString('zh-CN')}</span>
                      {(() => {
                        const meta = statusMeta(activeItem.extractStatus)
                        const StatusIcon = meta.icon
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: meta.color }}>
                            <StatusIcon size={12} />
                            {meta.label}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => copyMentionCommand(activeItem)}
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
                      <AtSign size={13} />
                      复制 @ 调用命令
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
                <div
                  style={{
                    padding: 18,
                    borderBottom: '1px solid var(--color-border)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  <ModuleCard
                    title={activeItem.type === 'background' ? '背景摘要 / 时代线索' : '写法范式'}
                    hint={activeItem.type === 'background' ? '这批资料的核心背景、历史阶段、时代线索...' : '优先展示这里：格式规则、重点观点、可复用约束、写作时必须遵守的内容...'}
                    content={activeItem.structureExtract}
                    onChange={value => updateActiveModule({ structureExtract: value })}
                  />
                  <ModuleCard
                    title={activeItem.type === 'background' ? '人物 / 概念' : '风格识别'}
                    hint={activeItem.type === 'background' ? '核心人物、作品、机构、理论概念、审美关键词...' : '资料类型、适合用途、使用边界...'}
                    content={activeItem.styleExtract}
                    onChange={value => updateActiveModule({ styleExtract: value })}
                  />
                  <ModuleCard
                    title={activeItem.type === 'background' ? '章节调用建议' : '调用方式'}
                    hint={activeItem.type === 'background' ? '适合在哪个阶段、哪个章节、哪个写作任务里调用...' : '说明应该在什么阶段、什么任务里 @ 调用这份资料...'}
                    content={activeItem.viewpointsExtract}
                    onChange={value => updateActiveModule({ viewpointsExtract: value })}
                  />
                  <ModuleCard
                    title={activeItem.type === 'background' ? '可转化论点 / 引用风险' : '材料与引用'}
                    hint={activeItem.type === 'background' ? '可以进入论文的论点，以及需要补正式出处的风险...' : '可引用片段、案例、格式细则、数据说明等...'}
                    content={activeItem.casesExtract}
                    onChange={value => updateActiveModule({ casesExtract: value })}
                  />
                </div>
                <div style={{ borderTop: '1px solid var(--color-border)', padding: '14px 18px' }}>
                  <button
                    onClick={() => setShowRawText(value => !value)}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      color: 'var(--color-ink-3)',
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {showRawText ? '收起原文内容' : '查看原文内容'}
                  </button>
                  {showRawText && (
                    <FilePreview item={activeItem} />
                  )}
                </div>
              </article>
            ) : (
              <div style={{ order: 2, maxWidth: 720, margin: '20px auto 0', width: '100%' }}>
                <h1 style={{ fontSize: 22, color: 'var(--color-ink)' }}>资料列表</h1>
                <p style={{ fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.8 }}>
                  暂无选中的资料。上传或粘贴资料后，可在这里查看 AI 提取的结构、风格、观点和案例。
                </p>
              </div>
            )}

            <div
              style={{
                maxWidth: 850,
                order: 1,
                width: '100%',
                margin: '0 auto',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: 18,
                  borderBottom: '1px solid var(--color-border)',
                  background: 'linear-gradient(180deg, var(--color-surface), var(--color-bg))',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <h1 style={{ margin: 0, fontSize: 20, color: 'var(--color-ink)' }}>上传 / 添加资料</h1>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                      资料库是全局数据库。上传文件或粘贴文本后，AI 会提取结构、风格、观点和案例；需要时在阶段输入框用 @ 调用。
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        background: uploading ? 'var(--color-border)' : 'var(--color-accent)',
                        color: '#fff',
                        padding: '8px 13px',
                        fontSize: 12,
                        cursor: uploading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <Upload size={14} />
                      上传 PDF / Word / TXT
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-ink-3)' }}>
                  快捷键
                  <kbd style={{ border: '1px solid var(--color-border)', borderRadius: 5, padding: '2px 6px', background: 'var(--color-surface)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-sans)' }}>
                    Ctrl + U
                  </kbd>
                  上传资料
                </div>
                {uploadError && (
                  <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 'var(--radius-sm)', background: '#FFF4E6', border: '1px solid #FFD8A8', color: '#B35C00', fontSize: 12, lineHeight: 1.6 }}>
                    {uploadError}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
                {([
                  { key: 'add',   label: '添加资料' },
                  { key: 'background', label: '背景资料' },
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                        minHeight: 150,
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
                    <div style={{
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 1,
                      display: 'flex',
                      justifyContent: 'flex-end',
                      paddingTop: 10,
                      background: 'var(--color-surface)',
                      borderTop: '1px solid var(--color-border)',
                    }}>
                      <button
                        onClick={addTextItem}
                        disabled={!draft.trim() || uploading}
                        style={{
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          background: draft.trim() && !uploading ? 'var(--color-accent)' : 'var(--color-border)',
                          color: '#fff',
                          padding: '9px 16px',
                          minWidth: 86,
                          minHeight: 34,
                          fontSize: 12,
                          lineHeight: 1,
                          whiteSpace: 'nowrap',
                          cursor: draft.trim() && !uploading ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {uploading ? '处理中…' : '存入库'}
                      </button>
                    </div>
                  </div>
                )}

                {tab === 'background' && (
                  <>
                    <input
                      value={backgroundName}
                      onChange={event => setBackgroundName(event.target.value)}
                      placeholder="背景资料名称（如：第四代导演历史背景）"
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
                      value={backgroundText}
                      onChange={event => setBackgroundText(event.target.value)}
                      placeholder="粘贴搜索整理、AI 汇总、历史背景、人物关系、理论概念或课堂笔记。系统会整理成背景语境，不默认作为正式脚注来源..."
                      rows={7}
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

                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={extractBackground}
                        disabled={!backgroundText.trim() || backgroundLoading}
                        style={{
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          background: backgroundText.trim() && !backgroundLoading
                            ? 'var(--color-accent)' : 'var(--color-border)',
                          color: '#fff',
                          padding: '8px 14px',
                          fontSize: 12,
                          cursor: backgroundText.trim() && !backgroundLoading ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Sparkles size={13} />
                        {backgroundLoading ? '整理中…' : '整理背景资料'}
                      </button>
                      <button
                        onClick={saveBackgroundTag}
                        disabled={(!backgroundResult.trim() && !backgroundText.trim()) || backgroundLoading}
                        style={{
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-surface)',
                          color: 'var(--color-ink-2)',
                          padding: '8px 14px',
                          fontSize: 12,
                          cursor: (!backgroundResult.trim() && !backgroundText.trim()) || backgroundLoading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        存入背景库
                      </button>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                      背景资料会进入 @ 调用上下文，但不会进入正式脚注可引用清单；需要脚注时请再绑定真实文献或可核验来源。
                    </div>

                    {backgroundResult && (
                      <div
                        style={{
                          marginTop: 12,
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          padding: 12,
                          background: 'var(--color-bg)',
                          whiteSpace: 'pre-wrap',
                          fontSize: 12,
                          lineHeight: 1.8,
                          color: 'var(--color-ink-2)',
                        }}
                      >
                        {backgroundResult}
                      </div>
                    )}
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
