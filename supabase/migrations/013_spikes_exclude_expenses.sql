-- Exclude ExpenseEntry rows from all spike-related views/functions.
-- Reimbursable expenses (court reporters, filing fees, copying, expert
-- retainers, books) are bookkeeping noise, not legal work — they inflate
-- spike billables without indicating any actual event the firm could
-- charge a surcharge for.

-- Matview must be dropped and recreated; CREATE OR REPLACE MV isn't a thing.
DROP MATERIALIZED VIEW IF EXISTS mv_matter_weekly_billable CASCADE;

CREATE MATERIALIZED VIEW mv_matter_weekly_billable AS
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
  AND a.type = 'TimeEntry'
  AND (a.flat_rate IS FALSE OR a.flat_rate IS NULL)
  AND NOT (
    a.activity_date = DATE '2016-11-06'
    AND lower(COALESCE(a.description, '')) LIKE '%xero%'
  )
GROUP BY a.matter_unique_id, date_trunc('week', a.activity_date);

CREATE UNIQUE INDEX mv_matter_weekly_billable_pk
  ON mv_matter_weekly_billable (matter_unique_id, week_start);

CREATE INDEX mv_matter_weekly_billable_week
  ON mv_matter_weekly_billable (week_start);

-- Live-query RPC mirrors the same TimeEntry-only filter.
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
      AND a.type = 'TimeEntry'
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

-- Drill-down: only TimeEntry rows.
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
    AND a.type = 'TimeEntry'
  ORDER BY a.activity_date, a.id;
$$;

GRANT EXECUTE ON FUNCTION spike_activities(text, date) TO authenticated, anon;

-- Keyword search also TimeEntry-only.
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
      AND a.type = 'TimeEntry'
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

-- Repopulate the matview with the new filter.
REFRESH MATERIALIZED VIEW mv_matter_weekly_billable;
