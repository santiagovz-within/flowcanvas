-- Derive Google OAuth profile usernames from the email local-part instead of
-- retaining the profile trigger's "User" placeholder.

CREATE OR REPLACE FUNCTION public.set_profile_username_from_auth_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  derived_username text;
BEGIN
  IF NEW.username IS DISTINCT FROM 'User' THEN
    RETURN NEW;
  END IF;

  SELECT lower(
    regexp_replace(
      split_part(auth_user.email, '@', 1),
      '[^a-z0-9_]',
      '_',
      'gi'
    )
  )
  INTO derived_username
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.id;

  IF derived_username IS NOT NULL AND derived_username <> '' THEN
    NEW.username := derived_username;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profile_username_from_auth_email ON public.profiles;
CREATE TRIGGER set_profile_username_from_auth_email
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.username = 'User')
  EXECUTE FUNCTION public.set_profile_username_from_auth_email();

-- Repair existing profiles without changing usernames that users or admins
-- have already customized.
UPDATE public.profiles AS profile
SET username = lower(
  regexp_replace(
    split_part(auth_user.email, '@', 1),
    '[^a-z0-9_]',
    '_',
    'gi'
  )
)
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND profile.username = 'User'
  AND auth_user.email IS NOT NULL
  AND split_part(auth_user.email, '@', 1) <> '';
