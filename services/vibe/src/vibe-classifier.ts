import type { VibeResponse, VibeLabel } from "@sensible/shared-types"
import type { GeminiVibeResult } from "./types"
import { VIBE_LABELS } from "./constants"

function isValidVibe(vibe: string): vibe is VibeLabel {
  return (VIBE_LABELS as readonly string[]).includes(vibe)
}

export function classifyVibe(
  sceneId: string,
  timestamp: number,
  geminiResult: GeminiVibeResult
): VibeResponse {
  const vibe = isValidVibe(geminiResult.vibe) && geminiResult.confidence > 0
    ? geminiResult.vibe
    : "unknown"

  return {
    scene_id: sceneId,
    vibe,
    confidence: geminiResult.confidence,
    descriptors: geminiResult.descriptors,
    timestamp,
  }
}
