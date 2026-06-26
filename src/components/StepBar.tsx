import { Check } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { chatStore, outlineStore, projectStore, sectionStore } from '../lib/storage'

interface StepBarProps {
  current: 0 | 1 | 2 | 3
}

const STEPS = [
  { label: '材料理解', route: 'stage1' },
  { label: '大纲撰写', route: 'stage2' },
  { label: '文章生成', route: 'stage3' },
  { label: '研究计算', route: 'research' },
]

const STEP_COLORS = [
  { active: '#2D5A3D', light: '#EBF2ED', text: '#2D5A3D' },   // 绿
  { active: '#1A6B5A', light: '#E8F4F1', text: '#1A6B5A' },   // 青绿
  { active: '#5A4D1A', light: '#F6F0D8', text: '#5A4D1A' },   // 金
  { active: '#2D5A3D', light: '#EBF2ED', text: '#2D5A3D' },   // 绿
]

export default function StepBar({ current }: StepBarProps) {
  const navigate = useNavigate()
  const params = useParams()
  const projectId = params.projectId ?? projectStore.getActiveId()
  const project = projectStore.ensure(projectId)
  const outline = outlineStore.get(project.id)
  const sections = sectionStore.getByProject(project.id)
  const stage1Messages = chatStore.getByProject(project.id, 'stage1')

  const canAccess = [
    true,
    Boolean(current >= 1 || project.context.rawSummary || outline?.sections?.length || stage1Messages.length > 1),
    Boolean(current >= 2 || sections.length > 0 || outline?.confirmedAt || outline?.sections?.length),
    Boolean(current >= 3 || sections.length > 0 || outline?.confirmedAt || outline?.sections?.length),
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '0 4px',
      }}
    >
      {STEPS.map((step, i) => {
        const isDone    = i < current
        const isActive  = i === current
        const isLocked  = !canAccess[i]
        const color     = STEP_COLORS[i]

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            {/* 连接线 */}
            {i > 0 && (
              <div
                style={{
                  width: 32,
                  height: 1,
                  background: i <= current ? color.active : 'var(--color-border)',
                  opacity: i <= current ? 0.5 : 1,
                }}
              />
            )}

            {/* 步骤按钮 */}
            <button
              onClick={() => {
                if (!isLocked) {
                  navigate(`/projects/${project.id}/${step.route}`)
                }
              }}
              disabled={isLocked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 99,
                border: isActive
                  ? `1.5px solid ${color.active}`
                  : '1.5px solid transparent',
                background: isActive
                  ? color.light
                  : isDone
                  ? 'transparent'
                  : 'transparent',
                color: isActive
                  ? color.text
                  : isDone
                  ? color.active
                  : 'var(--color-ink-3)',
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                cursor: isLocked ? 'default' : 'pointer',
                opacity: isLocked ? 0.55 : 1,
                fontFamily: 'var(--font-sans)',
                transition: 'all 0.15s',
              }}
            >
              {/* 状态圆点 */}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isDone
                    ? color.active
                    : isActive
                    ? color.active
                    : 'var(--color-border)',
                  flexShrink: 0,
                  fontSize: 10,
                  color: '#fff',
                  fontWeight: 500,
                }}
              >
                {isDone ? (
                  <Check size={10} strokeWidth={2.5} />
                ) : (
                  <span>{i + 1}</span>
                )}
              </span>
              {step.label}
              {isLocked && (
                <span
                  style={{
                    fontSize: 9,
                    background: 'var(--color-border)',
                    color: 'var(--color-ink-3)',
                    borderRadius: 3,
                    padding: '1px 4px',
                  }}
                >
                  未就绪
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
