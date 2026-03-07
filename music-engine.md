# Adaptive Leitmotif Music Pipeline

## Gemini 3.1 + Lyria Dynamic Motif System

## Goal

Generate continuous adaptive background music that reflects a scene's
vibe while embedding recognizable musical motifs for detected people. The purpose is to help visually impaired people subconciously process their surroundings. 

Key properties:

-   Background music evolves with environment vibe
-   Each person has a recognizable musical identity
-   Motifs stay recognizable across styles
-   Music remains continuous and coherent
-   Motifs blend naturally into the soundtrack

System responsibilities:

Gemini 3.1 → orchestration, context reasoning, prompt construction\
Lyria → music generation

------------------------------------------------------------------------

# High Level Architecture

Vision System detects faces ↓ user_ids detected ↓ environment system
provides vibe ↓ Gemini 3.1 Context Engine ↓ Build structured music
prompt ↓ Lyria generates adaptive soundtrack ↓ Audio engine streams
music

Gemini acts as the music director while Lyria acts as the composer.

You are building music engine:

Input: user_ids, current background context

Take previous background context and mesh together new context and new user ids 

Output: music with lyria 3
------------------------------------------------------------------------

# Core Concept

Instead of generating isolated sounds, the system generates a continuous
musical track.

The track: - reflects the background vibe - integrates leitmotifs for
visible people - maintains stylistic continuity

Example:

Scene vibe: calm cafe

Detected people: user_13 user_42

Generated music: lofi piano background with that plays the musical signatures ONCE for both users

------------------------------------------------------------------------

# Database Schema

Table: person_motif_prompts

user_id (string)\
name (string)\
motif_signature (json)\
motif_prompt (text)\
created_at (timestamp)

------------------------------------------------------------------------

# Motif Signature Structure

Each person has a stable melodic fingerprint.

{ "note_count": 5, "interval_pattern": \[0, +3, -2, +5, -3\],
"rhythm_pattern": \[0.25,0.25,0.5,0.25,0.75\], "melodic_contour":
"rise-fall-rise", "character": "curious calm" }

These parameters remain constant to preserve recognizability.

------------------------------------------------------------------------

# Gemini 3.1 Context Engine

Gemini maintains music state across time.

Inputs:

current_scene_vibe\
visible_user_ids\
previous_music_state

Gemini outputs a structured prompt for Lyria.

Responsibilities:

-   maintain style consistency
-   control motif appearances
-   avoid musical clutter
-   blend motifs musically

------------------------------------------------------------------------

# Runtime Input

{ "vibe": "ambient calm evening", "visible_users": \[ "user_13",
"user_42" \] }

Gemini retrieves motif signatures for each user.

------------------------------------------------------------------------

# Prompt Construction

Example prompt sent to Lyria:

Generate a continuous musical background piece.

Scene vibe: calm ambient evening

Style: soft ambient electronic

Tempo: 70 bpm

Musical structure: sparse evolving texture

Integrate the following motifs as melodic elements.

Motif A: 5 notes interval pattern: +3, -2, +5, -3 melodic contour:
rise-fall-rise

Motif B: 4 notes interval pattern: +4, -1, +2 melodic contour: fall-rise

Rules: - motifs must remain recognizable - motifs appear occasionally -
motifs blend into the music - maintain stylistic coherence

------------------------------------------------------------------------

# Continuous Music Strategy

Music is generated in time segments.

segment_length = 8 seconds

Gemini stores:

previous_style\
previous_tempo\
previous_harmony

Next prompts reference them to maintain continuity.

Example:

Continue the previous musical piece. Maintain tempo and instrumentation.
Introduce motif B more prominently.

------------------------------------------------------------------------

# Motif Integration Strategy

Motifs appear periodically but may vary in instrumentation.

Allowed variations:

instrument change (piano → synth)\
octave shift\
rhythmic stretch\
different harmonic background

The melodic structure remains identical.

------------------------------------------------------------------------

# Handling People Entering

Gemini updates prompt:

Introduce motif gradually.

Example:

Play motif C once.

------------------------------------------------------------------------

# Handling People Leaving

Gemini fades motif presence.

Example:

Play motif inversion once before fading.

------------------------------------------------------------------------

# Music State Object

Gemini maintains:

music_state = { tempo, key, instrumentation, harmony_palette,
active_motifs }

Each generation references this state.

------------------------------------------------------------------------

# Example Cycle

Frame update:

vibe: relaxed outdoor park\
visible_users: user_7

Gemini prompt:

Continue the ambient acoustic guitar texture. Tempo 80 bpm. Integrate
motif for user_7 occasionally using soft whistle.

Next frame:

visible_users: user_7, user_12

Gemini prompt:

Maintain previous music. Add motif for user_12 using marimba. Avoid
overlapping motifs simultaneously.

------------------------------------------------------------------------

# Latency Strategy

Generate short segments\
Overlap audio segments\
Cache motif signatures locally\
Prefetch prompts

------------------------------------------------------------------------

# Summary

This pipeline creates adaptive cinematic soundtracks for real
environments.

Gemini 3.1 acts as the music director maintaining context and composing
prompts.

Lyria generates the music itself.

People become recognizable musical themes embedded within evolving
background soundtracks.
