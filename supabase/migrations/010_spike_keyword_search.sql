-- Returns (matter_unique_id, week_start) pairs where at least one activity
-- in that ISO week has a description containing the search term. Used by
-- the Activity Spikes page to filter the spike table to weeks whose drivers
-- match a user's keyword (e.g. "hearing", "deposition", "trial").

CREATE OR REPLACE FUNCTION weeks_with_activity_keyword(
  p_keyword text
)
RETURNS TABLE (
  matter_unique_id text,
  week_start date
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT
    a.matter_unique_id,
    date_trunc('week', a.activity_date)::date AS week_start
  FROM clio_activities a
  WHERE
    a.activity_date IS NOT NULL
    AND a.billable_amount > 0
    AND (a.flat_rate IS FALSE OR a.flat_rate IS NULL)
    AND a.description ILIKE '%' || p_keyword || '%';
$$;

GRANT EXECUTE ON FUNCTION weeks_with_activity_keyword(text) TO authenticated, anon;

-- Trigram index for fast ILIKE on description. Skipped if pg_trgm unavailable
-- (a sequential scan still works, just slower).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clio_activities_description_trgm
             ON clio_activities USING gin (description gin_trgm_ops)
             WHERE description IS NOT NULL';
  END IF;
END$$;
