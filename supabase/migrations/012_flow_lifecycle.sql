-- Keep newly-created blank Flows out of saved-flow listings until the user
-- adds their first node. Existing Flows remain active.
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS lifecycle_state text;

UPDATE public.flows
SET lifecycle_state = 'active'
WHERE lifecycle_state IS NULL;

ALTER TABLE public.flows
  ALTER COLUMN lifecycle_state SET DEFAULT 'active',
  ALTER COLUMN lifecycle_state SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'flows_lifecycle_state_check'
      AND conrelid = 'public.flows'::regclass
  ) THEN
    ALTER TABLE public.flows
      ADD CONSTRAINT flows_lifecycle_state_check
      CHECK (lifecycle_state IN ('draft', 'active'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.flows.lifecycle_state IS
  'Blank New Flows begin as drafts and become active after their first node is saved.';

-- Lifecycle is one-way. Saving a first node or making a Flow a template
-- promotes it even if a stale client omits lifecycle_state from its update.
CREATE OR REPLACE FUNCTION public.enforce_flow_lifecycle_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  node_count integer := 0;
BEGIN
  IF jsonb_typeof(NEW.flow_data::jsonb -> 'nodes') = 'array' THEN
    node_count := jsonb_array_length(NEW.flow_data::jsonb -> 'nodes');
  END IF;

  IF NEW.is_template = TRUE OR node_count > 0 THEN
    NEW.lifecycle_state := 'active';
  ELSIF TG_OP = 'UPDATE' AND OLD.lifecycle_state = 'active' THEN
    NEW.lifecycle_state := 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_flow_lifecycle_state ON public.flows;
CREATE TRIGGER enforce_flow_lifecycle_state
  BEFORE INSERT OR UPDATE
  ON public.flows
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_flow_lifecycle_state();

CREATE INDEX IF NOT EXISTS flows_user_active_updated_idx
  ON public.flows (user_id, updated_at DESC)
  WHERE lifecycle_state = 'active' AND is_template = FALSE;

CREATE INDEX IF NOT EXISTS flows_stale_drafts_idx
  ON public.flows (user_id, updated_at)
  WHERE lifecycle_state = 'draft';
