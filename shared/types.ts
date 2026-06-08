export type WorkflowStage = 'stage1' | 'stage2' | 'stage3'

export interface ApiProject {
  id: string
  user_id: string
  title: string
  description: string
  current_stage: WorkflowStage
  library_item_ids: string[]
  context: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ApiSection {
  id: string
  project_id: string
  title: string
  content: string
  status: string
  sort_order: number
  created_at: string
  updated_at: string
}
