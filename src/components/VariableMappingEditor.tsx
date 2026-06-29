// Editable variable-to-column mapping for the research-analysis confirmation
// step. Lets the user correct which data column the AI assigned to each role
// before the analysis runs.
import type { CSSProperties } from 'react'
import type { ResearchAnalysisPlan } from '../lib/storage'
import { ROLE_LABELS, applyVariableColumn } from '../lib/researchLabels'

interface VariableMappingEditorProps {
  plan: ResearchAnalysisPlan
  columns: string[]
  numericColumns: string[]
  onChange: (plan: ResearchAnalysisPlan) => void
}

export default function VariableMappingEditor({
  plan,
  columns,
  numericColumns,
  onChange,
}: VariableMappingEditorProps) {
  if (!plan.variables.length) return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {plan.variables.map((variable, index) => {
        // Group/categorical roles can be any column; the rest prefer numeric.
        const options = variable.role === 'group'
          ? columns
          : (numericColumns.length ? numericColumns : columns)
        const unmapped = !variable.column
        const lowConfidence = (variable.confidence ?? 1) < 0.7
        return (
          <div key={`${variable.role}-${index}`} style={rowStyle(unmapped)}>
            <span style={roleBadgeStyle}>{ROLE_LABELS[variable.role] ?? variable.role}</span>
            <strong style={nameStyle}>{variable.name}</strong>
            <select
              value={variable.column ?? ''}
              onChange={event => onChange(applyVariableColumn(plan, index, event.target.value))}
              style={selectStyle}
            >
              <option value="">未选择</option>
              {options.map(column => (
                <option key={column} value={column}>{column}</option>
              ))}
            </select>
            {(unmapped || lowConfidence) && (
              <small style={hintStyle}>{unmapped ? '请选择对应数据列' : '建议确认这一项'}</small>
            )}
          </div>
        )
      })}
    </div>
  )
}

const rowStyle = (unmapped: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: '64px 1fr 1.2fr',
  gridTemplateRows: 'auto auto',
  columnGap: 8,
  rowGap: 2,
  alignItems: 'center',
  border: `1px solid ${unmapped ? 'var(--color-accent)' : 'var(--color-border)'}`,
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
  color: 'var(--color-ink-2)',
  background: 'var(--color-surface)',
})

const roleBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--color-accent)',
  whiteSpace: 'nowrap',
}

const nameStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-ink)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const selectStyle: CSSProperties = {
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  padding: '4px 6px',
  fontSize: 11,
  color: 'var(--color-ink)',
  background: 'var(--color-bg)',
  width: '100%',
}

const hintStyle: CSSProperties = {
  gridColumn: '2 / 4',
  fontSize: 10,
  color: 'var(--color-accent)',
}
