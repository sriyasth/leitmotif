-- Leitmotif: person motif prompts table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/jzaihdtewcepcldmrinm/sql

create table if not exists person_motif_prompts (
  id uuid default gen_random_uuid() primary key,
  user_id text not null unique,
  name text not null,
  motif_signature jsonb not null,
  motif_prompt text not null,
  created_at timestamptz default now()
);

-- Index for fast user_id lookups
create index if not exists idx_person_motif_prompts_user_id
  on person_motif_prompts (user_id);

-- Enable RLS (admin client bypasses this automatically)
alter table person_motif_prompts enable row level security;

-- Allow service role full access (already implicit, but explicit is cleaner)
create policy "service role full access"
  on person_motif_prompts
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- -------------------------------------------------------
-- Sample data for testing
-- -------------------------------------------------------

insert into person_motif_prompts (user_id, name, motif_signature, motif_prompt)
values
  (
    'user_13',
    'Alex',
    '{"note_count": 5, "interval_pattern": [0, 3, -2, 5, -3], "rhythm_pattern": [0.25, 0.25, 0.5, 0.25, 0.75], "melodic_contour": "rise-fall-rise", "character": "curious calm"}',
    'A gentle rising 5-note phrase, curious and warm, suitable for piano or soft synth'
  ),
  (
    'user_42',
    'Jordan',
    '{"note_count": 4, "interval_pattern": [0, 4, -1, 2], "rhythm_pattern": [0.5, 0.25, 0.25, 1.0], "melodic_contour": "fall-rise", "character": "grounded steady"}',
    'A grounded 4-note motif, steady and reassuring, suitable for cello or bass clarinet'
  ),
  (
    'user_7',
    'Sam',
    '{"note_count": 6, "interval_pattern": [0, 2, 3, -1, 2, -2], "rhythm_pattern": [0.25, 0.25, 0.25, 0.5, 0.25, 0.5], "melodic_contour": "ascending wave", "character": "playful bright"}',
    'A bright playful 6-note phrase, light and airy, suitable for marimba or vibraphone'
  ),
  (
    'user_12',
    'Riley',
    '{"note_count": 4, "interval_pattern": [0, -2, 3, -1], "rhythm_pattern": [0.5, 0.5, 0.25, 0.75], "melodic_contour": "fall-rise", "character": "reflective warm"}',
    'A reflective warm 4-note motif, introspective, suitable for flute or soft guitar'
  )
on conflict (user_id) do nothing;
