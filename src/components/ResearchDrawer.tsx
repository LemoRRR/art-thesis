import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, ArrowRight, BarChart3, CheckCircle2, ClipboardList, FileText, FlaskConical, History, Play, Upload, X } from 'lucide-react'
import { researchAPI } from '../lib/api'
import {
  projectStore,
  researchAssetStore,
  researchPackageStore,
  researchTaskStore,
  type ResearchAnalysisPlan,
  type ResearchAnalysisRun,
  type ResearchAsset,
  type ResearchAssetType,
  type ResearchContentPackage,
  type ResearchIntent,
  type ResearchTask,
  type ResearchTaskStatus,
} from '../lib/storage'

interface ResearchDrawerProps {
  projectId: string
  open: boolean
  activeSectionTitle?: string
  onClose: () => void
  onOpenDetails: () => void
  onInsertAsset: (asset: ResearchAsset) => void
  onUseAsReference: (asset: ResearchAsset) => void
  onGenerateChapter: (asset: ResearchAsset) => void
  onInsertAndPolish: (asset: ResearchAsset) => void
}

interface UploadedDataset {
  fileName: string
  text?: string
  base64?: string
  rowCount?: number
  assetId?: string
}

const taskStatusLabels: Record<ResearchTaskStatus, { label: string; tone: 'idle' | 'wait' | 'ready' | 'done'; hint: string }> = {
  route_planned: { label: '研究路线已规划', tone: 'idle', hint: '可以继续生成问卷、量表或上传已有材料。' },
  scale_drafting: { label: '研究工具草稿中', tone: 'idle', hint: '草稿不会自动进入正文，确认后才会被 Stage3 调用。' },
  scale_confirmed: { label: '量表已确认', tone: 'ready', hint: '可以写研究方法、变量测量和问卷设计。' },
  survey_ready: { label: '问卷可发放', tone: 'ready', hint: '可以导出问卷或数据模板，之后等待回收数据。' },
  collecting_data: { label: '等待数据回收', tone: 'wait', hint: '可以写研究方法，但不能生成统计结果。' },
  data_uploaded: { label: '数据已上传', tone: 'ready', hint: '下一步应确认变量映射并运行分析。' },
  data_validated: { label: '数据已校验', tone: 'ready', hint: '可以运行 Python 统计分析。' },
  analysis_done: { label: '分析已完成', tone: 'done', hint: '可以作为内容包插入当前章节。' },
  chapter_text_ready: { label: '结果文字已生成', tone: 'done', hint: '可以插入当前章节或进入详情继续编辑。' },
  inserted_into_paper: { label: '已写入论文', tone: 'done', hint: '可以继续润色，或在研究历史里恢复旧版本。' },
}

const assetLabels: Record<ResearchAssetType, string> = {
  research_design: '研究设计',
  scale_schema: '量表结构',
  survey_questionnaire: '问卷',
  questionnaire_review: '问卷优化',
  hypothesis_model: '假设模型',
  quant_dataset: '数据集',
  quant_analysis_result: '量化分析',
  kano_result: 'KANO',
  ahp_result: 'AHP',
  qualitative_coding: '质性编码',
  chapter_text: '结果文字',
}

const componentOptions = [
  { value: 'method', label: '方法' },
  { value: 'figure', label: '图表' },
  { value: 'statistics', label: '统计表' },
  { value: 'analysis', label: '分析文字' },
]

function getPrimaryTask(tasks: ResearchTask[]): ResearchTask | null {
  const priority: ResearchTaskStatus[] = [
    'analysis_done',
    'chapter_text_ready',
    'data_validated',
    'data_uploaded',
    'collecting_data',
    'survey_ready',
    'scale_confirmed',
    'scale_drafting',
    'route_planned',
    'inserted_into_paper',
  ]
  return [...tasks].sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0] ?? null
}

function isInsertable(asset: ResearchAsset) {
  return asset.type !== 'quant_dataset' && Boolean(asset.plainText.trim())
}

function getChapterAction(sectionTitle?: string) {
  const title = sectionTitle ?? ''
  if (/方法|设计|问卷|变量|测量|研究对象|资料收集/.test(title)) return '当前章节适合插入研究方法、变量映射、问卷设计或访谈方案。'
  if (/数据|分析|结果|第四章|KANO|AHP|编码|信度|效度|回归|相关/.test(title)) return '当前章节适合插入样本统计、Python 分析结果、图表和论文结果表述。'
  if (/讨论|结论|建议|优化/.test(title)) return '当前章节适合引用已有研究发现，生成讨论、建议和研究限制。'
  return '当前章节可以按需生成研究结果；如果涉及数据结论，请先上传数据并确认分析方案。'
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function formatPlan(plan: ResearchAnalysisPlan) {
  return [
    `目的：${plan.purpose}`,
    `方法：${plan.methods?.join('、') || plan.method}`,
    `原因：${plan.reason}`,
    `公式/模型：${plan.formula}`,
    `需要列：${plan.requiredColumns.join('、') || '待确认'}`,
    plan.needsVariableConfirmation ? '变量映射需要确认。' : '变量映射置信度较高。',
  ].join('\n')
}

function filteredResultForComponents(result: Record<string, unknown>, selectedTypes: string[]) {
  const selected = new Set(selectedTypes)
  return {
    ...result,
    figures: selected.has('figure') ? result.figures : [],
    tables: selected.has('statistics') ? result.tables : [],
    methodText: selected.has('method') ? result.methodText : '',
    analysisText: selected.has('analysis') ? result.analysisText : '',
  }
}

export default function ResearchDrawer({
  projectId,
  open,
  activeSectionTitle,
  onClose,
  onOpenDetails,
  onInsertAsset,
  onUseAsReference,
  onGenerateChapter,
  onInsertAndPolish,
}: ResearchDrawerProps) {
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [requestText, setRequestText] = useState('')
  const [dataset, setDataset] = useState<UploadedDataset | null>(null)
  const [intent, setIntent] = useState<ResearchIntent | null>(null)
  const [plan, setPlan] = useState<ResearchAnalysisPlan | null>(null)
  const [selectedTypes, setSelectedTypes] = useState(['method', 'figure', 'statistics', 'analysis'])
  const [latestAnalysisAssetId, setLatestAnalysisAssetId] = useState('')
  const [notice, setNotice] = useState('')
  const [loadingStep, setLoadingStep] = useState<'intent' | 'plan' | 'run' | ''>('')
  const [isUploadingDataset, setIsUploadingDataset] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const datasetUploadInFlightRef = useRef(false)

  const project = projectStore.ensure(projectId)
  const tasks = researchTaskStore.getByProject(projectId)
  const assets = researchAssetStore.getByProject(projectId)
  const packages = researchPackageStore.getByProject(projectId)
  const primaryTask = getPrimaryTask(tasks)
  const insertableAssets = useMemo(() => assets.filter(isInsertable), [assets])
  const selectedAsset = insertableAssets.find(asset => asset.id === selectedAssetId) ?? insertableAssets[0] ?? null
  const latestAnalysisAsset = latestAnalysisAssetId ? researchAssetStore.get(latestAnalysisAssetId) : null
  const status = primaryTask ? taskStatusLabels[primaryTask.status] : null

  useEffect(() => {
    if (!open) return
    if (!requestText) {
      queueMicrotask(() => {
        setRequestText(activeSectionTitle ? `为「${activeSectionTitle}」分析上传数据，生成可插入论文的图表、统计表和分析文字。` : '分析这组数据中核心变量之间的关系，并生成可插入论文的研究结果。')
      })
    }
    if (!selectedAssetId && insertableAssets[0]) {
      queueMicrotask(() => setSelectedAssetId(insertableAssets[0].id))
    }
  }, [activeSectionTitle, insertableAssets, open, requestText, selectedAssetId])

  const uploadDataset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    datasetUploadInFlightRef.current = true
    setIsUploadingDataset(true)
    setNotice('正在读取数据文件，请稍等。')
    try {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name)
      const text = isExcel ? undefined : await file.text()
      const base64 = isExcel ? arrayBufferToBase64(await file.arrayBuffer()) : undefined
      const task = primaryTask ?? researchTaskStore.add({
        projectId,
        title: '章节研究结果分析',
        methodType: 'quantitative',
        status: 'survey_ready',
        nextActionLabel: '确认分析方案',
      })
      const asset = researchAssetStore.add({
        projectId,
        taskId: task.id,
        type: 'quant_dataset',
        title: file.name,
        summary: isExcel ? '已上传 Excel 数据文件，等待 Python 读取。' : `已上传 CSV/TXT 数据，约 ${text?.split(/\r?\n/).filter(Boolean).length ?? 0} 行。`,
        source: 'uploaded_by_user',
        structuredData: { fileName: file.name, base64, preview: text?.slice(0, 3000) },
        plainText: text?.slice(0, 20000) ?? '',
        status: 'confirmed',
      })
      researchTaskStore.update(task.id, {
        status: 'data_uploaded',
        datasetAssetId: asset.id,
        nextActionLabel: 'AI 生成分析方案',
      })
      setDataset({ fileName: file.name, text, base64, rowCount: text?.split(/\r?\n/).filter(Boolean).length, assetId: asset.id })
      setPlan(null)
      setIntent(null)
      setNotice('数据已上传。下一步先让 AI 生成分析方案，确认后再运行 Python。')
    } catch (error) {
      setNotice(`读取数据失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      datasetUploadInFlightRef.current = false
      setIsUploadingDataset(false)
    }
  }

  const createIntentAndPlan = async () => {
    if (!requestText.trim()) {
      setNotice('请先描述你希望这次研究结果解决什么问题。')
      return
    }
    if (datasetUploadInFlightRef.current) {
      setNotice('数据文件还在读取中，请稍后再生成分析方案。')
      return
    }
    if (!dataset) {
      setNotice('请先上传 CSV 或 Excel 数据。')
      return
    }
    setLoadingStep('intent')
    setNotice('AI 正在理解研究意图…')
    try {
      const intentResult = await researchAPI.intent({
        projectId,
        chapterTitle: activeSectionTitle,
        chapterContent: '',
        stage1ResearchPlan: project.context.researchPlan,
        userRequest: requestText,
        existingAssets: assets.slice(0, 8).map(asset => ({ title: asset.title, type: asset.type, summary: asset.summary })),
      })
      setIntent(intentResult.intent)
      if (intentResult.intent.capabilityTier === 'out_of_scope') {
        setPlan(null)
        setNotice(`当前需求超出内置工具箱：${intentResult.intent.notes.join('；')}`)
        return
      }
      setLoadingStep('plan')
      setNotice('AI 正在读取数据预览并生成变量映射表…')
      const planResult = await researchAPI.analysisPlan({
        intent: intentResult.intent,
        fileName: dataset.fileName,
        text: dataset.text,
        base64: dataset.base64,
      })
      setPlan(planResult.plan)
      setNotice(planResult.plan.needsVariableConfirmation ? '方案已生成：请先核对变量映射，再确认运行 Python。' : '方案已生成：确认后即可运行 Python。')
    } catch (error) {
      setNotice(`生成方案失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoadingStep('')
    }
  }

  const runConfirmedPlan = async () => {
    if (!dataset || !plan) return
    setLoadingStep('run')
    setNotice('Python 正在按确认方案执行真实计算并生成 PNG 图表…')
    try {
      const result = await researchAPI.analyze({
        fileName: dataset.fileName,
        text: dataset.text,
        base64: dataset.base64,
        confirmedPlan: plan,
        selectedComponentTypes: selectedTypes,
      })
      const run: ResearchAnalysisRun = {
        id: `research_run_${Date.now()}`,
        inputDatasetId: dataset.assetId,
        confirmedPlan: plan,
        toolCalls: plan.toolCalls,
        rawResults: result,
        figures: result.figures ?? [],
        tables: result.tables ?? [],
        warnings: result.cautions ?? [],
        createdAt: Date.now(),
      }
      const filteredResult = filteredResultForComponents(result as unknown as Record<string, unknown>, selectedTypes)
      const asset = researchAssetStore.add({
        projectId,
        taskId: primaryTask?.id,
        type: 'quant_analysis_result',
        title: `${dataset.fileName}-章节研究结果`,
        summary: `按确认方案执行：${plan.methods?.join('、') || plan.method}；样本量 ${result.sampleSize}。`,
        source: 'created_in_stage3',
        structuredData: { dataset, intent, plan, run: { ...run, ...filteredResult }, result: filteredResult },
        plainText: [
          '【研究方法】',
          result.methodText,
          '',
          '【数据分析结果】',
          result.plainText,
          '',
          '【分析文字】',
          result.analysisText,
          result.cautions.length ? `\n【计算提示】\n${result.cautions.join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        status: 'confirmed',
      })
      if (primaryTask) {
        researchTaskStore.update(primaryTask.id, {
          status: 'analysis_done',
          analysisAssetId: asset.id,
          nextActionLabel: '插入当前章节',
        })
      }
      setLatestAnalysisAssetId(asset.id)
      setSelectedAssetId(asset.id)
      setHistoryTick(value => value + 1)
      setNotice('分析完成，已保存为研究内容包来源。可以直接插入当前章节。')
    } catch (error) {
      setNotice(`Python 分析失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoadingStep('')
    }
  }

  const restorePackageVersion = (pkg: ResearchContentPackage, versionId: string) => {
    researchPackageStore.restoreVersion(pkg.id, versionId)
    setHistoryTick(value => value + 1)
    setNotice(`已恢复「${pkg.title}」的历史版本。`)
  }

  if (!open) return null

  return (
    <aside style={drawerStyle} data-testid="stage3-research-drawer">
      <div style={headerStyle}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: 'var(--color-ink)' }}>
            <FlaskConical size={14} />
            插入研究结果
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)' }}>{activeSectionTitle || project.title}</div>
        </div>
        <button onClick={onClose} style={iconButtonStyle} title="关闭研究抽屉">
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {notice && (
          <div data-testid="research-drawer-notice">
            <WaitNotice text={notice} tone={notice.includes('失败') || notice.includes('超出') ? 'error' : 'info'} />
          </div>
        )}

        <section style={panelStyle}>
          <SectionTitle icon={<FileText size={13} />} label="当前章节" />
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-ink-2)' }}>{getChapterAction(activeSectionTitle)}</div>
          {status && primaryTask && (
            <div style={{ marginTop: 10, ...statusCardStyle(status.tone) }}>
              <div style={{ fontSize: 13, fontWeight: 850 }}>{status.label}</div>
              <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.6 }}>{primaryTask.title}</div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-ink-3)' }}>{status.hint}</div>
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <SectionTitle icon={<FlaskConical size={13} />} label="AI 编排 Python 分析" />
          <textarea
            data-testid="research-analysis-request"
            value={requestText}
            onChange={event => setRequestText(event.target.value)}
            rows={4}
            placeholder="例如：分析 X 与 Y 是否相关；检验量表信度；比较不同组在满意度上的差异；做单一中介模型。"
            style={textareaStyle}
          />
          <label style={uploadStyle} data-testid="research-upload-label">
            <Upload size={13} />
            {isUploadingDataset ? '正在读取文件…' : dataset ? dataset.fileName : '上传 CSV / Excel'}
            <input data-testid="research-upload-input" type="file" accept=".csv,.txt,.xlsx,.xls" onChange={uploadDataset} disabled={isUploadingDataset || Boolean(loadingStep)} style={{ display: 'none' }} />
          </label>
          {dataset && (
            <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 6 }}>
              {dataset.rowCount ? `已读取约 ${dataset.rowCount} 行；` : 'Excel 将由 Python 读取；'}运行前会先确认变量映射。
            </div>
          )}
          <button data-testid="research-generate-plan" onClick={createIntentAndPlan} disabled={Boolean(loadingStep) || isUploadingDataset || !dataset} style={primaryActionStyle(Boolean(loadingStep) || isUploadingDataset || !dataset)}>
            <ClipboardList size={13} />
            {isUploadingDataset ? '读取文件中…' : loadingStep === 'intent' || loadingStep === 'plan' ? '生成方案中…' : '生成分析方案'}
          </button>
        </section>

        {intent && (
          <section style={panelStyle}>
            <SectionTitle icon={<CheckCircle2 size={13} />} label="意图识别" />
            <div style={smallTextStyle}>
              <b>目的：</b>{intent.purpose}<br />
              <b>能力层级：</b>{intent.capabilityTier}<br />
              <b>推荐方法：</b>{intent.recommendedMethods.join('、') || '待确认'}
            </div>
          </section>
        )}

        {plan && (
          <section style={panelStyle}>
            <SectionTitle icon={<ClipboardList size={13} />} label="待确认分析方案" />
            <pre style={planStyle}>{formatPlan(plan)}</pre>
            <div style={{ display: 'grid', gap: 6 }}>
              {plan.variables.map((variable, index) => (
                <div key={`${variable.role}-${variable.column}-${index}`} style={variableRowStyle}>
                  <span>{variable.role}</span>
                  <strong>{variable.name}</strong>
                  <em>{variable.column || '未映射'}</em>
                  <small>{Math.round((variable.confidence ?? 0) * 100)}%</small>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {componentOptions.map(option => (
                <label key={option.value} style={checkStyle}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(option.value)}
                    onChange={event => setSelectedTypes(prev =>
                      event.target.checked ? [...prev, option.value] : prev.filter(item => item !== option.value)
                    )}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <button data-testid="research-run-plan" onClick={runConfirmedPlan} disabled={Boolean(loadingStep)} style={primaryActionStyle(Boolean(loadingStep))}>
              <Play size={13} />
              {loadingStep === 'run' ? 'Python 计算中…' : '确认方案并运行 Python'}
            </button>
          </section>
        )}

        {latestAnalysisAsset && (
          <section style={panelStyle}>
            <SectionTitle icon={<ArrowRight size={13} />} label="本次结果" />
            <div style={assetButtonStyle}>
              <div style={{ fontSize: 12, fontWeight: 850 }}>{latestAnalysisAsset.title}</div>
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--color-ink-3)', lineHeight: 1.6 }}>{latestAnalysisAsset.summary}</div>
            </div>
            <button data-testid="research-insert-latest" onClick={() => onInsertAsset(latestAnalysisAsset)} style={primaryActionStyle(false)}>
              <ArrowRight size={13} />
              插入当前章节
            </button>
          </section>
        )}

        <section style={panelStyle}>
          <SectionTitle icon={<ClipboardList size={13} />} label="已有研究资产" />
          {insertableAssets.length === 0 ? (
            <div style={emptyStyle}>暂无可插入资产。完成分析后会出现在这里。</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {insertableAssets.slice(0, 6).map(asset => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedAssetId(asset.id)}
                  style={{
                    ...assetButtonStyle,
                    borderColor: asset.id === selectedAsset?.id ? 'var(--color-accent)' : 'var(--color-border)',
                    background: asset.id === selectedAsset?.id ? 'var(--color-accent-light)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--color-ink)' }}>{asset.title}</span>
                    <span style={pillStyle}>{assetLabels[asset.type]}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: 'var(--color-ink-3)' }}>{asset.summary}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <SectionTitle icon={<History size={13} />} label="研究历史" />
          <div style={{ display: 'none' }}>{historyTick}</div>
          {packages.length === 0 ? (
            <div style={emptyStyle}>还没有研究内容包历史。首次插入后会记录生成、更新和恢复版本。</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {packages.slice(0, 5).map(pkg => (
                <div key={pkg.id} style={historyItemStyle}>
                  <div style={{ fontSize: 12, fontWeight: 850 }}>{pkg.title}</div>
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)' }}>
                    {pkg.components.length} 个组件，{pkg.versions.length} 个版本
                  </div>
                  {pkg.versions[1] && (
                    <button onClick={() => restorePackageVersion(pkg, pkg.versions[1].versionId)} style={miniButtonStyle}>
                      恢复上一版
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div style={footerStyle}>
        <button data-testid="research-use-reference" onClick={() => selectedAsset && onUseAsReference(selectedAsset)} disabled={!selectedAsset} style={secondaryButtonStyle}>
          <ClipboardList size={13} />
          作为参考
        </button>
        <button data-testid="research-insert-polish" onClick={() => selectedAsset && onInsertAndPolish(selectedAsset)} disabled={!selectedAsset} style={primaryButtonStyle(Boolean(selectedAsset))}>
          <ArrowRight size={13} />
          插入并润色
        </button>
        <button data-testid="research-insert-package" onClick={() => selectedAsset && onInsertAsset(selectedAsset)} disabled={!selectedAsset} style={secondaryButtonStyle}>
          <ArrowRight size={13} />
          插入内容包
        </button>
        <button data-testid="research-generate-chapter" onClick={() => selectedAsset && onGenerateChapter(selectedAsset)} disabled={!selectedAsset} style={secondaryButtonStyle}>
          <FileText size={13} />
          生成章节
        </button>
        <button data-testid="research-open-details" onClick={onOpenDetails} style={secondaryButtonStyle}>
          <BarChart3 size={13} />
          独立研究页
        </button>
      </div>
    </aside>
  )
}

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, fontSize: 12, fontWeight: 800, color: 'var(--color-ink)' }}>
      {icon}
      {label}
    </div>
  )
}

function WaitNotice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'error' }) {
  return (
    <div style={{ marginBottom: 12, display: 'flex', gap: 7, padding: 10, borderRadius: 8, background: tone === 'error' ? '#FFF1EF' : '#FFF7E8', color: tone === 'error' ? '#A13B2D' : '#8A5A16', fontSize: 11, lineHeight: 1.6 }}>
      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{text}</span>
    </div>
  )
}

const drawerStyle = {
  width: 360,
  flexShrink: 0,
  borderLeft: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  display: 'flex',
  flexDirection: 'column' as const,
  boxShadow: 'var(--shadow-lg)',
  zIndex: 190,
}

const headerStyle = {
  height: 48,
  padding: '0 12px',
  borderBottom: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const iconButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--color-ink-3)',
  cursor: 'pointer',
  padding: 4,
}

const panelStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 12,
  background: 'var(--color-bg)',
  marginBottom: 12,
}

const statusCardStyle = (tone: 'idle' | 'wait' | 'ready' | 'done') => ({
  borderRadius: 8,
  padding: 10,
  border: '1px solid var(--color-border)',
  background: tone === 'done' ? '#EEF8EF' : tone === 'ready' ? 'var(--color-accent-light)' : tone === 'wait' ? '#FFF7E8' : 'var(--color-surface)',
  color: tone === 'wait' ? '#8A5A16' : 'var(--color-ink)',
})

const emptyStyle = {
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 8,
  padding: 11,
  color: 'var(--color-ink-3)',
  fontSize: 11,
  lineHeight: 1.65,
  background: 'var(--color-surface)',
}

const assetButtonStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 9,
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}

const pillStyle = {
  flexShrink: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '2px 6px',
  fontSize: 10,
  color: 'var(--color-accent)',
  background: 'var(--color-surface)',
}

const footerStyle = {
  borderTop: '1px solid var(--color-border)',
  padding: 12,
  display: 'grid',
  gap: 8,
}

const primaryButtonStyle = (enabled: boolean) => ({
  width: '100%',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  padding: '8px 12px',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
  background: enabled ? 'var(--color-accent)' : 'var(--color-border)',
  cursor: enabled ? 'pointer' : 'not-allowed',
})

const secondaryButtonStyle = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-ink-2)',
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
}

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 9,
  resize: 'vertical' as const,
  minHeight: 86,
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-sans)',
  background: 'var(--color-surface)',
}

const uploadStyle = {
  marginTop: 8,
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  color: 'var(--color-accent)',
  fontSize: 12,
  cursor: 'pointer',
  background: 'var(--color-surface)',
}

const primaryActionStyle = (disabled: boolean) => ({
  marginTop: 10,
  width: '100%',
  border: 'none',
  borderRadius: 6,
  background: disabled ? 'var(--color-border)' : 'var(--color-accent)',
  color: '#fff',
  padding: '8px 12px',
  fontSize: 12,
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--font-sans)',
})

const smallTextStyle = {
  fontSize: 12,
  lineHeight: 1.75,
  color: 'var(--color-ink-2)',
}

const planStyle = {
  margin: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 10,
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  lineHeight: 1.65,
  color: 'var(--color-ink-2)',
  background: 'var(--color-surface)',
}

const variableRowStyle = {
  display: 'grid',
  gridTemplateColumns: '70px 1fr 1fr 38px',
  gap: 6,
  alignItems: 'center',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '5px 6px',
  fontSize: 11,
  color: 'var(--color-ink-2)',
  background: 'var(--color-surface)',
}

const checkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: '1px solid var(--color-border)',
  borderRadius: 999,
  padding: '4px 7px',
  fontSize: 11,
  color: 'var(--color-ink-2)',
  background: 'var(--color-surface)',
}

const historyItemStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 9,
  background: 'var(--color-surface)',
}

const miniButtonStyle = {
  marginTop: 7,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--color-accent)',
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}
