import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Download,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import {
  PROMPT_CATALOG,
  PROMPT_MODULES,
  promptOverrideStore,
  type PromptCatalogItem,
  type PromptModuleKey,
  type PromptOverride,
} from '../lib/promptSettings'
import { toast } from '../lib/toast'

function formatTime(timestamp?: number) {
  if (!timestamp) return '未保存'
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function runtimeLabel(item: PromptCatalogItem) {
  if (item.runtime === 'client') return '已接入前端生成'
  if (item.runtime === 'server') return '后端目录项'
  return '目录项'
}

function runtimeTone(item: PromptCatalogItem) {
  if (item.runtime === 'client') return { color: '#1D7A46', background: '#EAF7EF', border: '#C8EBD5' }
  if (item.runtime === 'server') return { color: '#8A5A00', background: '#FFF6DD', border: '#F1D99B' }
  return { color: 'var(--color-ink-2)', background: '#F4F1EA', border: 'var(--color-border)' }
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function PromptSettings() {
  const [moduleKey, setModuleKey] = useState<PromptModuleKey>('draft')
  const [query, setQuery] = useState('')
  const [overrides, setOverrides] = useState<PromptOverride[]>(() => promptOverrideStore.getAll())
  const [activeKey, setActiveKey] = useState(() => PROMPT_CATALOG.find(item => item.module === 'draft')?.key ?? PROMPT_CATALOG[0]?.key)
  const [draft, setDraft] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    const handleUpdate = () => setOverrides(promptOverrideStore.getAll())
    window.addEventListener('pai-prompt-overrides-updated', handleUpdate)
    return () => window.removeEventListener('pai-prompt-overrides-updated', handleUpdate)
  }, [])

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return PROMPT_CATALOG.filter(item => {
      const matchesModule = item.module === moduleKey
      const matchesQuery = !normalized || [
        item.key,
        item.name,
        item.trigger,
        item.location,
        item.editableFocus,
      ].join('\n').toLowerCase().includes(normalized)
      return matchesModule && matchesQuery
    })
  }, [moduleKey, query])

  const activeItem = useMemo(
    () => PROMPT_CATALOG.find(item => item.key === activeKey) ?? filteredItems[0] ?? PROMPT_CATALOG[0],
    [activeKey, filteredItems],
  )

  const activeOverride = overrides.find(item => item.key === activeItem.key)
  const customizedCount = overrides.filter(item => item.instruction.trim()).length
  const enabledCount = overrides.filter(item => item.enabled && item.instruction.trim()).length

  useEffect(() => {
    if (!filteredItems.some(item => item.key === activeKey) && filteredItems[0]) {
      setActiveKey(filteredItems[0].key)
    }
  }, [activeKey, filteredItems])

  useEffect(() => {
    const override = promptOverrideStore.get(activeItem.key)
    setDraft(override?.instruction ?? activeItem.defaultInstruction)
    setEnabled(override?.enabled ?? true)
  }, [activeItem])

  const saveCurrent = () => {
    promptOverrideStore.save(activeItem.key, draft.trim(), enabled)
    setOverrides(promptOverrideStore.getAll())
    toast('Prompt 设置已保存。', 'success')
  }

  const resetCurrent = () => {
    if (!confirm(`恢复「${activeItem.name}」默认设置？`)) return
    promptOverrideStore.reset(activeItem.key)
    setOverrides(promptOverrideStore.getAll())
    setDraft(activeItem.defaultInstruction)
    setEnabled(true)
    toast('已恢复默认设置。', 'success')
  }

  const exportConfig = () => {
    downloadText('prompt-overrides.json', JSON.stringify(promptOverrideStore.getAll(), null, 2))
  }

  const importConfig = () => {
    try {
      const parsed = JSON.parse(importText)
      if (!Array.isArray(parsed)) throw new Error('配置必须是数组')
      promptOverrideStore.importAll(parsed)
      setOverrides(promptOverrideStore.getAll())
      setImportText('')
      toast('Prompt 配置已导入。', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入失败，请检查 JSON。', 'error')
    }
  }

  const copyDocLine = async () => {
    await navigator.clipboard.writeText(`${activeItem.name} | ${activeItem.key} | ${activeItem.location}`)
    toast('已复制 Prompt 定位信息。', 'success')
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <header style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>后台设置</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 24, color: 'var(--color-ink)' }}>Prompt 管理</h1>
            <p style={{ margin: 0, color: 'var(--color-ink-2)', fontSize: 13, lineHeight: 1.7 }}>
              按模块管理 AI 行为。前端生成类 Prompt 保存后立即生效；后端目录项先用于交付定位，接入服务端配置后可同样热更新。
            </p>
          </div>
          <div style={statsStyle}>
            <Stat label="已定制" value={customizedCount} />
            <Stat label="启用中" value={enabledCount} />
            <Stat label="目录项" value={PROMPT_CATALOG.length} />
          </div>
        </header>

        <div style={bodyStyle}>
          <aside style={modulePanelStyle}>
            <label style={searchBoxStyle}>
              <Search size={14} color="var(--color-ink-3)" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索 Prompt"
                style={searchInputStyle}
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PROMPT_MODULES.map(module => {
                const count = PROMPT_CATALOG.filter(item => item.module === module.key).length
                const active = module.key === moduleKey
                return (
                  <button
                    key={module.key}
                    onClick={() => setModuleKey(module.key)}
                    style={{
                      ...moduleButtonStyle,
                      background: active ? 'var(--color-accent-light)' : 'transparent',
                      color: active ? 'var(--color-accent)' : 'var(--color-ink)',
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 650 }}>{module.label}</span>
                      <span style={{ display: 'block', marginTop: 3, color: 'var(--color-ink-3)', fontSize: 11, lineHeight: 1.4 }}>
                        {module.description}
                      </span>
                    </span>
                    <span style={countPillStyle}>{count}</span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section style={listPanelStyle}>
            <div style={panelTitleStyle}>
              <SlidersHorizontal size={15} />
              <span>{PROMPT_MODULES.find(item => item.key === moduleKey)?.label}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
              {filteredItems.map(item => {
                const override = overrides.find(entry => entry.key === item.key)
                const active = item.key === activeItem.key
                const tone = runtimeTone(item)
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveKey(item.key)}
                    style={{
                      ...promptCardStyle,
                      borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                      background: active ? '#FFFEFA' : 'var(--color-surface)',
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontWeight: 650, color: 'var(--color-ink)' }}>{item.name}</span>
                        <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.key}
                        </span>
                      </span>
                      {override?.enabled && override.instruction.trim() ? <CheckCircle2 size={15} color="#1D7A46" /> : null}
                    </span>
                    <span style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'var(--color-ink-2)', lineHeight: 1.6 }}>
                      {item.trigger}
                    </span>
                    <span style={{ ...runtimeBadgeStyle, color: tone.color, background: tone.background, borderColor: tone.border }}>
                      {runtimeLabel(item)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section style={editorPanelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-ink)' }}>{activeItem.name}</div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-ink-3)' }}>{activeItem.location}</div>
              </div>
              <button onClick={copyDocLine} style={ghostButtonStyle}>
                <Copy size={14} />
                复制定位
              </button>
            </div>

            <div style={metaGridStyle}>
              <Info label="触发入口" value={activeItem.trigger} />
              <Info label="可调整内容" value={activeItem.editableFocus} />
              <Info label="运行状态" value={runtimeLabel(activeItem)} />
              <Info label="最近保存" value={formatTime(activeOverride?.updatedAt)} />
            </div>

            <label style={toggleRowStyle}>
              <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
              <span>启用这个 Prompt 的自定义补充规则</span>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
              <span style={{ fontSize: 12, color: 'var(--color-ink-2)', fontWeight: 650 }}>自定义补充规则</span>
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                style={textareaStyle}
                placeholder="例如：输出更学术、更具体，避免泛泛而谈；问卷题项不少于 38 题；图表说明必须先描述最高项和最低项..."
              />
            </label>

            {activeItem.runtime !== 'client' ? (
              <div style={serverNoticeStyle}>
                这个 Prompt 当前属于后端目录项。设置会先保存为管理档案；若要让线上后端即时读取，需要继续接入服务端 Prompt 配置表。
              </div>
            ) : null}

            <div style={actionRowStyle}>
              <button onClick={saveCurrent} style={primaryButtonStyle}>
                <Save size={14} />
                保存设置
              </button>
              <button onClick={resetCurrent} style={secondaryButtonStyle}>
                <RotateCcw size={14} />
                恢复默认
              </button>
              <button onClick={exportConfig} style={secondaryButtonStyle}>
                <Download size={14} />
                导出配置
              </button>
            </div>

            <details style={importPanelStyle}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 650, color: 'var(--color-ink)' }}>导入 Prompt 配置 JSON</summary>
              <textarea
                value={importText}
                onChange={event => setImportText(event.target.value)}
                placeholder="粘贴 prompt-overrides.json 内容"
                style={{ ...textareaStyle, minHeight: 88, marginTop: 10, flex: 'none' }}
              />
              <button onClick={importConfig} disabled={!importText.trim()} style={{ ...secondaryButtonStyle, marginTop: 8 }}>
                <Upload size={14} />
                导入
              </button>
            </details>
          </section>
        </div>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ minWidth: 86 }}>
      <div style={{ fontSize: 20, fontWeight: 750, color: 'var(--color-accent)' }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--color-ink-3)' }}>{label}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoStyle}>
      <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--color-ink)', lineHeight: 1.55 }}>{value}</div>
    </div>
  )
}

const headerStyle = {
  padding: '24px 28px 18px',
  borderBottom: '1px solid var(--color-border)',
  background: '#FFFEFA',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 18,
} as const

const eyebrowStyle = {
  fontSize: 12,
  color: 'var(--color-accent)',
  fontWeight: 700,
} as const

const statsStyle = {
  display: 'flex',
  gap: 10,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  padding: '10px 12px',
  boxShadow: 'var(--shadow-sm)',
} as const

const bodyStyle = {
  flex: 1,
  minHeight: 0,
  padding: 18,
  display: 'grid',
  gridTemplateColumns: '260px 320px minmax(420px, 1fr)',
  gap: 14,
} as const

const modulePanelStyle = {
  minHeight: 0,
  overflowY: 'auto',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
} as const

const listPanelStyle = {
  minHeight: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: '#FFFEFA',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
} as const

const editorPanelStyle = {
  minHeight: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: 'var(--color-surface)',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  boxShadow: 'var(--shadow-sm)',
} as const

const searchBoxStyle = {
  height: 34,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: '#fff',
  padding: '0 10px',
} as const

const searchInputStyle = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  color: 'var(--color-ink)',
} as const

const moduleButtonStyle = {
  width: '100%',
  border: 'none',
  borderRadius: 7,
  padding: '10px 9px',
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 10,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
} as const

const countPillStyle = {
  alignSelf: 'flex-start',
  minWidth: 24,
  height: 20,
  borderRadius: 999,
  background: '#fff',
  border: '1px solid var(--color-border)',
  color: 'var(--color-ink-2)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
} as const

const panelTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-ink)',
} as const

const promptCardStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 12,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
} as const

const runtimeBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  marginTop: 9,
  height: 22,
  borderRadius: 999,
  border: '1px solid',
  padding: '0 8px',
  fontSize: 11,
  fontWeight: 650,
} as const

const metaGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
} as const

const infoStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: '#FFFEFA',
  padding: '9px 10px',
} as const

const toggleRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--color-ink)',
} as const

const textareaStyle = {
  width: '100%',
  flex: 1,
  minHeight: 210,
  resize: 'vertical',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  background: '#fff',
  padding: 12,
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  outline: 'none',
} as const

const serverNoticeStyle = {
  border: '1px solid #F1D99B',
  background: '#FFF8E6',
  color: '#7A5200',
  borderRadius: 7,
  padding: '9px 10px',
  fontSize: 12,
  lineHeight: 1.6,
} as const

const actionRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
} as const

const primaryButtonStyle = {
  height: 34,
  border: 'none',
  borderRadius: 7,
  background: 'var(--color-accent)',
  color: '#fff',
  padding: '0 13px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 650,
} as const

const secondaryButtonStyle = {
  height: 34,
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: '#fff',
  color: 'var(--color-ink)',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
} as const

const ghostButtonStyle = {
  ...secondaryButtonStyle,
  height: 30,
  flexShrink: 0,
} as const

const importPanelStyle = {
  borderTop: '1px solid var(--color-border)',
  paddingTop: 10,
} as const
