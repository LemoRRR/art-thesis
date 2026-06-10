import { Router } from 'express'
import { removeUndefined } from '../lib/object'
import { createUserClient } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
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

router.post('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { id, project_id, title, content = '', status = 'pending', sort_order = 0 } = req.body
  const { data, error } = await db
    .from('sections')
    .insert(removeUndefined({ id, project_id, title, content, status, sort_order }))
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.patch('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { title, content, status, sort_order } = req.body
  const { data, error } = await db
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
  const db = createUserClient(req.accessToken!)
  const { sections = [] } = req.body
  console.log('[sections:saveAll]', {
    projectId: req.params.projectId,
    userId: req.userId,
    count: sections.length,
    firstId: sections[0]?.id,
  })
  await db.from('sections').delete().eq('project_id', req.params.projectId)

  if (sections.length > 0) {
    const { error } = await db.from('sections').insert(
      sections.map((section: Record<string, unknown>, index: number) => ({
        id: section.id,
        title: section.title,
        content: section.content ?? '',
        status: section.status ?? 'pending',
        project_id: req.params.projectId,
        sort_order: index,
      })).map(removeUndefined)
    )
    if (error) {
      console.error('[sections:saveAll:error]', error.message)
      res.status(500).json({ error: error.message })
      return
    }
  }

  res.json({ ok: true })
})

router.delete('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { error } = await db.from('sections').delete().eq('id', req.params.id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
