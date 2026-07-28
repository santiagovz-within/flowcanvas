-- Make GCS-only mode a one-time choice available only to Flows created after
-- this migration. Existing Flows are deliberately marked ineligible.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS gcs_only_eligible boolean;

UPDATE public.flows
SET gcs_only_eligible = false
WHERE gcs_only_eligible IS NULL;

ALTER TABLE public.flows
  ALTER COLUMN gcs_only_eligible SET DEFAULT true,
  ALTER COLUMN gcs_only_eligible SET NOT NULL;

COMMENT ON COLUMN public.flows.gcs_only_eligible IS
  'Whether GCS-only mode can still be permanently enabled before the first Fal generation.';

-- Replace the original admin guard with one-way and eligibility enforcement.
-- The service-role generation routes may consume eligibility when generation
-- starts; the user-facing API still performs its own owner/admin checks.
CREATE OR REPLACE FUNCTION public.enforce_admin_gcs_only_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.gcs_only_eligible IS DISTINCT FROM OLD.gcs_only_eligible
    AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RAISE EXCEPTION 'GCS-only eligibility is managed by the application';
  END IF;

  IF OLD.is_gcs_only = TRUE AND NEW.is_gcs_only = FALSE
  THEN
    RAISE EXCEPTION 'GCS-only mode cannot be disabled once enabled';
  END IF;

  IF NEW.is_gcs_only IS DISTINCT FROM OLD.is_gcs_only
    AND NEW.is_gcs_only = TRUE
    AND OLD.gcs_only_eligible = FALSE
  THEN
    RAISE EXCEPTION 'GCS-only mode is not available for this Flow';
  END IF;

  IF NEW.is_gcs_only IS DISTINCT FROM OLD.is_gcs_only
    AND auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.is_admin = TRUE
    )
  THEN
    RAISE EXCEPTION 'Only admins can enable GCS-only mode';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_gcs_only_mode ON public.flows;
CREATE TRIGGER enforce_admin_gcs_only_mode
  BEFORE UPDATE OF is_gcs_only, gcs_only_eligible ON public.flows
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_gcs_only_mode();

