import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("Login");
  const { error } = await searchParams;

  async function loginAction(formData: FormData) {
    "use server";
    try {
      await signIn("staff-login", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
    } catch {
      redirect("/login?error=1");
    }
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("staffTitle")}</h1>
      {error && <p className="text-sm text-red-600">{t("error")}</p>}
      <form action={loginAction} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder={t("email")}
               className="rounded border p-2" />
        <input name="password" type="password" required placeholder={t("password")}
               className="rounded border p-2" />
        <button type="submit" className="rounded bg-sky-600 p-2 text-white">
          {t("submit")}
        </button>
      </form>
    </main>
  );
}
