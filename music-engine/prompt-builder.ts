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
  outdoors_nature: 'A single quiet sustained string pad. Nothing else.',
  outdoors_urban: 'A single quiet low synth drone. Nothing else.',
  outdoors_park: 'A single quiet warm pad. Nothing else.',
  indoors_home: 'A single quiet soft piano chord held. Nothing else.',
  indoors_office: 'A single quiet clean synth pad. Nothing else.',
  indoors_public: 'A single quiet airy pad. Nothing else.',
  transit: 'A single quiet low drone. Nothing else.',
  unknown: 'A single quiet soft pad. Nothing else.',
}

export function buildLyriaPrompt(input: PromptBuilderInput): string {
  const { vibe, environment, motifs, leavingMotifs, previousState, entering, leaving } = input
  const lines: string[] = []

  const vibeChanged = previousState !== null && previousState.vibe !== vibe
  const hasMotifChange = entering.length > 0 || leaving.length > 0
  const envTexture = ENV_TEXTURE[environment] ?? ENV_TEXTURE.unknown

  // Base musical context — keep background extremely simple
  const bgRules = [
    `The background must be ONLY a single sustained instrument at very low volume.`,
    `${envTexture}`,
    `No melody, no rhythm, no percussion, no chord changes, no movement in the background.`,
    `The background should be barely audible — like quiet room tone.`,
    `ONE instrument, ONE sustained note or chord, very quiet. That is the entire background.`,
  ]

  if (!previousState) {
    lines.push(
      `Generate an extremely minimal ambient background.`,
      `Scene vibe: ${vibe}. Environment: ${environment}.`,
      ...bgRules,
      `Tempo: 70-90 bpm.`,
    )
  } else if (vibeChanged) {
    lines.push(
      `Scene mood shifting from "${previousState.vibe}" to "${vibe}".`,
      `Slowly crossfade the single background pad to match the new vibe.`,
      ...bgRules,
    )
  } else if (hasMotifChange) {
    lines.push(
      `Scene vibe remains "${vibe}". Keep the background pad unchanged.`,
      ...bgRules,
    )
  } else {
    lines.push(
      `Continue the same quiet background pad. Do not change anything.`,
      ...bgRules,
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
    `\nCRITICAL RULES:`,
    `The background is ONLY a single quiet sustained pad. Nothing more. No melody, no rhythm, no texture.`,
    `Motifs must be 10x louder than the background. The background should be nearly silent.`,
    `When a motif plays, MUTE the background completely. Total silence except the motif.`,
    `Never play two motifs simultaneously.`,
    `The background must never compete with motifs. If in doubt, make the background quieter.`
  )

  return lines.join('\n')
}

