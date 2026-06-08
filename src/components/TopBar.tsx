import type { ReactNode } from 'react'
import { Feather } from 'lucide-react'
import StepBar from './StepBar'

interface TopBarProps {
  currentStep: 0 | 1 | 2
  right?: ReactNode     // 右侧插槽，各页面放不同内容
}

export default function TopBar({ currentStep, right }: TopBarProps) {
  return (
    <header
      style={{
        height: 52,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* 左：侧栏外的轻量品牌标识 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'var(--color-accent-light)',
            color: 'var(--color-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather size={15} />
        </span>
      </div>

      {/* 中：步骤条 */}
      <StepBar current={currentStep} />

      {/* 右：插槽 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
      </div>
    </header>
  )
}
