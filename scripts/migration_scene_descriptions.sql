-- Scene descriptions: singleton row holding the latest scene vibe description.
-- Mirrors the visible_users pattern but for scene-level context.

CREATE TABLE IF NOT EXISTS scene_descriptions (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    description text NOT NULL,
    model text NOT NULL DEFAULT 'gemini-2.0-flash',
    timestamp_ms bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
