-- Defence in depth for staff tenant scoping.
--
-- Every staff policy grants on `clinic_id = app_clinic_id()`, and app_clinic_id()
-- returned whatever the caller put in `app.clinic_id`. The application always
-- derives that from the signed-in user's own membership (staff-context.ts
-- resolveStaffMembership), so this was never reachable — but it made RLS a
-- scoping mechanism rather than an authorisation one: a single future action
-- that read clinicId from a form would become a silent cross-tenant breach with
-- nothing behind it.
--
-- app_clinic_id() now refuses to vouch for a clinic the session user is not a
-- member of, so a forged clinic id collapses to NULL and every `clinic_id =
-- app_clinic_id()` comparison fails. Only `app.role = 'staff'` is affected:
--   - 'public'  never sets a clinic id
--   - 'patient' is scoped by app_user_id(), not by clinic
--   - 'admin'   is admitted by the `app_role() = 'admin'` branch of each policy
--   - 'auth'    is the pre-login/booking context that legitimately acts on a
--               clinic before any membership exists (registration, booking),
--               and is admitted by its own policy branches
--
-- SECURITY DEFINER so the membership lookup itself is not filtered by RLS on
-- memberships (which would be circular — that policy calls app_clinic_id()).
-- The function is owned by the migration role, which owns the tables and is
-- therefore exempt from their policies (no table here uses FORCE ROW LEVEL
-- SECURITY). search_path is pinned so the definer's rights cannot be aimed at
-- an attacker-supplied schema.
CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN app_role() <> 'staff' THEN
      NULLIF(current_setting('app.clinic_id', true), '')::uuid
    WHEN EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id  = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
    ) THEN
      NULLIF(current_setting('app.clinic_id', true), '')::uuid
    ELSE NULL
  END
$$;

-- EXECUTE on a SECURITY DEFINER function is granted to PUBLIC by default;
-- keep it that way deliberately (the app role must call it) but make the
-- intent explicit.
GRANT EXECUTE ON FUNCTION app_clinic_id() TO PUBLIC;
