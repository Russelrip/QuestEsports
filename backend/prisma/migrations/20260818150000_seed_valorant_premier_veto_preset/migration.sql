-- Seed the canonical Premier preset separately so existing veto migrations
-- remain immutable and automatic match-room provisioning has a valid FK.
INSERT INTO "veto_rule_presets"
  ("id", "name", "game", "format", "version", "steps", "is_built_in", "updated_at")
VALUES
  (
    '00000000-0000-4000-8000-000000000304',
    'Valorant Premier',
    'valorant',
    'premier',
    1,
    '[
      {"kind":"ban","actor":"A"},
      {"kind":"ban","actor":"B"},
      {"kind":"ban","actor":"A"},
      {"kind":"ban","actor":"B"},
      {"kind":"ban","actor":"A"},
      {"kind":"ban","actor":"B"},
      {"kind":"decider","actor":null,"seriesIndex":1}
    ]'::jsonb,
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO NOTHING;
