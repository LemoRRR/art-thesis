import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authAPI } from '../lib/api'
import { auth } from '../lib/auth'
import { createNewConversationProject } from '../lib/conversation'

const CAN_USE_DEMO_LOGIN = !import.meta.env.PROD

export default function DemoLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function enterDemo() {
      if (!CAN_USE_DEMO_LOGIN) {
        setError('正式环境已停用演示账号，请使用邮箱注册或登录。')
        return
      }

      try {
        auth.clearSession()
        const data = await authAPI.demoLogin()
        if (!data.session?.access_token) throw new Error('Demo 登录没有返回有效会话')
        localStorage.setItem('access_token', data.session.access_token)
        localStorage.setItem('auth_user', JSON.stringify(data.user))
        const redirect = normalizeRedirect(searchParams.get('redirect'))
        if (!cancelled && redirect) {
          navigate(redirect, { replace: true })
          return
        }
        const project = createNewConversationProject()
        if (!cancelled) navigate(`/projects/${project.id}/stage1`, { replace: true })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Demo 登录失败')
      }
    }

    void enterDemo()
    return () => {
      cancelled = true
    }
  }, [navigate, searchParams])

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', color: 'var(--color-ink-2)', textAlign: 'center', padding: 24 }}>
      <div style={{ width: 'min(420px, 100%)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 28, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-ink)' }}>{CAN_USE_DEMO_LOGIN ? '正在进入演示项目' : '演示入口已停用'}</div>
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7, color: error ? '#C0392B' : 'var(--color-ink-3)' }}>
          {error || '系统正在自动登录演示账号，并创建一份新的论文项目。'}
        </div>
        {!CAN_USE_DEMO_LOGIN && (
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            style={{ marginTop: 18, border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            返回登录
          </button>
        )}
      </div>
    </div>
  )
}

function normalizeRedirect(value: string | null) {
  if (!value?.startsWith('/')) return ''
  let pathname: string
  try {
    pathname = new URL(value, window.location.origin).pathname
  } catch {
    pathname = value.split('?')[0] || value
  }
  if (pathname === '/login' || pathname === '/demo') return ''
  return value
}
