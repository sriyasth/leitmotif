import type { GeminiSceneResult } from "../../src/types"

export const livingRoomGeminiResponse: GeminiSceneResult = {
  environment: "living_room",
  objects: [
    { label: "couch", confidence: 0.92, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
    { label: "lamp", confidence: 0.85, bounding_box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 } },
    { label: "doorway", confidence: 0.78, bounding_box: { x: 0.5, y: 0.0, w: 0.2, h: 0.9 } },
  ],
  events: ["object_detected"],
}

export const emptyGeminiResponse: GeminiSceneResult = {
  environment: "unknown",
  objects: [],
}
