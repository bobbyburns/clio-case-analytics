-- Per-matter, per-month billable rollup for the top-clients stacked-area chart on
-- the Pricing Model page. Replaces a per-activity fetch (~70k rows) with ~2k×months
-- aggregated rows.

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
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.matter_unique_id,
    to_char(a.activity_date, 'YYYY-MM') AS month,
    COALESCE(SUM(a.billable_amount), 0) AS billable
  FROM clio_activities a
  WHERE
    a.activity_date IS NOT NULL
    AND a.billable_amount > 0
    AND (date_from IS NULL OR a.activity_date >= date_from)
    AND (date_to IS NULL OR a.activity_date <= date_to)
    AND (NOT hourly_only OR a.flat_rate IS NOT TRUE)
  GROUP BY a.matter_unique_id, to_char(a.activity_date, 'YYYY-MM');
$$;

GRANT EXECUTE ON FUNCTION matter_monthly_billable(date, date, boolean) TO authenticated, anon;
