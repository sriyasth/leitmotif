import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
config({ path: path.resolve(__dirname, '../.env.local') })

import { GoogleGenAI } from '@google/genai'
import type { LyriaPrompt } from './types'

let _ai: GoogleGenAI | null = null
function getAI() {
  if (!_ai) {
    _ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
      httpOptions: { apiVersion: 'v1alpha' },
    })
  }
  return _ai
}

export class LyriaPlayer {
  private session: any = null
  private onAudioChunk: (chunk: Buffer) => void
  private listening = false

  constructor(onAudioChunk: (chunk: Buffer) => void) {
    this.onAudioChunk = onAudioChunk
  }

  async connect(): Promise<void> {
    const ai = getAI()
    this.session = await (ai.live as any).music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onmessage: (message: any) => {
          const audioChunks = message.serverContent?.audioChunks ?? message.audioChunks
          if (audioChunks) {
            for (const chunk of audioChunks) {
              const data = chunk.data
              const buf = typeof data === 'string'
                ? Buffer.from(data, 'base64')
                : Buffer.from(data)
              this.onAudioChunk(buf)
            }
          }
        },
        onerror: (error: any) => {
          console.error('[LyriaPlayer] connection error:', error)
        }
      }
    })
    this.listening = true
    console.log('[LyriaPlayer] connected to Lyria RealTime')
  }

  async updatePrompt(prompt: LyriaPrompt): Promise<void> {
    if (!this.session) throw new Error('[LyriaPlayer] not connected')
    if (!prompt.text || prompt.text.trim().length === 0) {
      throw new Error('[LyriaPlayer] prompt text is empty')
    }
    console.log('[LyriaPlayer] updating prompt with:', { textLength: prompt.text.length, bpm: prompt.bpm })
    try {
      // Create weighted prompts in the expected format
      console.log('[LyriaPlayer] calling setWeightedPrompts')
      await this.session.setWeightedPrompts({
        weightedPrompts: [{ text: prompt.text, weight: 1.0 }],
      })
      console.log('[LyriaPlayer] setWeightedPrompts succeeded')
      await this.session.setMusicGenerationConfig({ config: { bpm: prompt.bpm } })
    } catch (err) {
      console.error('[LyriaPlayer] updatePrompt error:', err)
      throw err
    }
  }

  async play(): Promise<void> {
    if (!this.session) throw new Error('[LyriaPlayer] not connected')
    await this.session.play()
  }

  async pause(): Promise<void> {
    if (!this.session) return
    await this.session.pause()
  }

  async stop(): Promise<void> {
    this.listening = false
    if (!this.session) return
    await this.session.close()
    this.session = null
    console.log('[LyriaPlayer] disconnected')
  }
}
