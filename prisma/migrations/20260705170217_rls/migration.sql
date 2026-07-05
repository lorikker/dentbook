-- === Extensions ===
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- === Session-context helper functions ===
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'public')
$$;

-- === Double-booking guard (spec §6): one dentist, no overlapping active appts ===
-- Prisma stores DateTime as timestamp(3) without time zone (values are UTC),
-- so use tsrange: tstzrange over timestamp columns is not IMMUTABLE.
ALTER TABLE appointments ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    membership_id WITH =,
    tsrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));

-- === Enable RLS on tenant/user data ===
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE dentist_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- otp_codes: auth-layer table, not tenant data; guarded by the 'auth' context.
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- === Policies ===
-- Roles used in app.role: 'public' | 'patient' | 'staff' | 'admin' | 'auth'

-- users: self, admin, auth flows (user creation on OTP verify),
-- and staff may see patients who have an appointment at their clinic.
CREATE POLICY users_select ON users FOR SELECT USING (
  id = app_user_id()
  OR app_role() IN ('admin', 'auth')
  OR (app_role() = 'staff' AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_user_id = users.id
          AND a.clinic_id = app_clinic_id()))
);
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_role() IN ('auth', 'admin'));
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app_user_id() OR app_role() IN ('admin', 'auth'));

-- clinics: everyone sees published; staff their own; admin all.
CREATE POLICY clinics_select ON clinics FOR SELECT USING (
  published = true OR id = app_clinic_id() OR app_role() = 'admin'
);
CREATE POLICY clinics_insert ON clinics FOR INSERT
  WITH CHECK (app_role() IN ('staff', 'admin', 'auth'));
CREATE POLICY clinics_update ON clinics FOR UPDATE
  USING (id = app_clinic_id() OR app_role() = 'admin');

-- memberships: own rows, own clinic's rows, dentists of published clinics
-- (marketplace profiles), admin.
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  user_id = app_user_id()
  OR clinic_id = app_clinic_id()
  OR app_role() IN ('admin', 'auth')
  OR EXISTS (SELECT 1 FROM clinics c
             WHERE c.id = memberships.clinic_id AND c.published = true)
);
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

-- services: readable when the owning clinic is published, plus own tenant + admin.
CREATE POLICY services_select ON services FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR app_role() = 'admin'
  OR EXISTS (SELECT 1 FROM clinics c WHERE c.id = services.clinic_id AND c.published = true)
);
CREATE POLICY services_write ON services FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

CREATE POLICY dentist_services_select ON dentist_services FOR SELECT USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.id = dentist_services.membership_id)
);
CREATE POLICY dentist_services_write ON dentist_services FOR ALL
  USING (EXISTS (SELECT 1 FROM memberships m
                 WHERE m.id = dentist_services.membership_id
                   AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m
                      WHERE m.id = dentist_services.membership_id
                        AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')));

CREATE POLICY schedules_select ON schedules FOR SELECT USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.id = schedules.membership_id)
);
CREATE POLICY schedules_write ON schedules FOR ALL
  USING (EXISTS (SELECT 1 FROM memberships m
                 WHERE m.id = schedules.membership_id
                   AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM memberships m
                      WHERE m.id = schedules.membership_id
                        AND (m.clinic_id = app_clinic_id() OR app_role() = 'admin')));

CREATE POLICY schedule_exceptions_select ON schedule_exceptions FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR app_role() = 'admin'
  OR EXISTS (SELECT 1 FROM clinics c
             WHERE c.id = schedule_exceptions.clinic_id AND c.published = true)
);
CREATE POLICY schedule_exceptions_write ON schedule_exceptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

-- appointments: tenant staff, the patient themself, admin.
CREATE POLICY appointments_select ON appointments FOR SELECT USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);
CREATE POLICY appointments_insert ON appointments FOR INSERT WITH CHECK (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);
CREATE POLICY appointments_update ON appointments FOR UPDATE USING (
  clinic_id = app_clinic_id()
  OR patient_user_id = app_user_id()
  OR app_role() = 'admin'
);

-- reviews: published readable by all; author and tenant see their own; admin all.
CREATE POLICY reviews_select ON reviews FOR SELECT USING (
  status = 'PUBLISHED'
  OR patient_user_id = app_user_id()
  OR clinic_id = app_clinic_id()
  OR app_role() = 'admin'
);
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (patient_user_id = app_user_id() OR app_role() = 'admin');
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (app_role() = 'admin');

-- payments: tenant + admin + the paying patient (via their appointment).
CREATE POLICY payments_all ON payments FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin'
         OR EXISTS (SELECT 1 FROM appointments a
                    WHERE a.id = payments.appointment_id
                      AND a.patient_user_id = app_user_id()))
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin'
              OR EXISTS (SELECT 1 FROM appointments a
                         WHERE a.id = payments.appointment_id
                           AND a.patient_user_id = app_user_id()));

CREATE POLICY subscriptions_all ON subscriptions FOR ALL
  USING (clinic_id = app_clinic_id() OR app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic_id() OR app_role() = 'admin');

CREATE POLICY invoices_all ON invoices FOR ALL
  USING (app_role() = 'admin' OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = invoices.subscription_id AND s.clinic_id = app_clinic_id()))
  WITH CHECK (app_role() = 'admin' OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = invoices.subscription_id AND s.clinic_id = app_clinic_id()));

-- notifications: system-managed via worker (admin/auth) + tenant reads own.
CREATE POLICY notifications_select ON notifications FOR SELECT USING (
  clinic_id = app_clinic_id() OR app_role() IN ('admin', 'auth')
);
CREATE POLICY notifications_write ON notifications FOR ALL
  USING (app_role() IN ('admin', 'auth') OR clinic_id = app_clinic_id())
  WITH CHECK (app_role() IN ('admin', 'auth') OR clinic_id = app_clinic_id());

-- otp_codes: only the auth context touches these.
CREATE POLICY otp_codes_all ON otp_codes FOR ALL
  USING (app_role() = 'auth')
  WITH CHECK (app_role() = 'auth');
