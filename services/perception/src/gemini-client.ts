import { GoogleGenerativeAI } from "@google/generative-ai"
import type { GeminiSceneResult } from "./types"
import { DEMO_OBJECT_CLASSES, ENVIRONMENT_CLASSES } from "./constants"

export function createGeminiClient() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("Missing GEMINI_API_KEY")
  return new GoogleGenerativeAI(key)
}

const SCENE_ANALYSIS_PROMPT = `Analyze this image and return a JSON object with:
- "environment": one of ${JSON.stringify([...ENVIRONMENT_CLASSES])}
- "objects": array of detected objects, each with:
  - "label": one of ${JSON.stringify([...DEMO_OBJECT_CLASSES])}
  - "confidence": 0-1 float
  - "bounding_box": { "x": float, "y": float, "w": float, "h": float } (normalized 0-1)
  - "importance": 0-1 float (optional)
- "events": array of event strings like "object_detected"

Only include objects from the allowed list. If uncertain, omit the object.
Return ONLY valid JSON, no markdown.`

export async function analyzeSceneWithGemini(
  genAI: GoogleGenerativeAI,
  imageBase64: string
): Promise<GeminiSceneResult> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })
  const result = await model.generateContent([
    SCENE_ANALYSIS_PROMPT,
    {
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    },
  ])
  const text = result.response.text()
  return JSON.parse(text) as GeminiSceneResult
}
