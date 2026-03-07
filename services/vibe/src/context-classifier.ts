import type { VibeResponse, VibeLabel, SceneContext } from "@sensible/shared-types"

const MOTION: Record<SceneContext["motion_level"], number> = {
  none: 0, low: 0.25, moderate: 0.5, high: 0.9,
}
const INSTABILITY: Record<SceneContext["scene_stability"], number> = {
  stable: 0, changing: 0.5, volatile: 0.9,
}
const WARMTH: Record<SceneContext["lighting"], number> = {
  dark: 0.1, dim: 0.3, neutral: 0.5, warm: 0.8, bright: 0.6,
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function classifyVibeFromContext(
  sceneId: string,
  timestamp: number,
  ctx: SceneContext
): VibeResponse {
  const motion = MOTION[ctx.motion_level] ?? 0.5
  const instability = INSTABILITY[ctx.scene_stability] ?? 0.5
  const warmth = WARMTH[ctx.lighting] ?? 0.5

  let vibe: VibeLabel
  let confidence: number
  let descriptors = [...ctx.descriptors]

  if (motion >= 0.5 && instability >= 0.5) {
    vibe = "tense_busy"
    confidence = clamp((motion + instability) / 2)
    descriptors.push("high_motion", "rapid_change")
  } else if (ctx.people_count >= 2 && motion >= 0.25) {
    vibe = "social_active"
    confidence = clamp(Math.min(ctx.people_count / 4, 1) * 0.5 + motion * 0.5)
    descriptors.push("social", "active")
  } else if (instability >= 0.5 || ctx.activity === "walking") {
    vibe = "transitional"
    confidence = clamp(instability * 0.6 + motion * 0.4)
    if (confidence < 0.3) confidence = 0.4
    descriptors.push("changing")
  } else if (ctx.people_count === 0 && motion <= 0.25) {
    vibe = "quiet_empty"
    confidence = clamp((1 - motion) * 0.6 + 0.4)
    descriptors.push("empty", "still")
  } else if (ctx.people_count <= 2 && motion <= 0.25 && warmth >= 0.5) {
    vibe = "calm_familiar"
    confidence = clamp(warmth * 0.4 + (1 - motion) * 0.3 + 0.3)
    descriptors.push("calm", "warm")
  } else if (ctx.people_count === 1 && motion <= 0.5) {
    vibe = "calm_familiar"
    confidence = 0.6
    descriptors.push("stable", "low_activity")
  } else {
    vibe = "unknown"
    confidence = 0.3
    descriptors.push("ambiguous")
  }

  return { scene_id: sceneId, vibe, confidence, descriptors, timestamp }
}
