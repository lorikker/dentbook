import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { AuthShell } from "@/components/AuthShell";
import { GoogleIcon, FacebookIcon } from "@/components/OAuthIcons";
import { anyOAuthEnabled, facebookEnabled, googleEnabled } from "@/lib/oauth-config";

const inputClass =
  "border border-ink-line bg-ink-surface px-3.5 py-3 text-cream outline-none focus:border-accent";
const labelClass = "text-xs font-semibold tracking-[0.08em] text-muted-2";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("Login");
  const tAuth = await getTranslations("Auth");
  const { error } = await searchParams;

  const clinicsCount = await withDbContext({ role: "public" }, (tx) =>
    tx.clinic.count({ where: { published: true } }));

  // Same predicate src/auth.ts uses to register the providers, so a button
  // can never appear for a provider that isn't wired up.
  const showGoogle = googleEnabled();
  const showFacebook = facebookEnabled();

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
    redirect("/dashboard");
  }

  async function googleAction() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  async function facebookAction() {
    "use server";
    await signIn("facebook", { redirectTo: "/" });
  }

  return (
    <AuthShell
      active="login"
      loginTab={tAuth("loginTab")}
      registerTab={tAuth("registerTab")}
      panelTitle={tAuth("panelTitle", { count: clinicsCount })}
      panelBody={tAuth("panelBody")}
    >
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("staffTitle")}</h1>
      {error && <p className="mt-3 text-sm text-coral">{t("error")}</p>}

      <form action={loginAction} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("email").toUpperCase()}</span>
          <input name="email" type="email" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("password").toUpperCase()}</span>
          <input name="password" type="password" required className={inputClass} />
        </label>
        <button type="submit" className="mt-1 bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
          {t("submit")}
        </button>
      </form>

      {anyOAuthEnabled() && (
        <>
          <div className="mt-7 flex items-center gap-3 text-xs font-semibold tracking-[0.08em] text-muted-2">
            <span className="h-px flex-1 bg-ink-line" />
            {tAuth("orContinueAsPatient").toUpperCase()}
            <span className="h-px flex-1 bg-ink-line" />
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            {showGoogle && (
              <form action={googleAction}>
                <button className="flex w-full items-center justify-center gap-3 border border-ink-line bg-ink-surface px-4 py-3 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                  <GoogleIcon className="h-4.5 w-4.5" />
                  {tAuth("continueWithGoogle")}
                </button>
              </form>
            )}
            {showFacebook && (
              <form action={facebookAction}>
                <button className="flex w-full items-center justify-center gap-3 border border-ink-line bg-ink-surface px-4 py-3 text-sm font-semibold text-cream transition-colors hover:border-ink-line-hover">
                  <FacebookIcon className="h-4.5 w-4.5" />
                  {tAuth("continueWithFacebook")}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </AuthShell>
  );
}
