import type { VibeResponse } from "@sensible/shared-types"
import { createGeminiClient } from "./gemini-client"
import { classifyVibe } from "./vibe-classifier"
import { VIBE_LABELS, VIBE_UPDATE_INTERVAL_MS } from "./constants"
import type { GeminiVibeResult } from "./types"

const VIBE_PROMPT = `Analyze the vibe of this scene.

Choose exactly one label from:
${VIBE_LABELS.join(", ")}.

Return JSON with:
- "vibe": one of the labels above
- "confidence": 0-1 float
- "descriptors": array of short descriptor strings

Do not output any labels outside the allowed set.
Return ONLY valid JSON, no markdown.`

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
let genAI: ReturnType<typeof createGeminiClient> | null = null

function getClient() {
  if (!genAI) genAI = createGeminiClient()
  return genAI
}

export async function analyzeVibe(input: VibeInput): Promise<VibeResponse> {
  const now = Date.now()
  if (lastResponse && now - lastUpdateTimestamp < VIBE_UPDATE_INTERVAL_MS) {
    return lastResponse
  }

  if (!input.frame_image_base64) {
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }

  try {
    const model = getClient().getGenerativeModel({ model: "gemini-2.0-flash" })
    const result = await model.generateContent([
      VIBE_PROMPT,
      { inlineData: { mimeType: "image/jpeg", data: input.frame_image_base64 } },
    ])
    const text = result.response.text()
    const parsed = JSON.parse(text) as GeminiVibeResult
    const response = classifyVibe(input.scene_id, input.timestamp, parsed)

    lastUpdateTimestamp = now
    lastResponse = response
    return response
  } catch (err) {
    console.error("Vibe analysis failed:", err)
    return FALLBACK_RESPONSE(input.scene_id, input.timestamp)
  }
}

export function resetThrottle(): void {
  lastUpdateTimestamp = 0
  lastResponse = null
}

export { classifyVibe } from "./vibe-classifier"
export { VIBE_LABELS } from "./constants"
