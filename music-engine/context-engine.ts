import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
config({ path: path.resolve(__dirname, '../.env.local') })

import { GoogleGenAI } from '@google/genai'
import { supabaseAdmin } from '../lib/supabase'
import { buildLyriaPrompt } from './prompt-builder'
import type { MusicState, PersonMotif, SceneInput, ContextEngineOutput } from './types'

// Lazy init so env vars are guaranteed to be loaded
let _ai: GoogleGenAI | null = null
function getAI() {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  return _ai
}

// Local motif cache to avoid repeated Supabase lookups
const motifCache = new Map<string, PersonMotif>()

async function fetchMotifs(userIds: string[]): Promise<PersonMotif[]> {
  const uncached = userIds.filter(id => !motifCache.has(id))

  if (uncached.length > 0) {
    try {
      const { data, error } = await supabaseAdmin
        .from('person_motif_prompts')
        .select('*')
        .in('user_id', uncached)

      if (error) throw new Error(`Supabase fetch failed: ${error.message}`)

      for (const row of data ?? []) {
        motifCache.set(row.user_id, row as PersonMotif)
      }
    } catch (err) {
      console.warn('[ContextEngine] Supabase motif fetch failed, using defaults:', err)
      // Generate default motifs for development/testing
      for (const userId of uncached) {
        const defaultMotif: PersonMotif = {
          user_id: userId,
          name: userId === 'user_13' ? 'Alex' : userId === 'user_42' ? 'Jordan' : userId,
          motif_signature: {
            note_count: userId === 'user_13' ? 5 : 4,
            interval_pattern: userId === 'user_13' ? [0, 3, -2, 5, -3] : [0, 4, -1, 2],
            rhythm_pattern: [1, 1, 1, 1, 1],
            melodic_contour: userId === 'user_13' ? 'rise-fall-rise' : 'fall-rise',
            character: userId === 'user_13' ? 'Curious Calm' : 'Grounded Steady'
          },
          motif_prompt: `A ${userId === 'user_13' ? 'curious and calm' : 'grounded and steady'} 5-note motif`
        }
        motifCache.set(userId, defaultMotif)
      }
    }
  }

  return userIds.map(id => motifCache.get(id)).filter(Boolean) as PersonMotif[]
}

const GEMINI_SYSTEM_PROMPT = `You are a music director for an adaptive spatial audio system that helps visually impaired users understand their environment.
Given a scene and musical context, output ONLY valid JSON with this exact structure:
{
  "tempo": <number, bpm>,
  "key": "<string, e.g. C major>",
  "instrumentation": [<string array of instruments>],
  "harmony_palette": [<string array of harmonic descriptors>],
  "refined_prompt": "<string — the final text prompt to send to the Lyria music generator>"
}
Keep music calm, spatial, and non-intrusive. Motifs should be subtle but recognizable.`

export async function runContextEngine(
  input: SceneInput,
  previousState: MusicState | null
): Promise<ContextEngineOutput> {
  const motifs = await fetchMotifs(input.visible_users)

  const previouslyActive = previousState?.active_motifs ?? []
  const entering = input.visible_users.filter(id => !previouslyActive.includes(id))
  const leaving = previouslyActive.filter(id => !input.visible_users.includes(id))

  const draftPrompt = buildLyriaPrompt({
    vibe: input.vibe,
    motifs,
    previousState,
    entering,
    leaving,
  })

  const geminiInput = [
    `Scene vibe: ${input.vibe}`,
    `Previous music state: ${previousState ? JSON.stringify(previousState) : 'none (first segment)'}`,
    `Users entering: ${entering.join(', ') || 'none'}`,
    `Users leaving: ${leaving.join(', ') || 'none'}`,
    `Motif data: ${JSON.stringify(motifs.map(m => ({ user_id: m.user_id, name: m.name, signature: m.motif_signature })))}`,
    `Draft prompt:\n${draftPrompt}`,
  ].join('\n')

  const ai = getAI()
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: geminiInput,
    config: {
      systemInstruction: GEMINI_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
    },
  })

  const parsed = JSON.parse(response.text ?? '{}')
  console.log('[ContextEngine] Gemini response:', response.text)
  console.log('[ContextEngine] parsed:', parsed)

  const newMusicState: MusicState = {
    tempo: parsed.tempo ?? 80,
    key: parsed.key ?? 'C major',
    instrumentation: parsed.instrumentation ?? [],
    harmony_palette: parsed.harmony_palette ?? [],
    active_motifs: input.visible_users,
    vibe: input.vibe,
  }

  const refinedPrompt = parsed.refined_prompt ?? draftPrompt
  console.log('[ContextEngine] final prompt length:', refinedPrompt?.length)
  console.log('[ContextEngine] final prompt:', refinedPrompt)

  return {
    lyriaPrompt: {
      text: refinedPrompt,
      bpm: newMusicState.tempo,
    },
    newMusicState,
  }
}
