import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSceneContext = {
  environment: "living_room",
  people_count: 1,
  activity: "sitting",
  motion_level: "low",
  lighting: "warm",
  scene_stability: "stable",
  descriptors: ["indoor", "calm"],
}

const mockGenerateContent = vi.fn().mockResolvedValue({
  response: { text: () => JSON.stringify(mockSceneContext) },
})

vi.mock("../src/gemini-client", () => ({
  createGeminiClient: vi.fn().mockReturnValue({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  }),
}))

const { analyzeVibe, resetThrottle } = await import("../src/index")

describe("analyzeVibe (two-step pipeline)", () => {
  beforeEach(() => {
    resetThrottle()
    vi.clearAllMocks()
  })

  it("returns VibeResponse derived from scene context", async () => {
    const result = await analyzeVibe({
      scene_id: "t1",
      timestamp: 1720000000,
      frame_image_base64: "fake_base64",
    })
    expect(result.scene_id).toBe("t1")
    expect(result.vibe).toBe("calm_familiar")
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.descriptors).toContain("calm")
  })

  it("returns fallback on missing image", async () => {
    const result = await analyzeVibe({
      scene_id: "t2",
      timestamp: 1720000000,
    })
    expect(result.vibe).toBe("unknown")
    expect(result.confidence).toBe(0)
  })

  it("returns fallback when Gemini fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("API down"))
    const result = await analyzeVibe({
      scene_id: "t3",
      timestamp: 1720000000,
      frame_image_base64: "fake_base64",
    })
    expect(result.vibe).toBe("unknown")
    expect(result.confidence).toBe(0)
  })

  it("throttles rapid calls", async () => {
    await analyzeVibe({
      scene_id: "t4", timestamp: 1720000000,
      frame_image_base64: "fake_base64",
    })
    const throttled = await analyzeVibe({
      scene_id: "t4_again", timestamp: 1720000001,
      frame_image_base64: "fake_base64",
    })
    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(throttled.vibe).toBe("calm_familiar")
  })
})
