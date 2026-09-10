import { getTranslations } from "next-intl/server";
import { listPublishedTestimonials } from "@/lib/testimonials";
import { Container } from "@/components/Container";
import { SectionKicker } from "@/components/SectionKicker";

/**
 * Public testimonials pulled from Mongo. Mongo is a secondary datastore for
 * this app, so a hiccup here must never take the home page down with it —
 * any failure is logged and swallowed, and the section renders nothing.
 */
export async function HomeTestimonials() {
  const testimonials = await listPublishedTestimonials(3).catch((e) => {
    console.error("listPublishedTestimonials failed", e);
    return [];
  });
  if (testimonials.length === 0) return null;

  const t = await getTranslations("Home.testimonials");

  return (
    <div className="border-t border-ink-line">
      <Container className="py-20">
        <SectionKicker>{t("kicker")}</SectionKicker>
        <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          {t("title")}
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <div key={item.id} className="border border-ink-line bg-ink-surface p-5">
              <p className="text-accent" aria-hidden="true">“</p>
              <p className="text-muted">{item.quote}</p>
              <p className="mt-4 text-sm font-semibold text-cream">{item.authorName}</p>
              {item.role && <p className="text-sm text-muted-2">{item.role}</p>}
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}
