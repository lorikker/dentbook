import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { withDbContext } from "@/lib/tenant-db";
import { Card } from "@/components/Card";

export default async function ClinicsPage({
  searchParams,
}: { searchParams: Promise<{ city?: string }> }) {
  const t = await getTranslations("Clinics");
  const { city } = await searchParams;
  const all = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.findMany({ where: { published: true }, orderBy: { name: "asc" } }));
  const cities = [...new Set(all.map((c) => c.city))].sort();
  const clinics = city ? all.filter((c) => c.city === city) : all;

  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/clinics"
              className={`rounded-full border px-3 py-1 text-sm ${!city ? "bg-sky-600 text-white" : ""}`}>
          {t("allCities")}
        </Link>
        {cities.map((c) => (
          <Link key={c} href={`/clinics?city=${encodeURIComponent(c)}`}
                className={`rounded-full border px-3 py-1 text-sm ${city === c ? "bg-sky-600 text-white" : ""}`}>
            {c}
          </Link>
        ))}
      </div>
      {clinics.length === 0 && <p className="text-gray-500">{t("empty")}</p>}
      <ul className="flex flex-col gap-3">
        {clinics.map((c) => (
          <li key={c.id}>
            <Card href={`/clinics/${c.slug}`} title={c.name} subtitle={`${c.city} · ${c.address}`} />
          </li>
        ))}
      </ul>
    </main>
  );
}
