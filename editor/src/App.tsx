import { useState, useEffect, useCallback } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  BackgroundVariant,
  type Node, type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import FractalNode from './FractalNode'
import InputsPanel from './InputsPanel'
import { useStream } from './useStream'
import { toReactFlow } from './layout'
import type { SerializedGraph, Port } from './types'

const SERVER   = 'http://localhost:3000'
const nodeTypes = { fractal: FractalNode }

const STATE_COLOR = {
  idle:    '#555',
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
}

const MINIMAP_NODE_COLOR = {
  idle:    '#16161e',
  running: '#2a1e00',
  complete:'#0a1f10',
  error:   '#1f0a0a',
}

export default function App() {
  const [catalog, setCatalog]     = useState<{ name: string; graph: SerializedGraph }[]>([])
  const [selected, setSelected]   = useState('')
  const [graph, setGraph]         = useState<SerializedGraph | null>(null)
  const [inputPorts, setInputPorts] = useState<Port[]>([])
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [rfNodes, setRfNodes]     = useState<Node[]>([])
  const [rfEdges, setRfEdges]     = useState<Edge[]>([])

  const { runState, statuses, outputs, errorMsg, run, reset } = useStream()

  // Load graph list from server on mount
  useEffect(() => {
    fetch(`${SERVER}/graphs`)
      .then(r => r.json())
      .then((d: { graphs: typeof catalog }) => {
        setCatalog(d.graphs)
        if (d.graphs.length) {
          setSelected(d.graphs[0].name)
          setGraph(d.graphs[0].graph)
          const ports = d.graphs[0].graph.nodes.find(n => n.id === '$input')?.outputs ?? []
          setInputPorts(ports)
        }
      })
      .catch(() => console.error('Cannot reach server at http://localhost:3000'))
  }, [])

  // Recompute React Flow nodes/edges when graph or statuses change
  useEffect(() => {
    if (!graph) return
    const { nodes, edges } = toReactFlow(graph, statuses)
    setRfNodes(nodes)
    setRfEdges(edges)
  }, [graph, statuses])

  const handleSelect = useCallback((name: string) => {
    const found = catalog.find(g => g.name === name)
    if (!found) return
    setSelected(name)
    setGraph(found.graph)
    const ports = found.graph.nodes.find(n => n.id === '$input')?.outputs ?? []
    setInputPorts(ports)
    setInputValues({})
    reset()
  }, [catalog, reset])

  const handleInputChange = useCallback((id: string, value: string) => {
    setInputValues(prev => ({ ...prev, [id]: value }))
  }, [])

  const handleRun = useCallback(() => {
    if (graph) run(graph, inputValues)
  }, [graph, inputValues, run])

  const dotColor = STATE_COLOR[runState]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f0f' }}>

      {/* ── toolbar ── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:           12,
        padding:       '9px 16px',
        borderBottom: '1px solid #222',
        background:   '#111',
        flexShrink:    0,
      }}>
        <span style={{ color: '#e8e8e8', fontWeight: 700, fontFamily: 'monospace', fontSize: 14, letterSpacing: '-0.02em' }}>
          fractal editor
        </span>

        <select
          value={selected}
          onChange={e => handleSelect(e.target.value)}
          style={{
            background:   '#1a1a2e',
            color:        '#e8e8e8',
            border:       '1px solid #444',
            borderRadius:  6,
            padding:       '4px 8px',
            fontSize:      13,
            cursor:        'pointer',
            fontFamily:   'monospace',
          }}
        >
          {catalog.map(g => (
            <option key={g.name} value={g.name}>{g.name}</option>
          ))}
        </select>

        <button
          onClick={runState === 'running' ? reset : handleRun}
          disabled={!graph}
          style={{
            background:   runState === 'running' ? '#2b0d0d' : '#0d2b1a',
            color:        runState === 'running' ? '#ef4444' : '#22c55e',
            border:       `1px solid ${runState === 'running' ? '#ef4444' : '#22c55e'}`,
            borderRadius:  6,
            padding:       '4px 16px',
            fontSize:      13,
            cursor:        graph ? 'pointer' : 'not-allowed',
            fontFamily:   'monospace',
            fontWeight:    600,
          }}
        >
          {runState === 'running' ? '■ stop' : '▶ run'}
        </button>

        {/* status indicator */}
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:         6,
          marginLeft: 'auto',
          fontSize:    12,
          fontFamily: 'monospace',
          color:       dotColor,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor,
            boxShadow: runState === 'running' ? `0 0 6px ${dotColor}` : 'none',
          }} />
          {runState}
          {errorMsg && (
            <span style={{ color: '#ef4444', marginLeft: 8, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {errorMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── inputs panel ── */}
      <InputsPanel
        ports={inputPorts}
        values={inputValues}
        onChange={handleInputChange}
      />

      {/* ── canvas ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
        >
          <Background variant={BackgroundVariant.Dots} color="#222" gap={24} size={1} />
          <Controls
            style={{ background: '#111', border: '1px solid #333', borderRadius: 6 }}
            showInteractive={false}
          />
          <MiniMap
            style={{ background: '#111', border: '1px solid #333', borderRadius: 6 }}
            nodeColor={n => {
              const s = (statuses[n.id] ?? 'idle') as keyof typeof MINIMAP_NODE_COLOR
              return MINIMAP_NODE_COLOR[s] ?? MINIMAP_NODE_COLOR.idle
            }}
            maskColor="#0f0f0f99"
          />
        </ReactFlow>

        {catalog.length === 0 && (
          <div style={{
            position:   'absolute',
            inset:       0,
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color:      '#555',
            fontFamily: 'monospace',
            fontSize:    14,
            pointerEvents: 'none',
          }}>
            connecting to server…
          </div>
        )}
      </div>

      {/* ── outputs panel ── */}
      {outputs && (
        <div style={{
          borderTop:  '1px solid #222',
          background: '#111',
          padding:    '8px 16px',
          fontFamily: 'monospace',
          fontSize:    12,
          maxHeight:   90,
          overflowY:  'auto',
          flexShrink:  0,
          display:    'flex',
          gap:         16,
          flexWrap:   'wrap',
          alignItems: 'center',
        }}>
          <span style={{ color: '#22c55e', fontWeight: 700 }}>outputs</span>
          {Object.entries(outputs).map(([k, v]) => (
            <span key={k}>
              <span style={{ color: '#64748b' }}>{k}: </span>
              <span style={{ color: '#e8e8e8' }}>
                {typeof v === 'string' ? (v.length > 80 ? v.slice(0, 80) + '…' : v) : JSON.stringify(v)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
