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

  const inputClass = "border border-ink-line bg-ink-surface px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <form action={saveAction} className="mt-6 flex max-w-md flex-col gap-2.5">
        <input name="name" required defaultValue={clinic.name}
               placeholder={t("name")} className={inputClass} />
        <input name="city" required defaultValue={clinic.city}
               placeholder={t("city")} className={inputClass} />
        <input name="address" required defaultValue={clinic.address}
               placeholder={t("address")} className={inputClass} />
        <input name="phone" required defaultValue={clinic.phone}
               placeholder={t("phone")} className={inputClass} />
        <textarea name="aboutSq" defaultValue={clinic.aboutSq} rows={3}
                  placeholder={t("aboutSq")} className={inputClass} />
        <textarea name="aboutEn" defaultValue={clinic.aboutEn} rows={3}
                  placeholder={t("aboutEn")} className={inputClass} />
        <label className="flex items-center gap-2.5 text-sm text-muted">
          {t("brandColor")}
          <input name="brandColor" type="color" defaultValue={clinic.brandColor} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("bookingMode")}
          <select name="bookingMode" defaultValue={clinic.bookingMode} className={inputClass}>
            <option value="INSTANT">{t("modes.INSTANT")}</option>
            <option value="APPROVAL">{t("modes.APPROVAL")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          {t("cancellationWindow")}
          <input name="cancellationWindowHours" type="number" min={0} max={168}
                 defaultValue={clinic.cancellationWindowHours}
                 className={inputClass} />
        </label>
        <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">{t("save")}</button>
      </form>
    </div>
  );
}
