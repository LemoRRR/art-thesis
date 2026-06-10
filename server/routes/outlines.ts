import { Router } from 'express'
import { createUserClient } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('outlines')
    .select('*')
    .eq('project_id', req.params.projectId)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { sections = [], confirmed_at } = req.body
  const { data, error } = await db
    .from('outlines')
    .upsert({
      project_id: req.params.projectId,
      sections,
      confirmed_at,
    }, { onConflict: 'project_id' })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/project/:projectId/confirm', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('outlines')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('project_id', req.params.projectId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.delete('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { error } = await db.from('outlines').delete().eq('project_id', req.params.projectId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
