import { Router } from 'express'
import { extractDimensions } from '../lib/extract.js'
import { removeUndefined } from '../lib/object.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  let query = db
    .from('library_items')
    .select('*')
    .eq('user_id', req.userId)

  if (search) {
    query = query.or(`title.ilike.%${search}%,summary.ilike.%${search}%,text_content.ilike.%${search}%`)
  }

  const { data, error } = await query.order('updated_at', { ascending: false }).limit(50)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.get('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('library_items')
    .select('*')
    .eq('user_id', req.userId)
    .eq('id', req.params.id)
    .single()

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
    title,
    type = 'note',
    file_name,
    file_size,
    file_url,
    text_content = '',
    summary = '',
    tags = [],
    index_status = 'ready',
    extract_status = text_content ? 'processing' : 'pending',
  } = req.body
  const { data, error } = await db
    .from('library_items')
    .insert(removeUndefined({
      id,
      user_id: req.userId,
      title,
      type,
      file_name,
      file_size,
      file_url,
      text_content,
      summary,
      tags,
      index_status,
      extract_status,
    }))
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  if (text_content) {
    extractDimensions(data.id, text_content, req.accessToken).catch(() => {
      // 已在 extractDimensions 内部记录并更新 failed 状态。
    })
  }

  res.json(data)
})

router.patch('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('library_items')
    .update(req.body)
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
  const { error } = await db.from('library_items').delete().eq('id', req.params.id).eq('user_id', req.userId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
