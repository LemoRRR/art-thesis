import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Feather,
  Folder,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Shapes,
} from 'lucide-react'
import { projectStore } from '../lib/storage'

const NAV_ITEMS = [
  { label: '库', icon: BookOpen, path: '/library' },
  { label: '项目', icon: Folder, path: '/projects' },
  { label: '应用', icon: Shapes, path: '/projects' },
  { label: '更多', icon: MoreHorizontal, path: '/projects' },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const projects = projectStore.getAll()
  const activeProjectId = projectStore.getActiveId()

  const openConversation = (projectId: string) => {
    projectStore.setActiveId(projectId)
    navigate(`/projects/${projectId}/stage1`)
  }

  const startNewConversation = () => {
    const project = projectStore.add('未命名论文对话', '从一次材料理解对话开始的新项目')
    navigate(`/projects/${project.id}/stage1`)
  }

  return (
    <aside
      style={{
        width: 172,
        height: '100vh',
        flexShrink: 0,
        background: '#FAF9F5',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 14px 12px',
      }}
    >
      {/* Logo */}
      <button
        onClick={() => openConversation(activeProjectId)}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          cursor: 'pointer',
          marginBottom: 18,
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: 31,
            height: 31,
            borderRadius: 9,
            background: 'var(--color-accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Feather size={17} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 15,
              lineHeight: 1.1,
              fontWeight: 650,
              color: 'var(--color-accent)',
              letterSpacing: '0.01em',
            }}
          >
            论文助手
          </span>
          <span
            style={{
              display: 'inline-flex',
              marginTop: 4,
              fontSize: 9,
              lineHeight: 1,
              color: '#fff',
              background: 'var(--color-accent)',
              borderRadius: 4,
              padding: '2px 6px',
              fontWeight: 500,
            }}
          >
            Demo
          </span>
        </span>
      </button>

      {/* New chat */}
      <button
        onClick={startNewConversation}
        style={{
          height: 30,
          border: '1px solid var(--color-accent)',
          borderRadius: 4,
          background: 'var(--color-surface)',
          color: 'var(--color-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          marginBottom: 15,
        }}
      >
        <Plus size={14} />
        新对话
      </button>

      {/* Navigation */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {NAV_ITEMS.map(item => {
          const Icon = item.icon
          const active =
            (item.label === '库' && location.pathname.startsWith('/library')) ||
            (item.label === '项目' && location.pathname.startsWith('/projects'))

          return (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              style={{
                height: 30,
                border: 'none',
                borderRadius: 5,
                background: active ? 'var(--color-accent-light)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-ink-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 8px',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              <Icon size={14} strokeWidth={1.8} />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '15px 0 12px' }} />

      {/* Recent */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-ink-2)',
            marginBottom: 8,
            fontWeight: 500,
          }}
        >
          最近
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {projects.slice(0, 6).map((project) => (
            <button
              key={project.id}
              onClick={() => {
                openConversation(project.id)
              }}
              style={{
                border: 'none',
                borderRadius: 5,
                background: project.id === activeProjectId ? 'var(--color-accent-light)' : 'transparent',
                color: project.id === activeProjectId ? 'var(--color-accent)' : 'var(--color-ink-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 7px',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <MessageSquare size={12} strokeWidth={1.8} style={{ flexShrink: 0 }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {project.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* User */}
      <button
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: 'var(--color-surface)',
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#D7E4DF',
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 650,
            flexShrink: 0,
          }}
        >
          RR
        </span>
        <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--color-ink)', fontWeight: 500 }}>
            Ruby Ren
          </span>
          <span style={{ display: 'block', fontSize: 9, color: 'var(--color-ink-3)' }}>
            个人账户
          </span>
        </span>
        <ChevronDown size={12} color="var(--color-ink-3)" />
      </button>
    </aside>
  )
}
