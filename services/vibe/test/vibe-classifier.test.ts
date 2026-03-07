import { describe, it, expect } from "vitest"
import { classifyVibe } from "../src/vibe-classifier"
import type { GeminiVibeResult } from "../src/types"

describe("classifyVibe", () => {
  it("returns valid VibeResponse from Gemini result", () => {
    const input: GeminiVibeResult = {
      vibe: "calm_familiar",
      confidence: 0.87,
      descriptors: ["indoor", "stable", "low_activity"],
    }
    const result = classifyVibe("scene_001", 1720000000, input)
    expect(result.scene_id).toBe("scene_001")
    expect(result.vibe).toBe("calm_familiar")
    expect(result.confidence).toBe(0.87)
    expect(result.descriptors).toEqual(["indoor", "stable", "low_activity"])
    expect(result.timestamp).toBe(1720000000)
  })

  it("clamps to 'unknown' for invalid vibe label", () => {
    const bad: GeminiVibeResult = { vibe: "happy_excited", confidence: 0.9, descriptors: [] }
    const result = classifyVibe("scene_002", 1720000000, bad)
    expect(result.vibe).toBe("unknown")
  })

  it("clamps to 'unknown' when confidence is 0", () => {
    const low: GeminiVibeResult = { vibe: "calm_familiar", confidence: 0, descriptors: [] }
    const result = classifyVibe("scene_003", 1720000000, low)
    expect(result.vibe).toBe("unknown")
  })
})
