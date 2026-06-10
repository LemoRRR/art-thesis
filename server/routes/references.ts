import { Router } from 'express'
import { createUserClient } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('reference_selections')
    .select('*')
    .eq('project_id', req.params.projectId)
    .eq('stage', req.params.stage)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const {
    library_item_ids = [],
    section_ids = [],
    include_project_context = true,
    include_conversation_summary = false,
  } = req.body

  const { data, error } = await db
    .from('reference_selections')
    .upsert({
      project_id: req.params.projectId,
      stage: req.params.stage,
      library_item_ids,
      section_ids,
      include_project_context,
      include_conversation_summary,
    }, { onConflict: 'project_id,stage' })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

export default router
