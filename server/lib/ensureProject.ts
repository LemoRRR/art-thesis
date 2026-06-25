import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureProjectForUser(
  db: SupabaseClient,
  projectId: string,
  userId: string,
  title = '未命名论文'
) {
  const existing = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing.error) return existing
  if (existing.data) return existing

  return db
    .from('projects')
    .insert({
      id: projectId,
      user_id: userId,
      title,
      description: '',
      current_stage: 'stage1',
      context: {},
      library_item_ids: [],
    })
    .select('id')
    .single()
}
