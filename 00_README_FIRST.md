# README FIRST — How to Use These Plan Files

This folder contains four detailed markdown files meant to be dropped into Claude plan mode on four separate machines, with multiple agents running in parallel.

These files are written to maximize one-shot usefulness. Each file repeats enough global context that an isolated agent can still make good decisions without needing the whole repo history or a long conversation.

## Files

1. `01_PROJECT_FOUNDATION_AND_INTEGRATION.md`
   - For the technical lead / integration owner
   - Defines product scope, demo story, architecture, contracts, repo structure, integration checkpoints, and global rules

2. `02_MOBILE_CLIENT_AND_REALTIME_CAPTURE.md`
   - For the mobile / iPhone / client owner
   - Covers capture, streaming, spatial audio playback, UI, local simulation, permissions, and device testing

3. `03_PERCEPTION_MEMORY_AND_IDENTITY.md`
   - For the perception + memory owner(s)
   - Covers Gemini scene understanding, scene graph extraction, entity tracking, re-identification, memory persistence, embeddings, and APIs

4. `04_AUDIO_MOTIFS_SPATIALIZATION_AND_DEMO.md`
   - For the audio orchestration / motifs / demo owner
   - Covers leitmotif system design, Lyria strategy, spatial audio rules, prioritization, anti-chaos rules, and polished demo execution

## Recommended human ownership

- Person 1: Project foundation + integration + shared schema + final merge authority
- Person 2: Mobile client + realtime capture + playback
- Person 3: Perception + memory + identity resolution
- Person 4: Audio motifs + spatialization + demo choreography

## How to run agents in parallel without chaos

Each human should run agents in this exact structure:

### Agent A — Builder
Implements one bounded surface only.

### Agent B — Reviewer
Reviews branch against contracts and flags integration breakage.

### Agent C — Tester
Creates mocks, smoke tests, scripts, fixtures, and local demo harnesses.

Do not let any single agent roam across the whole codebase.

## Global operating principles

- Parallelize implementation, centralize interfaces
- One owner per subsystem folder
- Mock end-to-end flow before real integrations
- Shared types are sacred
- No one edits contracts casually
- Real demo loop matters more than technical completeness
- Every subsystem must support a single polished demo narrative

## Primary product framing

This project is an assistive-tech system that converts the visual world into a persistent spatial audio scene for blind or visually impaired users.

Core idea:
- Gemini understands the world
- Memory preserves identity and continuity
- Lyria gives people/objects/places recurring auditory identity
- Spatial audio lets the user perceive structure and direction
- The output is not speech-first; it is semantic, spatial, and motif-based

## Primary demo loop

Use one demo loop as the backbone:

1. User scans a living room with iPhone camera
2. System detects couch, lamp, doorway, and a person
3. Each entity is assigned a persistent audio motif
4. Motifs are spatially anchored to scene direction
5. User turns head and audio remains directionally consistent
6. Person leaves and re-enters; same motif returns
7. Optionally show memory card / semantic recap for explainability

## Hard scope boundaries

Do not try to fully solve:
- generic navigation
- dense public crowds with perfect recognition
- unrestricted open-world perception
- full musical composition engine
- robust production-grade accessibility
- end-to-end no-latency wearable hardware

For the hackathon, build a convincing prototype of semantic auditory scene understanding.

## Required shared contracts

All four workstreams must align on these:

- `SceneFrame`
- `DetectedEntity`
- `ResolvedEntity`
- `SceneEvent`
- `AudioInstruction`
- `HeadPose`
- `ThemeAssignment`
- `DemoScenario`

The authoritative definitions live in the shared types package described in file 1.

## Usage pattern in Claude plan mode

When feeding one file into plan mode, prepend a one-line instruction like:

> You own this subsystem. Follow the contracts exactly. Do not modify other subsystem boundaries unless explicitly required. Prioritize shipping a demo-safe implementation.

## Final warning

The project will fail if:
- schemas keep changing
- everyone edits frontend
- everyone edits orchestration
- agents are given vague prompts like “build the backend”
- real integrations are attempted before mocked flow works
- the team forgets the single demo story

The project will work if:
- shared types are locked early
- each subsystem ships a mocked version fast
- integration happens on fixed checkpoints
- final polish starts earlier than feels comfortable
