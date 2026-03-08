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

// Simple deterministic hash from a string → number
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// Generate a distinct motif for any person ID — deterministic so same ID = same motif
function generateMotifForId(userId: string): PersonMotif {
  const h = hashId(userId)

  const noteCounts = [3, 4, 5, 6, 7]
  const contours = ['rise', 'fall', 'rise-fall', 'fall-rise', 'rise-fall-rise', 'fall-rise-fall', 'arc-up', 'arc-down']
  const characters = ['Bright Sharp', 'Warm Gentle', 'Playful Quick', 'Calm Reserved', 'Grounded Steady', 'Soft Round', 'Angular Focused', 'Young Energetic']

  const noteCount = noteCounts[h % noteCounts.length]
  const contour = contours[(h >> 3) % contours.length]
  const character = characters[(h >> 6) % characters.length]

  // Generate distinct interval patterns seeded by hash
  const intervals = [0]
  for (let i = 1; i < noteCount; i++) {
    const raw = ((h >> (i * 4)) % 11) - 5 // range -5 to +5
    intervals.push(raw === 0 ? (i % 2 === 0 ? 2 : -2) : raw)
  }

  const name = userId.replace(/_/g, ' ')

  return {
    user_id: userId,
    name,
    motif_signature: {
      note_count: noteCount,
      interval_pattern: intervals,
      rhythm_pattern: Array(noteCount).fill(1),
      melodic_contour: contour,
      character,
    },
    motif_prompt: `A distinct ${noteCount}-note ${contour} motif with ${character.toLowerCase()} character`,
  }
}

async function fetchMotifs(userIds: string[]): Promise<PersonMotif[]> {
  const uncached = userIds.filter(id => !motifCache.has(id))

  if (uncached.length > 0) {
    // Try Supabase first for enrolled users
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
      console.warn('[ContextEngine] Supabase fetch failed, generating motifs locally:', err)
    }

    // Generate distinct motifs for any IDs still missing (unidentified people)
    for (const userId of uncached) {
      if (!motifCache.has(userId)) {
        const motif = generateMotifForId(userId)
        motifCache.set(userId, motif)
        console.log(`[ContextEngine] Generated motif for ${userId}: ${motif.motif_signature.melodic_contour}, ${motif.motif_signature.character}`)
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
CRITICAL: The background must be extremely minimal — a single quiet sustained pad, nothing more. No melody, no rhythm, no percussion in the background.
Motifs are short loud bursts that must completely dominate the mix. Mute the background when a motif plays.
The instrumentation array should contain at most 1 background instrument. Keep the refined_prompt as simple as possible.`

export async function runContextEngine(
  input: SceneInput,
  previousState: MusicState | null
): Promise<ContextEngineOutput> {
  const previouslyActive = previousState?.active_motifs ?? []
  const entering = input.visible_users.filter(id => !previouslyActive.includes(id))
  const leaving = previouslyActive.filter(id => !input.visible_users.includes(id))

  // Fetch motifs for ALL relevant people: currently visible + those leaving
  const allRelevantIds = [...input.visible_users, ...leaving]
  const allMotifs = await fetchMotifs(allRelevantIds)

  const motifs = allMotifs.filter(m => input.visible_users.includes(m.user_id))
  const leavingMotifs = allMotifs.filter(m => leaving.includes(m.user_id))

  const draftPrompt = buildLyriaPrompt({
    vibe: input.vibe,
    environment: input.environment ?? 'unknown',
    motifs,
    leavingMotifs,
    previousState,
    entering,
    leaving,
  })

  const geminiInput = [
    `Scene vibe: ${input.vibe}`,
    `Environment: ${input.environment ?? 'unknown'}`,
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
