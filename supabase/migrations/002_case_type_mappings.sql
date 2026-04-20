-- Case type mappings: maps raw Clio case types to normalized categories
CREATE TABLE IF NOT EXISTS public.case_type_mappings (
  id serial primary key,
  raw_case_type text unique not null,
  mapped_category text not null,
  created_at timestamptz default now()
);

ALTER TABLE public.case_type_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON public.case_type_mappings
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_insert" ON public.case_type_mappings
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated_update" ON public.case_type_mappings
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_delete" ON public.case_type_mappings
  FOR DELETE USING (auth.role() = 'authenticated');

-- Add mapped_category column to clio_matters for filtered queries
ALTER TABLE public.clio_matters ADD COLUMN IF NOT EXISTS mapped_category text;
CREATE INDEX IF NOT EXISTS idx_matters_mapped_category ON public.clio_matters (mapped_category);
