-- Migration: Create person_events, persons, and visible_users tables

CREATE TABLE IF NOT EXISTS person_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id text NOT NULL,
    event_type text NOT NULL,        -- person_entered, person_updated, person_left
    user_type text NOT NULL,         -- enrolled, unknown
    user_id text NOT NULL,
    source text NOT NULL,            -- identity, track
    confidence real NOT NULL DEFAULT 0,
    bearing real NOT NULL DEFAULT 0,
    distance_proxy real NOT NULL DEFAULT 0,
    similarity_top1 real NOT NULL DEFAULT 0,
    similarity_top2 real NOT NULL DEFAULT 0,
    margin real NOT NULL DEFAULT 0,
    timestamp_ms bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_events_user_created
    ON person_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS persons (
    user_id text PRIMARY KEY,
    user_type text NOT NULL,         -- enrolled, unknown
    display_name text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    last_confidence real NOT NULL DEFAULT 0,
    metadata jsonb
);

CREATE TABLE IF NOT EXISTS visible_users (
    user_id text PRIMARY KEY,
    user_type text NOT NULL,         -- enrolled, unknown
    track_id text NOT NULL,
    confidence real NOT NULL DEFAULT 0,
    bearing real NOT NULL DEFAULT 0,
    distance_proxy real NOT NULL DEFAULT 0,
    entered_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
