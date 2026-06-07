import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { SerializedNode, NodeStatus } from './types'

interface Props {
  data: { node: SerializedNode; status: NodeStatus }
}

const BG: Record<NodeStatus, string> = {
  idle:     '#16161e',
  running:  '#2a1e00',
  complete: '#0a1f10',
  error:    '#1f0a0a',
}

const BORDER: Record<NodeStatus, string> = {
  idle:     '#333',
  running:  '#f59e0b',
  complete: '#22c55e',
  error:    '#ef4444',
}

const TYPE_COLOR: Record<string, string> = {
  string:  '#60a5fa',
  number:  '#a78bfa',
  boolean: '#34d399',
  object:  '#fb923c',
  audio:   '#f472b6',
  image:   '#e879f9',
  void:    '#64748b',
  any:     '#94a3b8',
}

function portColor(type: string) {
  return TYPE_COLOR[type] ?? '#94a3b8'
}

export default memo(function FractalNode({ data }: Props) {
  const { node, status } = data
  const ports = Math.max(node.inputs.length, node.outputs.length, 1)

  return (
    <div style={{
      background:    BG[status],
      border:        `1.5px solid ${BORDER[status]}`,
      borderRadius:  7,
      width:         210,
      fontFamily:    'monospace',
      fontSize:      12,
      transition:    'border-color 0.12s, background 0.12s',
      overflow:      'hidden',
    }}>

      {/* ── header ── */}
      <div style={{
        padding:      '6px 10px',
        borderBottom: `1px solid ${BORDER[status]}33`,
        display:      'flex',
        alignItems:   'center',
        gap:           6,
      }}>
        <span style={{ color: '#e8e8e8', fontWeight: 700, fontSize: 13, flex: 1 }}>
          {node.id}
        </span>
        {node.loop   && <Badge label="loop"   color="#7c3aed" />}
        {node.router && <Badge label="route"  color="#0891b2" />}
        {node.agent  && <Badge label="agent"  color="#dc2626" />}
        {node.subgraph && !node.loop && <Badge label="graph" color="#059669" />}
      </div>

      {/* ── ports ── */}
      <div style={{ padding: '4px 0' }}>
        {Array.from({ length: ports }).map((_, i) => {
          const inp = node.inputs[i]
          const out = node.outputs[i]
          return (
            <div key={i} style={{
              display:        'flex',
              justifyContent: 'space-between',
              alignItems:     'center',
              height:          24,
              position:       'relative',
            }}>
              {/* input port */}
              <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 10, flex: 1 }}>
                {inp && (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={inp.id}
                      style={{ background: portColor(inp.type), width: 8, height: 8, left: -4, border: 'none' }}
                    />
                    <span style={{ color: '#94a3b8' }}>{inp.id}</span>
                    <span style={{ color: portColor(inp.type), marginLeft: 4, fontSize: 10, opacity: 0.8 }}>{inp.type}</span>
                  </>
                )}
              </div>

              {/* output port */}
              <div style={{ display: 'flex', alignItems: 'center', paddingRight: 10, justifyContent: 'flex-end', flex: 1 }}>
                {out && (
                  <>
                    <span style={{ color: portColor(out.type), marginRight: 4, fontSize: 10, opacity: 0.8 }}>{out.type}</span>
                    <span style={{ color: '#94a3b8' }}>{out.id}</span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={out.id}
                      style={{ background: portColor(out.type), width: 8, height: 8, right: -4, border: 'none' }}
                    />
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background:   `${color}22`,
      border:       `1px solid ${color}66`,
      color,
      fontSize:      9,
      padding:       '1px 5px',
      borderRadius:  3,
      letterSpacing: '0.03em',
    }}>
      {label}
    </span>
  )
}
