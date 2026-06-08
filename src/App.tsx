import type { ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { auth } from './lib/auth'
import Library from './pages/Library'
import Login from './pages/Login'
import ProjectHome from './pages/ProjectHome'
import Projects from './pages/Projects'
import Stage1 from './pages/Stage1'
import Stage2 from './pages/Stage2'
import Stage3 from './pages/Stage3'
import { projectStore } from './lib/storage'

function DefaultConversationRedirect() {
  const projectId = projectStore.getActiveId()
  return <Navigate to={`/projects/${projectId}/stage1`} replace />
}

function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  if (auth.isAuthRequired() && !auth.isLoggedIn() && location.pathname !== '/login') {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGuard>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<DefaultConversationRedirect />} />
          <Route path="/library" element={<Library />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<ProjectHome />} />
          <Route path="/projects/:projectId/stage1" element={<Stage1 />} />
          <Route path="/projects/:projectId/stage2" element={<Stage2 />} />
          <Route path="/projects/:projectId/stage3" element={<Stage3 />} />
          <Route path="/stage1" element={<Stage1 />} />
          <Route path="/stage2" element={<Stage2 />} />
          <Route path="/stage3" element={<Stage3 />} />
        </Routes>
      </AuthGuard>
    </BrowserRouter>
  )
}
