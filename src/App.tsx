import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { auth } from './lib/auth'
import { projectStore, syncRemoteData } from './lib/storage'

const Library = lazy(() => import('./pages/Library'))
const Login = lazy(() => import('./pages/Login'))
const DemoLogin = lazy(() => import('./pages/DemoLogin'))
const ProjectHome = lazy(() => import('./pages/ProjectHome'))
const Projects = lazy(() => import('./pages/Projects'))
const Stage1 = lazy(() => import('./pages/Stage1'))
const Stage2 = lazy(() => import('./pages/Stage2'))
const Stage3 = lazy(() => import('./pages/Stage3'))
const StyleProfiles = lazy(() => import('./pages/StyleProfiles'))
const ResearchCenter = lazy(() => import('./pages/ResearchCenter'))

const AUTH_EXPIRED_EVENT = 'paper-ai-auth-expired'
const AUTH_ENTRY_ROUTES = new Set(['/login', '/demo'])

function isAuthEntryPath(pathname: string) {
  return AUTH_ENTRY_ROUTES.has(pathname)
}

function safeLoginRedirect(location: ReturnType<typeof useLocation>) {
  if (isAuthEntryPath(location.pathname)) return ''
  return `${location.pathname}${location.search}${location.hash}`
}

function DefaultConversationRedirect() {
  const projectId = projectStore.getActiveId()
  return <Navigate to={`/projects/${projectId}/stage1`} replace />
}

function PageLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', color: 'var(--color-ink-3)', fontSize: 13 }}>
      正在打开页面...
    </div>
  )
}

function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isAuthEntryRoute = isAuthEntryPath(location.pathname)
  if (auth.isAuthRequired() && !auth.isLoggedIn() && !isAuthEntryRoute) {
    const redirect = safeLoginRedirect(location)
    return <Navigate to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'} replace />
  }
  return <>{children}</>
}

function RemoteDataGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isAuthEntryRoute = isAuthEntryPath(location.pathname)
  const [ready, setReady] = useState(!auth.isLoggedIn())
  const [error, setError] = useState('')
  const [redirectToLogin, setRedirectToLogin] = useState(false)
  const syncedProjectIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const handleAuthExpired = () => {
      if (auth.isAuthRequired() && !isAuthEntryRoute) {
        setRedirectToLogin(true)
      }
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [isAuthEntryRoute])

  useEffect(() => {
    let cancelled = false
    const routeProjectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1]
    const activeProjectId = projectStore.getActiveId()
    const projectIds = Array.from(new Set([routeProjectId, activeProjectId].filter((id): id is string => Boolean(id))))
    const needsProjectSync = projectIds.length === 0 || projectIds.some(id => !syncedProjectIdsRef.current.has(id))
    if (!auth.isLoggedIn() || auth.isLocalSession() || isAuthEntryRoute || !needsProjectSync) {
      setReady(true)
      return
    }

    setReady(false)
    setError('')
    setRedirectToLogin(false)
    Promise.race([
      syncRemoteData({ projectIds }).then(() => true),
      new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 5000)
      }).then(() => false),
    ])
      .then(didSync => {
        if (didSync) projectIds.forEach(id => syncedProjectIdsRef.current.add(id))
      })
      .catch(err => {
        console.warn('[App] Supabase 同步失败，继续使用本地缓存', err)
        if (!cancelled) setError('云端同步失败，已切换为本地缓存模式。')
      })
      .finally(() => {
        if (!cancelled) {
          if (auth.isAuthRequired() && !auth.isLoggedIn() && !isAuthEntryRoute) {
            setRedirectToLogin(true)
          }
          setReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isAuthEntryRoute, location.pathname])

  if (redirectToLogin && !isAuthEntryRoute && auth.isAuthRequired() && !auth.isLoggedIn()) {
    const redirect = safeLoginRedirect(location)
    return <Navigate to={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login'} replace />
  }

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', color: 'var(--color-ink-3)', fontSize: 13, textAlign: 'center', lineHeight: 1.8 }}>
        <div>
          <div>正在同步云端数据…</div>
          <div style={{ fontSize: 11 }}>如果网络较慢，系统会自动切换到本地缓存。</div>
        </div>
      </div>
    )
  }

  if (error) {
    console.warn(error)
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGuard>
        <RemoteDataGate>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/demo" element={<DemoLogin />} />
              <Route path="/" element={<DefaultConversationRedirect />} />
              <Route path="/library" element={<Library />} />
              <Route path="/style-profiles" element={<StyleProfiles />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:projectId" element={<ProjectHome />} />
              <Route path="/projects/:projectId/stage1" element={<Stage1 />} />
              <Route path="/projects/:projectId/stage2" element={<Stage2 />} />
              <Route path="/projects/:projectId/research/assets" element={<ResearchCenter />} />
              <Route path="/projects/:projectId/research" element={<ResearchCenter />} />
              <Route path="/projects/:projectId/stage3" element={<Stage3 />} />
              <Route path="/stage1" element={<Stage1 />} />
              <Route path="/stage2" element={<Stage2 />} />
              <Route path="/stage3" element={<Stage3 />} />
            </Routes>
          </Suspense>
        </RemoteDataGate>
      </AuthGuard>
    </BrowserRouter>
  )
}
