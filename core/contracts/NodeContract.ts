// core/contracts/NodeContract.ts

export type PortType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'audio'
  | 'image'
  | 'any';

export interface NodePort {
  id: string;
  type: PortType;
  optional?: boolean;
}

export interface NodeContract {
  /** Stable semantic identifier (never changes once published) */
  id: string;

  /** Human meaning, not implementation detail */
  description?: string;

  /** Declared inputs (no defaults, no logic) */
  inputs: NodePort[];

  /** Declared outputs */
  outputs: NodePort[];

  /** Optional semantic tags (used by emitters, visualizers, AI) */
  tags?: string[];

  /** Versioned meaning, NOT implementation */
  version?: string;
}
