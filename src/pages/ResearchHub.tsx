import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  FolderOpen,
  Layers3,
  PenLine,
  PieChart,
  Search,
} from 'lucide-react'
import Sidebar from '../components/Sidebar'
import {
  projectStore,
  researchAssetStore,
  researchPackageStore,
  researchTaskStore,
  type Project,
  type ResearchAsset,
  type ResearchContentPackage,
} from '../lib/storage'

type AssetFilter = 'all' | ResearchAsset['type']
type StatusFilter = 'all' | ResearchAsset['status'] | 'has_inserted'

type ProjectResearchFolder = {
  project: Project
  assets: ResearchAsset[]
  packages: ResearchContentPackage[]
  tasks: ReturnType<typeof researchTaskStore.getAll>
  updatedAt: number
  questionnaires: number
  datasets: number
  analyses: number
  figures: number
  tables: number
  insertedComponents: number
}

const PAGE_SIZE = 6

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

const filterOptions: Array<{ value: AssetFilter; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'survey_questionnaire', label: '问卷' },
  { value: 'scale_schema', label: '量表' },
  { value: 'quant_dataset', label: '数据集' },
  { value: 'quant_analysis_result', label: '定量结果' },
  { value: 'kano_result', label: 'KANO' },
  { value: 'ahp_result', label: 'AHP' },
  { value: 'qualitative_coding', label: '质性编码' },
]

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'confirmed', label: '已确认' },
  { value: 'used_in_paper', label: '已写入' },
  { value: 'has_inserted', label: '有图表写入' },
  { value: 'archived', label: '已归档' },
]

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

function buildFolder(project: Project, assets: ResearchAsset[], packages: ResearchContentPackage[], tasks: ReturnType<typeof researchTaskStore.getAll>): ProjectResearchFolder {
  const projectAssets = assets.filter(asset => asset.projectId === project.id)
  const projectPackages = packages.filter(pkg => pkg.projectId === project.id)
  const projectTasks = tasks.filter(task => task.projectId === project.id)
  const updatedAt = Math.max(
    project.updatedAt ?? 0,
    ...projectAssets.map(asset => asset.updatedAt),
    ...projectPackages.map(pkg => pkg.updatedAt),
    ...projectTasks.map(task => task.updatedAt),
  )
  const questionnaires = projectAssets.filter(asset => asset.type === 'survey_questionnaire' || asset.type === 'scale_schema').length
  const datasets = projectAssets.filter(asset => asset.type === 'quant_dataset').length
  const analyses = projectAssets.filter(asset => (
    asset.type === 'quant_analysis_result'
    || asset.type === 'kano_result'
    || asset.type === 'ahp_result'
    || asset.type === 'qualitative_coding'
  )).length
  const figures = projectPackages.reduce((sum, pkg) => sum + pkg.components.filter(component => component.type === 'figure').length, 0)
  const tables = projectPackages.reduce((sum, pkg) => sum + pkg.components.filter(component => component.type === 'table' || component.type === 'statistics').length, 0)
  const insertedComponents = projectPackages.reduce((sum, pkg) => sum + pkg.insertedComponentIds.length, 0)

  return {
    project,
    assets: projectAssets.sort((a, b) => b.updatedAt - a.updatedAt),
    packages: projectPackages.sort((a, b) => b.updatedAt - a.updatedAt),
    tasks: projectTasks,
    updatedAt,
    questionnaires,
    datasets,
    analyses,
    figures,
    tables,
    insertedComponents,
  }
}

function matchesFolder(folder: ProjectResearchFolder, query: string, assetType: AssetFilter, status: StatusFilter) {
  const normalizedQuery = query.trim().toLowerCase()
  const searchable = [
    folder.project.title,
    folder.project.description,
    folder.project.context.researchObject,
    ...folder.assets.flatMap(asset => [asset.title, asset.summary, asset.plainText.slice(0, 180)]),
    ...folder.packages.map(pkg => pkg.title),
  ].join('\n').toLowerCase()

  const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery)
  const matchesType = assetType === 'all' || folder.assets.some(asset => asset.type === assetType)
  const matchesStatus = status === 'all'
    || (status === 'has_inserted'
      ? folder.insertedComponents > 0 || folder.assets.some(asset => (asset.linkedSectionIds?.length ?? 0) > 0)
      : folder.assets.some(asset => asset.status === status))

  return matchesQuery && matchesType && matchesStatus
}

export default function ResearchHub() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [assetType, setAssetType] = useState<AssetFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  const folders = useMemo<ProjectResearchFolder[]>(() => {
    const projects = projectStore.getAll()
    const assets = researchAssetStore.getAll()
    const packages = researchPackageStore.getAll()
    const tasks = researchTaskStore.getAll()

    return projects
      .map(project => buildFolder(project, assets, packages, tasks))
      .filter(folder => folder.assets.length > 0 || folder.packages.length > 0 || folder.tasks.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [])

  const filteredFolders = useMemo(
    () => folders.filter(folder => matchesFolder(folder, query, assetType, status)),
    [assetType, folders, query, status],
  )
  const pageCount = Math.max(1, Math.ceil(filteredFolders.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleFolders = filteredFolders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query, assetType, status])

  const totalAssets = folders.reduce((sum, folder) => sum + folder.assets.length, 0)
  const totalPackages = folders.reduce((sum, folder) => sum + folder.packages.length, 0)
  const totalFigures = folders.reduce((sum, folder) => sum + folder.figures + folder.tables, 0)
  const latestAssets = folders
    .flatMap(folder => folder.assets.map(asset => ({ asset, project: folder.project })))
    .sort((a, b) => b.asset.updatedAt - a.asset.updatedAt)
    .slice(0, 6)

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section style={heroStyle}>
            <div>
              <div style={eyebrowStyle}>研究资产中心</div>
              <h1 style={{ margin: '6px 0 8px', fontSize: 24, color: 'var(--color-ink)' }}>按论文沉淀问卷、数据、图表和分析结果</h1>
              <p style={{ margin: 0, maxWidth: 760, fontSize: 13, lineHeight: 1.8, color: 'var(--color-ink-2)' }}>
                每篇论文是一个文件夹。这里先展示关键数量和最近资产，进入文件夹后再查看问卷、Excel、分析包、图表和写入状态。
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

          <section style={filterPanelStyle}>
            <label style={searchBoxStyle}>
              <Search size={15} color="var(--color-ink-3)" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="搜索论文、问卷、数据或结果包"
                style={searchInputStyle}
              />
            </label>
            <select value={assetType} onChange={event => setAssetType(event.target.value as AssetFilter)} style={selectStyle}>
              {filterOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={status} onChange={event => setStatus(event.target.value as StatusFilter)} style={selectStyle}>
              {statusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              onClick={() => {
                setQuery('')
                setAssetType('all')
                setStatus('all')
              }}
              style={secondaryButtonStyle}
            >
              重置筛选
            </button>
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
            <div style={contentGridStyle}>
              <section style={folderColumnStyle}>
                {filteredFolders.length === 0 ? (
                  <div style={emptyStyle}>没有符合当前筛选条件的论文资产。</div>
                ) : (
                  <>
                    <div style={folderGridStyle}>
                      {visibleFolders.map(folder => (
                        <FolderCard
                          key={folder.project.id}
                          folder={folder}
                          onOpenAssets={() => navigate(`/projects/${folder.project.id}/research/assets`)}
                          onOpenWorkflow={() => navigate(`/projects/${folder.project.id}/research`)}
                        />
                      ))}
                    </div>
                    <Pagination
                      page={currentPage}
                      pageCount={pageCount}
                      total={filteredFolders.length}
                      onPrev={() => setPage(value => Math.max(1, value - 1))}
                      onNext={() => setPage(value => Math.min(pageCount, value + 1))}
                      onPage={setPage}
                    />
                  </>
                )}
              </section>

              <aside style={sidePanelStyle}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 850, color: 'var(--color-ink)' }}>最近资产</div>
                  <span style={softBadgeStyle}>{latestAssets.length}</span>
                </div>
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

function FolderCard({ folder, onOpenAssets, onOpenWorkflow }: { folder: ProjectResearchFolder; onOpenAssets: () => void; onOpenWorkflow: () => void }) {
  const latest = folder.assets.slice(0, 2)
  const stats = [
    { label: '问卷/量表', value: folder.questionnaires, icon: PenLine },
    { label: '数据集', value: folder.datasets, icon: Database },
    { label: '分析包', value: folder.analyses + folder.packages.length, icon: Layers3 },
    { label: '图表', value: folder.figures + folder.tables, icon: BarChart3 },
  ]

  return (
    <article style={folderCardStyle}>
      <button onClick={onOpenAssets} style={folderMainButtonStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderOpen size={18} color="var(--color-accent)" />
              <h2 style={{ margin: 0, fontSize: 15, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.project.title}</h2>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-ink-3)' }}>
              最近更新 {formatTime(folder.updatedAt)} · 已写入 {folder.insertedComponents}
            </div>
          </div>
          <ArrowRight size={14} color="var(--color-ink-3)" />
        </div>

        <div style={cardStatGridStyle}>
          {stats.map(stat => {
            const Icon = stat.icon
            return (
              <span key={stat.label} style={cardStatStyle}>
                <Icon size={13} />
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </span>
            )
          })}
        </div>

        <div style={previewListStyle}>
          {latest.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>暂无独立资产，进入流程后可生成问卷或上传数据。</span>
          ) : latest.map(asset => (
            <span key={asset.id} style={previewAssetStyle}>
              <span style={{ ...assetDotStyle, background: assetTypeTone[asset.type] }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.title}</span>
              <span style={miniBadgeStyle}>{assetTypeLabels[asset.type]}</span>
              <span style={softBadgeStyle}>{assetStatusLabel(asset)}</span>
            </span>
          ))}
          {folder.assets.length > latest.length && (
            <span style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>还有 {folder.assets.length - latest.length} 个资产，点击查看全部</span>
          )}
        </div>
      </button>

      <div style={cardActionRowStyle}>
        <button onClick={onOpenAssets} style={secondaryButtonStyle}>查看资产</button>
        <button onClick={onOpenWorkflow} style={primaryButtonStyle}>进入流程 <ArrowRight size={13} /></button>
      </div>
    </article>
  )
}

function Pagination({ page, pageCount, total, onPrev, onNext, onPage }: { page: number; pageCount: number; total: number; onPrev: () => void; onNext: () => void; onPage: (page: number) => void }) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
  return (
    <div style={paginationStyle}>
      <span style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
        共 {total} 个文件夹 · 第 {page} / {pageCount} 页
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onPrev} disabled={page <= 1} style={{ ...pageButtonStyle, opacity: page <= 1 ? 0.45 : 1 }}>
          <ChevronLeft size={14} />
        </button>
        {pages.map(item => (
          <button
            key={item}
            onClick={() => onPage(item)}
            style={{
              ...pageButtonStyle,
              background: item === page ? 'var(--color-accent)' : 'var(--color-surface)',
              color: item === page ? '#fff' : 'var(--color-ink-2)',
              borderColor: item === page ? 'var(--color-accent)' : 'var(--color-border)',
            }}
          >
            {item}
          </button>
        ))}
        <button onClick={onNext} disabled={page >= pageCount} style={{ ...pageButtonStyle, opacity: page >= pageCount ? 0.45 : 1 }}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

const heroStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 18,
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
  padding: '8px 11px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
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
  padding: '8px 10px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
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
  gap: 10,
}

const summaryCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 13,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const filterPanelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 12,
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) 160px 160px auto',
  gap: 10,
  alignItems: 'center',
}

const searchBoxStyle: React.CSSProperties = {
  height: 36,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
}

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  fontSize: 12,
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-sans)',
  background: 'transparent',
}

const selectStyle: React.CSSProperties = {
  height: 36,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: '#fff',
  padding: '0 10px',
  color: 'var(--color-ink-2)',
  fontSize: 12,
  fontFamily: 'var(--font-sans)',
}

const folderGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
}

const contentGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 14,
  alignItems: 'start',
}

const folderColumnStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingBottom: 8,
}

const folderCardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
  minHeight: 248,
  display: 'flex',
  flexDirection: 'column',
}

const folderMainButtonStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  border: 'none',
  background: 'transparent',
  padding: 16,
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
}

const cardStatGridStyle: React.CSSProperties = {
  marginTop: 12,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 7,
}

const cardStatStyle: React.CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-bg)',
  padding: '7px 8px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--color-ink-3)',
}

const previewListStyle: React.CSSProperties = {
  marginTop: 11,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const previewAssetStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: 'var(--color-ink-2)',
}

const cardActionRowStyle: React.CSSProperties = {
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  padding: 10,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
}

const assetDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  flexShrink: 0,
}

const miniBadgeStyle: React.CSSProperties = {
  borderRadius: 999,
  background: 'var(--color-accent-light)',
  color: 'var(--color-accent)',
  padding: '2px 6px',
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
  top: 14,
  alignSelf: 'start',
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
  padding: 30,
  textAlign: 'center',
  color: 'var(--color-ink-3)',
}

const paginationStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: '12px 14px',
  minHeight: 54,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  position: 'sticky',
  bottom: 12,
  zIndex: 5,
  boxShadow: 'var(--shadow-sm)',
}

const pageButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  background: 'var(--color-surface)',
  color: 'var(--color-ink-2)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
}
