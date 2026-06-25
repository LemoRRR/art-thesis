import { Router } from 'express'
import { createUserClient } from '../lib/supabase.js'
import { ensureProjectForUser } from '../lib/ensureProject.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('chat_messages')
    .select('*')
    .eq('project_id', req.params.projectId)
    .eq('stage', req.params.stage)
    .order('created_at', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId/:stage', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { messages = [] } = req.body
  const projectId = String(req.params.projectId)
  const ensured = await ensureProjectForUser(db, projectId, req.userId!)
  if (ensured.error) {
    res.status(500).json({ error: ensured.error.message })
    return
  }

  const deleted = await db
    .from('chat_messages')
    .delete()
    .eq('project_id', projectId)
    .eq('stage', req.params.stage)
  if (deleted.error) {
    res.status(500).json({ error: deleted.error.message })
    return
  }

  if (messages.length > 0) {
    const { error } = await db.from('chat_messages').insert(
      messages.map((message: Record<string, unknown>) => ({
        project_id: projectId,
        stage: req.params.stage,
        role: message.role,
        content: message.content,
      }))
    )
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
  }

  res.json({ ok: true })
})

export default router
