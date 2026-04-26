-- Persist the firm-wide meta-analysis (surcharge strategy / unit economics)
-- so the dashboard re-hydrates on page reload without re-billing the Anthropic
-- API. Append-only: each run gets its own row; the page reads the most recent.

CREATE TABLE IF NOT EXISTS clio_meta_analyses (
  id              bigserial PRIMARY KEY,
  input_count     integer NOT NULL,
  attorney_rate   integer NOT NULL,
  paralegal_rate  integer NOT NULL,
  result          jsonb NOT NULL,
  event_aggregates jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_used      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_analyses_created
  ON clio_meta_analyses (created_at DESC);

ALTER TABLE clio_meta_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON clio_meta_analyses
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service insert" ON clio_meta_analyses
  FOR INSERT WITH CHECK (true);
