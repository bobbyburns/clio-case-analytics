ALTER TABLE public.clio_matters ADD COLUMN IF NOT EXISTS disregarded boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_matters_disregarded ON public.clio_matters (disregarded);
