# Sensible

Real-time on-device face recognition pipeline for iOS, built with React Native.

## Overview

Sensible provides a native iOS face recognition module that runs entirely on-device using Apple Vision and CoreML. It detects, tracks, and identifies faces from the camera feed, emitting structured events to the React Native layer.

### Key Features

- **Real-time face detection & tracking** — Uses Apple Vision framework for face detection with persistent track IDs across frames
- **On-device face embeddings** — Generates 512-d face embeddings via an AdaFace CoreML model (no server round-trips)
- **Face matching & enrollment** — Enroll known contacts with a short capture burst; match faces against the local gallery in real time
- **Scene descriptions** — Optional Gemini-powered scene narration with context about visible people
- **Supabase sync** — Syncs enrolled identities and embeddings to a Supabase backend
- **Structured person events** — Emits `person_entered`, `person_updated`, and `person_left` events with confidence, bearing, and distance data

## Architecture

```
React Native (TypeScript)
  └─ FacePipeline.ts          # JS API & event subscriptions
       └─ FacePipelineModule   # Native Swift module (RCTEventEmitter)
            ├─ CaptureManager      # AVFoundation camera capture
            ├─ FrameScheduler      # Frame rate throttling
            ├─ VisionPipeline      # Apple Vision face detection
            ├─ TrackManager        # Multi-face tracking state
            ├─ QualityGate         # Face quality filtering
            ├─ FaceEmbedder        # CoreML embedding (AdaFace)
            ├─ FaceMatcher         # Cosine similarity matching
            ├─ GalleryStore        # On-device gallery persistence
            ├─ EnrollmentManager   # Contact enrollment flow
            ├─ SceneDescriber      # Gemini scene narration
            └─ SupabaseSync        # Cloud sync for identities
```

## Usage

```typescript
import { FacePipeline } from './FacePipeline';

// Start the pipeline
await FacePipeline.startPipeline({
  detectEveryNFrames: 4,
  supabaseUrl: 'https://your-project.supabase.co',
  supabaseAnonKey: 'your-anon-key',
});

// Listen for person events
FacePipeline.onPersonEvent((event) => {
  console.log(event.event_type, event.display_name, event.confidence);
});

// Enroll a new contact
const result = await FacePipeline.enrollContact({
  owner_user_id: 'user-123',
  contact_external_id: 'contact-456',
  display_name: 'Jane Doe',
  burst_seconds: 3,
});

// Stop the pipeline
await FacePipeline.stopPipeline();
```

## Database Schema

The project includes a Supabase migration (`scripts/migration_person_events.sql`) that creates:

- **`person_events`** — Log of all enter/update/leave events
- **`persons`** — Known person records with last-seen timestamps
- **`visible_users`** — Currently visible users (live state)

## Models

- **AdaFace_IR50** — CoreML-converted face recognition model located in `models/AdaFace_IR50.mlpackage`

## Scripts

- `scripts/convert_adaface.py` — Convert AdaFace model to CoreML
- `scripts/validate_video_pipeline.swift` — Validate pipeline against test videos

## Requirements

- iOS 16+
- React Native
- Xcode with CoreML support
