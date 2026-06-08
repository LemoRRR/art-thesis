import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId/:stage', async (req, res) => {
  const { data, error } = await supabase
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

router.put('/project/:projectId/:stage', async (req, res) => {
  const { messages = [] } = req.body
  await supabase
    .from('chat_messages')
    .delete()
    .eq('project_id', req.params.projectId)
    .eq('stage', req.params.stage)

  if (messages.length > 0) {
    const { error } = await supabase.from('chat_messages').insert(
      messages.map((message: Record<string, unknown>) => ({
        project_id: req.params.projectId,
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
