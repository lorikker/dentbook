-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_clinic_id_key" ON "favorites"("user_id", "clinic_id");

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- === Enable RLS ===
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorites_all ON favorites FOR ALL
  USING (user_id = app_user_id() OR app_role() = 'admin')
  WITH CHECK (user_id = app_user_id() OR app_role() = 'admin');
