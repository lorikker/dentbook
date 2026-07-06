import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/staff-context";
import { setWeeklySchedule, addException, listSchedulesForClinic } from "@/lib/schedules";

const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const toHHmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export default async function SchedulesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("Dashboard.schedules");
  const dentists = await listSchedulesForClinic(ctx);
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`weekdays.${d}` as never));

  async function setAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    const entries = String(formData.get("entries") ?? "")
      .split("\n").map((l) => l.trim()).filter(Boolean)
      .map((line) => {
        const [weekday, start, end] = line.split(",").map((p) => p.trim());
        return { weekday: Number(weekday), startMin: toMin(start), endMin: toMin(end) };
      });
    await setWeeklySchedule(c, String(formData.get("membershipId")), entries);
    revalidatePath("/dashboard/schedules");
  }

  async function exceptionAction(formData: FormData) {
    "use server";
    const c = await requireStaff();
    const closed = formData.get("closed") === "on";
    const start = String(formData.get("start") ?? "");
    const end = String(formData.get("end") ?? "");
    await addException(c, {
      membershipId: String(formData.get("membershipId") ?? "") || null,
      date: String(formData.get("date") ?? ""),
      closed,
      startMin: !closed && start ? toMin(start) : null,
      endMin: !closed && end ? toMin(end) : null,
    });
    revalidatePath("/dashboard/schedules");
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <ul className="mb-8 flex flex-col gap-4">
        {dentists.map((m) => (
          <li key={m.id} className="rounded border p-3">
            <p className="font-semibold">{m.user.name}{m.title ? ` · ${m.title}` : ""}</p>
            {m.schedules.length === 0 && (
              <p className="text-sm text-gray-500">{t("noSchedule")}</p>
            )}
            <ul className="text-sm">
              {m.schedules.map((s) => (
                <li key={s.id}>
                  {weekdays[s.weekday]}: {toHHmm(s.startMin)}–{toHHmm(s.endMin)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 font-semibold">{t("setTitle")}</h2>
      <form action={setAction} className="mb-8 flex max-w-md flex-col gap-2">
        <select name="membershipId" required className="rounded border p-2">
          {dentists.map((m) => (
            <option key={m.id} value={m.id}>{m.user.name}</option>
          ))}
        </select>
        <textarea name="entries" rows={5} placeholder={t("entriesPlaceholder")}
                  className="rounded border p-2 font-mono text-sm" />
        <p className="text-xs text-gray-500">{t("entriesHint")}</p>
        <button className="rounded bg-sky-600 p-2 text-white">{t("save")}</button>
      </form>

      <h2 className="mb-2 font-semibold">{t("exceptionTitle")}</h2>
      <form action={exceptionAction} className="flex max-w-md flex-col gap-2">
        <select name="membershipId" className="rounded border p-2">
          <option value="">{t("wholeClinic")}</option>
          {dentists.map((m) => (
            <option key={m.id} value={m.id}>{m.user.name}</option>
          ))}
        </select>
        <input name="date" type="date" required className="rounded border p-2" />
        <label className="flex items-center gap-2 text-sm">
          <input name="closed" type="checkbox" defaultChecked /> {t("closed")}
        </label>
        <div className="flex gap-2">
          <input name="start" type="time" className="flex-1 rounded border p-2" />
          <input name="end" type="time" className="flex-1 rounded border p-2" />
        </div>
        <p className="text-xs text-gray-500">{t("exceptionHint")}</p>
        <button className="rounded bg-sky-600 p-2 text-white">{t("add")}</button>
      </form>
    </div>
  );
}
