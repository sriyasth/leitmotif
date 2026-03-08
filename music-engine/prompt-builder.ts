import type { MusicState, PersonMotif } from './types'

interface PromptBuilderInput {
  vibe: string
  environment: string
  motifs: PersonMotif[]
  leavingMotifs: PersonMotif[]
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

function buildFrozenMotifDescription(motif: PersonMotif): string {
  const sig = motif.motif_signature
  const instrument = inferInstrument(sig.character || '')

  return [
    `Begin with a single sharp snare hit to mark the motif start.`,
    `Immediately after the snare hit, a solo ${instrument} plays a rapid ${sig.note_count}-note burst.`,
    `Total motif duration: exactly 3 seconds (snare hit + rapid melody).`,
    `All notes should be played as fast sixteenth notes or staccato bursts — much quicker than the background tempo.`,
    `The motif should feel like a quick, punchy musical alert, not a slow melody.`,
    `Melodic contour: ${sig.melodic_contour}.`,
    `Interval pattern: ${sig.interval_pattern.join(', ')}.`,
    `Character reference for timbre only: ${sig.character}.`,
    `No accompaniment, no reverb, no background, no harmony beyond the opening snare.`,
    `Clean, dry, close-miked recording.`,
    `Single monophonic line only.`,
    `Do not add extra notes, ornamentation, counter-melody, chords, or texture.`
  ].join(' ')
}

const ENV_TEXTURE: Record<string, string> = {
  outdoors_nature: 'Use organic textures: gentle wind pads, soft wooden percussion, birdsong-like tones. Key center should feel open and pastoral (G major, D major).',
  outdoors_urban: 'Use urban-ambient textures: distant muted synth hum, light metallic resonance, subtle rhythmic pulse. Slightly faster feel.',
  outdoors_park: 'Use warm outdoor textures: acoustic guitar harmonics, soft marimba, airy pads. Relaxed and spacious.',
  indoors_home: 'Use intimate warm textures: soft piano, gentle Rhodes, warm pad. Close and cozy feel.',
  indoors_office: 'Use neutral focused textures: minimal clean synth pad, very soft hi-hat, muted keys. Unobtrusive and steady.',
  indoors_public: 'Use open indoor textures: light reverb pad, soft ambient chime, gentle pulse. Spacious but contained.',
  transit: 'Use motion textures: slow rhythmic pulse, gentle low drone, soft evolving pad. Sense of movement.',
  unknown: 'Use neutral ambient textures: soft pad, gentle piano.',
}

export function buildLyriaPrompt(input: PromptBuilderInput): string {
  const { vibe, environment, motifs, leavingMotifs, previousState, entering, leaving } = input
  const lines: string[] = []

  const vibeChanged = previousState !== null && previousState.vibe !== vibe
  const hasMotifChange = entering.length > 0 || leaving.length > 0
  const envTexture = ENV_TEXTURE[environment] ?? ENV_TEXTURE.unknown

  // Base musical context
  if (!previousState) {
    lines.push(
      `Generate a continuous ambient musical background.`,
      `Scene vibe: ${vibe}.`,
      `Environment: ${environment}.`,
      `${envTexture}`,
      `Texture: sparse, minimal, slowly evolving.`,
      `Tempo: 70-90 bpm.`,
      `Do not make the background busy, dense, muddy, or melody-forward.`,
      `Foreground motifs must always stand out clearly from the background.`
    )
  } else if (vibeChanged) {
    lines.push(
      `The scene mood is shifting from "${previousState.vibe}" to "${vibe}".`,
      `Environment: ${environment}.`,
      `${envTexture}`,
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
      `• Each motif must be exactly 3 seconds long: a snare hit followed by the melody.`,
      `• Play each motif exactly once when triggered and do not repeat it afterward.`,
      `• Leave at least 1 second of space between motifs.`,
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

  // Leaving cues — play the inverted version of their motif
  for (const motif of leavingMotifs) {
    const sig = motif.motif_signature
    const instrument = inferInstrument(sig.character || '')
    const invertedIntervals = sig.interval_pattern.map(n => -n)

    lines.push(
      `\n${motif.name} is LEAVING the scene.`,
      `Create a clear exit cue using the INVERTED version of their motif.`,
      `Briefly duck all background instruments to silence.`,
      `Play a solo ${instrument} with ${sig.note_count} notes.`,
      `Inverted interval pattern: ${invertedIntervals.join(', ')}.`,
      `The contour should be the mirror of their entry motif — if it rose, now it falls.`,
      `End with a descending release gesture that fades out.`,
      `The exit motif must be clearly recognizable as the inverse of their entry cue.`,
      `No accompaniment, no harmony, no background layers while it plays.`,
      `After the exit motif resolves, restore the background smoothly.`
    )
  }

  // Accessibility rules
  lines.push(
    `\nAccessibility Rules:`,
    `Motifs represent people and must always be easy to recognize.`,
    `Foreground motifs must always be clearly audible over the background.`,
    'MAKE MOTIFS MUCH LOUDER THAN THE BACKGROUND. EVEN IF THE BACKGROUND IS LOUD, THE MOTIFS MUST BE LOUDER AND CLEARER.',
    `Never play two motifs simultaneously.`,
    `The soundscape should feel calm and readable, never chaotic.`
  )

  return lines.join('\n')
}

