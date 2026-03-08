import type { MusicState, PersonMotif } from './types'

interface PromptBuilderInput {
  vibe: string
  motifs: PersonMotif[]
  previousState: MusicState | null
  entering: string[]
  leaving: string[]
}

function inferInstrument(character: string): string {
  const c = character.toLowerCase()

  if (c.includes('warm') || c.includes('gentle') || c.includes('soft') || c.includes('round')) {
    return 'celesta'
  }
  if (c.includes('sharp') || c.includes('angular') || c.includes('focused') || c.includes('bright')) {
    return 'solo muted trumpet'
  }
  if (c.includes('playful') || c.includes('young') || c.includes('energetic') || c.includes('quick')) {
    return 'kalimba'
  }
  if (c.includes('calm') || c.includes('reserved') || c.includes('elegant')) {
    return 'solo clarinet'
  }
  if (c.includes('grounded') || c.includes('steady') || c.includes('earthy')) {
    return 'marimba'
  }

  return 'glockenspiel'
}

function inferRhythmPattern(noteCount: number): string {
  if (noteCount <= 4) return 'Quarter note, quarter note, quarter note, half note'
  if (noteCount === 5) return 'Quarter note, quarter note, half note, two eighth notes'
  if (noteCount === 6) return 'Four eighth notes, two quarter notes'
  return 'Three eighth notes, quarter note, two eighth notes, half note'
}

function buildFrozenMotifDescription(motif: PersonMotif): string {
  const sig = motif.motif_signature
  const instrument = inferInstrument(sig.character || '')
  const rhythmPattern = inferRhythmPattern(sig.note_count)

  return [
    `A solo ${instrument} playing a ${sig.note_count}-note melody.`,
    `Rhythm: ${rhythmPattern}.`,
    `Melodic contour: ${sig.melodic_contour}.`,
    `Interval pattern: ${sig.interval_pattern.join(', ')}.`,
    `Character reference for timbre only: ${sig.character}.`,
    `No accompaniment, no reverb, no background, no harmony, no percussion.`,
    `Clean, dry, close-miked recording.`,
    `Single monophonic line only.`,
    `Do not add extra notes, ornamentation, counter-melody, chords, or texture.`
  ].join(' ')
}

export function buildLyriaPrompt(input: PromptBuilderInput): string {
  const { vibe, motifs, previousState, entering, leaving } = input
  const lines: string[] = []

  const vibeChanged = previousState !== null && previousState.vibe !== vibe
  const hasMotifChange = entering.length > 0 || leaving.length > 0

  // Base musical context
  if (!previousState) {
    lines.push(
      `Generate a continuous ambient musical background.`,
      `Scene vibe: ${vibe}.`,
      `Texture: sparse, minimal, slowly evolving.`,
      `Tempo: 70-90 bpm.`,
      `Background instruments: soft pads, soft piano, or very light percussion only.`,
      `Do not make the background busy, dense, muddy, or melody-forward.`,
      `Foreground motifs must always stand out clearly from the background.`
    )
  } else if (vibeChanged) {
    lines.push(
      `The scene mood is shifting from "${previousState.vibe}" to "${vibe}".`,
      `Begin from the current musical texture: ${previousState.tempo} bpm, key of ${previousState.key}.`,
      previousState.instrumentation.length
        ? `Current instrumentation: ${previousState.instrumentation.join(', ')}.`
        : '',
      `Gradually transition the background over 4-6 seconds.`,
      `Do not cut abruptly.`,
      `Let the harmonic palette shift smoothly from ${previousState.harmony_palette.join(', ') || 'the current palette'} toward what suits "${vibe}".`,
      `Tempo may drift slightly toward the new vibe's natural pace, but should not jump.`,
      `The background layer must remain soft and minimal so foreground motifs are clearly audible.`
    )
  } else if (hasMotifChange) {
    lines.push(
      `The scene vibe remains "${vibe}". Continue the existing soundscape without interruption.`,
      `Keep tempo at ${previousState.tempo} bpm, key of ${previousState.key}.`,
      previousState.instrumentation.length
        ? `Maintain instrumentation: ${previousState.instrumentation.join(', ')}.`
        : '',
      `Only the people in the scene have changed.`,
      `Do not reset the background.`,
      `The background layer must remain soft and minimal so foreground motifs are clearly audible.`
    )
  } else {
    lines.push(
      `Continue the existing musical soundscape unchanged.`,
      `Maintain tempo at ${previousState.tempo} bpm, key of ${previousState.key}.`,
      previousState.instrumentation.length
        ? `Background instrumentation: ${previousState.instrumentation.join(', ')}.`
        : '',
      `The background layer must remain soft and minimal so foreground motifs are clearly audible.`
    )
  }

  // Motif instructions
  if (motifs.length > 0) {
    lines.push(
      `\nForeground motif rules (these represent people and must be unmistakable):`,
      `• Before a motif plays, briefly duck the background instruments.`,
      `• Each motif must be short, fixed, and easy to recognize.`,
      `• Play each motif exactly once when triggered and do not repeat it afterward.`,
      `• Leave at least 2 seconds of space between motifs.`,
      `• Each motif must be rendered as a standalone single-instrument phrase.`,
      `• No accompaniment, no harmony, no percussion, no pad, and no layered texture during a motif.`,
      `• Motifs must be significantly louder and clearer than the background.`,
      `• Do not improvise, embellish, extend, or vary the motif.`,
      `• The same person must always receive the same motif notes, rhythm, contour, and instrument.`,
      `• Motifs should function like short musical identity labels, not ambient decoration.`
    )

    motifs.forEach((m, i) => {
      const label = String.fromCharCode(65 + i)
      const sig = m.motif_signature
      const frozenDescription = buildFrozenMotifDescription(m)

      lines.push(
        `\nMotif ${label} (${m.name}):`,
        `${frozenDescription}`
      )

      if (entering.includes(m.user_id)) {
        lines.push(
          `→ ${m.name} is ENTERING the scene.`,
          `Create a clear entrance cue.`,
          `Briefly lower the background instruments.`,
          `Then render motif ${label} exactly as specified above, once and only once.`,
          `Keep it fully exposed in the foreground.`,
          `After the motif, allow the background to return smoothly.`
        )
      }
    })
  }

  // Leaving cues
  for (const userId of leaving) {
    const motif = motifs.find(m => m.user_id === userId)
    const name = motif?.name ?? userId

    lines.push(
      `\n${name} is LEAVING the scene.`,
      `Create a clear exit cue.`,
      `Briefly lower the background instruments.`,
      `If this person's motif definition is available above, play that same motif once in the same instrument and same rhythmic shape, then end with a short descending release gesture.`,
      `The exit version should still be recognizable as the same identity cue, not a different melody.`,
      `Do not add harmony or background layers while it plays.`,
      `After the cue resolves, fade that motif out of the soundscape and restore the background.`
    )
  }

  // Accessibility rules
  lines.push(
    `\nAccessibility Rules:`,
    `Motifs represent people and must always be easy to recognize.`,
    `Foreground motifs must always be clearly audible over the background.`,
    `Never play two motifs simultaneously.`,
    `Motifs must remain musically consistent when repeated.`,
    `The soundscape should feel calm and readable, never chaotic.`
  )

  return lines.join('\n')
}

