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
