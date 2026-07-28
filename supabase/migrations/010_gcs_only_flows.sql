-- Admin-only mode for keeping Flow generation media in app-owned GCS.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS is_gcs_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.flows.is_gcs_only IS
  'When enabled, Fal generation outputs use immediate CDN expiry and request IO is not retained.';

-- RLS normally limits updates to the Flow owner, but it cannot restrict a single
-- column. This trigger prevents non-admin owners from enabling the privileged mode
-- through the Supabase API directly. The app route uses the service role only after
-- performing its own owner + admin checks.
CREATE OR REPLACE FUNCTION public.enforce_admin_gcs_only_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_gcs_only IS DISTINCT FROM OLD.is_gcs_only
    AND auth.role() IS DISTINCT FROM 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.is_admin = TRUE
    )
  THEN
    RAISE EXCEPTION 'Only admins can change GCS-only mode';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_gcs_only_mode ON public.flows;
CREATE TRIGGER enforce_admin_gcs_only_mode
  BEFORE UPDATE OF is_gcs_only ON public.flows
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_gcs_only_mode();
