import type { SceneEntity } from "./scene"

export type SceneFrameInput = {
  scene_id: string
  timestamp: number
  frame_image_url?: string
  frame_image_base64?: string
  object_candidates?: {
    label: string
    confidence: number
    bounding_box: {
      x: number
      y: number
      w: number
      h: number
    }
  }[]
  hints?: {
    likely_environment?: string
  }
}

export type SceneContextResponse = {
  scene_id: string
  environment_label: string
  objects: SceneEntity[]
  events: string[]
  timestamp: number
  raw_summary?: Record<string, unknown>
}
