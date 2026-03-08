# Leitmotif — Adaptive Audio for the Visually Impaired

> **Hackathon Guide: Backend Integration**

Leitmotif is an assistive audio system that generates adaptive, real-time background music to help visually impaired users perceive their surroundings. Each detected person is represented by a unique musical *motif* — a short melodic signature — woven into an evolving soundtrack that reflects the scene's mood.

---

## Architecture Overview

```
Webcam Frame
  │
  ▼  POST /frame  (base64 JPEG)
┌──────────────────────────────┐
│  Desktop Camera Server :3002 │  ← Gemini 2.5-flash vision analysis
│  desktop/server.ts           │
└──────────┬───────────────────┘
           │  POST /update  { vibe, visible_users }
           ▼
┌──────────────────────────────┐
│  Music Engine :3001          │
│  music-engine/index.ts       │
│  ┌────────────────────────┐  │
│  │  Context Engine        │  │  ← Gemini 2.5-flash orchestration
│  │  context-engine.ts     │  │
│  │  ┌──────────────────┐  │  │
│  │  │ Prompt Builder   │  │  │  ← Constructs Lyria prompts
│  │  │ prompt-builder.ts│  │  │
│  │  └──────────────────┘  │  │
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │
│  │  Lyria Player          │  │  ← Google Lyria RealTime API
│  │  lyria-player.ts       │  │
│  └────────────────────────┘  │
└──────────┬───────────────────┘
           │
           ▼
   🔊 Speaker output + music-output.wav

   Supabase (person_motif_prompts) ← stores per-person motif signatures
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend servers | Node.js · TypeScript · native `http` module |
| AI orchestration | Google Gemini 2.5-flash (`@google/genai`) |
| Music generation | Google Lyria RealTime (`lyria-realtime-exp`) |
| Database | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| Audio playback | `speaker` (PCM stream to system audio) |
| Mobile app | React Native (iOS / Android) |
| Web mockup | React · Vite · Tailwind CSS |

---

## Quick Start

### Prerequisites

- **Node.js 18.x**
- A **Google Gemini API key** with access to Gemini 2.5-flash and Lyria RealTime
- A **Supabase** project with the `person_motif_prompts` table (see [Database Schema](#database-schema))

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
GEMINI_API_KEY=<your-gemini-api-key>

MUSIC_ENGINE_URL=http://localhost:3001
MUSIC_ENGINE_PORT=3001
CAMERA_PORT=3002

NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

### 3. Run the backend

In two separate terminals:

```bash
# Terminal 1 — Music Engine (port 3001)
npm run engine

# Terminal 2 — Desktop Camera Server (port 3002)
npm run camera
```

The camera server opens a browser window for webcam capture. Frames are analyzed by Gemini, and scene updates are forwarded to the Music Engine which generates adaptive music via Lyria.

---

## API Reference

### Music Engine — `localhost:3001`

#### `POST /update`

Drive music generation with a scene update.

**Request body:**

```json
{
  "vibe": "calm",
  "visible_users": ["user_13", "user_42"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `vibe` | `string` | Scene mood — one of `calm`, `busy`, `tense`, `cheerful`, `empty`, `intimate` |
| `visible_users` | `string[]` | Stable person IDs currently in the scene |

**Response (`200`):**

```json
{ "ok": true }
```

**Error (`400`):**

```json
{ "ok": false, "error": "..." }
```

#### `GET /health`

```json
{ "ok": true, "started": false }
```

---

### Desktop Camera Server — `localhost:3002`

#### `POST /frame`

Submit a webcam frame for vision analysis.

**Request body:**

```json
{
  "image": "<base64-encoded JPEG>"
}
```

**Response (`200`):**

```json
{
  "vibe": "cheerful",
  "visible_users": ["person_1", "person_2"],
  "scene_description": "Two people talking in a bright kitchen."
}
```

The server automatically forwards the result to the Music Engine's `POST /update` endpoint.

#### `GET /health`

```json
{ "ok": true, "knownPeople": ["person_1"] }
```

#### `GET /` or `GET /camera`

Serves the webcam capture UI (`camera.html`).

---

## Integration Examples

### Drive the Music Engine directly with curl

```bash
# Start playback with a calm scene and two users
curl -X POST http://localhost:3001/update \
  -H "Content-Type: application/json" \
  -d '{"vibe": "calm", "visible_users": ["user_13", "user_42"]}'

# Scene changes — one user leaves, mood shifts
curl -X POST http://localhost:3001/update \
  -H "Content-Type: application/json" \
  -d '{"vibe": "cheerful", "visible_users": ["user_13"]}'

# Empty scene
curl -X POST http://localhost:3001/update \
  -H "Content-Type: application/json" \
  -d '{"vibe": "empty", "visible_users": []}'
```

### Check server health

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
```

---

## Backend Components

### Music Engine (`music-engine/index.ts`)

The main orchestrator. Receives scene updates via HTTP and coordinates the Context Engine and Lyria Player.

- **First update** → calls `engine.start(scene)` (connects to Lyria, runs first cycle)
- **Subsequent updates** → calls `engine.update(scene)` (re-runs context engine, updates prompt)
- Audio output → system speakers (PCM) + `music-output.wav`

### Context Engine (`music-engine/context-engine.ts`)

The "music director". Given a scene input and previous music state, it:

1. Fetches motif signatures from Supabase (cached locally after first lookup)
2. Detects which users are entering or leaving
3. Builds a draft Lyria prompt via the Prompt Builder
4. Sends all context to Gemini 2.5-flash with a system prompt
5. Parses Gemini's structured JSON response into a refined prompt and updated music state

### Prompt Builder (`music-engine/prompt-builder.ts`)

Constructs the text prompt for Lyria based on four scenarios:

| Scenario | Behavior |
|----------|----------|
| First segment | Fresh ambient background for the current vibe |
| Vibe changed | Smooth 4–6 second crossfade between moods |
| Only motif changes | Continue background, weave in entering/leaving motifs |
| No changes | Repeat the current soundscape unchanged |

Motif rules enforced in every prompt:
- Play each motif **once** on entry (bright solo saxophone)
- Duck background before motif plays
- Play inverted/descending motif on exit
- Never overlap motifs

### Lyria Player (`music-engine/lyria-player.ts`)

Manages the WebSocket connection to Google Lyria RealTime:

- `connect()` — opens a session to `models/lyria-realtime-exp`
- `updatePrompt(prompt)` — sets weighted prompts and BPM
- `play()` / `pause()` / `stop()` — transport controls
- Streams base64-encoded audio chunks back via the `onAudioChunk` callback

### Supabase Client (`lib/supabase.ts`)

Exports two Supabase clients:

- `supabase` — anon key, respects row-level security (for client-side use)
- `supabaseAdmin` — service role key, bypasses RLS (used by the backend)

---

## Database Schema

**Table: `person_motif_prompts`**

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | `string` | Unique person identifier (e.g. `user_13`) |
| `name` | `string` | Display name |
| `motif_signature` | `json` | Musical fingerprint (see below) |
| `motif_prompt` | `text` | Human-readable motif description |
| `created_at` | `timestamp` | Row creation time |

### Motif Signature Structure

```json
{
  "note_count": 5,
  "interval_pattern": [0, 3, -2, 5, -3],
  "rhythm_pattern": [0.25, 0.25, 0.5, 0.25, 0.75],
  "melodic_contour": "rise-fall-rise",
  "character": "curious calm"
}
```

These values stay constant so each person's motif remains recognizable regardless of instrument, octave, or background style.

---

## TypeScript Interfaces

All shared types live in `music-engine/types.ts`:

```typescript
interface SceneInput {
  vibe: string
  visible_users: string[]
}

interface MusicState {
  tempo: number
  key: string
  instrumentation: string[]
  harmony_palette: string[]
  active_motifs: string[]   // user_ids currently in scene
  vibe: string
}

interface LyriaPrompt {
  text: string
  bpm: number
}

interface MotifSignature {
  note_count: number
  interval_pattern: number[]
  rhythm_pattern: number[]
  melodic_contour: string
  character: string
}

interface PersonMotif {
  user_id: string
  name: string
  motif_signature: MotifSignature
  motif_prompt: string
}
```

---

## Project Structure

```
leitmotif/
├── music-engine/           # 🎵 Music generation backend
│   ├── index.ts            #    HTTP server + MusicEngine class
│   ├── context-engine.ts   #    Gemini-powered music director
│   ├── prompt-builder.ts   #    Lyria prompt construction
│   ├── lyria-player.ts     #    Lyria RealTime WebSocket client
│   └── types.ts            #    Shared TypeScript interfaces
├── desktop/                # 🎥 Webcam analysis server
│   ├── server.ts           #    HTTP server + Gemini vision
│   └── camera.html         #    Browser webcam capture UI
├── apps/mobile/            # 📱 React Native mobile app
│   └── src/
│       ├── screens/        #    Monitor, Contacts, Visualizer, Settings
│       ├── AppContext.tsx   #    Global state
│       └── ...
├── lib/
│   └── supabase.ts         # Supabase client setup
├── src/                    # Web mockup (React + Vite)
├── music-engine.md         # Detailed architecture document
├── package.json
└── .env.local              # Environment variables (not committed)
```

---

## Mobile App (`apps/mobile/`)

The React Native companion app provides four tab screens:

| Screen | Purpose |
|--------|---------|
| **Monitor** | Real-time entity tracking display |
| **Contacts** | Stored person identities and their motifs |
| **Visualizer** | Audio visualization of the generated music |
| **Settings** | Configuration and preferences |

The mobile app syncs with the Music Engine backend via `useMusicEngineSync.ts`.

---

## How It All Fits Together

1. **Camera captures a frame** → sent as base64 JPEG to the Camera Server
2. **Gemini vision** analyzes the image → extracts vibe, people, and scene description
3. **Camera Server forwards** `{ vibe, visible_users }` to the Music Engine
4. **Context Engine** fetches motif signatures from Supabase, detects entering/leaving users, and builds a structured prompt
5. **Gemini orchestration** refines the prompt with tempo, key, instrumentation, and harmony decisions
6. **Lyria RealTime** generates adaptive music from the refined prompt
7. **Audio streams** to the system speaker and is saved to `music-output.wav`
8. **On next frame**, the cycle repeats — music evolves continuously without interruption

---

## License

ISC
