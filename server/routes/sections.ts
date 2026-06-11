import { Router } from 'express'
import { removeUndefined } from '../lib/object.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

function isMissingContentDocColumn(error: { message?: string } | null) {
  return Boolean(error?.message?.includes('content_doc'))
}

function withoutContentDoc<T extends Record<string, unknown>>(row: T) {
  const next = { ...row }
  delete next.content_doc
  return next
}

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
  const { id, project_id, title, content = '', content_doc, status = 'pending', sort_order = 0 } = req.body
  const row = removeUndefined({ id, project_id, title, content, content_doc, status, sort_order })
  let { data, error } = await db
    .from('sections')
    .insert(row)
    .select()
    .single()

  if (isMissingContentDocColumn(error)) {
    const retry = await db
      .from('sections')
      .insert(withoutContentDoc(row))
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.patch('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { title, content, content_doc, status, sort_order } = req.body
  const patch = removeUndefined({ title, content, content_doc, status, sort_order })
  let { data, error } = await db
    .from('sections')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single()

  if (isMissingContentDocColumn(error)) {
    const retry = await db
      .from('sections')
      .update(withoutContentDoc(patch))
      .eq('id', req.params.id)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { sections = [] } = req.body
  const projectId = req.params.projectId

  if (sections.length > 0) {
    const rows = sections.map((section: Record<string, unknown>, index: number) => ({
        id: section.id,
        title: section.title,
        content: section.content ?? '',
        content_doc: section.content_doc,
        status: section.status ?? 'pending',
        project_id: projectId,
        sort_order: index,
      })).map(removeUndefined)
    let { error } = await db.from('sections').upsert(rows, { onConflict: 'id' })
    if (isMissingContentDocColumn(error)) {
      const retry = await db.from('sections').upsert(rows.map(withoutContentDoc), { onConflict: 'id' })
      error = retry.error
    }
    if (error) {
      console.error('[sections:saveAll:error]', error.message)
      res.status(500).json({ error: error.message })
      return
    }

    const incomingIds = rows.map(row => row.id).filter(Boolean)
    const staleDelete = incomingIds.length > 0
      ? await db.from('sections').delete().eq('project_id', projectId).not('id', 'in', `(${incomingIds.join(',')})`)
      : await db.from('sections').delete().eq('project_id', projectId)
    if (staleDelete.error) {
      console.error('[sections:saveAll:error]', staleDelete.error.message)
      res.status(500).json({ error: staleDelete.error.message })
      return
    }
  } else {
    const { error } = await db.from('sections').delete().eq('project_id', projectId)
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
