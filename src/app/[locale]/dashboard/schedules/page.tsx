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

  const inputClass = "border border-ink-line bg-ink-surface px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted-2 focus:border-accent";

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <div className="mt-6 mb-10 grid gap-3 sm:grid-cols-2">
        {dentists.map((m) => (
          <div key={m.id} className="border border-ink-line bg-ink-surface p-4">
            <p className="font-semibold">{m.user.name}{m.title ? ` · ${m.title}` : ""}</p>
            {m.schedules.length === 0 && (
              <p className="mt-1 text-sm text-muted">{t("noSchedule")}</p>
            )}
            <ul className="mt-1 text-sm text-muted">
              {m.schedules.map((s) => (
                <li key={s.id}>
                  {weekdays[s.weekday]}: {toHHmm(s.startMin)}–{toHHmm(s.endMin)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">{t("setTitle").toUpperCase()}</h2>
      <form action={setAction} className="mt-3 mb-10 flex max-w-md flex-col gap-2.5">
        <select name="membershipId" required className={inputClass}>
          {dentists.map((m) => (
            <option key={m.id} value={m.id}>{m.user.name}</option>
          ))}
        </select>
        <textarea name="entries" rows={5} placeholder={t("entriesPlaceholder")}
                  className={`${inputClass} font-mono`} />
        <p className="text-xs text-muted-2">{t("entriesHint")}</p>
        <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">{t("save")}</button>
      </form>

      <h2 className="text-[11.5px] font-bold tracking-[0.13em] text-muted-2">{t("exceptionTitle").toUpperCase()}</h2>
      <form action={exceptionAction} className="mt-3 flex max-w-md flex-col gap-2.5">
        <select name="membershipId" className={inputClass}>
          <option value="">{t("wholeClinic")}</option>
          {dentists.map((m) => (
            <option key={m.id} value={m.id}>{m.user.name}</option>
          ))}
        </select>
        <input name="date" type="date" required className={inputClass} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input name="closed" type="checkbox" defaultChecked /> {t("closed")}
        </label>
        <div className="flex gap-2.5">
          <input name="start" type="time" className={`flex-1 ${inputClass}`} />
          <input name="end" type="time" className={`flex-1 ${inputClass}`} />
        </div>
        <p className="text-xs text-muted-2">{t("exceptionHint")}</p>
        <button className="bg-accent px-4 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-accent-hover">{t("add")}</button>
      </form>
    </div>
  );
}
