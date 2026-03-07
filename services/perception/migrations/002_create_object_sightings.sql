CREATE TABLE IF NOT EXISTS object_sightings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id TEXT NOT NULL,
  temp_id TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence FLOAT NOT NULL,
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  z FLOAT NOT NULL,
  distance_meters FLOAT NOT NULL,
  importance FLOAT NOT NULL DEFAULT 0.0,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_object_sightings_scene_id ON object_sightings(scene_id);
CREATE INDEX idx_object_sightings_label ON object_sightings(label);
CREATE INDEX idx_object_sightings_timestamp ON object_sightings(timestamp);
