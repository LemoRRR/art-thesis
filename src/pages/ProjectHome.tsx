import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, AtSign, BookOpen, CheckCircle2, FlaskConical, Pencil, Sparkles } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import {
  libraryStore,
  projectStore,
  sectionStore,
  type Project,
  type WorkflowStage,
} from '../lib/storage'

const STAGES: Array<{ id: WorkflowStage; label: string; desc: string; route: string }> = [
  { id: 'stage1', label: '1 材料理解', desc: '确认研究对象、写作边界、学段与资料范围', route: 'stage1' },
  { id: 'stage2', label: '2 大纲撰写', desc: '生成论文大纲、按意见调整章节结构', route: 'stage2' },
  { id: 'stage3', label: '3 文章生成', desc: '按确认大纲生成全文、修改正文并导出', route: 'stage3' },
]

export default function ProjectHome() {
  const params = useParams()
  const navigate = useNavigate()
  const initialProject = projectStore.ensure(params.projectId)
  const [project, setProject] = useState<Project>(initialProject)
  const [editing, setEditing] = useState(false)
  const libraryItems = libraryStore.getAll()
  const sections = sectionStore.getByProject(project.id)
  const hasDraftContent = sections.some(section => section.status === 'done' && section.content.replace(/\s/g, '').length > 80)

  const updateProject = (patch: Partial<Project>) => {
    projectStore.update(project.id, patch)
    setProject(projectStore.ensure(project.id))
  }

  const goStage = (stage: WorkflowStage, route: string) => {
    updateProject({ currentStage: stage })
    navigate(`/projects/${project.id}/${route}`)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--color-bg)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <header
          style={{
            height: 52,
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 22px',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-ink)' }}>{project.title}</div>
            <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>Project 工作区 · 可随时引用资料库和项目内容</div>
          </div>
          <button
            onClick={() => setEditing(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: editing ? 'var(--color-accent-light)' : 'transparent',
              color: editing ? 'var(--color-accent)' : 'var(--color-ink-2)',
              padding: '6px 11px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Pencil size={13} />
            编辑项目
          </button>
        </header>

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: 28, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 20 }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: 20,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h1 style={{ margin: '0 0 12px', fontSize: 20, color: 'var(--color-ink)' }}>{project.title}</h1>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    value={project.title}
                    onChange={event => updateProject({ title: event.target.value })}
                    style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 9, fontFamily: 'var(--font-sans)' }}
                  />
                  <textarea
                    value={project.description}
                    onChange={event => updateProject({ description: event.target.value })}
                    rows={3}
                    placeholder="描述这个项目的研究对象、课程任务或交付要求"
                    style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 9, fontFamily: 'var(--font-sans)', resize: 'vertical' }}
                  />
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.8, color: 'var(--color-ink-2)' }}>
                  {project.description || '这个项目还没有说明。可以在这里补充论文主题、课程要求、研究对象和交付边界。'}
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {STAGES.map(stage => (
                <button
                  key={stage.id}
                  onClick={() => goStage(stage.id, stage.route)}
                  style={{
                    border: `1.5px solid ${project.currentStage === stage.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-lg)',
                    background: project.currentStage === stage.id ? 'var(--color-accent-light)' : 'var(--color-surface)',
                    padding: 16,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    minHeight: 140,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 650, color: 'var(--color-ink)', marginBottom: 8 }}>
                      {project.currentStage === stage.id ? <Sparkles size={15} color="var(--color-accent)" /> : <CheckCircle2 size={15} color="var(--color-ink-3)" />}
                      {stage.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 12, lineHeight: 1.65, color: 'var(--color-ink-3)' }}>{stage.desc}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-accent)' }}>
                    进入阶段
                    <ArrowRight size={12} />
                  </span>
                </button>
              ))}
              <button
                data-testid="project-research-entry"
                onClick={() => navigate(`/projects/${project.id}/${hasDraftContent ? 'research' : 'stage3'}`)}
                style={{
                  border: '1.5px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-surface)',
                  padding: 16,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  minHeight: 140,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 650, color: 'var(--color-ink)', marginBottom: 8 }}>
                    <FlaskConical size={15} color="var(--color-accent)" />
                    4 研究计算
                  </span>
                  <span style={{ display: 'block', fontSize: 12, lineHeight: 1.65, color: 'var(--color-ink-3)' }}>
                    {hasDraftContent
                      ? '生成研究工具、上传数据、运行分析，并把结果写入论文对应章节'
                      : '请先进入文章生成，生成或确认全文初稿后再做研究计算'}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-accent)' }}>
                  {hasDraftContent ? '进入模块' : '先生成全文'}
                  <ArrowRight size={12} />
                </span>
              </button>
            </div>

            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: 18,
              }}
            >
              <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--color-ink)' }}>最近文档</h2>
              {sections.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>还没有章节，进入阶段二开始生成。</div>
              ) : (
                sections.slice(0, 5).map(section => (
                  <div key={section.id} style={{ padding: '9px 0', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)' }}>{section.title}</div>
                    <div style={{ marginTop: 3, fontSize: 11, color: 'var(--color-ink-3)' }}>{section.content.slice(0, 80) || '暂无内容'}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <aside
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 18,
              boxShadow: 'var(--shadow-sm)',
              alignSelf: 'start',
            }}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--color-ink)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <BookOpen size={15} />
              资料库调用
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.7 }}>
              资料库是全局数据库，不会默认进入本项目。需要时在阶段输入框输入 @，搜索并选择资料维度后，AI 才会读取对应内容。
            </p>

            {libraryItems.length === 0 ? (
              <button
                onClick={() => navigate('/library')}
                style={{
                  width: '100%',
                  border: '1px dashed var(--color-border-strong)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  padding: 18,
                  color: 'var(--color-ink-3)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                先去库里上传资料
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {libraryItems.slice(0, 5).map(item => (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'transparent',
                      padding: 10,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 500, color: 'var(--color-ink)' }}>
                      <AtSign size={12} />
                      @{item.title}
                    </span>
                    <span style={{ display: 'block', marginTop: 4, fontSize: 10, color: 'var(--color-ink-3)' }}>
                      在阶段输入框中调用 · {item.type.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {libraryItems.length > 5 && (
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--color-ink-3)' }}>
                还有 {libraryItems.length - 5} 条资料，可在输入框通过 @ 搜索调用。
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  )
}
