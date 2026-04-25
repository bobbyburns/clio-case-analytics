-- Performance indexes for navigation queries.
-- All filtering happens on these columns; without indexes, every page does sequential scans.

CREATE INDEX IF NOT EXISTS idx_clio_activities_matter_unique_id
  ON clio_activities (matter_unique_id);

CREATE INDEX IF NOT EXISTS idx_clio_activities_activity_date
  ON clio_activities (activity_date);

CREATE INDEX IF NOT EXISTS idx_clio_activities_matter_date
  ON clio_activities (matter_unique_id, activity_date);

CREATE INDEX IF NOT EXISTS idx_clio_matters_open_date
  ON clio_matters (open_date DESC);

CREATE INDEX IF NOT EXISTS idx_clio_matters_status
  ON clio_matters (status);

CREATE INDEX IF NOT EXISTS idx_clio_matters_disregarded
  ON clio_matters (disregarded)
  WHERE disregarded IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_clio_matters_mapped_category
  ON clio_matters (mapped_category);

CREATE INDEX IF NOT EXISTS idx_clio_matters_county
  ON clio_matters (county);

CREATE INDEX IF NOT EXISTS idx_clio_matters_responsible_attorney
  ON clio_matters (responsible_attorney);

ANALYZE clio_matters;
ANALYZE clio_activities;
