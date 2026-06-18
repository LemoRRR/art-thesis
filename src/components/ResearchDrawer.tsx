import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, ArrowRight, BarChart3, CheckCircle2, ClipboardList, FileText, FlaskConical, Upload, X } from 'lucide-react'
import {
  projectStore,
  researchAssetStore,
  researchTaskStore,
  type ResearchAsset,
  type ResearchAssetType,
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

const taskStatusLabels: Record<ResearchTaskStatus, { label: string; tone: 'idle' | 'wait' | 'ready' | 'done'; hint: string }> = {
  route_planned: { label: '研究路线已规划', tone: 'idle', hint: '可以继续生成问卷、量表或上传已有材料。' },
  scale_drafting: { label: '研究工具草稿中', tone: 'idle', hint: '草稿不会自动进入正文，确认后才会被 Stage3 调用。' },
  scale_confirmed: { label: '量表已确认', tone: 'ready', hint: '可以写研究方法、变量测量和问卷设计。' },
  survey_ready: { label: '问卷可发放', tone: 'ready', hint: '可以导出问卷星格式或数据模板，之后等待回收数据。' },
  collecting_data: { label: '等待数据回收', tone: 'wait', hint: '可以写研究方法，但不能生成统计结果。' },
  data_uploaded: { label: '数据已上传', tone: 'ready', hint: '下一步应校验数据并运行分析。' },
  data_validated: { label: '数据已校验', tone: 'ready', hint: '可以运行统计、KANO、AHP 或编码分析。' },
  analysis_done: { label: '分析已完成', tone: 'done', hint: '可以写入第四章、讨论和结论。' },
  chapter_text_ready: { label: '结果文字已生成', tone: 'done', hint: '可以插入当前章节或进入详情继续编辑。' },
  inserted_into_paper: { label: '已写入论文', tone: 'done', hint: '可以继续润色，或在研究空间查看来源版本。' },
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
  if (/方法|设计|问卷|变量|测量|研究对象|资料收集/.test(title)) {
    return '当前章节适合插入研究方法、问卷设计、变量测量或访谈方案。'
  }
  if (/数据|分析|结果|第四章|KANO|AHP|编码|信度|效度|回归|相关/.test(title)) {
    return '当前章节适合插入样本统计、分析结果、编码结果或设计评价结论。'
  }
  if (/讨论|结论|建议|优化/.test(title)) {
    return '当前章节适合插入主要发现、优先级排序和研究建议。'
  }
  return '当前章节可引用已确认研究资产；如果要写结果章节，请先确认数据已完成分析。'
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
  const project = projectStore.ensure(projectId)
  const tasks = researchTaskStore.getByProject(projectId)
  const assets = researchAssetStore.getByProject(projectId)
  const primaryTask = getPrimaryTask(tasks)
  const insertableAssets = useMemo(() => assets.filter(isInsertable), [assets])
  const selectedAsset = insertableAssets.find(asset => asset.id === selectedAssetId) ?? insertableAssets[0] ?? null
  const status = primaryTask ? taskStatusLabels[primaryTask.status] : null

  useEffect(() => {
    if (!open) return
    if (!selectedAssetId && insertableAssets[0]) {
      setSelectedAssetId(insertableAssets[0].id)
    }
  }, [insertableAssets, open, selectedAssetId])

  if (!open) return null

  return (
    <aside style={drawerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 800, color: 'var(--color-ink)' }}>
            <FlaskConical size={14} />
            研究任务
          </div>
          <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-ink-3)' }}>{project.title}</div>
        </div>
        <button onClick={onClose} style={iconButtonStyle} title="关闭研究抽屉">
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <section style={panelStyle}>
          <SectionTitle icon={<CheckCircle2 size={13} />} label="当前状态" />
          {status && primaryTask ? (
            <div style={statusCardStyle(status.tone)}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{status.label}</div>
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.6 }}>{primaryTask.title}</div>
              <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.6, color: 'var(--color-ink-3)' }}>{status.hint}</div>
            </div>
          ) : (
            <div style={emptyStyle}>
              还没有研究任务。可以进入研究空间，根据当前论文生成问卷/量表，或直接上传已有数据。
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <SectionTitle icon={<FileText size={13} />} label="当前章节可做" />
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-ink-2)' }}>
            {getChapterAction(activeSectionTitle)}
          </div>
          {primaryTask?.status === 'collecting_data' && (
            <WaitNotice text="当前正在等待数据回收。可以写研究方法和问卷设计，但不要生成统计结论。" />
          )}
          {(primaryTask?.status === 'route_planned' || !primaryTask) && (
            <WaitNotice text="研究路线或研究资产还不完整。写到方法/结果章节时，建议先进入研究空间确认。" />
          )}
        </section>

        <section style={panelStyle}>
          <SectionTitle icon={<ClipboardList size={13} />} label="可用研究资产" />
          {insertableAssets.length === 0 ? (
            <div style={emptyStyle}>暂无可插入资产。问卷、分析结果或编码结果确认后会显示在这里。</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {insertableAssets.slice(0, 8).map(asset => (
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
      </div>

      <div style={footerStyle}>
        <button
          onClick={() => selectedAsset && onUseAsReference(selectedAsset)}
          disabled={!selectedAsset}
          style={{
            ...secondaryButtonStyle,
            cursor: selectedAsset ? 'pointer' : 'not-allowed',
          }}
        >
          <ClipboardList size={13} />
          作为参考
        </button>
        <button
          onClick={() => selectedAsset && onGenerateChapter(selectedAsset)}
          disabled={!selectedAsset}
          style={{
            ...secondaryButtonStyle,
            cursor: selectedAsset ? 'pointer' : 'not-allowed',
          }}
        >
          <FileText size={13} />
          生成章节
        </button>
        <button
          onClick={() => selectedAsset && onInsertAndPolish(selectedAsset)}
          disabled={!selectedAsset}
          style={{
            ...primaryButtonStyle,
            background: selectedAsset ? 'var(--color-accent)' : 'var(--color-border)',
            cursor: selectedAsset ? 'pointer' : 'not-allowed',
          }}
        >
          <ArrowRight size={13} />
          插入并润色
        </button>
        <button
          onClick={() => selectedAsset && onInsertAsset(selectedAsset)}
          disabled={!selectedAsset}
          style={{
            ...secondaryButtonStyle,
            cursor: selectedAsset ? 'pointer' : 'not-allowed',
          }}
        >
          <ArrowRight size={13} />
          插入原文
        </button>
        <button onClick={onOpenDetails} style={secondaryButtonStyle}>
          <BarChart3 size={13} />
          查看详情
        </button>
        <button onClick={onOpenDetails} style={secondaryButtonStyle}>
          <Upload size={13} />
          上传/分析
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

function WaitNotice({ text }: { text: string }) {
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 7, padding: 10, borderRadius: 8, background: '#FFF7E8', color: '#8A5A16', fontSize: 11, lineHeight: 1.6 }}>
      <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{text}</span>
    </div>
  )
}

const drawerStyle = {
  width: 320,
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
  padding: 11,
  border: '1px solid var(--color-border)',
  background: tone === 'done'
    ? '#EEF8EF'
    : tone === 'ready'
      ? 'var(--color-accent-light)'
      : tone === 'wait'
        ? '#FFF7E8'
        : 'var(--color-surface)',
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

const primaryButtonStyle = {
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
}

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
