import { describe, it, expect } from "vitest"
import { buildSceneContext } from "../src/scene-context-builder"
import type { GeminiSceneResult } from "../src/types"

describe("buildSceneContext", () => {
  it("produces SceneContextResponse from GeminiSceneResult", () => {
    const geminiResult: GeminiSceneResult = {
      environment: "living_room",
      objects: [
        { label: "couch", confidence: 0.9, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
        { label: "lamp", confidence: 0.8, bounding_box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 } },
        { label: "cat", confidence: 0.7, bounding_box: { x: 0.3, y: 0.6, w: 0.1, h: 0.1 } },
      ],
      events: ["object_detected"],
    }
    const result = buildSceneContext("scene_001", 1720000000, geminiResult)
    expect(result.scene_id).toBe("scene_001")
    expect(result.environment_label).toBe("living_room")
    expect(result.objects).toHaveLength(2) // cat filtered out
    expect(result.objects.every((o) => ["couch", "lamp"].includes(o.label))).toBe(true)
    expect(result.events).toEqual(["object_detected"])
  })

  it("returns empty objects when all below confidence", () => {
    const geminiResult: GeminiSceneResult = {
      environment: "unknown",
      objects: [
        { label: "couch", confidence: 0.2, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
      ],
    }
    const result = buildSceneContext("scene_002", 1720000000, geminiResult)
    expect(result.objects).toEqual([])
  })

  it("assigns position from bounding box", () => {
    const geminiResult: GeminiSceneResult = {
      environment: "living_room",
      objects: [
        { label: "couch", confidence: 0.9, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
      ],
    }
    const result = buildSceneContext("scene_003", 1720000000, geminiResult)
    expect(result.objects[0].position).toBeDefined()
    expect(result.objects[0].position.z).toBeCloseTo(1 / 0.3)
  })
})
