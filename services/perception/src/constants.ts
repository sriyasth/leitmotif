export const DEMO_OBJECT_CLASSES = [
  "couch",
  "lamp",
  "doorway",
  "chair",
  "table",
] as const

export type DemoObjectClass = (typeof DEMO_OBJECT_CLASSES)[number]

export const ENVIRONMENT_CLASSES = [
  "living_room",
  "hallway",
  "unknown",
] as const

export type EnvironmentClass = (typeof ENVIRONMENT_CLASSES)[number]

export const SCENE_CONTEXT_UPDATE_INTERVAL_MS = 500

export const MIN_CONFIDENCE_THRESHOLD = 0.5
