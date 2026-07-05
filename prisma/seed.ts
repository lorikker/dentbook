import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

// seeding bypasses RLS: superuser connection
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL! }),
});

async function main() {
  const pw = await bcrypt.hash("demo1234", 10);

  await db.user.upsert({
    where: { email: "admin@dentbook.dev" },
    update: {},
    create: { name: "Platform Admin", email: "admin@dentbook.dev",
              passwordHash: pw, isPlatformAdmin: true },
  });

  const clinics = [
    { slug: "klinika-arta", name: "Klinika Dentare Arta", city: "Prishtinë",
      address: "Rr. Nëna Terezë 12", phone: "+38344100100", published: true,
      owner: { name: "Arta Berisha", email: "arta@klinika-arta.dev" },
      dentists: [{ name: "Dr. Blerim Gashi", email: "blerim@klinika-arta.dev",
                   title: "Dr. med. dent." }] },
    { slug: "dental-prizren", name: "Dental Center Prizren", city: "Prizren",
      address: "Rr. Adem Jashari 5", phone: "+38344200200", published: true,
      owner: { name: "Fatos Krasniqi", email: "fatos@dental-prizren.dev" },
      dentists: [{ name: "Dr. Vjosa Hoti", email: "vjosa@dental-prizren.dev",
                   title: "Dr. med. dent." }] },
    { slug: "smile-peja", name: "Smile Clinic Peja", city: "Pejë",
      address: "Rr. Haxhi Zeka 3", phone: "+38344300300", published: false,
      owner: { name: "Erza Morina", email: "erza@smile-peja.dev" },
      dentists: [] },
  ];

  for (const c of clinics) {
    const existing = await db.clinic.findUnique({ where: { slug: c.slug } });
    if (existing) {
      console.log(`clinic ${c.slug} already seeded, skipping`);
      continue;
    }
    const clinic = await db.clinic.create({
      data: { slug: c.slug, name: c.name, city: c.city, address: c.address,
              phone: c.phone, published: c.published,
              approvedAt: c.published ? new Date() : null },
    });

    await db.subscription.create({
      data: { clinicId: clinic.id, plan: "TRIAL", status: "ACTIVE",
              trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });

    const owner = await db.user.upsert({
      where: { email: c.owner.email },
      update: {},
      create: { name: c.owner.name, email: c.owner.email, passwordHash: pw },
    });
    await db.membership.create({
      data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" },
    });

    const services = await Promise.all([
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Kontroll dhe konsultë",
                nameEn: "Check-up & consultation", durationMin: 30, priceEur: 20 } }),
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Pastrim dhëmbësh",
                nameEn: "Teeth cleaning", durationMin: 45, priceEur: 35 } }),
      db.service.create({
        data: { clinicId: clinic.id, nameSq: "Mbushje dhëmbi",
                nameEn: "Tooth filling", durationMin: 60, priceEur: 40,
                depositEur: 10 } }),
    ]);

    for (const d of c.dentists) {
      const du = await db.user.upsert({
        where: { email: d.email },
        update: {},
        create: { name: d.name, email: d.email, passwordHash: pw },
      });
      const m = await db.membership.create({
        data: { userId: du.id, clinicId: clinic.id, role: "DENTIST",
                title: d.title },
      });
      for (const s of services) {
        await db.dentistService.create({
          data: { membershipId: m.id, serviceId: s.id },
        });
      }
      // Mon–Fri 09:00–17:00
      for (const weekday of [1, 2, 3, 4, 5]) {
        await db.schedule.create({
          data: { membershipId: m.id, weekday, startMin: 9 * 60, endMin: 17 * 60 },
        });
      }
    }
    console.log(`seeded clinic ${c.slug}`);
  }

  console.log("Seed complete. Staff password for all demo users: demo1234");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
