import { useMemo } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, Database, FileSpreadsheet, FolderOpen, Layers3, PenLine, PieChart, Search } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import {
  projectStore,
  researchAssetStore,
  researchPackageStore,
  researchTaskStore,
  type Project,
  type ResearchAsset,
  type ResearchContentPackage,
  type ResearchPackageComponentType,
} from '../lib/storage'

type ProjectResearchFolder = {
  project: Project
  assets: ResearchAsset[]
  packages: ResearchContentPackage[]
  tasks: ReturnType<typeof researchTaskStore.getAll>
  updatedAt: number
  figures: number
  tables: number
  insertedComponents: number
}

const assetTypeLabels: Record<ResearchAsset['type'], string> = {
  research_design: '研究设计',
  scale_schema: '量表',
  survey_questionnaire: '问卷',
  questionnaire_review: '问卷检查',
  hypothesis_model: '模型假设',
  quant_dataset: '数据集',
  quant_analysis_result: '定量结果',
  kano_result: 'KANO结果',
  ahp_result: 'AHP结果',
  qualitative_coding: '质性编码',
  chapter_text: '论文文本',
}

const assetTypeTone: Record<ResearchAsset['type'], string> = {
  research_design: '#6C63FF',
  scale_schema: '#3F7CFF',
  survey_questionnaire: '#268F6C',
  questionnaire_review: '#7A6A2A',
  hypothesis_model: '#7E57C2',
  quant_dataset: '#00838F',
  quant_analysis_result: '#0B6E4F',
  kano_result: '#B15C00',
  ahp_result: '#9B4D96',
  qualitative_coding: '#5D6D7E',
  chapter_text: '#6D4C41',
}

const componentLabels: Record<ResearchPackageComponentType, string> = {
  figure: '图',
  statistics: '统计表',
  analysis: '分析段',
  method: '方法段',
  table: '表',
  raw_text: '原文',
}

function formatTime(timestamp: number) {
  if (!timestamp) return '暂无'
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function assetStatusLabel(asset: ResearchAsset) {
  if (asset.status === 'used_in_paper' || (asset.linkedSectionIds?.length ?? 0) > 0) return '已写入'
  if (asset.status === 'confirmed') return '已确认'
  if (asset.status === 'archived') return '已归档'
  return '草稿'
}

function assetSummary(asset: ResearchAsset) {
  return asset.summary || asset.plainText.slice(0, 80) || '暂无说明'
}

function folderStats(folder: ProjectResearchFolder) {
  const questionnaires = folder.assets.filter(asset => asset.type === 'survey_questionnaire' || asset.type === 'scale_schema').length
  const datasets = folder.assets.filter(asset => asset.type === 'quant_dataset').length
  const analyses = folder.assets.filter(asset => (
    asset.type === 'quant_analysis_result'
    || asset.type === 'kano_result'
    || asset.type === 'ahp_result'
    || asset.type === 'qualitative_coding'
  )).length
  return [
    { label: '问卷/量表', value: questionnaires, icon: PenLine },
    { label: '数据集', value: datasets, icon: Database },
    { label: '分析包', value: analyses + folder.packages.length, icon: Layers3 },
    { label: '图表组件', value: folder.figures + folder.tables, icon: BarChart3 },
  ]
}

function packageComponentSummary(pkg: ResearchContentPackage) {
  const counts = pkg.components.reduce<Record<string, number>>((acc, component) => {
    acc[component.type] = (acc[component.type] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([type, count]) => `${componentLabels[type as ResearchPackageComponentType] ?? type} ${count}`)
    .join(' / ') || '暂无组件'
}

export default function ResearchHub() {
  const navigate = useNavigate()
  const folders = useMemo<ProjectResearchFolder[]>(() => {
    const projects = projectStore.getAll()
    const assets = researchAssetStore.getAll()
    const packages = researchPackageStore.getAll()
    const tasks = researchTaskStore.getAll()

    return projects
      .map(project => {
        const projectAssets = assets.filter(asset => asset.projectId === project.id)
        const projectPackages = packages.filter(pkg => pkg.projectId === project.id)
        const projectTasks = tasks.filter(task => task.projectId === project.id)
        const updatedAt = Math.max(
          project.updatedAt ?? 0,
          ...projectAssets.map(asset => asset.updatedAt),
          ...projectPackages.map(pkg => pkg.updatedAt),
          ...projectTasks.map(task => task.updatedAt),
        )
        const figures = projectPackages.reduce((sum, pkg) => sum + pkg.components.filter(component => component.type === 'figure').length, 0)
        const tables = projectPackages.reduce((sum, pkg) => sum + pkg.components.filter(component => component.type === 'table' || component.type === 'statistics').length, 0)
        const insertedComponents = projectPackages.reduce((sum, pkg) => sum + pkg.insertedComponentIds.length, 0)
        return {
          project,
          assets: projectAssets.sort((a, b) => b.updatedAt - a.updatedAt),
          packages: projectPackages.sort((a, b) => b.updatedAt - a.updatedAt),
          tasks: projectTasks,
          updatedAt,
          figures,
          tables,
          insertedComponents,
        }
      })
      .filter(folder => folder.assets.length > 0 || folder.packages.length > 0 || folder.tasks.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [])

  const totalAssets = folders.reduce((sum, folder) => sum + folder.assets.length, 0)
  const totalPackages = folders.reduce((sum, folder) => sum + folder.packages.length, 0)
  const totalFigures = folders.reduce((sum, folder) => sum + folder.figures + folder.tables, 0)
  const latestAssets = folders.flatMap(folder => folder.assets.map(asset => ({ asset, project: folder.project }))).sort((a, b) => b.asset.updatedAt - a.asset.updatedAt).slice(0, 8)

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={heroStyle}>
            <div>
              <div style={eyebrowStyle}>研究资产中心</div>
              <h1 style={{ margin: '6px 0 8px', fontSize: 24, color: 'var(--color-ink)' }}>按论文沉淀问卷、数据、图表和分析结果</h1>
              <p style={{ margin: 0, maxWidth: 760, fontSize: 13, lineHeight: 1.8, color: 'var(--color-ink-2)' }}>
                这里是全局资料库。每篇论文是一个文件夹，里面可以有多个问卷、多个 Excel、多个分析包和多个图表；点击文件夹进入该论文的研究计算流程，点击具体资产查看来源和写入状态。
              </p>
            </div>
            <button onClick={() => navigate('/projects')} style={primaryButtonStyle}>
              查看论文项目
              <ArrowRight size={14} />
            </button>
          </section>

          <section style={summaryGridStyle}>
            <SummaryCard label="论文文件夹" value={folders.length} icon={<FolderOpen size={17} />} />
            <SummaryCard label="研究资产" value={totalAssets} icon={<FileSpreadsheet size={17} />} />
            <SummaryCard label="结果包" value={totalPackages} icon={<Layers3 size={17} />} />
            <SummaryCard label="图表/表格" value={totalFigures} icon={<PieChart size={17} />} />
          </section>

          {folders.length === 0 ? (
            <section style={emptyStyle}>
              <Search size={24} />
              <h2 style={{ margin: '12px 0 8px', fontSize: 18 }}>还没有研究资产</h2>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: 'var(--color-ink-3)' }}>
                进入某篇论文的研究计算流程后，生成的问卷、上传的数据、分析结果和图表会自动沉淀到这里。
              </p>
            </section>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 360px', gap: 16, alignItems: 'start' }}>
              <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {folders.map(folder => (
                  <article key={folder.project.id} style={folderStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FolderOpen size={18} color="var(--color-accent)" />
                          <h2 style={{ margin: 0, fontSize: 17, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {folder.project.title}
                          </h2>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-ink-3)' }}>
                          最近更新 {formatTime(folder.updatedAt)} · 已写入组件 {folder.insertedComponents}
                        </div>
                      </div>
                      <button onClick={() => navigate(`/projects/${folder.project.id}/research`)} style={secondaryButtonStyle}>
                        进入流程
                        <ArrowRight size={13} />
                      </button>
                    </div>

                    <div style={statRowStyle}>
                      {folderStats(folder).map(stat => {
                        const Icon = stat.icon
                        return (
                          <div key={stat.label} style={statPillStyle}>
                            <Icon size={14} />
                            <span>{stat.label}</span>
                            <strong>{stat.value}</strong>
                          </div>
                        )
                      })}
                    </div>

                    <div style={assetListStyle}>
                      {folder.assets.slice(0, 4).map(asset => (
                        <button
                          key={asset.id}
                          onClick={() => navigate(`/projects/${folder.project.id}/research/assets?asset=${encodeURIComponent(asset.id)}`)}
                          style={assetRowStyle}
                        >
                          <span style={{ ...assetDotStyle, background: assetTypeTone[asset.type] }} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <strong style={{ fontSize: 13, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.title}</strong>
                              <span style={badgeStyle}>{assetTypeLabels[asset.type]}</span>
                              <span style={softBadgeStyle}>{assetStatusLabel(asset)}</span>
                            </span>
                            <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {assetSummary(asset)}
                            </span>
                          </span>
                          <ArrowRight size={13} color="var(--color-ink-3)" />
                        </button>
                      ))}
                      {folder.assets.length === 0 && (
                        <div style={mutedBoxStyle}>暂无独立资产，进入流程后可生成问卷或上传数据。</div>
                      )}
                    </div>

                    {folder.packages.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {folder.packages.slice(0, 3).map(pkg => (
                          <button
                            key={pkg.id}
                            onClick={() => navigate(`/projects/${folder.project.id}/research/assets?package=${encodeURIComponent(pkg.id)}`)}
                            style={packageRowStyle}
                          >
                            <Layers3 size={13} color="var(--color-accent)" />
                            <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg.title}</span>
                            <span style={{ color: 'var(--color-ink-3)' }}>{packageComponentSummary(pkg)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </section>

              <aside style={sidePanelStyle}>
                <div style={{ fontSize: 14, fontWeight: 850, color: 'var(--color-ink)', marginBottom: 10 }}>最近资产</div>
                {latestAssets.length === 0 ? (
                  <div style={mutedBoxStyle}>暂无资产。</div>
                ) : latestAssets.map(({ asset, project }) => (
                  <button
                    key={asset.id}
                    onClick={() => navigate(`/projects/${project.id}/research/assets?asset=${encodeURIComponent(asset.id)}`)}
                    style={recentAssetStyle}
                  >
                    <span style={{ ...assetDotStyle, background: assetTypeTone[asset.type] }} />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 12, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.title}</strong>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--color-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.title}</span>
                    </span>
                  </button>
                ))}
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div style={summaryCardStyle}>
      <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
      <span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-ink-3)' }}>{label}</span>
        <strong style={{ display: 'block', marginTop: 3, fontSize: 20, color: 'var(--color-ink)' }}>{value}</strong>
      </span>
    </div>
  )
}

const heroStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 20,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  alignItems: 'center',
  boxShadow: 'var(--shadow-sm)',
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-accent)',
  fontWeight: 850,
  letterSpacing: '0.06em',
}

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--color-accent)',
  background: 'var(--color-accent)',
  color: '#fff',
  borderRadius: 6,
  padding: '9px 13px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-ink-2)',
  borderRadius: 6,
  padding: '8px 11px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 750,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 12,
}

const summaryCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 14,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const folderStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 16,
  boxShadow: 'var(--shadow-sm)',
}

const statRowStyle: React.CSSProperties = {
  marginTop: 14,
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 8,
}

const statPillStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-bg)',
  padding: '8px 9px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--color-ink-3)',
}

const assetListStyle: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
}

const assetRowStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 7,
  background: '#fff',
  padding: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontFamily: 'var(--font-sans)',
  textAlign: 'left',
  cursor: 'pointer',
}

const packageRowStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px dashed var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-bg)',
  padding: '8px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
  color: 'var(--color-ink-2)',
  textAlign: 'left',
  cursor: 'pointer',
}

const assetDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
}

const badgeStyle: React.CSSProperties = {
  borderRadius: 999,
  background: 'var(--color-accent-light)',
  color: 'var(--color-accent)',
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 850,
  flexShrink: 0,
}

const softBadgeStyle: React.CSSProperties = {
  borderRadius: 999,
  background: 'var(--color-bg)',
  color: 'var(--color-ink-3)',
  padding: '2px 7px',
  fontSize: 10,
  fontWeight: 750,
  flexShrink: 0,
}

const sidePanelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 14,
  position: 'sticky',
  top: 18,
}

const recentAssetStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderTop: '1px solid var(--color-border)',
  background: 'transparent',
  padding: '10px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
}

const mutedBoxStyle: React.CSSProperties = {
  border: '1px dashed var(--color-border)',
  borderRadius: 7,
  background: 'var(--color-bg)',
  padding: 12,
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--color-ink-3)',
}

const emptyStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 8,
  padding: 32,
  textAlign: 'center',
  color: 'var(--color-ink-3)',
}
