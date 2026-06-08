import { Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface StepBarProps {
  current: 0 | 1 | 2   // 0=阶段一, 1=阶段二, 2=阶段三
}

const STEPS = [
  { label: '材料理解', route: '/stage1' },
  { label: '撰写修改', route: '/stage2' },
  { label: '文章收尾', route: null },   // 完整版，暂不可点
]

const STEP_COLORS = [
  { active: '#2D5A3D', light: '#EBF2ED', text: '#2D5A3D' },   // 绿
  { active: '#1A6B5A', light: '#E8F4F1', text: '#1A6B5A' },   // 青绿
  { active: '#8A8480', light: '#F3F1EE', text: '#8A8480' },   // 灰（完整版）
]

export default function StepBar({ current }: StepBarProps) {
  const navigate = useNavigate()

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
        const isLocked  = step.route === null
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
                if (!isLocked && step.route && (isDone || isActive)) {
                  navigate(step.route)
                }
              }}
              disabled={isLocked || (!isDone && !isActive)}
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
                cursor: isLocked || (!isDone && !isActive) ? 'default' : 'pointer',
                opacity: isLocked ? 0.45 : 1,
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
                  完整版
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
