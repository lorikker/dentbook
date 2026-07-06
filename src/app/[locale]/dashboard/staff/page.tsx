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

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <ul className="mb-8 flex flex-col gap-2">
        {staff.map((m) => (
          <li key={m.id} className="rounded border p-3">
            {m.user.name} — {m.role}{m.title ? ` · ${m.title}` : ""}
            <span className="ml-2 text-sm text-gray-500">{m.user.email}</span>
          </li>
        ))}
      </ul>
      {ctx.role === "OWNER" && (
        <>
          <h2 className="mb-2 font-semibold">{t("addTitle")}</h2>
          <form action={addAction} className="flex max-w-md flex-col gap-2">
            <input name="name" required placeholder={t("name")} className="rounded border p-2" />
            <input name="email" type="email" required placeholder={t("email")} className="rounded border p-2" />
            <input name="password" required placeholder={t("tempPassword")} className="rounded border p-2" />
            <select name="role" className="rounded border p-2">
              <option value="DENTIST">{t("roles.DENTIST")}</option>
              <option value="RECEPTIONIST">{t("roles.RECEPTIONIST")}</option>
              <option value="OWNER">{t("roles.OWNER")}</option>
            </select>
            <input name="title" placeholder={t("titleField")} className="rounded border p-2" />
            <button className="rounded bg-sky-600 p-2 text-white">{t("add")}</button>
          </form>
        </>
      )}
    </div>
  );
}
