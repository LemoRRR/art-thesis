import { Router } from 'express'
import { removeUndefined } from '../lib/object.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  let query = db
    .from('style_profiles')
    .select('*')
    .eq('user_id', req.userId)

  if (search) {
    query = query.or(`student_name.ilike.%${search}%,profile_name.ilike.%${search}%,editable_summary.ilike.%${search}%`)
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
    .from('style_profiles')
    .select('*')
    .eq('user_id', req.userId)
    .eq('id', req.params.id)
    .single()

  if (error) {
    res.status(404).json({ error: '风格档案不存在' })
    return
  }
  res.json(data)
})

router.post('/', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const {
    id,
    student_name = '',
    profile_name = '',
    source_file_name,
    source_documents = [],
    source_text_length = 0,
    writing_level = '',
    sentence_style = '',
    paragraph_logic = '',
    argument_style = '',
    transition_style = '',
    vocabulary_style = '',
    avoid_content_reuse_notice = '',
    editable_summary = '',
  } = req.body
  const { data, error } = await db
    .from('style_profiles')
    .upsert(removeUndefined({
      id,
      user_id: req.userId,
      student_name,
      profile_name,
      source_file_name,
      source_documents,
      source_text_length,
      writing_level,
      sentence_style,
      paragraph_logic,
      argument_style,
      transition_style,
      vocabulary_style,
      avoid_content_reuse_notice,
      editable_summary,
    }), { onConflict: 'id' })
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
  const patch = removeUndefined({
    student_name: req.body.student_name,
    profile_name: req.body.profile_name,
    source_file_name: req.body.source_file_name,
    source_documents: req.body.source_documents,
    source_text_length: req.body.source_text_length,
    writing_level: req.body.writing_level,
    sentence_style: req.body.sentence_style,
    paragraph_logic: req.body.paragraph_logic,
    argument_style: req.body.argument_style,
    transition_style: req.body.transition_style,
    vocabulary_style: req.body.vocabulary_style,
    avoid_content_reuse_notice: req.body.avoid_content_reuse_notice,
    editable_summary: req.body.editable_summary,
    updated_at: new Date().toISOString(),
  })
  const { data, error } = await db
    .from('style_profiles')
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
    .from('style_profiles')
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
