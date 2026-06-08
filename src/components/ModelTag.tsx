type Model = 'gpt' | 'doubao'

interface ModelTagProps {
  model: Model
}

const CONFIG = {
  gpt: {
    label: 'GPT',
    bg: 'var(--color-gpt-light)',
    color: 'var(--color-gpt)',
    border: '#B5D9D1',
  },
  doubao: {
    label: '豆包',
    bg: 'var(--color-doubao-light)',
    color: 'var(--color-doubao)',
    border: '#E8C0AC',
  },
}

export default function ModelTag({ model }: ModelTagProps) {
  const c = CONFIG[model]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 4,
        background: c.bg,
        color: c.color,
        border: `0.5px solid ${c.border}`,
        fontWeight: 500,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {c.label}
    </span>
  )
}
