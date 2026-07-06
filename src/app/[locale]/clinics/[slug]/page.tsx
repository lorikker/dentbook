import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withDbContext } from "@/lib/tenant-db";

export default async function ClinicProfilePage({
  params,
}: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  const t = await getTranslations("Clinics");
  const clinic = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findFirst({
      where: { slug, published: true },
      include: {
        services: { where: { active: true }, orderBy: { nameSq: "asc" } },
        memberships: { where: { role: "DENTIST" },
                       include: { user: true }, orderBy: { createdAt: "asc" } },
      },
    }));
  if (!clinic) notFound();
  const about = locale === "en" ? clinic.aboutEn : clinic.aboutSq;

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="text-3xl font-bold" style={{ color: clinic.brandColor }}>
        {clinic.name}
      </h1>
      <p className="mb-1 text-gray-600">{clinic.city} · {clinic.address}</p>
      <p className="mb-6 text-gray-600">{clinic.phone}</p>
      {about && <p className="mb-8 whitespace-pre-line">{about}</p>}

      <h2 className="mb-2 text-xl font-semibold">{t("dentists")}</h2>
      <ul className="mb-8 flex flex-col gap-2">
        {clinic.memberships.map((m) => (
          <li key={m.id} className="rounded border p-3">
            {/* user can be null only if RLS blocks it — render defensively */}
            <p className="font-medium">{m.user?.name}{m.title ? ` · ${m.title}` : ""}</p>
            {m.bio && <p className="text-sm text-gray-500">{m.bio}</p>}
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-xl font-semibold">{t("services")}</h2>
      <ul className="flex flex-col gap-2">
        {clinic.services.map((s) => (
          <li key={s.id}
              className="flex items-center justify-between rounded border p-3">
            <span>
              {locale === "en" ? s.nameEn : s.nameSq}
              <span className="ml-2 text-sm text-gray-500">
                {s.durationMin} min · {String(s.priceEur)} €
              </span>
            </span>
            <Link href={`/clinics/${clinic.slug}/book?serviceId=${s.id}`}
                  className="rounded bg-sky-600 px-4 py-2 text-sm text-white">
              {t("book")}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
