import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";
import { updateClinicSettings } from "@/lib/clinic-settings";

export default async function SettingsPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.settings");
  const clinic = await withDbContext(
    { role: "staff", userId: ctx.userId, clinicId: ctx.clinicId },
    (tx) => tx.clinic.findUniqueOrThrow({ where: { id: ctx.clinicId } }),
  );

  async function saveAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await updateClinicSettings(c, {
      name: String(formData.get("name") ?? ""),
      city: String(formData.get("city") ?? ""),
      address: String(formData.get("address") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      aboutSq: String(formData.get("aboutSq") ?? ""),
      aboutEn: String(formData.get("aboutEn") ?? ""),
      brandColor: String(formData.get("brandColor") ?? ""),
      bookingMode: String(formData.get("bookingMode") ?? ""),
      cancellationWindowHours: Number(formData.get("cancellationWindowHours")),
    });
    revalidatePath("/dashboard/settings");
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <form action={saveAction} className="flex max-w-md flex-col gap-2">
        <input name="name" required defaultValue={clinic.name}
               placeholder={t("name")} className="rounded border p-2" />
        <input name="city" required defaultValue={clinic.city}
               placeholder={t("city")} className="rounded border p-2" />
        <input name="address" required defaultValue={clinic.address}
               placeholder={t("address")} className="rounded border p-2" />
        <input name="phone" required defaultValue={clinic.phone}
               placeholder={t("phone")} className="rounded border p-2" />
        <textarea name="aboutSq" defaultValue={clinic.aboutSq} rows={3}
                  placeholder={t("aboutSq")} className="rounded border p-2" />
        <textarea name="aboutEn" defaultValue={clinic.aboutEn} rows={3}
                  placeholder={t("aboutEn")} className="rounded border p-2" />
        <label className="flex items-center gap-2 text-sm">
          {t("brandColor")}
          <input name="brandColor" type="color" defaultValue={clinic.brandColor} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("bookingMode")}
          <select name="bookingMode" defaultValue={clinic.bookingMode}
                  className="rounded border p-2">
            <option value="INSTANT">{t("modes.INSTANT")}</option>
            <option value="APPROVAL">{t("modes.APPROVAL")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("cancellationWindow")}
          <input name="cancellationWindowHours" type="number" min={0} max={168}
                 defaultValue={clinic.cancellationWindowHours}
                 className="rounded border p-2" />
        </label>
        <button className="rounded bg-sky-600 p-2 text-white">{t("save")}</button>
      </form>
    </div>
  );
}
