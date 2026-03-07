import type { SceneFrameInput } from "@sensible/shared-types"

export const livingRoomFrame: SceneFrameInput = {
  scene_id: "scene_001",
  timestamp: 1720000000,
  object_candidates: [
    { label: "couch", confidence: 0.92, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
    { label: "lamp", confidence: 0.85, bounding_box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 } },
    { label: "doorway", confidence: 0.78, bounding_box: { x: 0.5, y: 0.0, w: 0.2, h: 0.9 } },
    { label: "cat", confidence: 0.60, bounding_box: { x: 0.3, y: 0.6, w: 0.1, h: 0.1 } },
  ],
  hints: { likely_environment: "living_room" },
}

export const emptyFrame: SceneFrameInput = {
  scene_id: "scene_002",
  timestamp: 1720000500,
}

export const lowConfidenceFrame: SceneFrameInput = {
  scene_id: "scene_003",
  timestamp: 1720001000,
  object_candidates: [
    { label: "couch", confidence: 0.3, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
    { label: "lamp", confidence: 0.2, bounding_box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 } },
  ],
}

export const unknownObjectsFrame: SceneFrameInput = {
  scene_id: "scene_004",
  timestamp: 1720001500,
  object_candidates: [
    { label: "piano", confidence: 0.95, bounding_box: { x: 0.2, y: 0.2, w: 0.3, h: 0.5 } },
    { label: "guitar", confidence: 0.88, bounding_box: { x: 0.6, y: 0.3, w: 0.2, h: 0.4 } },
  ],
}
