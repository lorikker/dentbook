import type { GetStaticProps, InferGetStaticPropsType } from "next";
import Head from "next/head";
import { Card } from "@/components/Card";
import { PagesNav } from "@/components/PagesNav";
import { withDbContext } from "@/lib/tenant-db";

type Product = {
  id: string;
  nameEn: string;
  durationMin: number;
  priceEur: number;
  clinicName: string;
  clinicSlug: string;
};

// SSG + ISR: the cross-clinic services catalog changes infrequently, so it's
// prerendered at build time and revalidated in the background at most once
// every 60 seconds — no full rebuild needed to pick up edits.
export const getStaticProps = (async () => {
  const services = await withDbContext({ role: "public" }, (tx) =>
    tx.service.findMany({
      where: { active: true, clinic: { published: true } },
      include: { clinic: true },
      orderBy: { nameEn: "asc" },
    }));

  return {
    props: {
      services: services.map((s) => ({
        id: s.id,
        nameEn: s.nameEn,
        durationMin: s.durationMin,
        priceEur: Number(s.priceEur),
        clinicName: s.clinic.name,
        clinicSlug: s.clinic.slug,
      })),
    },
    revalidate: 60,
  };
}) satisfies GetStaticProps<{ services: Product[] }>;

export default function ProductsPage({
  services,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  return (
    <>
      <Head>
        <title>Products · Dentbook</title>
      </Head>
      <PagesNav />
      <main className="mx-auto w-full max-w-3xl p-8">
        <h1 className="mb-6 text-3xl font-bold">Products</h1>
        {services.length === 0 ? (
          <p className="text-gray-500">No products found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {services.map((s) => (
              <Card
                key={s.id}
                href={`/products/${s.id}`}
                title={s.nameEn}
                subtitle={`${s.clinicName} · ${s.priceEur} €`}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
