-- Access requests: created when a new @within.co user signs in for the first
-- time and lands on the pending-approval screen. All admins receive an email
-- with a one-click "Approve access" link that carries a single-use token.
-- Only the SHA-256 hash of that token is stored here.

CREATE TABLE IF NOT EXISTS public.access_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  approved_at timestamptz,
  approved_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS access_requests_user_id_idx
  ON public.access_requests (user_id);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

-- All reads and writes go through the service-role client on the server.
-- Admins may read for auditing; nobody else has direct access.
CREATE POLICY "admin_select"
  ON public.access_requests FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );
