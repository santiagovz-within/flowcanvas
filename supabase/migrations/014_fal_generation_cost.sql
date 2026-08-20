ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS fal_billable_units numeric,
  ADD COLUMN IF NOT EXISTS fal_unit_price_usd numeric,
  ADD COLUMN IF NOT EXISTS fal_cost_usd numeric;

COMMENT ON COLUMN public.generations.fal_billable_units IS
  'Actual quantity reported by the x-fal-billable-units result header.';
COMMENT ON COLUMN public.generations.fal_unit_price_usd IS
  'Account-specific Fal unit price captured when the result completed.';
COMMENT ON COLUMN public.generations.fal_cost_usd IS
  'Actual Fal charge: billable units multiplied by the captured unit price.';
