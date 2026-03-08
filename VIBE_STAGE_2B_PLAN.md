
# Stage 2B — Vibe Inference Pipeline

## Purpose
Stage 2B infers the **overall vibe of a scene** from video frames and outputs structured JSON that Stage 3 (music generation) can consume.

This stage intentionally avoids full object detection or identity recognition to keep the pipeline simple and reliable.

---

## High-Level Pipeline

Video Frame
→ Frame Sampling (~500ms)
→ Gemini Vision Analysis
→ Vibe Classification
→ JSON Output
→ Stage 3 (Music Generation)

---

## Output Contract

```ts
type VibeLabel =
  | "calm_familiar"
  | "quiet_empty"
  | "social_active"
  | "tense_busy"
  | "transitional"
  | "unknown"

type VibeResponse = {
  scene_id: string
  vibe: VibeLabel
  confidence: number
  descriptors: string[]
  timestamp: number
}
```

---

## Example Output

```json
{
  "scene_id": "scene_00124",
  "vibe": "calm_familiar",
  "confidence": 0.87,
  "descriptors": ["indoor","stable","low_activity"],
  "timestamp": 1720000000
}
```

---

## Allowed Vibe Labels

calm_familiar  
quiet_empty  
social_active  
tense_busy  
transitional  
unknown  

If uncertain, return `"unknown"`.

---

## Vibe Definitions

calm_familiar  
• stable indoor environment  
• relaxed atmosphere  
• low motion

quiet_empty  
• minimal activity  
• empty or quiet space

social_active  
• multiple people interacting  
• conversational energy

tense_busy  
• cluttered or chaotic environment  
• high motion

transitional  
• people entering or leaving  
• environment changing

unknown  
• insufficient signal

---

## Gemini Prompt Template

Analyze the vibe of this scene.

Choose exactly one label from:
calm_familiar, quiet_empty, social_active, tense_busy, transitional, unknown.

Return JSON with:
vibe
confidence
descriptors

Do not output any labels outside the allowed set.

---

## Update Frequency

SCENE_VIBE_UPDATE_INTERVAL = 500ms

Do not analyze every frame.

---

## Fallback Behavior

If the API fails, return:

```json
{
  "scene_id": "scene_unknown",
  "vibe": "unknown",
  "confidence": 0,
  "descriptors": [],
  "timestamp": 0
}
```

---

## Anti-Hallucination Rules

Stage 2B must not:
• generate new vibe labels  
• output paragraphs of text  
• include identity information  
• include user_id fields  
• include object detection results  

Only output vibe inference.

---

## Integration With Stage 3

Example mapping:

calm_familiar → warm ambient music  
quiet_empty → sparse ambient texture  
social_active → layered rhythmic motifs  
tense_busy → grounding minimal motif  
transitional → musical transition phrase  
unknown → neutral ambient layer

---

## Acceptance Criteria

Stage 2B is complete when:

• output JSON matches schema  
• vibe labels are always valid  
• fallback behavior works  
• pipeline runs on sampled video frames  
• system never crashes on bad inputs

---

## Mission Summary

Stage 2B converts **visual scene context into a structured vibe classification** used by Stage 3 to drive adaptive music generation.
