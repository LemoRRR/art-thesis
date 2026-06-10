import type { MouseEvent } from 'react'
import type { SectionFootnote } from '../lib/storage'
import { splitTextWithFootnotes } from '../lib/footnotes'

interface FootnoteTextProps {
  text: string
  footnotes: SectionFootnote[]
  onFootnoteClick?: (footnote: SectionFootnote, event: MouseEvent) => void
}

export default function FootnoteText({ text, footnotes, onFootnoteClick }: FootnoteTextProps) {
  const parts = splitTextWithFootnotes(text, footnotes)

  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={`text-${index}`}>{part.text}</span>
        }

        const footnotes = part.footnotes ?? [part.footnote!]

        return (
          <span key={part.footnote!.id}>
            {part.text}
            {footnotes.map(footnote => (
              <sup
                key={footnote.id}
                onClick={event => {
                  event.stopPropagation()
                  onFootnoteClick?.(footnote, event)
                }}
                title={footnote.noteText}
                style={{
                  fontSize: '0.68em',
                  lineHeight: 1,
                  color: '#8B5A2B',
                  marginLeft: 1,
                  fontWeight: 650,
                  verticalAlign: 'super',
                  cursor: onFootnoteClick ? 'pointer' : 'default',
                }}
              >
                [{footnote.number}]
              </sup>
            ))}
          </span>
        )
      })}
    </>
  )
}
