import type { MusicState, PersonMotif } from './types'


interface PromptBuilderInput {
 vibe: string
 motifs: PersonMotif[]
 previousState: MusicState | null
 entering: string[]
 leaving: string[]
}


export function buildLyriaPrompt(input: PromptBuilderInput): string {
 const { vibe, motifs, previousState, entering, leaving } = input
 const lines: string[] = []


 const vibeChanged = previousState !== null && previousState.vibe !== vibe
 const hasMotifChange = entering.length > 0 || leaving.length > 0


 // Base musical context
 if (!previousState) {
   lines.push(
     `Generate a continuous ambient musical background. should be clear, and not a muddled tone or too busy`,
     `Scene vibe: ${vibe}.`,
     `Texture: sparse, minimal, slowly evolving.`,
     `Tempo: 70–90 bpm.`,
     `Background instruments: soft pads, piano, or light percussion.`,
     `Foreground motifs must always stand out clearly from the background.`
   )
 } else if (vibeChanged) {
   lines.push(
     `The scene mood is shifting from "${previousState.vibe}" to "${vibe}".`,
     `Begin from the current musical texture: ${previousState.tempo} bpm, key of ${previousState.key}.`,
     previousState.instrumentation.length
       ? `Current instrumentation: ${previousState.instrumentation.join(', ')}.`
       : '',
     `Gradually transition the background — crossfade from the old vibe's character into "${vibe}" over 4–6 seconds.`,
     `Do not cut abruptly. Let the harmonic palette shift smoothly: from ${previousState.harmony_palette.join(', ') || 'the current palette'} toward what suits "${vibe}".`,
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
     `Only the people in the scene have changed — weave in the new motifs naturally without resetting the background.`,
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
 // Motif instructions
if (motifs.length > 0) {
 lines.push(
   `\nForeground motif rules (these represent people and must be unmistakable):`,
   `• Before a motif plays, briefly reduce or duck background instruments.`,
   `• Each motif must be short (around 5 seconds).`,
   `• Play the motif exactly once and do not repeat it afterward.`,
   `• Leave at least 2 seconds of silence between motifs.`,
   `• Motifs must be clear, rhythmic, and extremely memorable.`,
   `• Use a bright foreground instrument such as solo saxophone.`,
   `• Motifs must be extremely consistent each time they play — the same notes, rhythm, and character — so they become easily recognizable audio cues for that person.`,
   `• Motif sound should not have any background noise soundscapes or instrumentation layered, it should be a standalone single instrument phrase`,
   `• Motifs must be significantly louder than the background.`,
   `• Avoid chords or harmony while a motif plays.`,
   `• Motifs should sound like short musical "announcements".`
 )


 motifs.forEach((m, i) => {
   const label = String.fromCharCode(65 + i)
   const sig = m.motif_signature


   lines.push(
     `\nMotif ${label} (${m.name}):`,
     `${sig.note_count} notes`,
     `interval pattern: ${sig.interval_pattern.join(', ')}`,
     `melodic contour: ${sig.melodic_contour}`,
     `character: ${sig.character}`,
     `Instrument: solo saxophone`
   )


   if (entering.includes(m.user_id)) {
     lines.push(
       `→ ${m.name} is ENTERING the scene.`,
       `Create a clear musical entrance cue.`,
       `Briefly lower the background instruments.`,
       `Then play motif ${label} once in a bright, high register so it stands out.`,
       `After the motif, allow the background to smoothly return.`
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
   `Create a clear musical exit cue.`,
   `Briefly lower the background instruments.`,
   `Play a recognizable inversion or reversed version of their motif once.`,
   `The exit version should descend in pitch to signal departure.`,
   `After the motif resolves, fade that motif out of the soundscape and restore the background.`
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

