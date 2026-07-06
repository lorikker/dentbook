-- Booking, availability, and manage-token flows run in the trusted 'auth'
-- context (no clinic/user session vars), so appointments must admit it.
DROP POLICY appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);
DROP POLICY appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT WITH CHECK (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);
DROP POLICY appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() IN ('admin', 'auth')
);

-- Marketplace shows dentist profiles of published clinics to anonymous
-- visitors (spec §5 public policies).
DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app_user_id()
  OR app_role() IN ('admin', 'auth')
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_user_id = users.id
          AND a.clinic_id = app_clinic_id()))
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.user_id = users.id
          AND m.clinic_id = app_clinic_id()))
  OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN clinics c ON c.id = m.clinic_id
        WHERE m.user_id = users.id
          AND m.role = 'DENTIST'
          AND c.published = true)
);
