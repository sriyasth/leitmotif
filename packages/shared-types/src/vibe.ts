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

export type SceneContext = {
  environment: string
  people_count: number
  activity: string
  motion_level: "none" | "low" | "moderate" | "high"
  lighting: "dark" | "dim" | "neutral" | "warm" | "bright"
  scene_stability: "stable" | "changing" | "volatile"
  descriptors: string[]
}
