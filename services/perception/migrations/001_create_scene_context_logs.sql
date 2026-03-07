CREATE TABLE IF NOT EXISTS scene_context_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id TEXT NOT NULL,
  environment_label TEXT NOT NULL,
  events JSONB DEFAULT '[]'::jsonb,
  timestamp BIGINT NOT NULL,
  raw_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_scene_context_logs_scene_id ON scene_context_logs(scene_id);
CREATE INDEX idx_scene_context_logs_timestamp ON scene_context_logs(timestamp);
