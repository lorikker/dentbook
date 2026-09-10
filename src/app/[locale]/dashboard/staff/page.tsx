import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { listStaff, addStaffMember } from "@/lib/staff-members";

export default async function StaffPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.staff");
  const staff = await listStaff(ctx);

  async function addAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    await addStaffMember(c, {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? ""),
      title: String(formData.get("title") ?? "") || undefined,
    });
    revalidatePath("/dashboard/staff");
  }

  const inputClass = "border border-ink-line bg-ink-surface px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <div className="mt-6 mb-10 grid gap-2.5">
        {staff.map((m) => (
          <div key={m.id} className="border border-ink-line bg-ink-surface p-3.5">
            <span className="font-semibold text-cream">{m.user.name}</span>
            <span className="text-muted"> — {m.role}{m.title ? ` · ${m.title}` : ""}</span>
            <span className="ml-2 text-sm text-muted-2">{m.user.email}</span>
          </div>
        ))}
      </div>
      {ctx.role === "OWNER" && (
        <>
          <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">{t("addTitle").toUpperCase()}</h2>
          <form action={addAction} className="mt-3 flex max-w-md flex-col gap-2.5">
            <input name="name" required placeholder={t("name")} className={inputClass} />
            <input name="email" type="email" required placeholder={t("email")} className={inputClass} />
            <input name="password" required placeholder={t("tempPassword")} className={inputClass} />
            <select name="role" className={inputClass}>
              <option value="DENTIST">{t("roles.DENTIST")}</option>
              <option value="RECEPTIONIST">{t("roles.RECEPTIONIST")}</option>
              <option value="OWNER">{t("roles.OWNER")}</option>
            </select>
            <input name="title" placeholder={t("titleField")} className={inputClass} />
            <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">{t("add")}</button>
          </form>
        </>
      )}
    </div>
  );
}
