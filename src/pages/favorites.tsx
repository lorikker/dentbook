import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import Head from "next/head";
import { Card } from "@/components/Card";
import { PagesNav } from "@/components/PagesNav";
import { auth } from "@/auth";
import { listFavoriteClinics } from "@/lib/favorites";

type FavoriteClinic = {
  id: string;
  name: string;
  slug: string;
  city: string;
  address: string;
};

// SSR: favorites are per-user and must never be cached or served stale
// across users, so this page is rendered fresh on every request.
export const getServerSideProps = (async (context) => {
  const session = await auth(context);
  if (!session?.user?.id) {
    return { redirect: { destination: "/login", permanent: false } };
  }

  const clinics = await listFavoriteClinics({ userId: session.user.id });

  return {
    props: {
      clinics: clinics.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        city: c.city,
        address: c.address,
      })),
    },
  };
}) satisfies GetServerSideProps<{ clinics: FavoriteClinic[] }>;

export default function FavoritesPage({
  clinics,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <>
      <Head>
        <title>Favorites · Dentbook</title>
      </Head>
      <PagesNav />
      <main className="mx-auto w-full max-w-3xl p-8">
        <h1 className="mb-6 text-3xl font-bold">Favorites</h1>
        {clinics.length === 0 ? (
          <p className="text-gray-500">
            You haven&apos;t favorited any clinics yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {clinics.map((c) => (
              <Card
                key={c.id}
                href={`/clinics/${c.slug}`}
                title={c.name}
                subtitle={`${c.city} · ${c.address}`}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
