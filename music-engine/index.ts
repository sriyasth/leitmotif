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

const MOTIF_COOLDOWN_MS = 4000 // hold motif prompts for 4s (3s motif + 1s buffer)

export class MusicEngine {
  private musicState: MusicState | null = null
  private player: LyriaPlayer
  private running = false
  private segmentTimer: ReturnType<typeof setInterval> | null = null
  private cooldownUntil = 0 // timestamp until which updates are blocked
  private pendingInput: SceneInput | null = null // queued input during cooldown

  constructor(onAudioChunk: (chunk: Buffer) => void = () => {}) {
    this.player = new LyriaPlayer(onAudioChunk)
  }

  async start(input: SceneInput): Promise<void> {
    await this.player.connect()
    this.running = true
    await this._cycle(input)
  }

  async update(input: SceneInput): Promise<void> {
    if (!this.running) return

    // During cooldown, just save the latest input — don't overwrite the motif prompt
    if (Date.now() < this.cooldownUntil) {
      this.pendingInput = input
      console.log('[MusicEngine] cooldown active, queuing update')
      return
    }

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

      // Detect if this cycle has motif changes (enter/leave)
      const previouslyActive = this.musicState?.active_motifs ?? []
      const entering = input.visible_users.filter(id => !previouslyActive.includes(id))
      const leaving = previouslyActive.filter(id => !input.visible_users.includes(id))
      const hasMotifChange = entering.length > 0 || leaving.length > 0

      this.musicState = newMusicState

      console.log('[MusicEngine] bpm:', lyriaPrompt.bpm)
      console.log('[MusicEngine] prompt:', lyriaPrompt.text.slice(0, 200))

      try {
        await this.player.updatePrompt(lyriaPrompt)
      } catch (updateErr) {
        console.warn('[MusicEngine] updatePrompt failed, trying play anyway:', updateErr)
      }
      await this.player.play()

      // If a motif just played, block updates so it has time to be heard
      if (hasMotifChange) {
        this.cooldownUntil = Date.now() + MOTIF_COOLDOWN_MS
        this.pendingInput = null
        console.log(`[MusicEngine] motif cooldown: holding for ${MOTIF_COOLDOWN_MS / 1000}s (entering: ${entering}, leaving: ${leaving})`)

        // After cooldown, process the latest queued input
        setTimeout(async () => {
          if (this.pendingInput && this.running) {
            console.log('[MusicEngine] cooldown expired, processing queued update')
            const queued = this.pendingInput
            this.pendingInput = null
            await this._cycle(queued)
          }
        }, MOTIF_COOLDOWN_MS)
      }
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