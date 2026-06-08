import { Router } from 'express'
import { supabase } from '../lib/supabase'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('library_items')
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
  const { title, type = 'note', text_content = '', summary = '', tags = [] } = req.body
  const { data, error } = await supabase
    .from('library_items')
    .insert({
      user_id: req.userId,
      title,
      type,
      text_content,
      summary,
      tags,
      index_status: 'ready',
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.patch('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('library_items')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('library_items').delete().eq('id', req.params.id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
