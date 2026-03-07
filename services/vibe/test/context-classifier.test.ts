import { describe, it, expect } from "vitest"
import type { SceneContext } from "@sensible/shared-types"
import { classifyVibeFromContext } from "../src/context-classifier"

describe("classifyVibeFromContext", () => {
  it("returns quiet_empty for empty dark room", () => {
    const ctx: SceneContext = {
      environment: "room", people_count: 0, activity: "none",
      motion_level: "none", lighting: "dim",
      scene_stability: "stable", descriptors: ["empty", "dark"],
    }
    const result = classifyVibeFromContext("s1", Date.now(), ctx)
    expect(result.vibe).toBe("quiet_empty")
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it("returns social_active for group with motion", () => {
    const ctx: SceneContext = {
      environment: "living_room", people_count: 3, activity: "conversation",
      motion_level: "moderate", lighting: "warm",
      scene_stability: "stable", descriptors: ["social", "group"],
    }
    const result = classifyVibeFromContext("s2", Date.now(), ctx)
    expect(result.vibe).toBe("social_active")
  })

  it("returns tense_busy for high motion volatile scene", () => {
    const ctx: SceneContext = {
      environment: "kitchen", people_count: 2, activity: "rushing",
      motion_level: "high", lighting: "bright",
      scene_stability: "volatile", descriptors: ["busy"],
    }
    const result = classifyVibeFromContext("s3", Date.now(), ctx)
    expect(result.vibe).toBe("tense_busy")
  })

  it("returns calm_familiar for warm stable room with 1 person", () => {
    const ctx: SceneContext = {
      environment: "bedroom", people_count: 1, activity: "sitting",
      motion_level: "low", lighting: "warm",
      scene_stability: "stable", descriptors: ["calm", "indoor"],
    }
    const result = classifyVibeFromContext("s4", Date.now(), ctx)
    expect(result.vibe).toBe("calm_familiar")
  })

  it("returns transitional for changing scene", () => {
    const ctx: SceneContext = {
      environment: "hallway", people_count: 1, activity: "walking",
      motion_level: "low", lighting: "neutral",
      scene_stability: "stable", descriptors: ["movement"],
    }
    const result = classifyVibeFromContext("s5", Date.now(), ctx)
    expect(result.vibe).toBe("transitional")
  })

  it("returns unknown for ambiguous context", () => {
    const ctx: SceneContext = {
      environment: "unknown", people_count: 0, activity: "unknown",
      motion_level: "moderate", lighting: "dim",
      scene_stability: "stable", descriptors: [],
    }
    const result = classifyVibeFromContext("s6", Date.now(), ctx)
    expect(result.vibe).toBe("unknown")
  })

  it("always returns valid VibeResponse shape", () => {
    const ctx: SceneContext = {
      environment: "office", people_count: 2, activity: "working",
      motion_level: "low", lighting: "bright",
      scene_stability: "stable", descriptors: ["work"],
    }
    const result = classifyVibeFromContext("s7", 1720000000, ctx)
    expect(result).toHaveProperty("scene_id", "s7")
    expect(result).toHaveProperty("timestamp", 1720000000)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(Array.isArray(result.descriptors)).toBe(true)
  })

  it("clamps confidence to [0, 1] for extreme inputs", () => {
    const ctx: SceneContext = {
      environment: "stadium", people_count: 100, activity: "cheering",
      motion_level: "high", lighting: "bright",
      scene_stability: "volatile", descriptors: ["crowded"],
    }
    const result = classifyVibeFromContext("s8", Date.now(), ctx)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
  })
})
