import { Router } from 'express'
import { createUserClient } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('versions')
    .select('*')
    .eq('project_id', req.params.projectId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { description, sections_snapshot } = req.body
  const { data, error } = await db
    .from('versions')
    .insert({
      project_id: req.params.projectId,
      description,
      sections_snapshot,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

export default router
