import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS ?? 15000)
const AUTH_RETRY_COUNT = Number(process.env.AUTH_RETRY_COUNT ?? 1)
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'admin@qq.com'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || '123456789'

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), AUTH_TIMEOUT_MS)
    }),
  ])
}

async function withAuthRetry<T>(factory: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= AUTH_RETRY_COUNT; attempt += 1) {
    try {
      return await withTimeout(factory(), `${label}${attempt > 0 ? ` retry ${attempt}` : ''}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function canUseLocalDemoFallback(email: string, password: string) {
  return process.env.NODE_ENV !== 'production' && email === DEMO_EMAIL && password === DEMO_PASSWORD
}

function localDemoSession() {
  const user = {
    id: 'local-demo-user',
    email: DEMO_EMAIL,
    user_metadata: {
      displayName: 'Demo',
      display_name: 'Demo',
      name: 'Demo',
    },
  }
  return {
    user,
    session: {
      access_token: `dev-local-demo-token-${Date.now()}`,
    },
    local: true,
  }
}

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  try {
    const { data, error } = await withTimeout(
      supabase.auth.signUp({ email, password }),
      'Supabase register'
    )
    if (error) {
      res.status(400).json({ error: error.message })
      return
    }

    if (data.user) {
      await supabase.from('user_profiles').insert({
        id: data.user.id,
        display_name: displayName || email.split('@')[0],
      })
    }

    res.json({ user: data.user, session: data.session })
  } catch (error) {
    res.status(504).json({
      error: error instanceof Error ? error.message : 'Register service timed out',
    })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' })
    return
  }

  try {
    const { data, error } = await withAuthRetry(
      () => supabase.auth.signInWithPassword({ email, password }),
      'Supabase login'
    )
    if (error) {
      res.status(401).json({ error: 'Email or password is incorrect' })
      return
    }
    res.json({ user: data.user, session: data.session })
  } catch (error) {
    if (canUseLocalDemoFallback(email, password)) {
      res.json(localDemoSession())
      return
    }
    res.status(504).json({
      error: error instanceof Error ? error.message : 'Login service timed out',
    })
  }
})

router.post('/demo-login', async (_req, res) => {
  // The demo account uses a shared, well-known credential — never expose it in
  // production. Demo login is only available in non-production environments.
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: '演示登录已停用，请使用账号登录。' })
    return
  }
  try {
    const { data, error } = await withAuthRetry(
      () => supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
      'Supabase demo login'
    )
    if (error) {
      if (canUseLocalDemoFallback(DEMO_EMAIL, DEMO_PASSWORD)) {
        res.json(localDemoSession())
        return
      }
      res.status(401).json({ error: 'Demo account login failed' })
      return
    }
    res.json({ user: data.user, session: data.session })
  } catch (error) {
    if (canUseLocalDemoFallback(DEMO_EMAIL, DEMO_PASSWORD)) {
      res.json(localDemoSession())
      return
    }
    res.status(504).json({
      error: error instanceof Error ? error.message : 'Demo login service timed out',
    })
  }
})

router.post('/logout', async (_req, res) => {
  res.json({ ok: true })
})

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.slice(7)
  if (!token) {
    res.status(401).json({ error: 'Not logged in' })
    return
  }

  if (process.env.NODE_ENV !== 'production' && token.startsWith('dev-local-demo-token-')) {
    res.json({ user: localDemoSession().user })
    return
  }

  try {
    const { data: { user }, error } = await withAuthRetry(
      () => supabase.auth.getUser(token),
      'Supabase get user'
    )
    if (error || !user) {
      res.status(401).json({ error: 'Not logged in' })
      return
    }

    res.json({ user })
  } catch (error) {
    res.status(504).json({
      error: error instanceof Error ? error.message : 'Auth service timed out',
    })
  }
})

export default router
