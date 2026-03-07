export interface MotifSignature {
  note_count: number
  interval_pattern: number[]
  rhythm_pattern: number[]
  melodic_contour: string
  character: string
}

export interface PersonMotif {
  user_id: string
  name: string
  motif_signature: MotifSignature
  motif_prompt: string
}

export interface MusicState {
  tempo: number
  key: string
  instrumentation: string[]
  harmony_palette: string[]
  active_motifs: string[] // user_ids currently in scene
  vibe: string           // current scene vibe
}

export interface LyriaPrompt {
  text: string
  bpm: number
}

export interface SceneInput {
  vibe: string
  visible_users: string[]
}

export interface ContextEngineOutput {
  lyriaPrompt: LyriaPrompt
  newMusicState: MusicState
}
