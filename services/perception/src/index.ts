import type { SceneFrameInput, SceneContextResponse } from "@sensible/shared-types"
import { analyzeScene } from "./scene-analyzer"
import { buildSceneContext } from "./scene-context-builder"
import { NullPersistence } from "./persistence/null-persistence"
import type { PersistenceStrategy } from "./persistence/persistence-strategy"
import { SCENE_CONTEXT_UPDATE_INTERVAL_MS } from "./constants"

interface ProcessSceneOptions {
  persistence?: PersistenceStrategy
}

let lastUpdateTimestamp = 0
let lastResponse: SceneContextResponse | null = null

export async function processScene(
  input: SceneFrameInput,
  options?: ProcessSceneOptions
): Promise<SceneContextResponse> {
  // Throttle: return cached response if within update interval
  const now = Date.now()
  if (lastResponse && now - lastUpdateTimestamp < SCENE_CONTEXT_UPDATE_INTERVAL_MS) {
    return lastResponse
  }

  const geminiResult = await analyzeScene(input)
  const response = buildSceneContext(input.scene_id, input.timestamp, geminiResult)

  const strategy = options?.persistence ?? new NullPersistence()
  await strategy.logSceneContext(response)
  await strategy.logObjectSightings(response.scene_id, response.objects, response.timestamp)

  lastUpdateTimestamp = now
  lastResponse = response
  return response
}

/** Reset throttle state (for testing) */
export function resetThrottle(): void {
  lastUpdateTimestamp = 0
  lastResponse = null
}

// Re-exports
export { buildSceneContext } from "./scene-context-builder"
export { filterToVocabulary } from "./object-filter"
export { estimatePosition } from "./position-estimator"
export { analyzeScene } from "./scene-analyzer"
export type { PersistenceStrategy } from "./persistence/persistence-strategy"
export { NullPersistence } from "./persistence/null-persistence"
export { SupabasePersistence } from "./persistence/supabase-persistence"
export { createSupabaseClient } from "./persistence/supabase-client"
export { DEMO_OBJECT_CLASSES, ENVIRONMENT_CLASSES } from "./constants"
