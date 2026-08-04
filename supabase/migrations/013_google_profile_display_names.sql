-- User Management displays display_name before username. Repair profiles whose
-- trigger-created display_name still hides the email-derived username as "User".

DROP TRIGGER IF EXISTS set_profile_username_from_auth_email ON public.profiles;
DROP TRIGGER IF EXISTS set_profile_google_details_from_auth ON public.profiles;
DROP FUNCTION IF EXISTS public.set_profile_username_from_auth_email();

CREATE OR REPLACE FUNCTION public.set_profile_google_details_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  derived_username text;
  google_display_name text;
BEGIN
  SELECT
    lower(
      regexp_replace(
        split_part(auth_user.email, '@', 1),
        '[^a-z0-9_]',
        '_',
        'gi'
      )
    ),
    COALESCE(
      CASE
        WHEN btrim(auth_user.raw_user_meta_data->>'full_name') <> ''
          AND lower(btrim(auth_user.raw_user_meta_data->>'full_name')) <> 'user'
        THEN btrim(auth_user.raw_user_meta_data->>'full_name')
      END,
      CASE
        WHEN btrim(auth_user.raw_user_meta_data->>'name') <> ''
          AND lower(btrim(auth_user.raw_user_meta_data->>'name')) <> 'user'
        THEN btrim(auth_user.raw_user_meta_data->>'name')
      END
    )
  INTO derived_username, google_display_name
  FROM auth.users AS auth_user
  WHERE auth_user.id = NEW.id;

  IF NEW.username = 'User'
    AND derived_username IS NOT NULL
    AND derived_username <> ''
  THEN
    NEW.username := derived_username;
  END IF;

  IF NEW.display_name = 'User' THEN
    NEW.display_name := google_display_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_profile_google_details_from_auth
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  WHEN (NEW.username = 'User' OR NEW.display_name = 'User')
  EXECUTE FUNCTION public.set_profile_google_details_from_auth();

-- Keep this migration independently corrective in case any profiles retained
-- the username placeholder after migration 012.
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

-- Prefer the Google full name. If metadata has no usable name, set NULL so
-- User Management falls back to the corrected username instead of "User".
UPDATE public.profiles AS profile
SET display_name = COALESCE(
  CASE
    WHEN btrim(auth_user.raw_user_meta_data->>'full_name') <> ''
      AND lower(btrim(auth_user.raw_user_meta_data->>'full_name')) <> 'user'
    THEN btrim(auth_user.raw_user_meta_data->>'full_name')
  END,
  CASE
    WHEN btrim(auth_user.raw_user_meta_data->>'name') <> ''
      AND lower(btrim(auth_user.raw_user_meta_data->>'name')) <> 'user'
    THEN btrim(auth_user.raw_user_meta_data->>'name')
  END
)
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND profile.display_name = 'User';
