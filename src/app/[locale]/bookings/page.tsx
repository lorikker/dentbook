import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, getFormatter } from "next-intl/server";
import { auth } from "@/auth";
import { withDbContext } from "@/lib/tenant-db";
import { Container } from "@/components/Container";

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const t = await getTranslations("Bookings");
  const tManage = await getTranslations("Manage");
  const format = await getFormatter();

  const appointments = await withDbContext(
    { role: "patient", userId: session.user.id },
    (tx) =>
      tx.appointment.findMany({
        where: { patientUserId: session.user.id },
        orderBy: { startsAt: "desc" },
        include: { clinic: true, service: true, payment: true },
      }),
  );

  return (
    <div className="bg-ink text-cream">
      <Container size="narrow" className="py-16">
        <h1 className="font-display text-4xl font-bold tracking-tight">{t("title")}</h1>
        {appointments.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="mt-8 space-y-4">
            {appointments.map((a) => {
              const serviceName = locale === "en" ? a.service.nameEn : a.service.nameSq;
              return (
                <Link
                  key={a.id}
                  href={`/manage/${a.manageToken}`}
                  className="block border border-ink-line bg-ink-surface p-5 transition-colors hover:border-ink-line-hover"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{a.clinic.name}</p>
                      <p className="text-sm text-muted">{serviceName}</p>
                      <p className="mt-2 font-display text-xl font-bold tracking-tight">
                        {format.dateTime(a.startsAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: a.clinic.timezone,
                        })}
                      </p>
                    </div>
                    <span className="border border-ink-line px-2.5 py-1 text-xs font-semibold tracking-[0.06em] text-muted">
                      {tManage(`status.${a.status}` as never)}
                    </span>
                  </div>
                  {a.payment && (
                    <p className="mt-3 text-sm text-muted">
                      {tManage("deposit", {
                        amount: format.number(Number(a.payment.amountEur), {
                          style: "currency",
                          currency: "EUR",
                        }),
                      })}
                      {" · "}
                      {tManage(`depositStatus.${a.payment.status}` as never)}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Container>
    </div>
  );
}
