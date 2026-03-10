import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

export const maxDuration = 30

let _ai: GoogleGenAI | null = null
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! })
  return _ai
}

const SCENE_PROMPT = `Analyze this webcam frame for an assistive audio system.
Return ONLY valid JSON:
{
  "vibe": "<one of: calm, busy, tense, cheerful, empty, intimate>",
  "environment": "<one of: indoors_home, indoors_office, indoors_public, outdoors_nature, outdoors_urban, outdoors_park, transit, unknown>",
  "scene_description": "<one sentence describing the scene>"
}
Rules:
- The vibe should reflect the overall mood/energy.
- The environment should describe the physical setting.
- Keep it concise.`

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json() as { image: string }

    const ai = getAI()
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: SCENE_PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: image } },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    })

    const parsed = JSON.parse(response.text ?? '{}')
    return NextResponse.json({
      vibe: parsed.vibe ?? 'calm',
      environment: parsed.environment ?? 'unknown',
      scene_description: parsed.scene_description ?? '',
    })
  } catch (err) {
    console.error('[API/scene] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
