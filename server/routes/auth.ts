import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json({ error: '邮箱和密码必填' })
    return
  }

  const { data, error } = await supabase.auth.signUp({ email, password })
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
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json({ error: '邮箱和密码必填' })
    return
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    res.status(401).json({ error: '邮箱或密码错误' })
    return
  }
  res.json({ user: data.user, session: data.session })
})

router.post('/logout', async (_req, res) => {
  res.json({ ok: true })
})

router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.slice(7)
  if (!token) {
    res.status(401).json({ error: '未登录' })
    return
  }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    res.status(401).json({ error: '未登录' })
    return
  }

  res.json({ user })
})

export default router
