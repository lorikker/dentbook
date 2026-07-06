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

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <table className="mb-8 w-full text-left">
        <thead><tr className="border-b">
          <th className="py-2">{t("name")}</th><th>{t("duration")}</th>
          <th>{t("price")}</th><th>{t("deposit")}</th><th></th>
        </tr></thead>
        <tbody>
          {services.map((s) => (
            <tr key={s.id} className={`border-b ${s.active ? "" : "opacity-40"}`}>
              <td className="py-2">{s.nameSq}</td>
              <td>{s.durationMin} min</td>
              <td>{String(s.priceEur)} €</td>
              <td>{s.depositEur ? `${s.depositEur} €` : "—"}</td>
              <td>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={String(!s.active)} />
                  <button className="text-sm text-sky-700 underline">
                    {s.active ? t("deactivate") : t("activate")}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-2 font-semibold">{t("addTitle")}</h2>
      <form action={createAction} className="flex max-w-md flex-col gap-2">
        <input name="nameSq" required placeholder={t("nameSq")} className="rounded border p-2" />
        <input name="nameEn" required placeholder={t("nameEn")} className="rounded border p-2" />
        <input name="durationMin" type="number" required placeholder={t("duration")} className="rounded border p-2" />
        <input name="priceEur" type="number" step="0.01" required placeholder={t("price")} className="rounded border p-2" />
        <input name="depositEur" type="number" step="0.01" placeholder={t("deposit")} className="rounded border p-2" />
        <button className="rounded bg-sky-600 p-2 text-white">{t("add")}</button>
      </form>
    </div>
  );
}
