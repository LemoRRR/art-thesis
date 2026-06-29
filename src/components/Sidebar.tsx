import { memo, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Feather,
  FlaskConical,
  Folder,
  LogIn,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Shapes,
  Trash2,
  Type,
} from 'lucide-react'
import { chatStore, projectStore, type ChatMessage } from '../lib/storage'
import { auth } from '../lib/auth'

const NAV_ITEMS = [
  { label: '资料库', icon: BookOpen, path: '/library' },
  { label: '风格档案', icon: Type, path: '/style-profiles' },
  { label: '项目', icon: Folder, path: '/projects' },
  { label: '应用', icon: Shapes, path: '/projects' },
  { label: '更多', icon: MoreHorizontal, path: '/projects' },
  { label: '研究计算', icon: FlaskConical, path: 'active-project-research' },
]

function getProjectDisplayTitle(project: ReturnType<typeof projectStore.getAll>[number]) {
  if (project.title && project.title !== '未命名论文' && project.title !== '未命名论文对话') {
    return project.title
  }
  return project.context.researchObject || project.context.rawSummary.split('\n')[0]?.replace(/^研究对象[:：]/, '') || project.title
}

const STAGE_LABELS = {
  stage1: '材料理解',
  stage2: '大纲撰写',
  stage3: '文章生成',
} as const

function createWelcomeMessage(projectId: string): ChatMessage {
  return {
    id: `welcome-${projectId}`,
    role: 'ai',
    content:
      '你好，我是你的论文写作助手。\n\n先把论文背景告诉我——可以直接粘贴题目、大纲或研究框架，也可以点左边的📎上传已有的论文原文（PDF 或 Word）。\n\n我不会学你的语言风格，只是理解研究方向和写作边界，为后续每一节的生成做准备。',
    timestamp: Date.now(),
    projectId,
    stage: 'stage1',
  }
}

function getUserLabel() {
  const user = auth.getUser()
  if (!user) return ''
  return user.user_metadata?.displayName
    || user.user_metadata?.display_name
    || user.user_metadata?.name
    || user.email
    || '已登录账户'
}

function getInitials(label: string) {
  const clean = label.trim()
  if (!clean) return '未'
  if (/^[A-Za-z]/.test(clean)) return clean.slice(0, 2).toUpperCase()
  return clean.slice(0, 1)
}

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const projects = projectStore.getAll()
  const draftSnapshots = projectStore.getDraftSnapshots()
  const recentProjects = useMemo(
    () => projects
      .filter(project => !projectStore.isEmptyDraft(project, draftSnapshots))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [draftSnapshots, projects]
  )
  const activeProjectId = projectStore.getActiveId()
  const [loggedIn, setLoggedIn] = useState(() => auth.isLoggedIn())
  const userLabel = getUserLabel()

  useEffect(() => {
    const keepActiveEmpty = location.pathname.startsWith(`/projects/${activeProjectId}`)
    projectStore.pruneEmptyDrafts(keepActiveEmpty ? activeProjectId : undefined)
  }, [activeProjectId, location.pathname])

  const openConversation = (projectId: string) => {
    projectStore.setActiveId(projectId)
    navigate(`/projects/${projectId}/stage1`)
  }

  const startNewConversation = () => {
    projectStore.pruneEmptyDrafts()
    const project = projectStore.add('未命名论文对话', '从一次材料理解对话开始的新项目')
    projectStore.resetWorkspace(project.id)
    chatStore.saveForProject(project.id, 'stage1', [createWelcomeMessage(project.id)])
    projectStore.setActiveId(project.id)
    navigate(`/projects/${project.id}/stage1`)
  }

  const deleteProject = (projectId: string) => {
    const project = projectStore.get(projectId)
    if (!project) return
    const title = getProjectDisplayTitle(project)
    if (!confirm(`确认删除「${title}」？相关对话、大纲和正文也会一起删除。`)) return

    projectStore.remove(projectId)
    const nextProject = projectStore.getAll()[0]
    if (projectId === activeProjectId) {
      if (nextProject) {
        navigate(`/projects/${nextProject.id}/stage1`)
      } else {
        const created = projectStore.add('未命名论文对话', '从一次材料理解对话开始的新项目')
        navigate(`/projects/${created.id}/stage1`)
      }
    }
  }

  const goLogin = () => {
    const redirect = `${location.pathname}${location.search}`
    navigate(`/login?redirect=${encodeURIComponent(redirect)}`)
  }

  const logout = async () => {
    if (!confirm('退出登录后仍可使用本地模式，但云端同步、云端解析和跨设备资料库会暂停。确认退出？')) return
    await auth.logout()
    setLoggedIn(false)
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
          const itemPath = item.path === 'active-project-research'
            ? '/research'
            : item.path
          const active =
            (item.label === '资料库' && location.pathname.startsWith('/library')) ||
            (item.label === '风格档案' && location.pathname.startsWith('/style-profiles')) ||
            (item.label === '研究计算' && location.pathname.includes('/research')) ||
            (item.label === '项目' && location.pathname.startsWith('/projects') && !location.pathname.includes('/research'))

          return (
            <button
              key={item.label}
              onClick={() => navigate(itemPath)}
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
                opacity: 1,
              }}
              title={undefined}
            >
              <Icon size={14} strokeWidth={1.8} />
              {item.label}
            </button>
          )
        })}
      </nav>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '15px 0 12px' }} />

      {/* Recent */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
        <div
          className="sidebar-recent-list"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 2 }}
        >
          {recentProjects.map((project) => (
            <div
              key={project.id}
              className="sidebar-project-row"
              style={{
                position: 'relative',
                borderRadius: 7,
                background: project.id === activeProjectId ? 'var(--color-accent-light)' : 'transparent',
                color: project.id === activeProjectId ? 'var(--color-accent)' : 'var(--color-ink-2)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 7,
                padding: '8px 4px 8px 7px',
              }}
            >
              <button
                onClick={() => {
                  openConversation(project.id)
                }}
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 7,
                  padding: 0,
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <MessageSquare size={12} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                  {getProjectDisplayTitle(project)}
                </span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 9, color: 'var(--color-ink-3)' }}>
                  {STAGE_LABELS[project.currentStage] ?? project.currentStage}
                </span>
              </span>
              </button>
              <button
                className="sidebar-delete-button"
                title="删除"
                onClick={(event) => {
                  event.stopPropagation()
                  deleteProject(project.id)
                }}
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  border: 'none',
                  borderRadius: 5,
                  background: 'transparent',
                  color: 'var(--color-ink-3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: 0.65,
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .sidebar-recent-list::-webkit-scrollbar {
          width: 6px;
        }
        .sidebar-recent-list::-webkit-scrollbar-thumb {
          background: transparent;
          border-radius: 999px;
        }
        .sidebar-recent-list:hover::-webkit-scrollbar-thumb {
          background: rgba(44, 95, 65, 0.22);
        }
        .sidebar-project-row:hover {
          background: var(--color-accent-light) !important;
        }
        .sidebar-delete-button:hover {
          background: rgba(192, 57, 43, 0.08) !important;
          color: #C0392B !important;
          opacity: 1 !important;
        }
      `}</style>

      {/* Account status */}
      <div
        style={{
          border: `1px solid ${loggedIn ? 'rgba(47, 158, 68, 0.22)' : '#FFD8A8'}`,
          borderRadius: 8,
          background: loggedIn ? '#F0FAF2' : '#FFF8EC',
          padding: 8,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          onClick={loggedIn ? undefined : goLogin}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: loggedIn ? 'default' : 'pointer',
            fontFamily: 'var(--font-sans)',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: loggedIn ? '#D7EEDF' : '#FFE8C2',
              color: loggedIn ? '#2F9E44' : '#B35C00',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 650,
              flexShrink: 0,
            }}
          >
            {loggedIn ? getInitials(userLabel) : <LogIn size={14} />}
          </span>
          <span style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--color-ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loggedIn ? userLabel : '未登录'}
            </span>
            <span style={{ display: 'block', marginTop: 2, fontSize: 9, color: loggedIn ? '#2F9E44' : '#B35C00' }}>
              {loggedIn ? '云端同步已开启' : '本地模式 · 点此登录'}
            </span>
          </span>
          {loggedIn ? (
            <button
              title="退出登录"
              onClick={event => {
                event.stopPropagation()
                void logout()
              }}
              style={{
                width: 24,
                height: 24,
                border: 'none',
                borderRadius: 5,
                background: 'transparent',
                color: 'var(--color-ink-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <LogOut size={13} />
            </button>
          ) : (
            <ChevronDown size={12} color="#B35C00" />
          )}
        </div>
      </div>
    </aside>
  )
}

export default memo(Sidebar)
