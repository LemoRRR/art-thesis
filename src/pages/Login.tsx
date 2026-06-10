import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authAPI } from '../lib/api'
import { auth } from '../lib/auth'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const redirectTo = (() => {
    const value = searchParams.get('redirect')
    return value?.startsWith('/') && !value.startsWith('/login') ? value : '/'
  })()

  const handleLogin = async () => {
    if (!email || !password || loading) return
    if (!email.includes('@')) {
      setError('请输入有效邮箱')
      return
    }
    setLoading(true)
    setError('')
    try {
      await auth.login(email, password)
      navigate(redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    if (!email || !password || loading) return
    if (!email.includes('@')) {
      setError('请输入有效邮箱，不能只填用户名')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await authAPI.register(email, password, displayName) as {
        user: unknown
        session?: { access_token: string }
      }
      if (data.session?.access_token) {
        localStorage.setItem('access_token', data.session.access_token)
        localStorage.setItem('auth_user', JSON.stringify(data.user))
      }
      navigate(redirectTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  const submit = tab === 'login' ? handleLogin : handleRegister

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div style={{ width: 380, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 32, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-ink)' }}>论文助手</div>
          <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginTop: 4 }}>AI 学术写作工作台</div>
        </div>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
          {(['login', 'register'] as const).map(item => (
            <button
              key={item}
              onClick={() => setTab(item)}
              style={{ flex: 1, padding: '8px 0', border: 'none', borderBottom: `2px solid ${tab === item ? 'var(--color-accent)' : 'transparent'}`, background: 'transparent', color: tab === item ? 'var(--color-accent)' : 'var(--color-ink-3)', fontSize: 13, fontWeight: tab === item ? 500 : 400, cursor: 'pointer' }}
            >
              {item === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'register' && (
            <input
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder="昵称（可选）"
              style={inputStyle}
            />
          )}
          <input
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="邮箱"
            type="email"
            style={inputStyle}
          />
          <input
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="密码"
            type="password"
            onKeyDown={event => event.key === 'Enter' && submit()}
            style={inputStyle}
          />
          {error && <div style={{ fontSize: 12, color: '#C0392B' }}>{error}</div>}
          <button
            onClick={submit}
            disabled={loading}
            style={{ width: '100%', border: 'none', borderRadius: 'var(--radius-sm)', background: loading ? 'var(--color-border)' : 'var(--color-accent)', color: '#fff', padding: '11px 0', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? '处理中…' : tab === 'login' ? '登录' : '注册'}
          </button>
        </div>
      </div>
    </div>
  )
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
