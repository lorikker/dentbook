import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { listServices, createService, updateService } from "@/lib/services";

export default async function ServicesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.services");
  const services = await listServices(ctx);

  async function createAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await createService(c, {
      nameSq: String(formData.get("nameSq") ?? ""),
      nameEn: String(formData.get("nameEn") ?? ""),
      durationMin: Number(formData.get("durationMin")),
      priceEur: Number(formData.get("priceEur")),
      depositEur: formData.get("depositEur") ? Number(formData.get("depositEur")) : null,
    });
    revalidatePath("/dashboard/services");
  }

  async function toggleAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await updateService(c, String(formData.get("id")),
      { active: formData.get("active") === "true" });
    revalidatePath("/dashboard/services");
  }

  const inputClass = "border border-ink-line bg-ink-surface px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <div className="mt-6 mb-10 border border-ink-line">
        {services.map((s) => (
          <div
            key={s.id}
            className={`flex flex-wrap items-center justify-between gap-3 border-b border-ink-line bg-ink-surface px-5 py-3.5 last:border-b-0 ${s.active ? "" : "opacity-40"}`}
          >
            <span className="text-cream">{s.nameSq}</span>
            <span className="flex items-center gap-5 text-sm text-muted">
              <span>{s.durationMin} min</span>
              <span className="font-semibold text-cream">{String(s.priceEur)} €</span>
              <span>{s.depositEur ? `${s.depositEur} €` : "—"}</span>
              <form action={toggleAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="active" value={String(!s.active)} />
                <button className="font-semibold text-accent hover:text-accent-hover">
                  {s.active ? t("deactivate") : t("activate")}
                </button>
              </form>
            </span>
          </div>
        ))}
      </div>
      <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">{t("addTitle").toUpperCase()}</h2>
      <form action={createAction} className="mt-3 flex max-w-md flex-col gap-2.5">
        <input name="nameSq" required placeholder={t("nameSq")} className={inputClass} />
        <input name="nameEn" required placeholder={t("nameEn")} className={inputClass} />
        <input name="durationMin" type="number" required placeholder={t("duration")} className={inputClass} />
        <input name="priceEur" type="number" step="0.01" required placeholder={t("price")} className={inputClass} />
        <input name="depositEur" type="number" step="0.01" placeholder={t("deposit")} className={inputClass} />
        <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">{t("add")}</button>
      </form>
    </div>
  );
}
