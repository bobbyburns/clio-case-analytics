-- Activity Patterns page rollup. Replaces fetching every activity row just to
-- compute aggregate counts and per-user totals.

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

GRANT EXECUTE ON FUNCTION activity_patterns_rollup(date, date, text[]) TO authenticated, anon;
