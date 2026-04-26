-- Persist Claude's per-spike event classifications so they survive page reloads
-- and don't need to be re-analyzed (and re-billed to the API) every time.

CREATE TABLE IF NOT EXISTS clio_spike_analyses (
  matter_unique_id  text NOT NULL,
  week_start        date NOT NULL,
  primary_event     text NOT NULL,
  secondary_events  jsonb NOT NULL DEFAULT '[]'::jsonb,
  narrative         text NOT NULL,
  evidence_quotes   jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_used        text,
  analyzed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_unique_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_spike_analyses_event
  ON clio_spike_analyses (primary_event);

CREATE INDEX IF NOT EXISTS idx_spike_analyses_analyzed_at
  ON clio_spike_analyses (analyzed_at DESC);

ALTER TABLE clio_spike_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON clio_spike_analyses
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "service insert" ON clio_spike_analyses
  FOR INSERT WITH CHECK (true);

CREATE POLICY "service update" ON clio_spike_analyses
  FOR UPDATE USING (true);
