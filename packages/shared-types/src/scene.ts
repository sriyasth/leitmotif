export type Vec3 = { x: number; y: number; z: number }

export type SceneEntity = {
  temp_id: string
  persistent_id?: string
  type: "person" | "object" | "environment"
  label: string
  confidence: number
  position: Vec3
  importance: number
  recognized: boolean
  motif_id?: string
}

export type SceneAnalysisResponse = {
  scene_id: string
  environment_label: string
  entities: SceneEntity[]
  events: string[]
  timestamp: number
}
