import { describe, it, expect, vi } from "vitest"
import type { SceneFrameInput } from "@sensible/shared-types"

const mockGeminiResponse = {
  environment: "living_room",
  objects: [
    { label: "couch", confidence: 0.92, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
  ],
  events: ["object_detected"],
}

vi.mock("../src/gemini-client", () => ({
  analyzeSceneWithGemini: vi.fn().mockResolvedValue(mockGeminiResponse),
  createGeminiClient: vi.fn(),
}))

// Import after mock setup
const { analyzeScene } = await import("../src/scene-analyzer")

describe("analyzeScene", () => {
  it("uses object_candidates when provided (skips Gemini)", async () => {
    const input: SceneFrameInput = {
      scene_id: "scene_001",
      timestamp: 1720000000,
      object_candidates: [
        { label: "couch", confidence: 0.9, bounding_box: { x: 0.1, y: 0.3, w: 0.4, h: 0.3 } },
      ],
      hints: { likely_environment: "living_room" },
    }
    const result = await analyzeScene(input)
    expect(result.environment).toBe("living_room")
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].label).toBe("couch")
  })

  it("defaults environment to 'unknown' when no hints", async () => {
    const input: SceneFrameInput = {
      scene_id: "scene_002",
      timestamp: 1720000000,
      object_candidates: [
        { label: "lamp", confidence: 0.8, bounding_box: { x: 0.5, y: 0.1, w: 0.1, h: 0.4 } },
      ],
    }
    const result = await analyzeScene(input)
    expect(result.environment).toBe("unknown")
  })

  it("returns empty objects when no candidates and no image", async () => {
    const input: SceneFrameInput = {
      scene_id: "scene_003",
      timestamp: 1720000000,
    }
    const result = await analyzeScene(input)
    expect(result.objects).toEqual([])
    expect(result.environment).toBe("unknown")
  })
})
