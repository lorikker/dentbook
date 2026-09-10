import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { registerClinic, registerClinicForUser, RegisterError } from "@/lib/register-clinic";
import { resolveStaffMembership } from "@/lib/staff-context";
import { withDbContext } from "@/lib/tenant-db";
import { AuthShell } from "@/components/AuthShell";

const inputClass =
  "border border-ink-line bg-ink-surface px-3.5 py-3 text-cream outline-none focus:border-accent";
const labelClass = "text-xs font-semibold tracking-[0.08em] text-muted-2";

type Field = readonly [name: string, type: string, minLength?: number];
const ACCOUNT_FIELDS: readonly Field[] = [
  ["ownerName", "text", 2], ["email", "email"], ["password", "password", 8],
];
const CLINIC_FIELDS: readonly Field[] = [
  ["clinicName", "text", 2], ["city", "text", 2], ["address", "text", 2], ["phone", "tel", 8],
];

const field = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export default async function RegisterPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("Register");
  const tAuth = await getTranslations("Auth");
  const { error } = await searchParams;

  // Already signed in: the clinic goes on this account instead of a new one.
  // Someone who already runs a clinic has nothing to register (one clinic per
  // account for now), so they go straight to it.
  const session = await auth();
  const userId = session?.user?.id;
  if (userId && (await resolveStaffMembership(userId))) redirect("/dashboard");

  const clinicsCount = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.count({ where: { published: true } }));

  async function action(formData: FormData) {
    "use server";
    const email = field(formData, "email");
    const password = field(formData, "password");
    try {
      await registerClinic({
        ownerName: field(formData, "ownerName"),
        email,
        password,
        clinicName: field(formData, "clinicName"),
        city: field(formData, "city"),
        address: field(formData, "address"),
        phone: field(formData, "phone"),
      });
    } catch (e) {
      redirect(`/register?error=${e instanceof RegisterError ? e.code : "UNKNOWN"}`);
    }
    try {
      await signIn("staff-login", { email, password, redirect: false });
    } catch {
      // Registration succeeded even if the immediate sign-in didn't — fall
      // back to asking for the password they just chose, rather than losing
      // the new account.
      redirect("/login?registered=1");
    }
    redirect("/dashboard");
  }

  async function clinicOnlyAction(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/register");
    try {
      await registerClinicForUser(s.user.id, {
        clinicName: field(formData, "clinicName"),
        city: field(formData, "city"),
        address: field(formData, "address"),
        phone: field(formData, "phone"),
      });
    } catch (e) {
      if (e instanceof RegisterError && e.code === "ALREADY_HAS_CLINIC") redirect("/dashboard");
      redirect(`/register?error=${e instanceof RegisterError ? e.code : "UNKNOWN"}`);
    }
    redirect("/dashboard");
  }

  const fields = userId ? CLINIC_FIELDS : [...ACCOUNT_FIELDS, ...CLINIC_FIELDS];

  return (
    <AuthShell
      active="register"
      loginTab={tAuth("loginTab")}
      registerTab={tAuth("registerTab")}
      panelTitle={tAuth("panelTitle", { count: clinicsCount })}
      panelBody={tAuth("panelBody")}
    >
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      {error && (
        <p className="mt-3 text-sm text-coral">{t(`errors.${error}` as never)}</p>
      )}
      <form action={userId ? clinicOnlyAction : action} className="mt-6 flex flex-col gap-3">
        {fields.map(([name, type, minLength]) => (
          <label key={name} className="flex flex-col gap-1.5">
            <span className={labelClass}>{t(`fields.${name}` as never).toUpperCase()}</span>
            <input
              name={name} type={type} required minLength={minLength}
              className={inputClass}
            />
          </label>
        ))}
        <button className="mt-1 bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
          {t("submit")}
        </button>
      </form>
    </AuthShell>
  );
}
