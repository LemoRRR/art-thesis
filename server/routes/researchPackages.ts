import { Router } from 'express'
import { ensureProjectForUser } from '../lib/ensureProject.js'
import { createUserClient } from '../lib/supabase.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

type ResearchPackagePayload = Record<string, unknown> & {
  id?: string
  projectId?: string
  chapterId?: string
  title?: string
  createdAt?: number
  updatedAt?: number
  versions?: unknown[]
}

function trimPackageVersions(pkg: ResearchPackagePayload): ResearchPackagePayload {
  const versions = Array.isArray(pkg.versions) ? pkg.versions.slice(0, 10) : []
  return { ...pkg, versions }
}

router.get('/project/:projectId', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const { data, error } = await db
    .from('research_packages')
    .select('*')
    .eq('project_id', req.params.projectId)
    .order('updated_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json(data)
})

router.put('/:id', async (req: AuthRequest, res) => {
  const db = createUserClient(req.accessToken!)
  const rawPackage = req.body?.package
  if (!rawPackage || typeof rawPackage !== 'object') {
    res.status(400).json({ error: 'Missing research package payload' })
    return
  }

  const pkg = trimPackageVersions(rawPackage as ResearchPackagePayload)
  const projectId = String(pkg.projectId ?? '')
  if (!projectId || String(pkg.id ?? '') !== req.params.id) {
    res.status(400).json({ error: 'Invalid research package id or project id' })
    return
  }

  const ensured = await ensureProjectForUser(db, projectId, req.userId!)
  if (ensured.error) {
    res.status(500).json({ error: ensured.error.message })
    return
  }

  const now = new Date().toISOString()
  const createdAt = Number(pkg.createdAt)
  const updatedAt = Number(pkg.updatedAt)
  const { data, error } = await db
    .from('research_packages')
    .upsert({
      id: req.params.id,
      project_id: projectId,
      chapter_id: String(pkg.chapterId ?? '').trim() || null,
      title: String(pkg.title ?? ''),
      package_json: pkg,
      created_at: Number.isFinite(createdAt) ? new Date(createdAt).toISOString() : now,
      updated_at: Number.isFinite(updatedAt) ? new Date(updatedAt).toISOString() : now,
    }, { onConflict: 'id' })
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
    .from('research_packages')
    .delete()
    .eq('id', req.params.id)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
