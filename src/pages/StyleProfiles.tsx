import { useMemo, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, FileText, Loader2, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { callGPT } from '../lib/ai'
import { filesAPI, libraryAPI } from '../lib/api'
import { promptExtractStyleProfile } from '../lib/prompts'
import { libraryStore, styleProfileStore, type LibraryItem, type StyleProfile } from '../lib/storage'

interface StyleProfileJson {
  writingLevel?: string
  sentenceStyle?: string
  paragraphLogic?: string
  argumentStyle?: string
  transitionStyle?: string
  vocabularyStyle?: string
  avoidContentReuseNotice?: string
  editableSummary?: string
}

type DraftProfile = Omit<StyleProfile, 'id' | 'createdAt' | 'updatedAt'>
const maxDocumentsPerProfile = 3

const emptyDraft: DraftProfile = {
  studentName: '',
  profileName: '',
  sourceFileName: '',
  sourceDocuments: [],
  sourceTextLength: 0,
  writingLevel: '',
  sentenceStyle: '',
  paragraphLogic: '',
  argumentStyle: '',
  transitionStyle: '',
  vocabularyStyle: '',
  avoidContentReuseNotice: '只参考语言水平、句式、段落组织和论证节奏，不复用参考文章的观点、案例、素材、原句或具体内容。',
  editableSummary: '',
}

const styleFields: Array<[string, keyof DraftProfile]> = [
  ['语言水平', 'writingLevel'],
  ['句式特征', 'sentenceStyle'],
  ['段落组织', 'paragraphLogic'],
  ['论证方式', 'argumentStyle'],
  ['过渡方式', 'transitionStyle'],
  ['词汇风格', 'vocabularyStyle'],
  ['风险提醒', 'avoidContentReuseNotice'],
  ['风格画像总结', 'editableSummary'],
]

function parseStyleProfile(content: string): StyleProfileJson {
  const match = content.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!match) return { editableSummary: content.trim() }
  try {
    return JSON.parse(match[0]) as StyleProfileJson
  } catch {
    return { editableSummary: content.trim() }
  }
}

function streamStyleProfile(text: string): Promise<StyleProfileJson> {
  return new Promise((resolve, reject) => {
    let full = ''
    callGPT(promptExtractStyleProfile(text), {
      onChunk: chunk => {
        full += chunk
      },
      onDone: () => resolve(parseStyleProfile(full)),
      onError: reject,
    })
  })
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitForParsedLibraryItem(itemId: string): Promise<LibraryItem> {
  let latest = libraryStore.get(itemId)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (latest?.text || latest?.summary || latest?.extractStatus === 'failed') return latest
    await sleep(1200)
    const row = await libraryAPI.get(itemId)
    latest = libraryStore.upsertRemote(row)
  }
  if (latest) return latest
  throw new Error('没有找到上传后的资料记录')
}

function downloadText(fileName: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function profileToText(profile: StyleProfile): string {
  return [
    `学生：${profile.studentName}`,
    `文档数：${profile.sourceDocuments?.length ?? (profile.sourceFileName ? 1 : 0)}`,
    '',
    `语言水平：${profile.writingLevel}`,
    `句式特征：${profile.sentenceStyle}`,
    `段落组织：${profile.paragraphLogic}`,
    `论证方式：${profile.argumentStyle}`,
    `过渡方式：${profile.transitionStyle}`,
    `词汇风格：${profile.vocabularyStyle}`,
    `风险提醒：${profile.avoidContentReuseNotice}`,
    '',
    `风格画像：${profile.editableSummary}`,
  ].filter(Boolean).join('\n')
}

function profileToCsv(profile: StyleProfile): string {
  const rows = [
    ['字段', '内容'],
    ['学生', profile.studentName],
    ['文档数', String(profile.sourceDocuments?.length ?? 0)],
    ['语言水平', profile.writingLevel],
    ['句式特征', profile.sentenceStyle],
    ['段落组织', profile.paragraphLogic],
    ['论证方式', profile.argumentStyle],
    ['过渡方式', profile.transitionStyle],
    ['词汇风格', profile.vocabularyStyle],
    ['风险提醒', profile.avoidContentReuseNotice],
    ['风格画像', profile.editableSummary],
  ]
  return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function profileToDraft(profile: StyleProfile): DraftProfile {
  return {
    studentName: profile.studentName,
    profileName: profile.profileName,
    sourceFileName: profile.sourceFileName ?? '',
    sourceDocuments: profile.sourceDocuments ?? (profile.sourceFileName
      ? [{ id: profile.id, fileName: profile.sourceFileName, textLength: profile.sourceTextLength, extractedAt: profile.updatedAt }]
      : []),
    sourceTextLength: profile.sourceTextLength,
    writingLevel: profile.writingLevel,
    sentenceStyle: profile.sentenceStyle,
    paragraphLogic: profile.paragraphLogic,
    argumentStyle: profile.argumentStyle,
    transitionStyle: profile.transitionStyle,
    vocabularyStyle: profile.vocabularyStyle,
    avoidContentReuseNotice: profile.avoidContentReuseNotice,
    editableSummary: profile.editableSummary,
  }
}

function mergeStyleText(previous: string, next?: string) {
  const clean = next?.trim()
  if (!clean) return previous
  if (!previous.trim()) return clean
  return `${previous.trim()}\n\n补充样本：${clean}`
}

function guessStudentNameFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const labeled = baseName.match(/(?:学生|同学|姓名|作者)[-_\s：:]*([\u4e00-\u9fa5]{2,4})/)
  if (labeled?.[1]) return labeled[1]
  const suffixed = baseName.match(/([\u4e00-\u9fa5]{2,4})(?:同学|学生)/)
  if (suffixed?.[1]) return suffixed[1]
  return /^[\u4e00-\u9fa5]{2,4}$/.test(baseName) ? baseName : ''
}

export default function StyleProfiles() {
  const [profiles, setProfiles] = useState<StyleProfile[]>(() => styleProfileStore.getAll())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProfile>(emptyDraft)
  const [isExtracting, setIsExtracting] = useState(false)
  const [notice, setNotice] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [isAddDragActive, setIsAddDragActive] = useState(false)
  const [isModalDragActive, setIsModalDragActive] = useState(false)
  const [isUploadLoading, setIsUploadLoading] = useState(false)

  const activeProfile = useMemo(
    () => profiles.find(profile => profile.id === activeId) ?? null,
    [activeId, profiles]
  )
  const isEditing = Boolean(activeId)
  const filteredProfiles = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase()
    if (!keyword) return profiles
    return profiles.filter(profile => [
      profile.studentName,
      profile.editableSummary,
      profile.writingLevel,
    ].some(value => value?.toLowerCase().includes(keyword)))
  }, [profiles, searchTerm])
  const pageSize = 8
  const totalPages = Math.max(1, Math.ceil(filteredProfiles.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedProfiles = filteredProfiles.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const refresh = () => setProfiles(styleProfileStore.getAll())

  const startNew = () => {
    setActiveId(null)
    setDraft(emptyDraft)
    setNotice('')
    setUploadStatus('')
    setIsModalOpen(true)
  }

  const selectProfile = (profile: StyleProfile) => {
    setActiveId(profile.id)
    setDraft(profileToDraft(profile))
    setNotice('')
    setUploadStatus(profile.sourceDocuments?.length ? `当前档案包含 ${profile.sourceDocuments.length} 个参考文档` : '')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    if (isExtracting) return
    setIsModalOpen(false)
    setNotice('')
    setUploadStatus('')
  }

  const saveProfile = () => {
    const studentName = draft.studentName.trim()
    if (!studentName) {
      setNotice('请先填写学生名。')
      return
    }
    if (profiles.length >= 50 && !activeProfile) {
      setNotice('风格档案最多 50 个，请删除旧档案后再新增。')
      return
    }
    const payload: DraftProfile = {
      ...draft,
      studentName,
      profileName: `${studentName}风格档案`,
    }

    if (activeProfile) {
      styleProfileStore.update(activeProfile.id, payload)
      setNotice('风格档案已更新。')
    } else {
      const created = styleProfileStore.add(payload)
      setActiveId(created.id)
      setNotice('风格档案已保存。')
    }
    refresh()
    setIsModalOpen(false)
    setNotice('')
    setUploadStatus('')
  }

  const deleteProfile = (profile: StyleProfile) => {
    if (!confirm(`确认删除「${profile.studentName || '未填写学生名'}」的风格档案？`)) return
    styleProfileStore.remove(profile.id)
    const next = styleProfileStore.getAll()
    setProfiles(next)
    setActiveId(null)
    setDraft(emptyDraft)
    setNotice('')
    setUploadStatus('')
  }

  const uploadFiles = async (fileList: FileList | File[], resetBeforeUpload = false) => {
    const incomingFiles = Array.from(fileList).slice(0, maxDocumentsPerProfile)
    if (incomingFiles.length === 0) return
    let uploadNotice = ''
    if (fileList.length > maxDocumentsPerProfile) {
      uploadNotice = `每张风格名片最多选择 ${maxDocumentsPerProfile} 个参考文档，本次只处理前 ${maxDocumentsPerProfile} 个。`
    }

    const existingCount = resetBeforeUpload ? 0 : (draft.sourceDocuments?.length ?? 0)
    const remainingSlots = Math.max(0, maxDocumentsPerProfile - existingCount)
    if (remainingSlots <= 0) {
      setNotice(`这张风格名片已经有 ${maxDocumentsPerProfile} 个参考文档，不能继续添加。`)
      setUploadStatus(`处理失败：这张风格名片最多 ${maxDocumentsPerProfile} 个参考文档。`)
      return
    }

    const files = incomingFiles.slice(0, remainingSlots)
    if (incomingFiles.length > remainingSlots) {
      uploadNotice = `这张名片还可添加 ${remainingSlots} 个参考文档，本次只处理前 ${remainingSlots} 个。`
    }

    if (resetBeforeUpload) {
      setActiveId(null)
      setDraft(emptyDraft)
      setNotice('')
      setUploadStatus('')
      setIsModalOpen(false)
      setIsUploadLoading(true)
    }
    setIsExtracting(true)
    setNotice(uploadNotice)

    try {
      for (const [index, file] of files.entries()) {
        const prefix = files.length > 1 ? `(${index + 1}/${files.length}) ` : ''
        let text = ''
        setUploadStatus(`${prefix}已选择：${file.name}，正在准备解析…`)
        if (file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')) {
          setUploadStatus(`${prefix}正在读取文本：${file.name}`)
          text = await file.text()
        } else {
          setUploadStatus(`${prefix}正在上传并解析：${file.name}`)
          setNotice('Word/PDF 会先上传到解析服务；解析出的正文只用于生成风格画像。')
          const row = await filesAPI.upload(file)
          const item = libraryStore.upsertRemote(row)
          setUploadStatus(`${prefix}文件已上传，正在等待正文解析结果…`)
          const parsedItem = await waitForParsedLibraryItem(item.id)
          if (parsedItem.extractStatus === 'failed') {
            throw new Error('文件解析失败，请换一个文档或先转为 TXT 再上传。')
          }
          text = parsedItem.text || parsedItem.summary || ''
        }

        const clipped = text.trim().slice(0, 10000)
        if (!clipped) throw new Error('没有解析到可用于提取风格的正文')

        setUploadStatus(`${prefix}已读取 ${clipped.length} 字，正在生成风格画像…`)
        const extracted = await streamStyleProfile(clipped)
        const documentRecord = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          fileName: file.name,
          textLength: clipped.length,
          extractedAt: Date.now(),
        }

        setDraft(prev => {
          const base = resetBeforeUpload && index === 0 ? emptyDraft : prev
          const guessedStudentName = base.studentName || guessStudentNameFromFileName(file.name)
          return {
            ...base,
            studentName: guessedStudentName,
            profileName: guessedStudentName ? `${guessedStudentName}风格档案` : '',
            sourceFileName: file.name,
            sourceTextLength: (base.sourceTextLength ?? 0) + clipped.length,
            sourceDocuments: [...(base.sourceDocuments ?? []), documentRecord].slice(0, maxDocumentsPerProfile),
            writingLevel: mergeStyleText(base.writingLevel, extracted.writingLevel),
            sentenceStyle: mergeStyleText(base.sentenceStyle, extracted.sentenceStyle),
            paragraphLogic: mergeStyleText(base.paragraphLogic, extracted.paragraphLogic),
            argumentStyle: mergeStyleText(base.argumentStyle, extracted.argumentStyle),
            transitionStyle: mergeStyleText(base.transitionStyle, extracted.transitionStyle),
            vocabularyStyle: mergeStyleText(base.vocabularyStyle, extracted.vocabularyStyle),
            avoidContentReuseNotice: extracted.avoidContentReuseNotice || base.avoidContentReuseNotice,
            editableSummary: mergeStyleText(base.editableSummary, extracted.editableSummary),
          }
        })
      }
      setUploadStatus(`已添加 ${files.length} 个参考文档。`)
      if (resetBeforeUpload) setIsModalOpen(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '风格提取失败'
      const isAuthError = message.includes('401') || message.includes('Token') || message.includes('登录') || message.toLowerCase().includes('unauthorized')
      const friendlyMessage = isAuthError ? '登录已过期，请重新登录后再上传风格档案。' : message
      setUploadStatus(`处理失败：${friendlyMessage}`)
      setNotice(friendlyMessage)
      if (resetBeforeUpload) setIsModalOpen(true)
    } finally {
      setIsExtracting(false)
      if (resetBeforeUpload) setIsUploadLoading(false)
    }
  }

  const handleNewProfileFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    event.target.value = ''
    if (!files?.length) return
    await uploadFiles(files, true)
  }

  const handleAddDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (!isExtracting) setIsAddDragActive(true)
  }

  const handleAddDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsAddDragActive(false)
    }
  }

  const handleAddDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsAddDragActive(false)
    if (isExtracting) return
    const files = event.dataTransfer.files
    if (!files?.length) return
    await uploadFiles(files, true)
  }

  const handleModalProfileFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    event.target.value = ''
    if (!files?.length) return
    await uploadFiles(files, false)
  }

  const handleModalDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    if (!isExtracting) setIsModalDragActive(true)
  }

  const handleModalDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsModalDragActive(false)
    }
  }

  const handleModalDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsModalDragActive(false)
    if (isExtracting) return
    const files = event.dataTransfer.files
    if (!files?.length) return
    await uploadFiles(files, false)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <style>{'@keyframes style-profile-spin { to { transform: rotate(360deg); } }'}</style>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar currentStep={0} />
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 20, color: 'var(--color-ink)' }}>风格档案</h1>
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                    一个学生一张风格名片，可上传多个参考文档综合分析。这里只保存表达方式，不保存参考文章的观点、案例或具体内容。
                  </p>
                </div>
              </div>
            </section>

            <section
              onDragOver={handleAddDragOver}
              onDragLeave={handleAddDragLeave}
              onDrop={handleAddDrop}
              style={{
                minHeight: 190,
                border: `1px dashed ${isAddDragActive ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                borderRadius: 8,
                background: isAddDragActive ? 'var(--color-accent-light)' : 'var(--color-surface)',
                boxShadow: isAddDragActive ? '0 0 0 3px rgba(67, 131, 85, 0.14)' : 'var(--shadow-sm)',
                padding: 22,
                display: 'flex',
                justifyContent: 'space-between',
                gap: 20,
                alignItems: 'stretch',
              }}
            >
              <button onClick={startNew} style={{ flex: 1, border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 48, height: 48, borderRadius: 8, background: '#E8F3EA', color: 'var(--color-accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  {isAddDragActive ? <Upload size={22} /> : <Plus size={22} />}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, color: 'var(--color-ink)' }}>添加风格档案</h2>
                  <p style={{ margin: '8px 0 0', maxWidth: 540, fontSize: 13, lineHeight: 1.7, color: 'var(--color-ink-3)' }}>
                    {isAddDragActive ? '松开文件后自动上传解析，并打开风格档案弹窗。' : `拖拽文件到这里，系统会自动上传识别；也可以一次选择最多 ${maxDocumentsPerProfile} 个参考文档，或先填写档案信息。`}
                  </p>
                </div>
              </button>
              <div style={{ width: 210, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, flexShrink: 0 }}>
                <label style={{ ...primaryButtonStyle, justifyContent: 'center', cursor: isExtracting ? 'not-allowed' : 'pointer' }}>
                  <Upload size={13} />
                  批量上传文档
                  <input type="file" accept=".pdf,.doc,.docx,.txt,text/plain" multiple onChange={handleNewProfileFile} disabled={isExtracting} style={{ display: 'none' }} />
                </label>
                <button onClick={startNew} disabled={isExtracting} style={{ ...secondaryButtonStyle, justifyContent: 'center' }}>
                  <Plus size={13} />
                  填写档案信息
                </button>
              </div>
            </section>

            <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--color-border)', borderRadius: 6, padding: '0 10px', background: 'var(--color-bg)' }}>
                <Search size={16} color="var(--color-ink-3)" />
                <input
                  value={searchTerm}
                  onChange={event => {
                    setSearchTerm(event.target.value)
                    setPage(1)
                  }}
                  placeholder="搜索学生名或风格关键词"
                  style={{ ...inputStyle, border: 'none', paddingLeft: 0, background: 'transparent' }}
                />
              </label>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16 }}>
              {pagedProfiles.map(profile => (
                <article key={profile.id} style={{ ...cardStyle, borderColor: profile.id === activeId ? 'var(--color-accent)' : 'var(--color-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ width: 46, height: 46, borderRadius: 8, background: 'var(--color-accent-light)', color: 'var(--color-accent)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 700 }}>
                      {profile.studentName.trim().slice(0, 1) || '档'}
                    </div>
                    <button onClick={() => deleteProfile(profile)} title="删除" style={iconButtonStyle}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div style={{ minHeight: 70 }}>
                    <h2 style={{ margin: '12px 0 6px', fontSize: 16, lineHeight: 1.4, color: 'var(--color-ink)' }}>{profile.studentName || '未填写学生名'}</h2>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.5 }}>
                      {profile.sourceDocuments?.slice(0, 2).map(doc => doc.fileName).join(' / ') || profile.sourceFileName || '学生风格档案'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tag>{profile.sourceDocuments?.length ?? (profile.sourceFileName ? 1 : 0)} 个文档</Tag>
                    <Tag>{profile.writingLevel ? '已分析' : '待分析'}</Tag>
                  </div>
                  <div style={{ display: 'flex', borderTop: '1px solid var(--color-border)', margin: '12px -14px -14px', padding: '8px 10px', gap: 4 }}>
                    <CardAction icon={<Eye size={12} />} label="查看" onClick={() => selectProfile(profile)} />
                    <CardAction icon={<Upload size={12} />} label="追加" onClick={() => selectProfile(profile)} />
                    <CardAction icon={<Download size={12} />} label="导出" onClick={() => downloadText(`${profile.studentName || '风格档案'}.txt`, profileToText(profile))} />
                  </div>
                </article>
              ))}
              {filteredProfiles.length === 0 && (
                <div style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center', color: 'var(--color-ink-3)', textAlign: 'center' }}>
                  <Search size={22} />
                  <div style={{ fontSize: 13 }}>没有找到匹配的风格档案</div>
                </div>
              )}
            </section>
            {filteredProfiles.length > pageSize && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setPage(prev => Math.max(1, prev - 1))} disabled={currentPage <= 1} style={pagerButtonStyle}>
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                  {currentPage} / {totalPages}
                </span>
                <button onClick={() => setPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage >= totalPages} style={pagerButtonStyle}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            {isUploadLoading && (
              <div style={modalBackdropStyle}>
                <section style={{ ...modalPanelStyle, width: 'min(520px, 100%)', padding: 26, display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--color-accent-light)', color: 'var(--color-accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Loader2 size={22} style={{ animation: 'style-profile-spin 1s linear infinite' }} />
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 16, color: 'var(--color-ink)' }}>正在解析风格档案</h2>
                    <p style={{ margin: '7px 0 0', fontSize: 13, lineHeight: 1.7, color: 'var(--color-ink-3)' }}>
                      {uploadStatus || '正在上传并识别文档，请稍候。'}
                    </p>
                  </div>
                </section>
              </div>
            )}

            {isModalOpen && (
              <div style={modalBackdropStyle}>
                <section style={modalPanelStyle}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', padding: '16px 18px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 16, color: 'var(--color-ink)' }}>{isEditing ? '查看风格档案' : '确认风格档案'}</h2>
                      <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 5 }}>
                        学生名为必填项。上传解析完成后，可在这里确认并保存风格画像。
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {activeProfile && (
                        <>
                          <button onClick={() => downloadText(`${activeProfile.studentName || '风格档案'}.txt`, profileToText(activeProfile))} style={secondaryButtonStyle}>
                            <Download size={13} />
                            TXT
                          </button>
                          <button onClick={() => downloadText(`${activeProfile.studentName || '风格档案'}.csv`, `\uFEFF${profileToCsv(activeProfile)}`, 'text/csv;charset=utf-8')} style={secondaryButtonStyle}>
                            <Download size={13} />
                            CSV
                          </button>
                        </>
                      )}
                      <button onClick={closeModal} disabled={isExtracting} title="关闭" style={iconButtonStyle}>
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                      <label style={labelStyle}>
                        学生名（必填）
                        <input value={draft.studentName} onChange={event => setDraft({ ...draft, studentName: event.target.value })} placeholder="例如：张同学" style={inputStyle} />
                      </label>
                    </div>

                    <section
                      onDragOver={handleModalDragOver}
                      onDragLeave={handleModalDragLeave}
                      onDrop={handleModalDrop}
                      style={{
                        border: `1px dashed ${isModalDragActive ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                        borderRadius: 8,
                        background: isModalDragActive ? 'var(--color-accent-light)' : 'var(--color-bg)',
                        padding: 14,
                        display: 'flex',
                        gap: 14,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 8, background: '#E8F3EA', color: 'var(--color-accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          {isExtracting ? <Loader2 size={18} style={{ animation: 'style-profile-spin 1s linear infinite' }} /> : <FileText size={18} />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-ink)' }}>
                            {isEditing ? '继续给这张名片添加参考文档' : '给新名片添加参考文档'}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, color: 'var(--color-ink-3)' }}>
                            支持拖拽或选择 Word / PDF / TXT。每张名片最多 {maxDocumentsPerProfile} 个文档，新文档会追加分析，不会覆盖已有风格画像。
                          </div>
                        </div>
                      </div>
                      <label style={{ ...secondaryButtonStyle, justifyContent: 'center', cursor: isExtracting ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                        <Upload size={13} />
                        多选文档
                        <input type="file" accept=".pdf,.doc,.docx,.txt,text/plain" multiple onChange={handleModalProfileFile} disabled={isExtracting} style={{ display: 'none' }} />
                      </label>
                    </section>

                    {uploadStatus && (
                      <div style={{ fontSize: 12, color: uploadStatus.startsWith('处理失败') ? '#C0392B' : 'var(--color-accent)', background: uploadStatus.startsWith('处理失败') ? '#FFF4F2' : 'var(--color-accent-light)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 10px' }}>
                        {uploadStatus}
                      </div>
                    )}

                    {(draft.sourceDocuments?.length ?? 0) > 0 && (
                      <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 12px', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-ink-2)', fontWeight: 600 }}>
                          已纳入分析的文档
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, padding: 10 }}>
                          {draft.sourceDocuments?.map(doc => (
                            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--color-border)', borderRadius: 6, padding: 8, fontSize: 12, color: 'var(--color-ink-2)' }}>
                              <FileText size={14} color="var(--color-accent)" />
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</span>
                              <span style={{ color: 'var(--color-ink-3)' }}>{doc.textLength}字</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {styleFields.map(([label, key]) => (
                        <label key={key} style={{ ...labelStyle, gridColumn: key === 'editableSummary' || key === 'avoidContentReuseNotice' ? '1 / -1' : undefined }}>
                          {label}
                          <textarea
                            value={String(draft[key] ?? '')}
                            onChange={event => setDraft({ ...draft, [key]: event.target.value })}
                            rows={key === 'editableSummary' ? 4 : 2}
                            style={textareaStyle}
                          />
                        </label>
                      ))}
                    </div>

                    {notice && <div style={{ fontSize: 12, color: 'var(--color-accent)' }}>{notice}</div>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                      <button onClick={closeModal} disabled={isExtracting} style={secondaryButtonStyle}>取消</button>
                      <button onClick={saveProfile} disabled={isExtracting} style={primaryButtonStyle}>
                        <Sparkles size={13} />
                        {isEditing ? '保存档案' : '创建档案'}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: 'var(--color-accent)', background: 'var(--color-accent-light)', border: '1px solid #B8D9C0', borderRadius: 4, padding: '2px 6px' }}>
      {children}
    </span>
  )
}

function CardAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--color-ink-3)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: '4px 0' }}>
      {icon}
      {label}
    </button>
  )
}

const cardStyle = {
  minHeight: 216,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-sm)',
  padding: 14,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
}

const iconButtonStyle = {
  width: 26,
  height: 26,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-ink-3)',
  cursor: 'pointer',
}

const pagerButtonStyle = {
  width: 30,
  height: 30,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface)',
  color: 'var(--color-ink-2)',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
}

const labelStyle = {
  fontSize: 12,
  color: 'var(--color-ink-2)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
}

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  lineHeight: 1.7,
  outline: 'none',
  resize: 'vertical' as const,
  fontFamily: 'var(--font-sans)',
}

const modalBackdropStyle = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 20,
  background: 'rgba(26, 28, 24, 0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}

const modalPanelStyle = {
  width: 'min(1040px, 100%)',
  maxHeight: 'calc(100vh - 56px)',
  overflowY: 'auto' as const,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
}

const primaryButtonStyle = {
  border: 'none',
  borderRadius: 6,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const secondaryButtonStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-ink-2)',
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
