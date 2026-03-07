import path from 'path'
import { fileURLToPath } from 'url' // Required to replicate __dirname
import { config } from 'dotenv'

// Replicate __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../.env.local') })

import { createWriteStream } from 'fs'
import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { runContextEngine } from './context-engine.js'
import { LyriaPlayer } from './lyria-player.js'
import type { MusicState, SceneInput } from './types.js'
import Speaker from 'speaker'

export class MusicEngine {
  private musicState: MusicState | null = null
  private player: LyriaPlayer
  private running = false
  private segmentTimer: ReturnType<typeof setInterval> | null = null

  constructor(onAudioChunk: (chunk: Buffer) => void = () => {}) {
    this.player = new LyriaPlayer(onAudioChunk)
  }

  async start(input: SceneInput): Promise<void> {
    await this.player.connect()
    this.running = true
    await this._cycle(input)
  }

  // Call this each time the scene changes (new frame, user enters/leaves, vibe shifts)
  async update(input: SceneInput): Promise<void> {
    if (!this.running) return
    await this._cycle(input)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.segmentTimer) clearInterval(this.segmentTimer)
    await this.player.stop()
  }

  private async _cycle(input: SceneInput): Promise<void> {
    try {
      console.log('[MusicEngine] running context engine...')
      const { lyriaPrompt, newMusicState } = await runContextEngine(input, this.musicState)
      this.musicState = newMusicState

      console.log('[MusicEngine] bpm:', lyriaPrompt.bpm)
      console.log('[MusicEngine] prompt:', lyriaPrompt.text.slice(0, 200))

      try {
        await this.player.updatePrompt(lyriaPrompt)
      } catch (updateErr) {
        console.warn('[MusicEngine] updatePrompt failed, trying play anyway:', updateErr)
      }
      await this.player.play()
    } catch (err) {
      console.error('[MusicEngine] cycle error:', err)
    }
  }
}

// HTTP server — upstream pipeline POSTs { vibe, visible_users } to /update
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = parseInt(process.env.MUSIC_ENGINE_PORT ?? '3001', 10)
  const OUTPUT_FILE = path.resolve(__dirname, '../music-output.wav')

  function stripWavHeader(chunk: Buffer): Buffer {
    if (chunk.length > 44 && chunk.toString('ascii', 0, 4) === 'RIFF') {
      return chunk.subarray(44)
    }
    return chunk
  }

  const speaker = new Speaker({
    channels: 2,
    bitDepth: 16,
    sampleRate: 48000,
  })

  const fileWriter = createWriteStream(OUTPUT_FILE)

  const engine = new MusicEngine((chunk) => {
    const pcm = stripWavHeader(chunk)
    if (pcm.length > 0) speaker.write(pcm)
    fileWriter.write(chunk)
  })

  console.log('[MusicEngine] audio output → speakers + ' + OUTPUT_FILE)

  let started = false

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/update') {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const scene = JSON.parse(body) as SceneInput
          console.log('[MusicEngine] received scene update:', scene)

          if (!started) {
            started = true
            await engine.start(scene)
          } else {
            await engine.update(scene)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err) {
          console.error('[MusicEngine] bad update payload:', err)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, started }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(PORT, () => {
    console.log(`[MusicEngine] listening on http://localhost:${PORT}`)
    console.log('[MusicEngine] POST { vibe, visible_users } to /update to drive playback')
  })

  process.on('SIGINT', async () => {
    console.log('\n[MusicEngine] stopping...')
    server.close()
    speaker.end()
    fileWriter.end()
    await engine.stop()
    process.exit(0)
  })
}