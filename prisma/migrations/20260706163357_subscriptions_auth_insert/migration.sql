-- Clinic self-registration runs in the 'auth' context (no clinic_id set yet),
-- so the signup flow needs these policies widened to 'auth'.

DROP POLICY subscriptions_all ON subscriptions;
CREATE POLICY subscriptions_all ON subscriptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'));

DROP POLICY memberships_write ON memberships;
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth'));

-- INSERT ... RETURNING on clinics needs the new (unpublished) row to pass the
-- SELECT policy, and the slug-uniqueness probe must see unpublished clinics.
DROP POLICY clinics_select ON clinics;
CREATE POLICY clinics_select ON clinics FOR SELECT USING (
  published = true OR id = app_clinic_id() OR app_role() IN ('admin', 'auth')
);
