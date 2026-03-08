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

const VISION_PROMPT = `You are analyzing a webcam frame for an assistive audio system that helps visually impaired users.

Analyze this image and return ONLY valid JSON:
{
  "vibe": "<one of: calm, busy, tense, cheerful, empty, intimate>",
  "people": [
    { "id": "<stable short label like person_1>", "description": "<brief>" }
  ],
  "scene_description": "<one sentence describing the scene>"
}

Rules:
- If no people are visible, return an empty people array.
- Use consistent IDs for the same person across frames (based on position/appearance).
- The vibe should reflect the overall mood/energy of the scene.
- Keep it concise.`

// Track known people across frames for stable IDs
let knownPeople: string[] = []

async function analyzeFrame(base64Image: string): Promise<{ vibe: string; visible_users: string[]; scene_description: string }> {
  const ai = getAI()

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: VISION_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  })

  const text = response.text ?? '{}'
  const parsed = JSON.parse(text)

  const vibe: string = parsed.vibe ?? 'calm'
  const people: { id: string; description: string }[] = parsed.people ?? []
  const visible_users = people.map((p: { id: string }) => p.id)
  const scene_description: string = parsed.scene_description ?? ''

  knownPeople = visible_users
  return { vibe, visible_users, scene_description }
}

async function postToMusicEngine(vibe: string, visible_users: string[]): Promise<void> {
  try {
    const res = await fetch(`${MUSIC_ENGINE_URL}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vibe, visible_users }),
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

  if (req.method === 'POST' && req.url === '/frame') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { image } = JSON.parse(body) as { image: string }
        console.log('[DesktopCamera] received frame (' + Math.round(image.length / 1024) + ' KB)')

        const result = await analyzeFrame(image)
        console.log('[DesktopCamera] scene:', result.vibe, 'people:', result.visible_users)
        console.log('[DesktopCamera] description:', result.scene_description)

        // Forward to music engine
        await postToMusicEngine(result.vibe, result.visible_users)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (err) {
        console.error('[DesktopCamera] analysis error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err) }))
      }
    })
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, knownPeople }))
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
