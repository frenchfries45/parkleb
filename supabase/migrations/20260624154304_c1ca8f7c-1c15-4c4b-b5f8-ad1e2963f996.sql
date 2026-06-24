
-- 1. Add backend_admin enum value (must be committed before being used as a literal)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'backend_admin';

-- 2. Create pending_messages table
CREATE TABLE IF NOT EXISTS public.pending_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE CASCADE,
  subscriber_name TEXT NOT NULL,
  subscriber_phone TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  message TEXT NOT NULL,
  requested_by_username TEXT NOT NULL,
  requested_by_user_id UUID NOT NULL,
  is_bulk BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by_username TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_messages TO authenticated;
GRANT ALL ON public.pending_messages TO service_role;

ALTER TABLE public.pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pending messages"
  ON public.pending_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert pending messages"
  ON public.pending_messages FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update pending messages"
  ON public.pending_messages FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete pending messages"
  ON public.pending_messages FOR DELETE TO authenticated USING (true);

-- 3. Add role and allowlisted_username columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role public.app_role NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS allowlisted_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_allowlisted_username_key
  ON public.profiles (allowlisted_username)
  WHERE allowlisted_username IS NOT NULL;

-- 4. Backfill roles from user_roles (only admin/employee currently exist in DB).
-- backend_admin enum value is added in this same migration but cannot be referenced
-- as a literal here; nobody has that role yet anyway.
UPDATE public.profiles p
SET role = sub.role
FROM (
  SELECT user_id,
         CASE
           WHEN bool_or(role = 'admin'::public.app_role) THEN 'admin'::public.app_role
           ELSE 'employee'::public.app_role
         END AS role
  FROM public.user_roles
  GROUP BY user_id
) sub
WHERE p.user_id = sub.user_id;

-- 5. Drop the legacy tables (policies drop with them via CASCADE)
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.allowed_usernames CASCADE;

-- 6. Rewrite has_role to read from profiles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE user_id = _user_id AND role = _role
  )
$$;

-- 7. Drop the unused allowlist helper functions
DROP FUNCTION IF EXISTS public.is_username_allowed(text);
DROP FUNCTION IF EXISTS public.claim_allowed_username(text);

-- 8. Update handle_new_user to set role directly on profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    'employee'
  );
  RETURN NEW;
END;
$$;

-- 9. Privilege-escalation guard: users may update their own profile but NOT their role
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND cmd='UPDATE' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

-- Helper to read current user's role without recursing through RLS
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid()
$$;

-- Users update their own profile, role must stay unchanged
CREATE POLICY "Users can update own profile (role locked)"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND role = public.current_user_role());

-- Admins can update any profile, including role
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
