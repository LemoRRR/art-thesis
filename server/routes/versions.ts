import { Router } from 'express'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

// Retention per contract: keep history for 90 days. A generous count cap is a
// secondary safety net so a single hyperactive project can't bloat the table.
const RETENTION_DAYS = 90
const MAX_VERSIONS_PER_PROJECT = 50

async function pruneOldVersions(
  db: ReturnType<typeof createUserClient>,
  projectId: string,
): Promise<void> {
  // 1) Delete anything older than the 90-day retention window.
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  await db.from('versions').delete().eq('project_id', projectId).lt('created_at', cutoff)

  // 2) Safety cap: keep at most the most recent MAX_VERSIONS_PER_PROJECT.
  const { data: stale } = await db
    .from('versions')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(MAX_VERSIONS_PER_PROJECT, 9999)
  const ids = (stale ?? []).map(row => (row as { id: string }).id)
  if (ids.length) {
    await db.from('versions').delete().in('id', ids)
  }
}

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('versions')
    .select('*')
    .eq('project_id', req.params.projectId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.post('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { description, sections_snapshot = [], outline_snapshot = null } = req.body
  const { data, error } = await db
    .from('versions')
    .insert({
      project_id: req.params.projectId,
      description,
      sections_snapshot,
      outline_snapshot,
    })
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Best-effort retention: never let the request fail because of pruning.
  pruneOldVersions(db, req.params.projectId).catch(() => {})

  res.json(data)
})

export default router
