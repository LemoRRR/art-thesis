import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', async (req, res) => {
  const { data, error } = await supabase
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

router.post('/project/:projectId', async (req, res) => {
  const { description, sections_snapshot } = req.body
  const { data, error } = await supabase
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
