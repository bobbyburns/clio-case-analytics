-- Per-matter, per-week billable rollup for the Activity Spikes page.
-- Excludes flat-fee matters (cannot generate surcharges) and the Xero
-- 2016-11-06 migration row (mirrors mv_matter_rollup's exclusion).

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_matter_weekly_billable AS
SELECT
  a.matter_unique_id,
  date_trunc('week', a.activity_date)::date AS week_start,
  COALESCE(SUM(a.billable_amount), 0) AS billable,
  COALESCE(SUM(a.hours), 0) AS hours,
  COUNT(*) AS activity_count
FROM clio_activities a
WHERE
  a.activity_date IS NOT NULL
  AND a.billable_amount > 0
  AND (a.flat_rate IS FALSE OR a.flat_rate IS NULL)
  AND NOT (
    a.activity_date = DATE '2016-11-06'
    AND lower(COALESCE(a.description, '')) LIKE '%xero%'
  )
GROUP BY a.matter_unique_id, date_trunc('week', a.activity_date);

CREATE UNIQUE INDEX IF NOT EXISTS mv_matter_weekly_billable_pk
  ON mv_matter_weekly_billable (matter_unique_id, week_start);

CREATE INDEX IF NOT EXISTS mv_matter_weekly_billable_week
  ON mv_matter_weekly_billable (week_start);

-- Per-matter weekly RPC. Read from matview when no filters; query live otherwise.
CREATE OR REPLACE FUNCTION matter_weekly_billable(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL
)
RETURNS TABLE (
  matter_unique_id text,
  week_start date,
  billable numeric,
  hours numeric,
  activity_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF date_from IS NULL AND date_to IS NULL THEN
    RETURN QUERY SELECT * FROM mv_matter_weekly_billable;
  ELSE
    RETURN QUERY
    SELECT
      a.matter_unique_id,
      date_trunc('week', a.activity_date)::date,
      COALESCE(SUM(a.billable_amount), 0),
      COALESCE(SUM(a.hours), 0),
      COUNT(*)
    FROM clio_activities a
    WHERE
      a.activity_date IS NOT NULL
      AND a.billable_amount > 0
      AND (a.flat_rate IS FALSE OR a.flat_rate IS NULL)
      AND NOT (
        a.activity_date = DATE '2016-11-06'
        AND lower(COALESCE(a.description, '')) LIKE '%xero%'
      )
      AND (date_from IS NULL OR a.activity_date >= date_from)
      AND (date_to IS NULL OR a.activity_date <= date_to)
    GROUP BY a.matter_unique_id, date_trunc('week', a.activity_date);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION matter_weekly_billable(date, date) TO authenticated, anon;

-- Drill-down: pull activity rows for a single (matter, week) pair.
CREATE OR REPLACE FUNCTION spike_activities(
  p_matter_id text,
  p_week_start date
)
RETURNS TABLE (
  activity_date date,
  type text,
  user_name text,
  description text,
  hours numeric,
  rate numeric,
  billable_amount numeric,
  expense_category text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.activity_date,
    a.type,
    a.user_name,
    a.description,
    a.hours,
    a.rate,
    a.billable_amount,
    a.expense_category
  FROM clio_activities a
  WHERE
    a.matter_unique_id = p_matter_id
    AND a.activity_date >= p_week_start
    AND a.activity_date < p_week_start + INTERVAL '7 days'
    AND a.billable_amount > 0
  ORDER BY a.activity_date, a.id;
$$;

GRANT EXECUTE ON FUNCTION spike_activities(text, date) TO authenticated, anon;

-- Extend refresh_rollups() to include the weekly matview.
CREATE OR REPLACE FUNCTION refresh_rollups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_matter_rollup;
  REFRESH MATERIALIZED VIEW mv_matter_monthly_hourly;
  REFRESH MATERIALIZED VIEW mv_monthly_firm_hourly;
  REFRESH MATERIALIZED VIEW mv_activity_patterns_global;
  REFRESH MATERIALIZED VIEW mv_activity_patterns_users;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_matter_weekly_billable;
END;
$$;
