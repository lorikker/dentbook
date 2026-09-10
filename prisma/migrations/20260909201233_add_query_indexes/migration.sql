-- DropIndex
DROP INDEX "otp_codes_phone_idx";

-- CreateIndex
CREATE INDEX "appointments_clinic_id_starts_at_idx" ON "appointments"("clinic_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_clinic_id_status_starts_at_idx" ON "appointments"("clinic_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_membership_id_starts_at_idx" ON "appointments"("membership_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_patient_user_id_idx" ON "appointments"("patient_user_id");

-- CreateIndex
CREATE INDEX "appointments_service_id_idx" ON "appointments"("service_id");

-- CreateIndex
CREATE INDEX "clinics_published_city_idx" ON "clinics"("published", "city");

-- CreateIndex
CREATE INDEX "clinics_published_created_at_idx" ON "clinics"("published", "created_at");

-- CreateIndex
CREATE INDEX "dentist_services_service_id_idx" ON "dentist_services"("service_id");

-- CreateIndex
CREATE INDEX "favorites_clinic_id_idx" ON "favorites"("clinic_id");

-- CreateIndex
CREATE INDEX "invoices_subscription_id_idx" ON "invoices"("subscription_id");

-- CreateIndex
CREATE INDEX "memberships_clinic_id_role_idx" ON "memberships"("clinic_id", "role");

-- CreateIndex
CREATE INDEX "memberships_clinic_id_created_at_idx" ON "memberships"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_clinic_id_idx" ON "notifications"("clinic_id");

-- CreateIndex
CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_codes_request_ip_created_at_idx" ON "otp_codes"("request_ip", "created_at");

-- CreateIndex
CREATE INDEX "payments_clinic_id_idx" ON "payments"("clinic_id");

-- CreateIndex
CREATE INDEX "reviews_clinic_id_status_idx" ON "reviews"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "reviews_patient_user_id_idx" ON "reviews"("patient_user_id");

-- CreateIndex
CREATE INDEX "schedule_exceptions_clinic_id_date_idx" ON "schedule_exceptions"("clinic_id", "date");

-- CreateIndex
CREATE INDEX "schedule_exceptions_membership_id_idx" ON "schedule_exceptions"("membership_id");

-- CreateIndex
CREATE INDEX "schedules_membership_id_idx" ON "schedules"("membership_id");

-- CreateIndex
CREATE INDEX "services_clinic_id_active_idx" ON "services"("clinic_id", "active");
