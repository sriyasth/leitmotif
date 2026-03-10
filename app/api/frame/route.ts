import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

export const maxDuration = 30

let _ai: GoogleGenAI | null = null
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY! })
  return _ai
}

interface TrackedPersonInput {
  id: string
  description: string
  present: boolean
}

function buildPeoplePrompt(trackedPeople: TrackedPersonInput[]): string {
  const presentPeople = trackedPeople.filter(p => p.present)
  const absentPeople = trackedPeople.filter(p => !p.present)

  let peopleContext = ''
  if (presentPeople.length > 0) {
    peopleContext += `\nPeople currently in scene:\n${presentPeople.map(p => `- ${p.id}: ${p.description}`).join('\n')}\nReuse these exact IDs if the same person is still visible.`
  }
  if (absentPeople.length > 0) {
    peopleContext += `\nPeople seen before (not currently visible):\n${absentPeople.map(p => `- ${p.id}: ${p.description}`).join('\n')}\nIf any of these people have returned, reuse their EXACT ID.`
  }

  return `Count and identify people in this webcam frame. Be fast and precise.
${peopleContext}
Return ONLY valid JSON:
{
  "people_count": <integer>,
  "people": [
    { "id": "<reuse existing ID if same person, or person_N for genuinely new>", "description": "<brief: hair, clothing, position>" }
  ]
}
Rules:
- If 0 people visible, return people_count: 0 and empty array.
- Only include people actually visible in THIS frame.
- IMPORTANT: If someone matches a previously seen person (by appearance/clothing), reuse their original ID. Only assign a new ID for genuinely new people.
- Keep descriptions brief but distinctive.`
}

export async function POST(req: NextRequest) {
  try {
    const { image, trackedPeople } = await req.json() as {
      image: string
      trackedPeople: TrackedPersonInput[]
    }

    const ai = getAI()
    const prompt = buildPeoplePrompt(trackedPeople || [])

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
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
      people_count: parsed.people_count ?? 0,
      people: parsed.people ?? [],
    })
  } catch (err) {
    console.error('[API/frame] error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
