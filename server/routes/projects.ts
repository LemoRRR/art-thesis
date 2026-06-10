import { Router } from 'express'
import { removeUndefined } from '../lib/object.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('user_id', req.userId)
    .order('updated_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const {
    id,
    title = '未命名论文',
    description = '',
    current_stage = 'stage1',
    context = {},
    library_item_ids = [],
  } = req.body
  const { data, error } = await db
    .from('projects')
    .insert(removeUndefined({ id, user_id: req.userId, title, description, current_stage, context, library_item_ids }))
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.get('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (error) {
    res.status(404).json({ error: '项目不存在' })
    return
  }
  res.json(data)
})

router.patch('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { title, description, current_stage, context, library_item_ids } = req.body
  const patch = removeUndefined({ title, description, current_stage, context, library_item_ids })
  const { data, error } = await db
    .from('projects')
    .update(patch)
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.delete('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { error } = await db
    .from('projects')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
