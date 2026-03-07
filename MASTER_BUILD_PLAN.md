
# MASTER BUILD PLAN – Auditory Scene Graph Hackathon Project

## 1. Project Mission
Build a multimodal assistive system that converts live camera perception into persistent spatial audio motifs representing people, objects, and environments. The system enables blind users to perceive the structure of a space through sound.

Core idea: convert visual scene understanding into an **auditory scene graph**.

## 2. One-Sentence Pitch
A system that lets blind users *hear the structure of a room* by assigning spatial musical motifs to objects, people, and environments.

## 3. Final Demo Story
Demo must follow this exact flow.

1. User opens the app and points phone camera around a living room.
2. System detects couch, lamp, doorway, and a known person.
3. Each entity gets a persistent sound motif.
4. Spatial audio anchors each motif in the correct direction.
5. When the user turns their head, sound stays anchored in space.
6. When the known person re-enters, the same motif returns.

## 4. Non‑Goals
Do NOT attempt:

- Full navigation system
- Robust face recognition
- Large-scale crowd analysis
- Perfect real-time music generation
- Production-grade mobile app

This is a **demo-first prototype**.

## 5. System Architecture

Pipeline:

Camera Input
→ Perception Service (Gemini)
→ Scene Graph Builder
→ Memory / Identity Service
→ Motif Assignment
→ Spatial Audio Engine
→ Playback

## 6. Monorepo Structure

repo/
    apps/
        mobile/
    services/
        perception/
        memory/
        audio/
    packages/
        shared-types/
    docs/

## 7. Shared Data Schemas

```ts
type Vec3 = {
  x: number
  y: number
  z: number
}

type SceneEntity = {
  temp_id: string
  persistent_id?: string
  type: "person" | "object" | "environment"
  label: string
  confidence: number
  position: Vec3
  importance: number
  recognized: boolean
  motif_id?: string
}

type SceneAnalysisResponse = {
  scene_id: string
  environment_label: string
  entities: SceneEntity[]
  events: string[]
  timestamp: number
}
```

## 8. Execution Stages

### Stage 1 – Repository Bootstrap

Goal:
Create the base repo and shared types.

Tasks:
- initialize monorepo
- create mobile app skeleton
- create perception service skeleton
- create memory service skeleton
- create audio service skeleton
- define shared types

Success Criteria:
- repo builds
- shared types import correctly

---

### Stage 2 – Mock End‑to‑End Loop

Goal:
Prove full pipeline works before real AI.

Tasks:
- mock perception response
- mock memory lookup
- mock motif assignment
- trigger audio playback events

Success Criteria:
- fake scene produces spatial sound events

---

### Stage 3 – Perception Integration

Goal:
Integrate Gemini for scene understanding.

Tasks:
- capture camera frames
- send frames to perception service
- extract objects and people
- convert results into SceneAnalysisResponse schema

Success Criteria:
- real objects detected in a room

---

### Stage 4 – Memory and Identity

Goal:
Persist identity across frames.

Tasks:
- store embeddings for detected entities
- match new detections to known entities
- assign persistent motif IDs

Success Criteria:
- returning entity receives same motif

---

### Stage 5 – Audio Motif Engine

Goal:
Assign motifs and render spatial sound.

Tasks:
- generate motif for each entity
- maintain motif consistency
- implement directional spatial audio
- implement fade in/out rules

Success Criteria:
- sounds remain anchored while user moves phone

---

### Stage 6 – Demo Polish

Goal:
Make the demo stable and impressive.

Tasks:
- clean UI overlay
- visual debug panel
- stable motif playback
- add demo reset button
- preload known entities

Success Criteria:
- demo runs smoothly for judges

## 9. Integration Checkpoints

Checkpoint 1
Repo builds and mocked pipeline works.

Checkpoint 2
Perception returns real entities.

Checkpoint 3
Memory persistence works.

Checkpoint 4
Spatial audio demo works.

## 10. Failure Modes / Fallbacks

If perception fails:
Use cached mock scene.

If identity recognition fails:
Use generic "unknown person" motif.

If spatial audio fails:
Fallback to stereo panning.

If music generation fails:
Use prebuilt motif samples.

## 11. Agent Prompt Template

Use this prompt structure when running coding agents.

Task:
Implement [stage component].

Context:
Follow schemas defined in MASTER_BUILD_PLAN.md.

Constraints:
Do not modify shared schemas unless necessary.

Output:
Provide working code and a brief explanation of changes.

## 12. Final Shipping Checklist

- repo builds
- perception working
- motifs consistent
- spatial sound stable
- demo script rehearsed
- fallback mode ready

END OF MASTER PLAN
