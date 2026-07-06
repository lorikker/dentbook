-- Staff must see colleague user rows (names/emails) for the dashboard:
-- staff list, schedules, and appointment views join membership -> user.
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
);
