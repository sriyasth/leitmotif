import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneContext } from "@sensible/shared-types"

const mockSceneContext: SceneContext = {
  environment: "living_room",
  people_count: 2,
  activity: "conversation",
  motion_level: "low",
  lighting: "warm",
  scene_stability: "stable",
  descriptors: ["indoor", "cozy"],
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

const { analyzeScene } = await import("../src/scene-analyzer")

describe("analyzeScene", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns SceneContext from Gemini response", async () => {
    const result = await analyzeScene("fake_base64")
    expect(result).not.toBeNull()
    expect(result!.environment).toBe("living_room")
    expect(result!.people_count).toBe(2)
    expect(result!.motion_level).toBe("low")
  })

  it("returns null on Gemini error", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("API down"))
    const result = await analyzeScene("fake_base64")
    expect(result).toBeNull()
  })

  it("returns null on invalid JSON", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => "not json" },
    })
    const result = await analyzeScene("fake_base64")
    expect(result).toBeNull()
  })
})
