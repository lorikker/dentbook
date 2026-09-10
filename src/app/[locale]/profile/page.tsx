import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { ProfileForm } from "@/components/ProfileForm";
import { Container } from "@/components/Container";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const t = await getTranslations("Profile");
  const user = await withDbContext(
    { role: "patient", userId: session.user.id },
    (tx) => tx.user.findUniqueOrThrow({ where: { id: session.user.id } }),
  );

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        <div className="mt-8">
          <ProfileForm
            initial={{
              name: user.name,
              email: user.email ?? "",
              locale: user.locale === "en" ? "en" : "sq",
            }}
          />
        </div>
      </Container>
    </div>
  );
}
