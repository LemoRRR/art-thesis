import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { auth } from './lib/auth'
import Library from './pages/Library'
import Login from './pages/Login'
import ProjectHome from './pages/ProjectHome'
import Projects from './pages/Projects'
import Stage1 from './pages/Stage1'
import Stage2 from './pages/Stage2'
import Stage3 from './pages/Stage3'
import StyleProfiles from './pages/StyleProfiles'
import { projectStore, syncRemoteData } from './lib/storage'

function DefaultConversationRedirect() {
  const projectId = projectStore.getActiveId()
  return <Navigate to={`/projects/${projectId}/stage1`} replace />
}

function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  if (auth.isAuthRequired() && !auth.isLoggedIn() && location.pathname !== '/login') {
    const redirect = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return <>{children}</>
}

function RemoteDataGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [ready, setReady] = useState(!auth.isLoggedIn())
  const [error, setError] = useState('')
  const syncedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (!auth.isLoggedIn() || location.pathname === '/login' || syncedRef.current) {
      setReady(true)
      return
    }

    setReady(false)
    setError('')
    Promise.race([
      syncRemoteData(),
      new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 5000)
      }),
    ])
      .catch(err => {
        console.warn('[App] Supabase 同步失败，继续使用本地缓存', err)
        if (!cancelled) setError('云端同步失败，已切换为本地缓存模式。')
      })
      .finally(() => {
        if (!cancelled) {
          syncedRef.current = true
          setReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [location.pathname])

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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<DefaultConversationRedirect />} />
            <Route path="/library" element={<Library />} />
            <Route path="/style-profiles" element={<StyleProfiles />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<ProjectHome />} />
            <Route path="/projects/:projectId/stage1" element={<Stage1 />} />
            <Route path="/projects/:projectId/stage2" element={<Stage2 />} />
            <Route path="/projects/:projectId/stage3" element={<Stage3 />} />
            <Route path="/stage1" element={<Stage1 />} />
            <Route path="/stage2" element={<Stage2 />} />
            <Route path="/stage3" element={<Stage3 />} />
          </Routes>
        </RemoteDataGate>
      </AuthGuard>
    </BrowserRouter>
  )
}
