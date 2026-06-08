import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', async (req, res) => {
  const { data, error } = await supabase
    .from('sections')
    .select('*')
    .eq('project_id', req.params.projectId)
    .order('sort_order', { ascending: true })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/', async (req, res) => {
  const { project_id, title, content = '', status = 'pending', sort_order = 0 } = req.body
  const { data, error } = await supabase
    .from('sections')
    .insert({ project_id, title, content, status, sort_order })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { title, content, status, sort_order } = req.body
  const { data, error } = await supabase
    .from('sections')
    .update({ title, content, status, sort_order })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId', async (req: AuthRequest, res) => {
  const { sections = [] } = req.body
  await supabase.from('sections').delete().eq('project_id', req.params.projectId)

  if (sections.length > 0) {
    const { error } = await supabase.from('sections').insert(
      sections.map((section: Record<string, unknown>, index: number) => ({
        title: section.title,
        content: section.content ?? '',
        status: section.status ?? 'pending',
        project_id: req.params.projectId,
        sort_order: index,
      }))
    )
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
  }

  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('sections').delete().eq('id', req.params.id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
