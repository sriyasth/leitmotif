import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PersistenceStrategy } from "../src/persistence/persistence-strategy"
import { livingRoomFrame, emptyFrame } from "./fixtures/mock-scenes"

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

const { processScene, resetThrottle } = await import("../src/index")

describe("processScene", () => {
  let mockPersistence: PersistenceStrategy

  beforeEach(() => {
    resetThrottle()
    mockPersistence = {
      logSceneContext: vi.fn().mockResolvedValue(undefined),
      logObjectSightings: vi.fn().mockResolvedValue(undefined),
    }
  })

  it("returns SceneContextResponse with filtered objects and calls persistence", async () => {
    const result = await processScene(livingRoomFrame, { persistence: mockPersistence })
    expect(result.scene_id).toBe("scene_001")
    expect(result.environment_label).toBe("living_room")
    expect(result.objects.length).toBeGreaterThan(0)
    expect(result.objects.every((o) => o.type === "object")).toBe(true)
    expect(mockPersistence.logSceneContext).toHaveBeenCalledOnce()
    expect(mockPersistence.logObjectSightings).toHaveBeenCalledOnce()
  })

  it("works without persistence (defaults to NullPersistence)", async () => {
    const result = await processScene(livingRoomFrame)
    expect(result.scene_id).toBe("scene_001")
  })

  it("returns empty objects for empty frame", async () => {
    const result = await processScene(emptyFrame, { persistence: mockPersistence })
    expect(result.objects).toEqual([])
  })
})
