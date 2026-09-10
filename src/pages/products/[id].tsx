import type {
  GetStaticPaths,
  GetStaticProps,
  InferGetStaticPropsType,
} from "next";
import Head from "next/head";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { PagesNav } from "@/components/PagesNav";
import { withDbContext } from "@/lib/tenant-db";

type ProductDetail = {
  id: string;
  nameEn: string;
  durationMin: number;
  priceEur: number;
  clinicName: string;
  clinicSlug: string;
  clinicCity: string;
};

// Pre-build a handful of services at build time; every other id falls back
// to on-demand SSR-then-cache ("blocking") the first time it's requested.
export const getStaticPaths = (async () => {
  const top = await withDbContext({ role: "public" }, (tx) =>
    tx.service.findMany({
      where: { active: true, clinic: { published: true } },
      take: 5,
      orderBy: { nameEn: "asc" },
      select: { id: true },
    }));

  return {
    paths: top.map((s) => ({ params: { id: s.id } })),
    fallback: "blocking",
  };
}) satisfies GetStaticPaths;

export const getStaticProps = (async (context) => {
  const id = context.params?.id as string;
  const service = await withDbContext({ role: "public" }, (tx) =>
    tx.service.findFirst({
      where: { id, active: true, clinic: { published: true } },
      include: { clinic: true },
    }));

  if (!service) return { notFound: true };

  return {
    props: {
      id: service.id,
      nameEn: service.nameEn,
      durationMin: service.durationMin,
      priceEur: Number(service.priceEur),
      clinicName: service.clinic.name,
      clinicSlug: service.clinic.slug,
      clinicCity: service.clinic.city,
    },
    revalidate: 60,
  };
}) satisfies GetStaticProps<ProductDetail, { id: string }>;

export default function ProductDetailPage({
  nameEn,
  durationMin,
  priceEur,
  clinicName,
  clinicSlug,
  clinicCity,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  return (
    <>
      <Head>
        <title>{nameEn} · Dentbook</title>
      </Head>
      <div className="min-h-screen bg-ink text-cream">
        <PagesNav />
        <main className="mx-auto w-full max-w-2xl p-8">
          <h1 className="font-display text-4xl font-bold tracking-tight">{nameEn}</h1>
          <p className="mt-2 mb-8 text-muted">
            {durationMin} min · {priceEur} €
          </p>
          <Card title={clinicName} subtitle={clinicCity} />
          <div className="mt-6">
            <ButtonLink href={`/clinics/${clinicSlug}`}>View clinic</ButtonLink>
          </div>
        </main>
      </div>
    </>
  );
}
