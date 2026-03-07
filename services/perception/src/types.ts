export interface SceneContextLogRow {
  id?: string
  scene_id: string
  environment_label: string
  events: string[]
  timestamp: number
  raw_summary?: Record<string, unknown>
}

export interface ObjectSightingRow {
  id?: string
  scene_id: string
  temp_id: string
  label: string
  confidence: number
  x: number
  y: number
  z: number
  distance_meters: number
  importance: number
  timestamp: number
}

export interface GeminiSceneResult {
  environment: string
  objects: {
    label: string
    confidence: number
    bounding_box: { x: number; y: number; w: number; h: number }
    importance?: number
  }[]
  events?: string[]
}
