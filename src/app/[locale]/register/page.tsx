import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { registerClinic, RegisterError } from "@/lib/register-clinic";

export default async function RegisterPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("Register");
  const { error } = await searchParams;

  async function action(formData: FormData) {
    "use server";
    try {
      await registerClinic({
        ownerName: String(formData.get("ownerName") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        clinicName: String(formData.get("clinicName") ?? ""),
        city: String(formData.get("city") ?? ""),
        address: String(formData.get("address") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });
    } catch (e) {
      redirect(`/register?error=${e instanceof RegisterError ? e.code : "UNKNOWN"}`);
    }
    redirect("/login?registered=1");
  }

  const fields = [
    ["ownerName", "text"], ["email", "email"], ["password", "password"],
    ["clinicName", "text"], ["city", "text"], ["address", "text"], ["phone", "tel"],
  ] as const;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {error && <p className="text-sm text-red-600">{t(`errors.${error}` as never)}</p>}
      <form action={action} className="flex flex-col gap-3">
        {fields.map(([name, type]) => (
          <input key={name} name={name} type={type} required
                 placeholder={t(`fields.${name}` as never)}
                 className="rounded border p-2" />
        ))}
        <button className="rounded bg-sky-600 p-2 text-white">{t("submit")}</button>
      </form>
    </main>
  );
}
