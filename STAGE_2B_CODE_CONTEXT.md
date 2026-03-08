# Stage 2B — Gemini Vision + Deterministic Vibe Pipeline

## Overview

Stage 2B refactors vibe inference into a **two-step pipeline**:

1. **Gemini Vision** extracts structured scene facts (`SceneContext`) from a video frame
2. A **deterministic classifier** maps those facts to a `VibeResponse` with one of 6 fixed vibe labels

This decouples the vibe label from LLM nondeterminism — Gemini only describes what it sees, and the classifier always produces the same output for the same scene facts.

### Pipeline

```
frame_image_base64
  → Gemini Vision (scene facts prompt)
  → SceneContext JSON (structured intermediate)
  → classifyVibeFromContext() (deterministic rules)
  → VibeResponse JSON (final output for Stage 3)
```

### Vibe Labels (fixed set of 6)

```
calm_familiar | quiet_empty | social_active | tense_busy | transitional | unknown
```

---

## Shared Types

### `packages/shared-types/src/vibe.ts`

```ts
export type VibeLabel =
  | "calm_familiar"
  | "quiet_empty"
  | "social_active"
  | "tense_busy"
  | "transitional"
  | "unknown"

export type VibeResponse = {
  scene_id: string
  vibe: VibeLabel
  confidence: number
  descriptors: string[]
  timestamp: number
}

export type SceneContext = {
  environment: string
  people_count: number
  activity: string
  motion_level: "none" | "low" | "moderate" | "high"
  lighting: "dark" | "dim" | "neutral" | "warm" | "bright"
  scene_stability: "stable" | "changing" | "volatile"
  descriptors: string[]
}
```

### `packages/shared-types/src/index.ts`

```ts
export * from "./scene"
export * from "./context"
export * from "./vibe"
```

---

## Vibe Service Source

### `services/vibe/src/constants.ts`

```ts
export const VIBE_LABELS = [
  "calm_familiar",
  "quiet_empty",
  "social_active",
  "tense_busy",
  "transitional",
  "unknown",
] as const

export const VIBE_UPDATE_INTERVAL_MS = 500
```

### `services/vibe/src/types.ts` (legacy, kept for reference)

```ts
export interface GeminiVibeResult {
  vibe: string
  confidence: number
  descriptors: string[]
}
```

### `services/vibe/src/gemini-client.ts`

```ts
import { GoogleGenerativeAI } from "@google/generative-ai"

export function createGeminiClient() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("Missing GEMINI_API_KEY")
  return new GoogleGenerativeAI(key)
}
```

### `services/vibe/src/scene-analyzer.ts` (NEW — Step 1: Gemini extracts scene facts)

```ts
import type { SceneContext } from "@sensible/shared-types"
import { createGeminiClient } from "./gemini-client"

const SCENE_CONTEXT_PROMPT = `Analyze this image and describe the scene.

Return ONLY valid JSON with these exact fields:
- "environment": string (e.g. "living_room", "kitchen", "office", "hallway", "outdoor")
- "people_count": number (how many people are visible, 0 if none)
- "activity": string (e.g. "sitting", "conversation", "walking", "cooking", "none")
- "motion_level": one of "none", "low", "moderate", "high"
- "lighting": one of "dark", "dim", "neutral", "warm", "bright"
- "scene_stability": one of "stable", "changing", "volatile"
- "descriptors": string[] (2-5 short tags describing the scene)

Do NOT classify mood or vibe. Only describe what you see.
Return ONLY valid JSON, no markdown, no explanation.`

let client: ReturnType<typeof createGeminiClient> | null = null

function getClient() {
  if (!client) client = createGeminiClient()
  return client
}

export async function analyzeScene(imageBase64: string): Promise<SceneContext | null> {
  try {
    const model = getClient().getGenerativeModel({ model: "gemini-2.0-flash" })
    const result = await model.generateContent([
      SCENE_CONTEXT_PROMPT,
      { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
    ])
    const text = result.response.text()
    return JSON.parse(text) as SceneContext
  } catch (err) {
    console.error("Scene analysis failed:", err)
    return null
  }
}
```

### `services/vibe/src/context-classifier.ts` (NEW — Step 2: deterministic rules)

```ts
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
```

### `services/vibe/src/index.ts` (REWRITTEN — two-step pipeline entry point)

```ts
import type { VibeResponse } from "@sensible/shared-types"
import { analyzeScene } from "./scene-analyzer"
import { classifyVibeFromContext } from "./context-classifier"
import { VIBE_UPDATE_INTERVAL_MS } from "./constants"

interface VibeInput {
  scene_id: string
  timestamp: number
  frame_image_base64?: string
}

const FALLBACK_RESPONSE = (sceneId: string, timestamp: number): VibeResponse => ({
  scene_id: sceneId,
  vibe: "unknown",
  confidence: 0,
  descriptors: [],
  timestamp,
})

let lastUpdateTimestamp = 0
let lastResponse: VibeResponse | null = null

export async function analyzeVibe(input: VibeInput): Promise<VibeResponse> {
  const now = Date.now()
  if (lastResponse && now - lastUpdateTimestamp < VIBE_UPDATE_INTERVAL_MS) {
    return lastResponse
  }

  if (!input.frame_image_base64) {
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }

  const ctx = await analyzeScene(input.frame_image_base64)
  if (!ctx) {
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }

  const response = classifyVibeFromContext(input.scene_id, input.timestamp, ctx)
  lastUpdateTimestamp = now
  lastResponse = response
  return response
}

export function resetThrottle(): void {
  lastUpdateTimestamp = 0
  lastResponse = null
}

export { classifyVibeFromContext } from "./context-classifier"
export { analyzeScene } from "./scene-analyzer"
export { VIBE_LABELS } from "./constants"
```

### `services/vibe/src/vibe-classifier.ts` (legacy, preserved for reference)

```ts
import type { VibeResponse, VibeLabel } from "@sensible/shared-types"
import type { GeminiVibeResult } from "./types"
import { VIBE_LABELS } from "./constants"

function isValidVibe(vibe: string): vibe is VibeLabel {
  return (VIBE_LABELS as readonly string[]).includes(vibe)
}

export function classifyVibe(
  sceneId: string,
  timestamp: number,
  geminiResult: GeminiVibeResult
): VibeResponse {
  const vibe = isValidVibe(geminiResult.vibe) && geminiResult.confidence > 0
    ? geminiResult.vibe
    : "unknown"

  return {
    scene_id: sceneId,
    vibe,
    confidence: geminiResult.confidence,
    descriptors: geminiResult.descriptors,
    timestamp,
  }
}
```

---

## CLI Runners

### `services/vibe/run-test.ts` (real Gemini test)

```ts
import { readFileSync } from "node:fs"
import { analyzeVibe } from "./src/index"

async function main() {
  const imagePath = process.argv[2]
  if (!imagePath) {
    console.error("Usage: npx tsx run-test.ts <path-to-image.jpg>")
    process.exit(1)
  }

  const imageBase64 = readFileSync(imagePath).toString("base64")

  const response = await analyzeVibe({
    scene_id: "test_001",
    timestamp: Date.now(),
    frame_image_base64: imageBase64,
  })

  console.log(JSON.stringify(response, null, 2))
}

main()
```

### `services/vibe/run-test-mock.ts` (offline mock test using legacy classifier)

```ts
import { classifyVibe } from "./src/vibe-classifier"

function main() {
  const response = classifyVibe("test_mock_001", Date.now(), {
    vibe: "calm_familiar",
    confidence: 0.87,
    descriptors: ["indoor", "stable", "low_activity"],
  })
  console.log(JSON.stringify(response, null, 2))
}

main()
```

---

## Tests

### `services/vibe/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
})
```

### `services/vibe/test/context-classifier.test.ts` (8 tests)

```ts
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
```

### `services/vibe/test/scene-analyzer.test.ts` (3 tests)

```ts
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
```

### `services/vibe/test/integration-pipeline.test.ts` (4 tests)

```ts
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
```

### `services/vibe/test/vibe-classifier.test.ts` (3 tests, legacy — still passing)

```ts
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
```

---

## Config

### `services/vibe/package.json`

```json
{
  "name": "@sensible/vibe",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@sensible/shared-types": "*"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Test Results

All 18 vibe tests pass across 4 test files:

| Test File | Tests | Status |
|---|---|---|
| `context-classifier.test.ts` | 8 | PASS |
| `scene-analyzer.test.ts` | 3 | PASS |
| `integration-pipeline.test.ts` | 4 | PASS |
| `vibe-classifier.test.ts` | 3 | PASS |

Perception service tests (21/21) also unaffected.

---

## Classifier Rule Priority

The deterministic classifier evaluates rules in this order:

| Priority | Condition | Vibe Label |
|---|---|---|
| 1 | motion >= 0.5 AND instability >= 0.5 | `tense_busy` |
| 2 | people >= 2 AND motion >= 0.25 | `social_active` |
| 3 | instability >= 0.5 OR activity == "walking" | `transitional` |
| 4 | people == 0 AND motion <= 0.25 | `quiet_empty` |
| 5 | people <= 2 AND motion <= 0.25 AND warmth >= 0.5 | `calm_familiar` |
| 6 | people == 1 AND motion <= 0.5 | `calm_familiar` |
| 7 | fallback | `unknown` |

---

## Running

```bash
# Unit tests
npm -w @sensible/vibe run test

# Real Gemini test (requires GEMINI_API_KEY in env)
export $(grep -v '^#' .env.local | xargs)
npx tsx services/vibe/run-test.ts test-assets/frame.jpg

# Mock test (no API needed)
npx tsx services/vibe/run-test-mock.ts

# Build
npm -w @sensible/shared-types run build && npm -w @sensible/vibe run build
```
