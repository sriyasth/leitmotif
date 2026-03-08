import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { readFileSync } from 'fs'
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { GoogleGenAI } from '@google/genai'
import { exec } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
config({ path: path.resolve(__dirname, '../.env.local') })

const CAMERA_PORT = parseInt(process.env.CAMERA_PORT ?? '3002', 10)
const MUSIC_ENGINE_URL = process.env.MUSIC_ENGINE_URL ?? 'http://localhost:3001'

let _ai: GoogleGenAI | null = null
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  return _ai
}

// -- Person tracking state --
interface TrackedPerson {
  id: string
  description: string
  missedFrames: number // how many consecutive frames they've been absent
}

const trackedPeople = new Map<string, TrackedPerson>()
const LEAVE_THRESHOLD = 2 // must be absent for this many frames before considered "left"
let nextPersonId = 1

// -- Cached scene state (updated every 20s) --
let cachedVibe = 'calm'
let cachedEnvironment = 'unknown'
let cachedSceneDescription = ''

// -- Fast people-tracking prompt (1s) --
function buildPeoplePrompt(): string {
  const currentPeople = [...trackedPeople.values()].filter(p => p.missedFrames === 0)
  const peopleContext = currentPeople.length > 0
    ? `\nPeople currently tracked:\n${currentPeople.map(p => `- ${p.id}: ${p.description}`).join('\n')}\nReuse these exact IDs if same person is still visible.`
    : ''

  return `Count and identify people in this webcam frame. Be fast and precise.
${peopleContext}
Return ONLY valid JSON:
{
  "people_count": <integer>,
  "people": [
    { "id": "<reuse existing ID or person_N for new>", "description": "<brief: hair, clothing, position>" }
  ]
}
Rules:
- If 0 people visible, return people_count: 0 and empty array.
- Only include people actually visible in THIS frame.
- Keep descriptions brief but distinctive.`
}

// -- Full scene prompt (20s) --
function buildScenePrompt(): string {
  return `Analyze this webcam frame for an assistive audio system.
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
}

interface PeopleResult {
  visible_users: string[]
  entered: string[]
  left: string[]
}

interface SceneResult {
  vibe: string
  environment: string
  scene_description: string
}

// Fast call: people tracking only
async function analyzePeople(base64Image: string): Promise<PeopleResult> {
  const ai = getAI()
  const prompt = buildPeoplePrompt()

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  })

  const parsed = JSON.parse(response.text ?? '{}')
  const rawPeople: { id: string; description: string }[] = parsed.people ?? []
  const peopleCount: number = parsed.people_count ?? rawPeople.length

  // Normalize IDs
  const framePeople: { id: string; description: string }[] = []
  for (const p of rawPeople) {
    if (trackedPeople.has(p.id)) {
      framePeople.push({ id: p.id, description: p.description })
    } else {
      const newId = `person_${nextPersonId++}`
      framePeople.push({ id: newId, description: p.description })
    }
  }

  const effectivePeople = peopleCount === 0 ? [] : framePeople
  const currentIds = new Set(effectivePeople.map(p => p.id))
  const entered: string[] = []
  const left: string[] = []

  for (const p of effectivePeople) {
    if (!trackedPeople.has(p.id)) {
      entered.push(p.id)
      console.log(`[Tracker] ENTERED: ${p.id} (${p.description})`)
    }
    trackedPeople.set(p.id, { id: p.id, description: p.description, missedFrames: 0 })
  }

  for (const [id, person] of trackedPeople) {
    if (!currentIds.has(id)) {
      person.missedFrames++
      if (person.missedFrames === LEAVE_THRESHOLD) {
        left.push(id)
        console.log(`[Tracker] LEFT: ${id} (absent ${LEAVE_THRESHOLD} frames)`)
      }
      if (person.missedFrames > LEAVE_THRESHOLD + 3) {
        trackedPeople.delete(id)
      }
    }
  }

  return { visible_users: [...currentIds], entered, left }
}

// Slow call: full scene analysis
async function analyzeScene(base64Image: string): Promise<SceneResult> {
  const ai = getAI()
  const prompt = buildScenePrompt()

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  })

  const parsed = JSON.parse(response.text ?? '{}')
  const result = {
    vibe: parsed.vibe ?? 'calm',
    environment: parsed.environment ?? 'unknown',
    scene_description: parsed.scene_description ?? '',
  }

  // Update cached scene state
  cachedVibe = result.vibe
  cachedEnvironment = result.environment
  cachedSceneDescription = result.scene_description
  console.log(`[Scene] Updated: vibe=${result.vibe} env=${result.environment} desc="${result.scene_description}"`)

  return result
}

async function postToMusicEngine(vibe: string, environment: string, visible_users: string[]): Promise<void> {
  try {
    const res = await fetch(`${MUSIC_ENGINE_URL}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vibe, environment, visible_users }),
    })
    const data = await res.json()
    console.log('[DesktopCamera] music engine response:', data)
  } catch (err) {
    console.warn('[DesktopCamera] music engine unreachable:', (err as Error).message)
  }
}

// Serve the camera HTML page and handle frame POSTs
const cameraHtml = readFileSync(path.resolve(__dirname, 'camera.html'), 'utf-8')

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS for browser
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/camera')) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(cameraHtml)
    return
  }

  // Fast people tracking (every 1s from client)
  if (req.method === 'POST' && req.url === '/frame') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { image } = JSON.parse(body) as { image: string }

        const people = await analyzePeople(image)
        console.log('[People] visible:', people.visible_users, 'entered:', people.entered, 'left:', people.left)

        // Forward to music engine in background — don't block client response
        postToMusicEngine(cachedVibe, cachedEnvironment, people.visible_users)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ...people,
          vibe: cachedVibe,
          environment: cachedEnvironment,
          scene_description: cachedSceneDescription,
        }))
      } catch (err) {
        console.error('[People] analysis error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    return
  }

  // Full scene description (every 20s from client)
  if (req.method === 'POST' && req.url === '/scene') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { image } = JSON.parse(body) as { image: string }

        const scene = await analyzeScene(image)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(scene))
      } catch (err) {
        console.error('[Scene] analysis error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, tracked: [...trackedPeople.values()] }))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(CAMERA_PORT, () => {
  const url = `http://localhost:${CAMERA_PORT}`
  console.log(`[DesktopCamera] server running at ${url}`)
  console.log('[DesktopCamera] opening camera popup...')

  // Auto-open the browser
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${openCmd} ${url}`)
})

process.on('SIGINT', () => {
  console.log('\n[DesktopCamera] shutting down...')
  server.close()
  process.exit(0)
})
