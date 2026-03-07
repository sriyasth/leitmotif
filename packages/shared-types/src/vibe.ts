export type VibeLabel =
  | "calm_familiar"
  | "quiet_empty"
  | "social_active"
  | "tense_busy"
  | "transitional"
  | "unknown"

export type VibeResponse = {
  scene_id: string
  vibe: VibeLabel
  confidence: number
  descriptors: string[]
  timestamp: number
}
