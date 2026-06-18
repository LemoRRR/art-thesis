import { Router } from 'express'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

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
    auto_citation_enabled = true,
    auto_sources = [],
    evidence_pack = null,
    last_auto_run_at = null,
  } = req.body

  const payload = {
    project_id: req.params.projectId,
    stage: req.params.stage,
    library_item_ids,
    section_ids,
    include_project_context,
    include_conversation_summary,
    auto_citation_enabled,
    auto_sources,
    evidence_pack,
    last_auto_run_at,
  }

  let { data, error } = await db
    .from('reference_selections')
    .upsert(payload, { onConflict: 'project_id,stage' })
    .select()
    .single()

  if (error && /auto_citation_enabled|auto_sources|evidence_pack|last_auto_run_at/i.test(error.message)) {
    const fallback = {
      project_id: req.params.projectId,
      stage: req.params.stage,
      library_item_ids,
      section_ids,
      include_project_context,
      include_conversation_summary,
    }
    const fallbackResult = await db
      .from('reference_selections')
      .upsert(fallback, { onConflict: 'project_id,stage' })
      .select()
      .single()
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

export default router
