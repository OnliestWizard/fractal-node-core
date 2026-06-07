import type { Port } from './types'

interface Props {
  ports:    Port[]
  values:   Record<string, string>
  onChange: (id: string, value: string) => void
}

const TEXTAREA_IDS = new Set(['prompt', 'system', 'question'])

export default function InputsPanel({ ports, values, onChange }: Props) {
  if (ports.length === 0) return null

  return (
    <div style={{
      display:      'flex',
      flexWrap:     'wrap',
      gap:           12,
      padding:       '10px 16px',
      borderBottom: '1px solid #222',
      background:   '#111',
      flexShrink:    0,
    }}>
      {ports.map(port => {
        const isLong = TEXTAREA_IDS.has(port.id)
        const shared = {
          value:     values[port.id] ?? '',
          onChange:  (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                       onChange(port.id, e.target.value),
          placeholder: port.optional ? 'optional' : `${port.id}…`,
          style: {
            background:   '#1a1a2e',
            color:        '#e8e8e8',
            border:       '1px solid #333',
            borderRadius:  5,
            padding:       '4px 8px',
            fontSize:      12,
            fontFamily:   'monospace',
            outline:      'none',
            resize:       'vertical' as const,
            width:         isLong ? 320 : 200,
            minHeight:     isLong ? 56 : undefined,
          } as React.CSSProperties,
        }

        return (
          <label key={port.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize:  10,
              fontFamily:'monospace',
              color:      port.optional ? '#555' : '#94a3b8',
              letterSpacing: '0.04em',
            }}>
              {port.id}
              <span style={{ color: '#444', marginLeft: 4 }}>{port.type}</span>
            </span>
            {isLong
              ? <textarea rows={2} {...shared} />
              : <input    type="text" {...shared} />
            }
          </label>
        )
      })}
    </div>
  )
}
