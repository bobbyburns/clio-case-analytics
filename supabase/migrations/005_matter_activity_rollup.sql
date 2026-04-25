-- Matter-level activity rollup. Replaces fetchActivitiesForMatters() in the hot path
-- for Pricing Model and Clients pages, which currently pulls every activity row just
-- to compute per-matter sums and date bounds.

CREATE OR REPLACE FUNCTION matter_activity_rollup(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL
)
RETURNS TABLE (
  matter_unique_id text,
  total_billable numeric,
  total_nonbillable numeric,
  total_hours numeric,
  flat_rate_billable numeric,
  hourly_billable numeric,
  legacy_billable numeric,
  activity_count bigint,
  first_activity_date date,
  last_activity_date date
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.matter_unique_id,
    COALESCE(SUM(a.billable_amount), 0) AS total_billable,
    COALESCE(SUM(a.nonbillable_amount), 0) AS total_nonbillable,
    COALESCE(SUM(a.hours), 0) AS total_hours,
    COALESCE(SUM(CASE WHEN a.flat_rate THEN a.billable_amount ELSE 0 END), 0) AS flat_rate_billable,
    COALESCE(SUM(CASE WHEN NOT a.flat_rate OR a.flat_rate IS NULL THEN a.billable_amount ELSE 0 END), 0) AS hourly_billable,
    COALESCE(SUM(
      CASE
        WHEN a.activity_date = DATE '2016-11-06'
          AND lower(COALESCE(a.description, '')) LIKE '%xero%'
        THEN a.billable_amount
        ELSE 0
      END
    ), 0) AS legacy_billable,
    COUNT(*) AS activity_count,
    MIN(a.activity_date) AS first_activity_date,
    MAX(a.activity_date) AS last_activity_date
  FROM clio_activities a
  WHERE
    (date_from IS NULL OR a.activity_date >= date_from)
    AND (date_to IS NULL OR a.activity_date <= date_to)
  GROUP BY a.matter_unique_id;
$$;

-- Per-month firm-revenue rollup for predictability stats and trends.
CREATE OR REPLACE FUNCTION monthly_firm_revenue(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL,
  hourly_only boolean DEFAULT false
)
RETURNS TABLE (
  month text,
  billable numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_char(a.activity_date, 'YYYY-MM') AS month,
    COALESCE(SUM(a.billable_amount), 0) AS billable
  FROM clio_activities a
  WHERE
    a.activity_date IS NOT NULL
    AND (date_from IS NULL OR a.activity_date >= date_from)
    AND (date_to IS NULL OR a.activity_date <= date_to)
    AND (NOT hourly_only OR a.flat_rate IS NOT TRUE)
  GROUP BY to_char(a.activity_date, 'YYYY-MM')
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION matter_activity_rollup(date, date) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION monthly_firm_revenue(date, date, boolean) TO authenticated, anon;
