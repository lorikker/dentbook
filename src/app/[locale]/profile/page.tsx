import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { ProfileForm } from "@/components/ProfileForm";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const t = await getTranslations("Profile");
  const user = await withDbContext(
    { role: "auth", userId: session.user.id },
    (tx) => tx.user.findUniqueOrThrow({ where: { id: session.user.id } }),
  );

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <ProfileForm
        initial={{
          name: user.name,
          email: user.email ?? "",
          locale: user.locale === "en" ? "en" : "sq",
        }}
      />
    </div>
  );
}
