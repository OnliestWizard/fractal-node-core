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

const SERVER    = 'http://localhost:3000'
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
  const [catalog, setCatalog]       = useState<{ name: string; graph: SerializedGraph }[]>([])
  const [selected, setSelected]     = useState('')
  const [graph, setGraph]           = useState<SerializedGraph | null>(null)
  const [inputPorts, setInputPorts] = useState<Port[]>([])
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [rfNodes, setRfNodes]       = useState<Node[]>([])
  const [rfEdges, setRfEdges]       = useState<Edge[]>([])

  const [plantTask, setPlantTask]   = useState('')
  const [planting, setPlanting]     = useState(false)
  const [plantError, setPlantError] = useState<string | null>(null)

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
    setPlantError(null)
    reset()
  }, [catalog, reset])

  const handleInputChange = useCallback((id: string, value: string) => {
    setInputValues(prev => ({ ...prev, [id]: value }))
  }, [])

  const handleRun = useCallback(() => {
    if (graph) run(graph, inputValues)
  }, [graph, inputValues, run])

  const handlePlant = useCallback(async () => {
    const task = plantTask.trim()
    if (!task) return
    setPlanting(true)
    setPlantError(null)
    reset()
    try {
      const res = await fetch(`${SERVER}/plant`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ task }),
      })
      const data = await res.json() as { graph?: SerializedGraph; error?: string }
      if (!res.ok || !data.graph) {
        setPlantError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setSelected('')
      setGraph(data.graph)
      const ports = data.graph.nodes.find(n => n.id === '$input')?.outputs ?? []
      setInputPorts(ports)
      setInputValues({})
    } catch (err: any) {
      setPlantError(err.message ?? 'Plant failed')
    } finally {
      setPlanting(false)
    }
  }, [plantTask, reset])

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
        flexWrap:     'wrap',
      }}>
        <span style={{ color: '#e8e8e8', fontWeight: 700, fontFamily: 'monospace', fontSize: 14, letterSpacing: '-0.02em' }}>
          fractal
        </span>

        {/* catalog dropdown */}
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
          {selected === '' && <option value="">— planted —</option>}
          {catalog.map(g => (
            <option key={g.name} value={g.name}>{g.name}</option>
          ))}
        </select>

        {/* plant input */}
        <input
          type="text"
          placeholder="describe a graph…"
          value={plantTask}
          onChange={e => setPlantTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !planting) handlePlant() }}
          disabled={planting}
          style={{
            background:   '#1a1a2e',
            color:        '#e8e8e8',
            border:       `1px solid ${plantError ? '#ef4444' : '#444'}`,
            borderRadius:  6,
            padding:       '4px 10px',
            fontSize:      13,
            fontFamily:   'monospace',
            width:         260,
            outline:      'none',
          }}
        />

        <button
          onClick={handlePlant}
          disabled={planting || !plantTask.trim()}
          style={{
            background:   planting ? '#1a1a2e' : '#1a1030',
            color:        planting ? '#555' : '#a78bfa',
            border:       '1px solid #7c3aed55',
            borderRadius:  6,
            padding:       '4px 14px',
            fontSize:      13,
            cursor:        planting || !plantTask.trim() ? 'not-allowed' : 'pointer',
            fontFamily:   'monospace',
            fontWeight:    600,
          }}
        >
          {planting ? '⟳ planting…' : '✦ plant'}
        </button>

        {/* run/stop button */}
        <button
          onClick={runState === 'running' ? reset : handleRun}
          disabled={!graph || planting}
          style={{
            background:   runState === 'running' ? '#2b0d0d' : '#0d2b1a',
            color:        runState === 'running' ? '#ef4444' : '#22c55e',
            border:       `1px solid ${runState === 'running' ? '#ef4444' : '#22c55e'}`,
            borderRadius:  6,
            padding:       '4px 16px',
            fontSize:      13,
            cursor:        graph && !planting ? 'pointer' : 'not-allowed',
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
          {(errorMsg || plantError) && (
            <span style={{ color: '#ef4444', marginLeft: 8, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {errorMsg ?? plantError}
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

        {planting && (
          <div style={{
            position:   'absolute',
            inset:       0,
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f0f0fcc',
            color:      '#a78bfa',
            fontFamily: 'monospace',
            fontSize:    14,
            gap:         10,
            pointerEvents: 'none',
          }}>
            <span style={{ animation: 'spin 1s linear infinite' }}>⟳</span>
            planting graph…
          </div>
        )}

        {!planting && catalog.length === 0 && !graph && (
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
