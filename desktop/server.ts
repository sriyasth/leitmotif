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
  present: boolean     // currently visible in scene
}

const trackedPeople = new Map<string, TrackedPerson>() // never deleted — persistent memory
const LEAVE_THRESHOLD = 2 // must be absent for this many frames before considered "left"
let nextPersonId = 1

// -- Cached scene state (updated every 20s) --
let cachedVibe = 'calm'
let cachedEnvironment = 'unknown'
let cachedSceneDescription = ''

// -- Fast people-tracking prompt (1s) --
function buildPeoplePrompt(): string {
  const presentPeople = [...trackedPeople.values()].filter(p => p.present)
  const absentPeople = [...trackedPeople.values()].filter(p => !p.present)

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

  // Normalize IDs — reuse known IDs, assign new ones only for genuinely new people
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
    const existing = trackedPeople.get(p.id)
    if (!existing) {
      // Brand new person
      entered.push(p.id)
      console.log(`[Tracker] ENTERED (new): ${p.id} (${p.description})`)
    } else if (!existing.present) {
      // Known person returning
      entered.push(p.id)
      console.log(`[Tracker] RE-ENTERED: ${p.id} (${p.description})`)
    }
    trackedPeople.set(p.id, { id: p.id, description: p.description, missedFrames: 0, present: true })
  }

  for (const [id, person] of trackedPeople) {
    if (!currentIds.has(id) && person.present) {
      person.missedFrames++
      if (person.missedFrames >= LEAVE_THRESHOLD) {
        person.present = false
        left.push(id)
        console.log(`[Tracker] LEFT: ${id} (absent ${LEAVE_THRESHOLD} frames)`)
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

let musicEngineReady = false

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

async function checkMusicEngineReady(): Promise<boolean> {
  try {
    const res = await fetch(`${MUSIC_ENGINE_URL}/health`)
    const data = await res.json() as { ok: boolean; ready?: boolean }
    return data.ready === true
  } catch {
    return false
  }
}

// Pre-warm: start ambient background with no people so Lyria is connected and playing
async function warmupMusicEngine(): Promise<void> {
  console.log('[DesktopCamera] warming up music engine (empty scene)...')
  await postToMusicEngine('calm', 'unknown', [])

  // Poll until music engine reports ready
  while (!musicEngineReady) {
    musicEngineReady = await checkMusicEngineReady()
    if (!musicEngineReady) await new Promise(r => setTimeout(r, 500))
  }
  console.log('[DesktopCamera] music engine is ready')
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

  // Manual motif trigger from contacts panel
  if (req.method === 'POST' && req.url === '/play-motif') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { user_id } = JSON.parse(body) as { user_id: string }
        console.log(`[PlayMotif] triggering motif for ${user_id}`)

        // Get current visible users from camera tracking
        const currentVisible = [...trackedPeople.values()].filter(p => p.present).map(p => p.id)

        // Add the contact user and send to music engine (triggers "entering")
        const withContact = [...new Set([...currentVisible, user_id])]
        await postToMusicEngine(cachedVibe, cachedEnvironment, withContact)

        // After cooldown, remove the contact user so they can be triggered again
        setTimeout(() => {
          const stillVisible = [...trackedPeople.values()].filter(p => p.present).map(p => p.id)
          const without = stillVisible.filter(id => id !== user_id)
          postToMusicEngine(cachedVibe, cachedEnvironment, without)
          console.log(`[PlayMotif] removed ${user_id} after cooldown`)
        }, 4500)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, user_id }))
      } catch (err) {
        console.error('[PlayMotif] error:', err)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    return
  }

  if (req.method === 'GET' && req.url === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ready: musicEngineReady }))
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

server.listen(CAMERA_PORT, async () => {
  const url = `http://localhost:${CAMERA_PORT}`
  console.log(`[DesktopCamera] server running at ${url}`)

  // Pre-warm music engine before opening browser
  await warmupMusicEngine()

  console.log('[DesktopCamera] opening camera popup...')
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${openCmd} ${url}`)
})

process.on('SIGINT', () => {
  console.log('\n[DesktopCamera] shutting down...')
  server.close()
  process.exit(0)
})
