import { useState, useCallback, useRef } from 'react'
import type { NodeStatus, SerializedGraph } from './types'

const SERVER = 'http://localhost:3000'

type RunState = 'idle' | 'running' | 'done' | 'error'

export function useStream() {
  const [runState, setRunState]   = useState<RunState>('idle')
  const [statuses, setStatuses]   = useState<Record<string, NodeStatus>>({})
  const [outputs,  setOutputs]    = useState<Record<string, unknown> | null>(null)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const abortRef                  = useRef<AbortController | null>(null)

  const run = useCallback(async (graph: SerializedGraph, inputs: Record<string, unknown> = {}) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatuses({})
    setOutputs(null)
    setErrorMsg(null)
    setRunState('running')

    try {
      const res = await fetch(`${SERVER}/execute/stream`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ graph, inputs }),
        signal:  ctrl.signal,
      })

      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setErrorMsg(body.error ?? `HTTP ${res.status}`)
        setRunState('error')
        return
      }

      const reader = res.body!.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''
      let   event  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })

        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            event = line.slice(7).trim()
          } else if (line.startsWith('data: ') && event) {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>

            if (event === 'node') {
              const nodeId = data.nodeId as string
              if      (data.type === 'start')    setStatuses(p => ({ ...p, [nodeId]: 'running'  }))
              else if (data.type === 'complete') setStatuses(p => ({ ...p, [nodeId]: 'complete' }))
              else if (data.type === 'error')    setStatuses(p => ({ ...p, [nodeId]: 'error'    }))
            } else if (event === 'done') {
              setOutputs(data.outputs as Record<string, unknown>)
              setRunState('done')
            } else if (event === 'error') {
              setErrorMsg(data.error as string ?? 'Execution error')
              setRunState('error')
            }

            event = ''
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setErrorMsg(err.message)
        setRunState('error')
      }
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setStatuses({})
    setOutputs(null)
    setErrorMsg(null)
    setRunState('idle')
  }, [])

  return { runState, statuses, outputs, errorMsg, run, reset }
}
