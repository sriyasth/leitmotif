import type { VibeResponse } from "@sensible/shared-types"
import { analyzeScene } from "./scene-analyzer"
import { classifyVibeFromContext } from "./context-classifier"
import { VIBE_UPDATE_INTERVAL_MS } from "./constants"

interface VibeInput {
  scene_id: string
  timestamp: number
  frame_image_base64?: string
}

const FALLBACK_RESPONSE = (sceneId: string, timestamp: number): VibeResponse => ({
  scene_id: sceneId,
  vibe: "unknown",
  confidence: 0,
  descriptors: [],
  timestamp,
})

let lastUpdateTimestamp = 0
let lastResponse: VibeResponse | null = null

export async function analyzeVibe(input: VibeInput): Promise<VibeResponse> {
  const now = Date.now()
  if (lastResponse && now - lastUpdateTimestamp < VIBE_UPDATE_INTERVAL_MS) {
    return lastResponse
  }

  if (!input.frame_image_base64) {
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }

  const ctx = await analyzeScene(input.frame_image_base64)
  if (!ctx) {
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }

  const response = classifyVibeFromContext(input.scene_id, input.timestamp, ctx)
  lastUpdateTimestamp = now
  lastResponse = response
  return response
}

export function resetThrottle(): void {
  lastUpdateTimestamp = 0
  lastResponse = null
}

export { classifyVibeFromContext } from "./context-classifier"
export { analyzeScene } from "./scene-analyzer"
export { VIBE_LABELS } from "./constants"
