export type ExecutionNode = {
  id: string
  intent: string

  inputs: Record<string, {
    type: string
    required: boolean
  }>

  outputs: Record<string, {
    type: string
  }>

  sideEffects: Array<
    | 'hardware_access'
    | 'filesystem_write'
    | 'network_access'
    | 'microphone'
    | 'camera'
  >

  constraints?: {
    offlineCapable?: boolean
    realtime?: boolean
  }
}
