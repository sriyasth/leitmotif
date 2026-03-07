import type { SceneFrameInput } from "@sensible/shared-types"
import type { GeminiSceneResult } from "./types"
import { ENVIRONMENT_CLASSES } from "./constants"
import { analyzeSceneWithGemini, createGeminiClient } from "./gemini-client"

let genAI: ReturnType<typeof createGeminiClient> | null = null

function getGeminiClient() {
  if (!genAI) genAI = createGeminiClient()
  return genAI
}

function resolveEnvironment(hint?: string): string {
  if (hint && (ENVIRONMENT_CLASSES as readonly string[]).includes(hint)) {
    return hint
  }
  return "unknown"
}

export async function analyzeScene(
  input: SceneFrameInput
): Promise<GeminiSceneResult> {
  // Path 1: Use pre-extracted object_candidates if available
  if (input.object_candidates && input.object_candidates.length > 0) {
    return {
      environment: resolveEnvironment(input.hints?.likely_environment),
      objects: input.object_candidates.map((c) => ({
        label: c.label,
        confidence: c.confidence,
        bounding_box: c.bounding_box,
      })),
      events: ["object_detected"],
    }
  }

  // Path 2: Call Gemini if we have an image
  if (input.frame_image_base64) {
    try {
      return await analyzeSceneWithGemini(getGeminiClient(), input.frame_image_base64)
    } catch (err) {
      console.error("Gemini analysis failed, returning empty scene:", err)
    }
  }

  // Fallback: empty scene
  return {
    environment: resolveEnvironment(input.hints?.likely_environment),
    objects: [],
  }
}
