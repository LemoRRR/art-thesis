import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Folder, Plus } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import { projectStore, sectionStore, type Project } from '../lib/storage'

export default function Projects() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>(() => projectStore.getAll())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const createProject = () => {
    const name = title.trim()
    if (!name) return
    const project = projectStore.add(name, description.trim())
    setProjects(projectStore.getAll())
    setTitle('')
    setDescription('')
    navigate(`/projects/${project.id}`)
  }

  const openProject = (project: Project) => {
    projectStore.setActiveId(project.id)
    navigate(`/projects/${project.id}`)
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
            <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-ink)' }}>项目</div>
            <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>像 Claude Project 一样管理论文上下文和阶段流</div>
          </div>
        </header>

        <div style={{ maxWidth: 980, margin: '0 auto', padding: 28 }}>
          <section
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 18,
              boxShadow: 'var(--shadow-sm)',
              marginBottom: 22,
            }}
          >
            <h1 style={{ margin: '0 0 12px', fontSize: 18, color: 'var(--color-ink)' }}>新建项目</h1>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 10 }}>
              <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="论文或课题名称"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 11px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                }}
              />
              <input
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="研究方向、课程、任务说明"
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 11px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                }}
              />
              <button
                onClick={createProject}
                disabled={!title.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: title.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                  color: '#fff',
                  padding: '0 14px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: title.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                <Plus size={14} />
                创建
              </button>
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {projects.map(project => {
              const completed = sectionStore.getByProject(project.id).filter(section => section.status === 'done').length
              const total = sectionStore.getByProject(project.id).length

              return (
                <button
                  key={project.id}
                  onClick={() => openProject(project)}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-surface)',
                    padding: 16,
                    textAlign: 'left',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        background: 'var(--color-accent-light)',
                        color: 'var(--color-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Folder size={15} />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-ink)' }}>{project.title}</span>
                  </div>
                  <p style={{ minHeight: 38, margin: 0, fontSize: 12, color: 'var(--color-ink-3)', lineHeight: 1.6 }}>
                    {project.description || '尚未填写项目说明'}
                  </p>
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-ink-3)' }}>
                    <span>{completed} / {total} 节完成</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-accent)' }}>
                      进入
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </button>
              )
            })}
          </section>
        </div>
      </main>
    </div>
  )
}
