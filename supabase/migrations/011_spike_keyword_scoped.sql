-- Tighter keyword search: limits results to matter-weeks whose total billable
-- is meaningful (>= the absolute floor the user set). Without this, the global
-- search returns ~thousands of low-billable weeks where the keyword incidentally
-- appears (e.g. "attorney" in a one-line note), and the client-side intersection
-- with the spike list zeroes out.

CREATE OR REPLACE FUNCTION weeks_with_activity_keyword(
  p_keyword text,
  p_floor numeric DEFAULT 0
)
RETURNS TABLE (
  matter_unique_id text,
  week_start date
)
LANGUAGE sql
STABLE
AS $$
  WITH matched AS (
    SELECT DISTINCT
      a.matter_unique_id,
      date_trunc('week', a.activity_date)::date AS week_start
    FROM clio_activities a
    WHERE
      a.activity_date IS NOT NULL
      AND a.billable_amount > 0
      AND (a.flat_rate IS FALSE OR a.flat_rate IS NULL)
      AND a.description ILIKE '%' || p_keyword || '%'
  )
  SELECT m.matter_unique_id, m.week_start
  FROM matched m
  JOIN mv_matter_weekly_billable w
    ON w.matter_unique_id = m.matter_unique_id
   AND w.week_start = m.week_start
  WHERE w.billable >= COALESCE(p_floor, 0);
$$;

GRANT EXECUTE ON FUNCTION weeks_with_activity_keyword(text, numeric) TO authenticated, anon;
