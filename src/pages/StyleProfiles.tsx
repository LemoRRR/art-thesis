import { useMemo, useState, type ChangeEvent } from 'react'
import { Download, FileText, Plus, Sparkles, Trash2 } from 'lucide-react'
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
    `档案：${profile.profileName}`,
    profile.sourceFileName ? `来源：${profile.sourceFileName}` : '',
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
    ['档案', profile.profileName],
    ['来源', profile.sourceFileName ?? ''],
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

const emptyDraft = {
  studentName: '',
  profileName: '',
  sourceFileName: '',
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

export default function StyleProfiles() {
  const [profiles, setProfiles] = useState<StyleProfile[]>(() => styleProfileStore.getAll())
  const [activeId, setActiveId] = useState<string | null>(() => styleProfileStore.getAll()[0]?.id ?? null)
  const [draft, setDraft] = useState(emptyDraft)
  const [isExtracting, setIsExtracting] = useState(false)
  const [notice, setNotice] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')

  const activeProfile = useMemo(
    () => profiles.find(profile => profile.id === activeId) ?? null,
    [activeId, profiles]
  )

  const refresh = () => setProfiles(styleProfileStore.getAll())

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsExtracting(true)
    setNotice('')
    setUploadStatus(`已选择：${file.name}，正在准备解析…`)
    try {
      let text = ''
      if (file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')) {
        setUploadStatus(`正在读取文本：${file.name}`)
        text = await file.text()
      } else {
        setUploadStatus(`正在上传并解析：${file.name}`)
        setNotice('Word/PDF 会先上传到解析服务；解析出的正文只用于生成风格画像。')
        const row = await filesAPI.upload(file)
        const item = libraryStore.upsertRemote(row)
        setUploadStatus('文件已上传，正在等待正文解析结果…')
        const parsedItem = await waitForParsedLibraryItem(item.id)
        if (parsedItem.extractStatus === 'failed') {
          throw new Error('文件解析失败，请换一个文档或先转为 TXT 再上传。')
        }
        text = parsedItem.text || parsedItem.summary || ''
      }

      const clipped = text.trim().slice(0, 10000)
      if (!clipped) throw new Error('没有解析到可用于提取风格的正文')

      setUploadStatus(`已读取 ${clipped.length} 字，正在生成风格画像…`)
      const extracted = await streamStyleProfile(clipped)
      setDraft(prev => ({
        ...prev,
        profileName: prev.profileName || file.name.replace(/\.[^.]+$/, ''),
        sourceFileName: file.name,
        sourceTextLength: clipped.length,
        writingLevel: extracted.writingLevel ?? '',
        sentenceStyle: extracted.sentenceStyle ?? '',
        paragraphLogic: extracted.paragraphLogic ?? '',
        argumentStyle: extracted.argumentStyle ?? '',
        transitionStyle: extracted.transitionStyle ?? '',
        vocabularyStyle: extracted.vocabularyStyle ?? '',
        avoidContentReuseNotice: extracted.avoidContentReuseNotice || prev.avoidContentReuseNotice,
        editableSummary: extracted.editableSummary ?? '',
      }))
      setUploadStatus(`风格画像已生成：${file.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '风格提取失败'
      setUploadStatus(`处理失败：${message}`)
      setNotice(message)
    } finally {
      setIsExtracting(false)
    }
  }

  const saveProfile = () => {
    if (!draft.studentName.trim() || !draft.profileName.trim()) {
      setNotice('请先填写学生名和档案名。')
      return
    }
    if (profiles.length >= 50 && !activeProfile) {
      setNotice('风格档案最多 50 个，请删除旧档案后再新增。')
      return
    }

    if (activeProfile) {
      styleProfileStore.update(activeProfile.id, draft)
      setNotice('风格档案已更新。')
    } else {
      const created = styleProfileStore.add(draft)
      setActiveId(created.id)
      setNotice('风格档案已保存。')
    }
    refresh()
  }

  const startNew = () => {
    setActiveId(null)
    setDraft(emptyDraft)
    setNotice('')
    setUploadStatus('')
  }

  const selectProfile = (profile: StyleProfile) => {
    setActiveId(profile.id)
    setDraft({
      studentName: profile.studentName,
      profileName: profile.profileName,
      sourceFileName: profile.sourceFileName ?? '',
      sourceTextLength: profile.sourceTextLength,
      writingLevel: profile.writingLevel,
      sentenceStyle: profile.sentenceStyle,
      paragraphLogic: profile.paragraphLogic,
      argumentStyle: profile.argumentStyle,
      transitionStyle: profile.transitionStyle,
      vocabularyStyle: profile.vocabularyStyle,
      avoidContentReuseNotice: profile.avoidContentReuseNotice,
      editableSummary: profile.editableSummary,
    })
    setNotice('')
    setUploadStatus(profile.sourceFileName ? `当前档案来源：${profile.sourceFileName}` : '')
  }

  const deleteProfile = (profile: StyleProfile) => {
    if (!confirm(`确认删除「${profile.profileName}」？`)) return
    styleProfileStore.remove(profile.id)
    const next = styleProfileStore.getAll()
    setProfiles(next)
    setActiveId(next[0]?.id ?? null)
    if (next[0]) selectProfile(next[0])
    else setDraft(emptyDraft)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar currentStep={0} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <aside style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--color-border)', background: 'var(--color-surface)', padding: 16, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--color-ink)' }}>风格档案</div>
                <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 4 }}>{profiles.length} / 50 个学生档案</div>
              </div>
              <button onClick={startNew} style={{ border: 'none', borderRadius: 6, background: 'var(--color-accent)', color: '#fff', width: 30, height: 30, cursor: 'pointer' }}>
                <Plus size={15} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {profiles.map(profile => (
                <button
                  key={profile.id}
                  onClick={() => selectProfile(profile)}
                  style={{
                    border: `1px solid ${profile.id === activeId ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: profile.id === activeId ? 'var(--color-accent-light)' : 'var(--color-bg)',
                    borderRadius: 8,
                    padding: 10,
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--color-ink)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{profile.profileName}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 4 }}>{profile.studentName}</div>
                </button>
              ))}
            </div>
          </aside>

          <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <h1 style={{ fontSize: 18, margin: 0, color: 'var(--color-ink)' }}>语言风格记忆库</h1>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
                      这里只保存语言水平、句式和段落组织，不保存参考文章的观点、案例或具体内容。Stage1 上传已有论文默认不会进入风格学习。
                    </p>
                  </div>
                  {activeProfile && (
                    <button onClick={() => deleteProfile(activeProfile)} style={{ border: '1px solid #F1C0B8', background: '#FFF4F2', color: '#C0392B', borderRadius: 6, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      <Trash2 size={13} />
                      删除
                    </button>
                  )}
                </div>
              </section>

              <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--color-ink-2)' }}>
                  学生名
                  <input value={draft.studentName} onChange={event => setDraft({ ...draft, studentName: event.target.value })} placeholder="例如：张同学" style={inputStyle} />
                </label>
                <label style={{ fontSize: 12, color: 'var(--color-ink-2)' }}>
                  档案名
                  <input value={draft.profileName} onChange={event => setDraft({ ...draft, profileName: event.target.value })} placeholder="例如：本科论文表达习惯" style={inputStyle} />
                </label>
                <label style={{ gridColumn: '1 / -1', border: '1px dashed var(--color-border-strong)', borderRadius: 8, padding: 14, background: 'var(--color-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <FileText size={18} color="var(--color-accent)" />
                  <span style={{ fontSize: 13, color: 'var(--color-ink-2)' }}>
                    {isExtracting ? (uploadStatus || '正在提取风格画像…') : '上传参考文章提取风格画像（Word/PDF/TXT，最多使用前 10000 字）'}
                  </span>
                  <input type="file" accept=".pdf,.doc,.docx,.txt,text/plain" onChange={handleFile} disabled={isExtracting} style={{ display: 'none' }} />
                </label>
                {uploadStatus && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: uploadStatus.startsWith('处理失败') ? '#C0392B' : 'var(--color-accent)', background: uploadStatus.startsWith('处理失败') ? '#FFF4F2' : 'var(--color-accent-light)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 10px' }}>
                    {uploadStatus}
                  </div>
                )}
              </section>

              <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  ['语言水平', 'writingLevel'],
                  ['句式特征', 'sentenceStyle'],
                  ['段落组织', 'paragraphLogic'],
                  ['论证方式', 'argumentStyle'],
                  ['过渡方式', 'transitionStyle'],
                  ['词汇风格', 'vocabularyStyle'],
                  ['风险提醒', 'avoidContentReuseNotice'],
                  ['风格画像总结', 'editableSummary'],
                ].map(([label, key]) => (
                  <label key={key} style={{ fontSize: 12, color: 'var(--color-ink-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {label}
                    <textarea
                      value={String(draft[key as keyof typeof draft] ?? '')}
                      onChange={event => setDraft({ ...draft, [key]: event.target.value })}
                      rows={key === 'editableSummary' ? 4 : 2}
                      style={textareaStyle}
                    />
                  </label>
                ))}

                {notice && <div style={{ fontSize: 12, color: 'var(--color-accent)' }}>{notice}</div>}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={saveProfile} disabled={isExtracting} style={primaryButtonStyle}>
                    <Sparkles size={13} />
                    {activeProfile ? '保存修改' : '保存档案'}
                  </button>
                  {activeProfile && (
                    <>
                      <button onClick={() => downloadText(`${activeProfile.profileName}.txt`, profileToText(activeProfile))} style={secondaryButtonStyle}>
                        <Download size={13} />
                        导出 TXT
                      </button>
                      <button onClick={() => downloadText(`${activeProfile.profileName}.csv`, `\uFEFF${profileToCsv(activeProfile)}`, 'text/csv;charset=utf-8')} style={secondaryButtonStyle}>
                        <Download size={13} />
                        导出 CSV
                      </button>
                    </>
                  )}
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  display: 'block',
  marginTop: 6,
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
