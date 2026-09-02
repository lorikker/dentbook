import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin-context";
import { listPendingClinics, approveClinic } from "@/lib/clinic-approvals";
import { connectMongo } from "@/lib/mongo";
import { ActivityLog } from "@/lib/models/activity-log";
import { Testimonial } from "@/lib/models/testimonial";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";

interface ActivityLogEntry {
  _id: unknown;
  type: string;
  message: string;
  createdAt: Date;
}

interface TestimonialEntry {
  _id: unknown;
  authorName: string;
  quote: string;
  published: boolean;
}

export default async function AdminPage() {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("Admin");

  const [pendingClinics] = await Promise.all([
    listPendingClinics(ctx),
    connectMongo(),
  ]);
  const [activityLogs, testimonials] = await Promise.all([
    ActivityLog.find().sort({ createdAt: -1 }).limit(50).lean<ActivityLogEntry[]>(),
    Testimonial.find().sort({ createdAt: -1 }).lean<TestimonialEntry[]>(),
  ]);

  async function approveAction(formData: FormData) {
    "use server";
    const c = await requirePlatformAdmin();
    await approveClinic(c, String(formData.get("clinicId")));
    revalidatePath("/admin");
  }

  async function toggleAction(formData: FormData) {
    "use server";
    await requirePlatformAdmin();
    const [{ connectMongo }, { Testimonial }] = await Promise.all([
      import("@/lib/mongo"),
      import("@/lib/models/testimonial"),
    ]);
    await connectMongo();
    const id = String(formData.get("id"));
    const currentPublished = formData.get("published") === "true";
    await Testimonial.findByIdAndUpdate(id, { published: !currentPublished });
    revalidatePath("/admin");
  }

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">{t("title")}</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">{t("pendingClinics")}</h2>
        {pendingClinics.length === 0 && (
          <p className="text-gray-500">{t("noPending")}</p>
        )}
        <ul className="flex flex-col gap-3">
          {pendingClinics.map((clinic) => (
            <li key={clinic.id} className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <Card title={clinic.name} subtitle={`${clinic.city} · ${clinic.address}`} />
              </div>
              <form action={approveAction}>
                <input type="hidden" name="clinicId" value={clinic.id} />
                <Button type="submit">{t("approve")}</Button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">{t("activityFeed")}</h2>
        {activityLogs.length === 0 && (
          <p className="text-gray-500">{t("noActivity")}</p>
        )}
        <ul className="flex flex-col gap-2">
          {activityLogs.map((log) => (
            <li key={String(log._id)} className="rounded border p-3 text-sm">
              <span className="font-mono text-xs text-gray-500">
                {new Date(log.createdAt).toLocaleString()}
              </span>
              {" — "}
              <span className="font-semibold">{log.type}</span>
              {": "}
              {log.message}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("testimonials")}</h2>
        {testimonials.length === 0 && (
          <p className="text-gray-500">{t("noTestimonials")}</p>
        )}
        <ul className="flex flex-col gap-3">
          {testimonials.map((testimonial) => (
            <li key={String(testimonial._id)} className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <Card title={testimonial.authorName} subtitle={testimonial.quote} />
              </div>
              <form action={toggleAction}>
                <input type="hidden" name="id" value={String(testimonial._id)} />
                <input type="hidden" name="published" value={String(testimonial.published)} />
                <Button type="submit">
                  {testimonial.published ? t("hide") : t("publish")}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
