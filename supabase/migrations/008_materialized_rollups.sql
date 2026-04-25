-- Materialized rollups. Activity data is batch-imported, so live aggregation on
-- 231k+ rows per page-load is wasteful. Precompute once, read in <50ms.

-- Per-matter rollup: same shape as matter_activity_rollup() function.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_matter_rollup AS
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
GROUP BY a.matter_unique_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_matter_rollup_pk
  ON mv_matter_rollup (matter_unique_id);

-- Per-matter, per-month billable (hourly only) for the top-clients stacked chart.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_matter_monthly_hourly AS
SELECT
  a.matter_unique_id,
  to_char(a.activity_date, 'YYYY-MM') AS month,
  COALESCE(SUM(a.billable_amount), 0) AS billable
FROM clio_activities a
WHERE
  a.activity_date IS NOT NULL
  AND a.billable_amount > 0
  AND a.flat_rate IS NOT TRUE
GROUP BY a.matter_unique_id, to_char(a.activity_date, 'YYYY-MM');

CREATE INDEX IF NOT EXISTS mv_matter_monthly_hourly_matter
  ON mv_matter_monthly_hourly (matter_unique_id);

-- Firm-wide monthly revenue (hourly only).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_firm_hourly AS
SELECT
  to_char(a.activity_date, 'YYYY-MM') AS month,
  COALESCE(SUM(a.billable_amount), 0) AS billable
FROM clio_activities a
WHERE
  a.activity_date IS NOT NULL
  AND a.flat_rate IS NOT TRUE
GROUP BY to_char(a.activity_date, 'YYYY-MM');

-- Activity Patterns global totals (single row).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_activity_patterns_global AS
SELECT
  COUNT(*) AS total_entries,
  COUNT(*) FILTER (WHERE type = 'TimeEntry') AS time_entries,
  COUNT(*) FILTER (WHERE type = 'ExpenseEntry') AS expense_entries,
  COALESCE(SUM(CASE WHEN type = 'TimeEntry' AND billable_amount > 0 THEN hours ELSE 0 END), 0) AS billable_hours,
  COALESCE(SUM(CASE WHEN type = 'TimeEntry' AND nonbillable_amount > 0 THEN hours ELSE 0 END), 0) AS nonbillable_hours,
  COUNT(*) FILTER (WHERE type = 'TimeEntry' AND flat_rate IS TRUE) AS flat_rate_count,
  COUNT(*) FILTER (WHERE type = 'TimeEntry' AND (flat_rate IS FALSE OR flat_rate IS NULL)) AS hourly_count,
  COALESCE(SUM(billable_amount), 0) AS total_billable_amount
FROM clio_activities;

-- Activity Patterns top-10 users by billable amount.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_activity_patterns_users AS
SELECT user_name, ROUND(SUM(billable_amount))::numeric AS amount
FROM clio_activities
WHERE user_name IS NOT NULL AND billable_amount > 0
GROUP BY user_name
ORDER BY SUM(billable_amount) DESC
LIMIT 10;

-- Single-call refresh. Run after each CSV import.
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
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_rollups() TO authenticated;

-- Reroute the existing RPCs through matviews when there are no filters.
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
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF date_from IS NULL AND date_to IS NULL THEN
    RETURN QUERY SELECT * FROM mv_matter_rollup;
  ELSE
    RETURN QUERY
    SELECT
      a.matter_unique_id,
      COALESCE(SUM(a.billable_amount), 0),
      COALESCE(SUM(a.nonbillable_amount), 0),
      COALESCE(SUM(a.hours), 0),
      COALESCE(SUM(CASE WHEN a.flat_rate THEN a.billable_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN NOT a.flat_rate OR a.flat_rate IS NULL THEN a.billable_amount ELSE 0 END), 0),
      COALESCE(SUM(
        CASE
          WHEN a.activity_date = DATE '2016-11-06'
            AND lower(COALESCE(a.description, '')) LIKE '%xero%'
          THEN a.billable_amount
          ELSE 0
        END
      ), 0),
      COUNT(*),
      MIN(a.activity_date),
      MAX(a.activity_date)
    FROM clio_activities a
    WHERE
      (date_from IS NULL OR a.activity_date >= date_from)
      AND (date_to IS NULL OR a.activity_date <= date_to)
    GROUP BY a.matter_unique_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION matter_monthly_billable(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL,
  hourly_only boolean DEFAULT false
)
RETURNS TABLE (
  matter_unique_id text,
  month text,
  billable numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF date_from IS NULL AND date_to IS NULL AND hourly_only THEN
    RETURN QUERY SELECT * FROM mv_matter_monthly_hourly;
  ELSE
    RETURN QUERY
    SELECT
      a.matter_unique_id,
      to_char(a.activity_date, 'YYYY-MM'),
      COALESCE(SUM(a.billable_amount), 0)
    FROM clio_activities a
    WHERE
      a.activity_date IS NOT NULL
      AND a.billable_amount > 0
      AND (date_from IS NULL OR a.activity_date >= date_from)
      AND (date_to IS NULL OR a.activity_date <= date_to)
      AND (NOT hourly_only OR a.flat_rate IS NOT TRUE)
    GROUP BY a.matter_unique_id, to_char(a.activity_date, 'YYYY-MM');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION monthly_firm_revenue(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL,
  hourly_only boolean DEFAULT false
)
RETURNS TABLE (
  month text,
  billable numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF date_from IS NULL AND date_to IS NULL AND hourly_only THEN
    RETURN QUERY SELECT * FROM mv_monthly_firm_hourly ORDER BY month;
  ELSE
    RETURN QUERY
    SELECT
      to_char(a.activity_date, 'YYYY-MM'),
      COALESCE(SUM(a.billable_amount), 0)
    FROM clio_activities a
    WHERE
      a.activity_date IS NOT NULL
      AND (date_from IS NULL OR a.activity_date >= date_from)
      AND (date_to IS NULL OR a.activity_date <= date_to)
      AND (NOT hourly_only OR a.flat_rate IS NOT TRUE)
    GROUP BY to_char(a.activity_date, 'YYYY-MM')
    ORDER BY 1;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION activity_patterns_rollup(
  date_from date DEFAULT NULL,
  date_to date DEFAULT NULL,
  matter_ids text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  totals jsonb;
  by_user jsonb;
BEGIN
  IF date_from IS NULL AND date_to IS NULL AND matter_ids IS NULL THEN
    SELECT jsonb_build_object(
      'total_entries', total_entries,
      'time_entries', time_entries,
      'expense_entries', expense_entries,
      'billable_hours', billable_hours,
      'nonbillable_hours', nonbillable_hours,
      'flat_rate_count', flat_rate_count,
      'hourly_count', hourly_count,
      'total_billable_amount', total_billable_amount
    ) INTO totals
    FROM mv_activity_patterns_global;

    SELECT COALESCE(jsonb_agg(row_to_json(u)), '[]'::jsonb)
    INTO by_user
    FROM mv_activity_patterns_users u;

    RETURN totals || jsonb_build_object('top_users', by_user);
  END IF;

  SELECT jsonb_build_object(
    'total_entries', COUNT(*),
    'time_entries', COUNT(*) FILTER (WHERE type = 'TimeEntry'),
    'expense_entries', COUNT(*) FILTER (WHERE type = 'ExpenseEntry'),
    'billable_hours', COALESCE(SUM(CASE WHEN type = 'TimeEntry' AND billable_amount > 0 THEN hours ELSE 0 END), 0),
    'nonbillable_hours', COALESCE(SUM(CASE WHEN type = 'TimeEntry' AND nonbillable_amount > 0 THEN hours ELSE 0 END), 0),
    'flat_rate_count', COUNT(*) FILTER (WHERE type = 'TimeEntry' AND flat_rate IS TRUE),
    'hourly_count', COUNT(*) FILTER (WHERE type = 'TimeEntry' AND (flat_rate IS FALSE OR flat_rate IS NULL)),
    'total_billable_amount', COALESCE(SUM(billable_amount), 0)
  ) INTO totals
  FROM clio_activities a
  WHERE
    (date_from IS NULL OR a.activity_date >= date_from)
    AND (date_to IS NULL OR a.activity_date <= date_to)
    AND (matter_ids IS NULL OR a.matter_unique_id = ANY(matter_ids));

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO by_user
  FROM (
    SELECT user_name, ROUND(SUM(billable_amount))::numeric AS amount
    FROM clio_activities a
    WHERE
      a.user_name IS NOT NULL
      AND a.billable_amount > 0
      AND (date_from IS NULL OR a.activity_date >= date_from)
      AND (date_to IS NULL OR a.activity_date <= date_to)
      AND (matter_ids IS NULL OR a.matter_unique_id = ANY(matter_ids))
    GROUP BY user_name
    ORDER BY SUM(billable_amount) DESC
    LIMIT 10
  ) t;

  RETURN totals || jsonb_build_object('top_users', by_user);
END;
$$;
