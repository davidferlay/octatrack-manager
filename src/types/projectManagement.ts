export interface OctatrackProject {
  name: string
  path: string
  has_project_file: boolean
  has_banks: boolean
}

export interface OctatrackSet {
  name: string
  path: string
  has_audio_pool: boolean
  projects: OctatrackProject[]
}

export interface ClipboardState {
  kind: 'project' | 'set'
  path: string
  name: string
}

export interface DraggedProject {
  path: string
  name: string
  sourceSetPath: string
}

export type ContextTarget =
  | { kind: 'project'; project: OctatrackProject; setPath: string; setName: string }
  | { kind: 'set'; setPath: string; setName: string }
  | { kind: 'location'; locationPath: string; locationName: string }
  | { kind: 'standaloneGroup'; locationPath: string; locationName: string }

export interface ContextMenuState {
  x: number
  y: number
  target: ContextTarget
}
