import type { SceneContextResponse, SceneEntity } from "@sensible/shared-types"
import type { GeminiSceneResult } from "./types"
import { filterToVocabulary } from "./object-filter"
import { estimatePosition } from "./position-estimator"

export function buildSceneContext(
  sceneId: string,
  timestamp: number,
  geminiResult: GeminiSceneResult
): SceneContextResponse {
  const filtered = filterToVocabulary(geminiResult.objects)

  const objects: SceneEntity[] = filtered.map((obj, i) => ({
    temp_id: `obj_${i}`,
    type: "object" as const,
    label: obj.label,
    confidence: obj.confidence,
    position: estimatePosition(obj.bounding_box),
    importance: obj.importance ?? obj.confidence,
    recognized: false,
  }))

  return {
    scene_id: sceneId,
    environment_label: geminiResult.environment,
    objects,
    events: geminiResult.events ?? [],
    timestamp,
  }
}
