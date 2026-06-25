import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authAPI } from '../lib/api'
import { auth } from '../lib/auth'
import { createNewConversationProject } from '../lib/conversation'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const rawRedirect = searchParams.get('redirect')
    if (rawRedirect && !normalizeRedirect(rawRedirect)) {
      navigate('/login', { replace: true })
    }
  }, [navigate, searchParams])

  const goToNewConversation = () => {
    const redirect = normalizeRedirect(searchParams.get('redirect'))
    if (redirect) {
      navigate(redirect, { replace: true })
      return
    }
    const project = createNewConversationProject()
    navigate(`/projects/${project.id}/stage1`, { replace: true })
  }

  const handleLogin = async () => {
    if (!email || !password) {
      setError('请填写邮箱和密码')
      return
    }
    if (!isValidEmail(email)) {
      setError('请输入有效邮箱，不能只填用户名')
      return
    }

    setLoading(true)
    setStatus('正在验证账号，请稍候…')
    setError('')
    try {
      await auth.login(email.trim(), password)
      setStatus('登录成功，正在进入项目…')
      goToNewConversation()
    } catch (err) {
      setError(formatAuthError(err))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = async () => {
    if (loading) return
    setLoading(true)
    setStatus('正在进入演示账号…')
    setError('')
    try {
      auth.clearSession()
      const data = await authAPI.demoLogin()
      if (!data.session?.access_token) throw new Error('Demo 登录没有返回有效会话')
      localStorage.setItem('access_token', data.session.access_token)
      localStorage.setItem('auth_user', JSON.stringify(data.user))
      setStatus('已进入演示账号，正在打开项目…')
      goToNewConversation()
    } catch (err) {
      setError(formatAuthError(err))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!email || !password) {
      setError('请填写邮箱和密码')
      return
    }
    if (!isValidEmail(email)) {
      setError('请输入有效邮箱，不能只填用户名')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }

    setLoading(true)
    setStatus('正在创建账号，请稍候…')
    setError('')
    try {
      const data = await authAPI.register(email.trim(), password, displayName) as {
        user: unknown
        session?: { access_token: string }
      }
      if (data.session?.access_token) {
        localStorage.setItem('access_token', data.session.access_token)
        localStorage.setItem('auth_user', JSON.stringify(data.user))
        setStatus('注册成功，正在进入项目…')
        goToNewConversation()
      } else {
        setStatus('')
        setError('注册成功，请回到登录页登录。')
        setTab('login')
      }
    } catch (err) {
      setError(formatAuthError(err))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
    void (tab === 'login' ? handleLogin() : handleRegister())
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div style={{ width: 380, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 32, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink)' }}>论文助手</div>
          <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 4 }}>艺术科研管理系统</div>
        </div>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
          {(['login', 'register'] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => {
                if (loading) return
                setTab(item)
                setError('')
                setStatus('')
              }}
              style={{ flex: 1, padding: '8px 0', border: 'none', borderBottom: `2px solid ${tab === item ? 'var(--color-accent)' : 'transparent'}`, background: 'transparent', color: tab === item ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 13, fontWeight: tab === item ? 500 : 400, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {item === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'register' && (
            <input
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder="昵称（可选）"
              disabled={loading}
              style={inputStyle}
            />
          )}
          <input
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="邮箱（用于登录）"
            type="email"
            autoComplete="email"
            disabled={loading}
            style={inputStyle}
          />
          <input
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="密码"
            type="password"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            disabled={loading}
            style={inputStyle}
          />
          {error && <div style={{ fontSize: 12, color: '#C0392B', lineHeight: 1.6 }}>{error}</div>}
          {!error && (
            <div style={{ fontSize: 12, color: status ? 'var(--color-accent)' : 'var(--color-ink-3)', lineHeight: 1.6 }}>
              {status || '注册请使用邮箱，密码至少 6 位。'}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: loading ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', padding: '11px 0', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? (tab === 'login' ? '正在登录…' : '正在注册…') : tab === 'login' ? '登录' : '注册'}
          </button>
          {tab === 'login' && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleDemoLogin()}
              style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: loading ? 'var(--color-ink-3)' : 'var(--color-ink-2)', padding: '10px 0', fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              使用演示账号进入
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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

function formatAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : '登录失败'
  if (message.includes('401') || message.includes('incorrect')) return '邮箱或密码不正确，请检查后重试。'
  if (message.includes('timed out') || message.includes('504')) return '登录服务响应较慢，请稍后重试；本地测试可点击“使用演示账号进入”。'
  if (message.includes('Cannot connect')) return '暂时无法连接后端服务，请确认本地服务已启动。'
  return message
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
}
