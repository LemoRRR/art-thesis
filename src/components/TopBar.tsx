import type { ReactNode } from 'react'
import { Feather } from 'lucide-react'
import StepBar from './StepBar'

interface TopBarProps {
  currentStep: 0 | 1 | 2 | 3
  right?: ReactNode
}

export default function TopBar({ currentStep, right }: TopBarProps) {
  return (
    <header
      style={{
        minHeight: right ? 92 : 52,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: right ? '8px 20px 9px' : '0 20px',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '40px minmax(0, 1fr)',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
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

        <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-start' }}>
          <StepBar current={currentStep} />
        </div>
      </div>

      {right && (
        <div
          style={{
            width: '100%',
            marginTop: 8,
            display: 'flex',
            justifyContent: 'flex-end',
            overflowX: 'auto',
            overflowY: 'hidden',
            paddingBottom: 1,
          }}
        >
          {right}
        </div>
      )}
    </header>
  )
}
