import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Container } from "@/components/Container";
import { submitTestimonial, TestimonialError } from "@/lib/testimonials";

const team = [
  { name: "Arta Krasniqi", role: "Founder & Product" },
  { name: "Blerim Gashi", role: "Engineering" },
  { name: "Dea Morina", role: "Clinic Partnerships" },
];

const inputClass =
  "border border-ink-line bg-ink-surface px-3.5 py-3 text-cream outline-none placeholder:text-muted-2 focus:border-accent";

export default async function AboutPage({
  searchParams,
}: {
  searchParams: Promise<{ thanks?: string; error?: string }>;
}) {
  const t = await getTranslations("About");
  const flags = await searchParams;

  async function shareAction(formData: FormData) {
    "use server";
    try {
      await submitTestimonial({
        authorName: formData.get("name"),
        quote: formData.get("quote"),
        role: formData.get("role") || undefined,
      });
    } catch (e) {
      redirect(`/about?error=${e instanceof TestimonialError ? "invalid" : "failed"}#share`);
    }
    redirect("/about?thanks=1#share");
  }

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-4 max-w-xl text-lg text-muted">{t("intro")}</p>
        <h2 className="mt-10 text-[11.5px] font-bold tracking-[0.13em] text-muted-2">
          {t("teamTitle").toUpperCase()}
        </h2>
        <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
          {team.map((member) => (
            <div key={member.name} className="border border-ink-line bg-ink-surface p-4">
              <p className="font-semibold">{member.name}</p>
              <p className="mt-1 text-sm text-muted">{member.role}</p>
            </div>
          ))}
        </div>

        <h2 id="share" className="mt-14 scroll-mt-24 font-display text-2xl font-bold tracking-tight">
          {t("shareTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-muted">{t("shareIntro")}</p>
        <form action={shareAction} className="mt-6 flex max-w-md flex-col gap-3">
          <input name="name" required maxLength={80} placeholder={t("name")} className={inputClass} />
          <input name="role" maxLength={80} placeholder={t("role")} className={inputClass} />
          <textarea name="quote" required minLength={10} maxLength={500} rows={4}
                    placeholder={t("quote")} className={inputClass} />
          <button type="submit" className="bg-accent px-5 py-3.5 text-base font-bold text-ink transition-colors hover:bg-accent-hover">
            {t("submit")}
          </button>
          {flags.thanks && <p className="text-sm text-accent">{t("thanks")}</p>}
          {flags.error && (
            <p className="text-sm text-coral">{t(flags.error === "invalid" ? "invalid" : "failed")}</p>
          )}
        </form>
      </Container>
    </div>
  );
}
