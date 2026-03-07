import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGeminiResult = {
  vibe: "calm_familiar",
  confidence: 0.87,
  descriptors: ["indoor", "stable", "low_activity"],
}

const mockGenerateContent = vi.fn().mockResolvedValue({
  response: { text: () => JSON.stringify(mockGeminiResult) },
})

vi.mock("../src/gemini-client", () => ({
  createGeminiClient: vi.fn().mockReturnValue({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  }),
}))

const { analyzeVibe, resetThrottle } = await import("../src/index")

describe("analyzeVibe", () => {
  beforeEach(() => {
    resetThrottle()
    vi.clearAllMocks()
  })

  it("returns VibeResponse from image base64", async () => {
    const result = await analyzeVibe({
      scene_id: "scene_001",
      timestamp: 1720000000,
      frame_image_base64: "fake_base64_data",
    })
    expect(result.scene_id).toBe("scene_001")
    expect(result.vibe).toBe("calm_familiar")
    expect(result.confidence).toBe(0.87)
  })

  it("returns fallback on missing image", async () => {
    const result = await analyzeVibe({
      scene_id: "scene_002",
      timestamp: 1720000000,
    })
    expect(result.vibe).toBe("unknown")
    expect(result.confidence).toBe(0)
  })

  it("returns fallback on Gemini error", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("API down"))
    const result = await analyzeVibe({
      scene_id: "scene_003",
      timestamp: 1720000000,
      frame_image_base64: "fake_base64_data",
    })
    expect(result.vibe).toBe("unknown")
    expect(result.confidence).toBe(0)
  })
})
