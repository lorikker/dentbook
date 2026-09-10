import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";
import mongoose from "mongoose";
import { wallTimeToUtc } from "../src/lib/slots";
import { Testimonial } from "../src/lib/models/testimonial";

// seeding bypasses RLS: superuser connection
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL! }),
});

/*
 * Safe to re-run against a database that already holds real data:
 *  - clinics are created only when their slug is missing; users are upserted
 *    by email or phone; favorites by (user, clinic);
 *  - past visits and their reviews are created once, keyed by a "seed:hist:"
 *    tag in Appointment.notes (a column the app never renders);
 *  - today's and upcoming appointments ("seed:live:") are deleted and rebuilt
 *    on every run, so the staff dashboards and pending requests stay current.
 * Rows without a seed tag are never modified or deleted.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_PASSWORD = "demo1234";
const HIST_TAG = "seed:hist:";
const LIVE_TAG = "seed:live:";

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const SERVICE_CATALOG = {
  checkup: { nameSq: "Kontroll dhe konsultë", nameEn: "Check-up & consultation", durationMin: 30 },
  cleaning: { nameSq: "Pastrim dhëmbësh", nameEn: "Teeth cleaning", durationMin: 45 },
  filling: { nameSq: "Mbushje dhëmbi", nameEn: "Tooth filling", durationMin: 60 },
  whitening: { nameSq: "Zbardhim dhëmbësh", nameEn: "Teeth whitening", durationMin: 60 },
  extraction: { nameSq: "Nxjerrje dhëmbi", nameEn: "Tooth extraction", durationMin: 45 },
  rootCanal: { nameSq: "Trajtim kanali", nameEn: "Root canal treatment", durationMin: 90 },
  crown: { nameSq: "Kurorë porcelani", nameEn: "Porcelain crown", durationMin: 90 },
  implantConsult: { nameSq: "Konsultë për implant", nameEn: "Implant consultation", durationMin: 30 },
  orthoConsult: { nameSq: "Konsultë ortodontike", nameEn: "Orthodontic consultation", durationMin: 30 },
  kidsCheckup: { nameSq: "Kontroll për fëmijë", nameEn: "Children's check-up", durationMin: 30 },
} as const;
type ServiceKey = keyof typeof SERVICE_CATALOG;

interface WeeklyHours { weekday: number; startMin: number; endMin: number }
interface ServiceSpec { key: ServiceKey; priceEur: number; depositEur?: number }
interface PersonSpec { name: string; email: string }
interface DentistSpec extends PersonSpec {
  title: string;
  bio?: string;
  /** Defaults to Mon–Fri 09:00–17:00. */
  hours?: WeeklyHours[];
  /** A specialist offers only these; everyone else offers every non-specialist service. */
  only?: ServiceKey[];
}
interface ReviewSpec { patient: string; rating: number; comment: string; hidden?: boolean }
interface ClinicSpec {
  slug: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  published: boolean;
  bookingMode?: "INSTANT" | "APPROVAL";
  plan?: "TRIAL" | "BASIC" | "PRO";
  /** Drives the "newest clinics" ordering on the home page. Defaults to 30. */
  joinedDaysAgo?: number;
  aboutSq?: string;
  aboutEn?: string;
  owner: PersonSpec;
  receptionists?: PersonSpec[];
  dentists: DentistSpec[];
  /** Defaults to the three standard services. */
  services?: ServiceSpec[];
  reviews?: ReviewSpec[];
  /** Appointments rebuilt on every run, relative to today. */
  live?: { today?: number; confirmed?: number; pending?: number };
}
interface PatientSpec {
  key: string;
  name: string;
  phone: string;
  locale?: "sq" | "en";
  favorites: string[];
}

/** Weekly hours on the given weekdays (0 = Sunday … 6 = Saturday). */
function weekdays(fromHour: number, toHour: number, days = [1, 2, 3, 4, 5]): WeeklyHours[] {
  return days.map((weekday) => ({ weekday, startMin: fromHour * 60, endMin: toHour * 60 }));
}

const STANDARD_SERVICES: ServiceSpec[] = [
  { key: "checkup", priceEur: 20 },
  { key: "cleaning", priceEur: 35 },
  { key: "filling", priceEur: 40, depositEur: 10 },
];

const CLINICS: ClinicSpec[] = [
  {
    slug: "klinika-arta", name: "Klinika Dentare Arta", city: "Prishtinë",
    address: "Rr. Nëna Terezë 12", phone: "+38344100100", published: true,
    owner: { name: "Arta Berisha", email: "arta@klinika-arta.dev" },
    dentists: [{ name: "Dr. Blerim Gashi", email: "blerim@klinika-arta.dev", title: "Dr. med. dent." }],
    reviews: [
      { patient: "arber", rating: 5, comment: "Dr. Blerimi shumë i kujdesshëm, pa dhimbje fare." },
      { patient: "mimoza", rating: 4, comment: "Shërbim i mirë, vetëm pak pritje në recepsion." },
      { patient: "fisnik", rating: 5, comment: "E rekomandoj! Pastrimi u bë shpejt dhe me profesionalizëm." },
      { patient: "vlora", rating: 5, comment: "Very friendly staff and a spotless clinic." },
    ],
    live: { today: 3, confirmed: 3 },
  },
  {
    slug: "dental-prizren", name: "Dental Center Prizren", city: "Prizren",
    address: "Rr. Adem Jashari 5", phone: "+38344200200", published: true,
    owner: { name: "Fatos Krasniqi", email: "fatos@dental-prizren.dev" },
    dentists: [{ name: "Dr. Vjosa Hoti", email: "vjosa@dental-prizren.dev", title: "Dr. med. dent." }],
    reviews: [
      { patient: "drita", rating: 4, comment: "Klinikë e pastër, çmime të arsyeshme." },
      { patient: "besnik", rating: 5, comment: "Dr. Vjosa i shpjegon gjërat me shumë durim." },
      { patient: "albulena", rating: 4, comment: "Termini u respektua në minutë." },
    ],
    live: { confirmed: 2 },
  },
  {
    slug: "smile-peja", name: "Smile Clinic Peja", city: "Pejë",
    address: "Rr. Haxhi Zeka 3", phone: "+38344300300", published: false,
    owner: { name: "Erza Morina", email: "erza@smile-peja.dev" },
    dentists: [],
  },
  {
    slug: "dentistpro-prishtina", name: "DentistPro Prishtina", city: "Prishtinë",
    address: "Bulevardi Bill Klinton 45", phone: "+38344110110", published: true,
    plan: "PRO", joinedDaysAgo: 2,
    aboutSq: "Klinikë moderne me specialistë për implante, ortodonci dhe estetikë dentare. Skaner 3D dhe radiografi digjitale në vend.",
    aboutEn: "A modern clinic with specialists in implants, orthodontics and cosmetic dentistry. 3D scanning and digital X-ray on site.",
    owner: { name: "Genc Maloku", email: "genc@dentistpro.dev" },
    receptionists: [{ name: "Blerta Salihu", email: "blerta@dentistpro.dev" }],
    dentists: [
      { name: "Dr. Arian Musliu", email: "arian@dentistpro.dev", title: "Dr. med. dent.",
        bio: "Stomatologji e përgjithshme dhe estetike, 12 vjet përvojë.", hours: weekdays(8, 16) },
      { name: "Dr. Njomza Ibrahimi", email: "njomza@dentistpro.dev", title: "Ortodonte",
        bio: "Aparate fikse dhe të padukshme për të rinj e të rritur.",
        hours: weekdays(10, 18, [1, 3, 5]), only: ["orthoConsult"] },
      { name: "Dr. Kushtrim Latifi", email: "kushtrim@dentistpro.dev", title: "Kirurg oral",
        bio: "Implante dhe nxjerrje komplekse.",
        hours: weekdays(9, 15, [2, 4]), only: ["implantConsult", "extraction"] },
    ],
    services: [
      { key: "checkup", priceEur: 35 },
      { key: "cleaning", priceEur: 50 },
      { key: "whitening", priceEur: 150, depositEur: 30 },
      { key: "crown", priceEur: 280, depositEur: 80 },
      { key: "orthoConsult", priceEur: 40 },
      { key: "implantConsult", priceEur: 50 },
      { key: "extraction", priceEur: 60 },
    ],
    reviews: [
      { patient: "liridon", rating: 5, comment: "Implanti u vendos pa asnjë problem. Ekip shumë profesional." },
      { patient: "teuta", rating: 5, comment: "Best orthodontic consultation I've had: a clear plan and clear pricing." },
      { patient: "ilir", rating: 5, comment: "Modern equipment, and they explained every step before doing it." },
      { patient: "egzon", rating: 5, comment: "Zbardhimi doli perfekt, e rekomandoj." },
      { patient: "rina", rating: 4, comment: "Pak e shtrenjtë, por ia vlen." },
      // Moderated away: shows that HIDDEN reviews stay out of listings and averages.
      { patient: "arber", rating: 1, comment: "SPAM spam spam www.example.com", hidden: true },
    ],
    live: { today: 3, confirmed: 4 },
  },
  {
    slug: "bardhi-dental", name: "Bardhi Dental Studio", city: "Prishtinë",
    address: "Rr. Garibaldi 8", phone: "+38344120120", published: true,
    bookingMode: "APPROVAL", plan: "BASIC", joinedDaysAgo: 5,
    aboutSq: "Studio e vogël familjare në qendër të qytetit. Çmime miqësore për studentë dhe familje.",
    aboutEn: "A small family studio in the city centre, with friendly prices for students and families.",
    owner: { name: "Luljeta Bardhi", email: "luljeta@bardhi-dental.dev" },
    dentists: [
      { name: "Dr. Agron Bardhi", email: "agron@bardhi-dental.dev", title: "Dr. med. dent.",
        bio: "Mbushje estetike dhe trajtime kanali." },
    ],
    services: [
      { key: "checkup", priceEur: 15 },
      { key: "cleaning", priceEur: 25 },
      { key: "filling", priceEur: 30, depositEur: 10 },
      { key: "rootCanal", priceEur: 90, depositEur: 20 },
    ],
    reviews: [
      { patient: "mimoza", rating: 4, comment: "Çmime shumë të mira për studentë." },
      { patient: "fisnik", rating: 5, comment: "Dr. Bardhi është shumë i sjellshëm dhe i durueshëm." },
      { patient: "vlora", rating: 4, comment: "It took a day to confirm my request, but the visit itself was great." },
    ],
    live: { pending: 3, confirmed: 1 },
  },
  {
    slug: "gjakova-smile", name: "Gjakova Smile", city: "Gjakovë",
    address: "Rr. Ismail Qemali 21", phone: "+38344130130", published: true, joinedDaysAgo: 8,
    aboutSq: "Hapur edhe të shtunën në mëngjes. Kujdes i plotë dentar për gjithë familjen.",
    aboutEn: "Also open on Saturday mornings. Complete dental care for the whole family.",
    owner: { name: "Shpresa Hajdari", email: "shpresa@gjakova-smile.dev" },
    dentists: [
      { name: "Dr. Mentor Kelmendi", email: "mentor@gjakova-smile.dev", title: "Dr. med. dent.",
        hours: [...weekdays(9, 17), ...weekdays(9, 13, [6])] },
      { name: "Dr. Elona Dauti", email: "elona@gjakova-smile.dev", title: "Dr. med. dent.",
        bio: "Estetikë dentare dhe zbardhim.", hours: weekdays(12, 20) },
    ],
    services: [
      { key: "checkup", priceEur: 28 },
      { key: "cleaning", priceEur: 35 },
      { key: "filling", priceEur: 40, depositEur: 10 },
      { key: "whitening", priceEur: 120 },
    ],
    reviews: [
      { patient: "drita", rating: 5, comment: "Punojnë edhe të shtunën, shumë praktike." },
      { patient: "besnik", rating: 4, comment: "Mbushja u bë mirë, pa dhimbje." },
      { patient: "albulena", rating: 5, comment: "Stafi shumë i ngrohtë dhe mikpritës." },
      { patient: "egzon", rating: 4, comment: "Pritje e shkurtër, shërbim i shpejtë." },
    ],
    live: { confirmed: 2 },
  },
  {
    slug: "dental-care-ferizaj", name: "Dental Care Ferizaj", city: "Ferizaj",
    address: "Rr. Dëshmorët e Kombit 14", phone: "+38344140140", published: true,
    plan: "BASIC", joinedDaysAgo: 12,
    aboutSq: "Specializuar në stomatologji pediatrike: vizita të qeta dhe pa frikë për fëmijët.",
    aboutEn: "Specialised in paediatric dentistry: calm, fear-free visits for children.",
    owner: { name: "Arben Sadiku", email: "arben@dentalcare-ferizaj.dev" },
    dentists: [
      { name: "Dr. Leonora Mustafa", email: "leonora@dentalcare-ferizaj.dev", title: "Dentiste pediatrike",
        bio: "Punon me fëmijë që nga mosha 2 vjeç.", only: ["kidsCheckup"] },
      { name: "Dr. Valon Sylejmani", email: "valon@dentalcare-ferizaj.dev", title: "Dr. med. dent.",
        hours: weekdays(8, 14) },
    ],
    services: [
      { key: "kidsCheckup", priceEur: 18 },
      { key: "checkup", priceEur: 20 },
      { key: "cleaning", priceEur: 30 },
      { key: "filling", priceEur: 35, depositEur: 10 },
    ],
    reviews: [
      { patient: "liridon", rating: 4, comment: "Djali im nuk pati frikë fare. Faleminderit Dr. Leonora!" },
      { patient: "teuta", rating: 4, comment: "Wonderful with kids." },
      { patient: "ilir", rating: 3, comment: "Good care, but parking nearby is a nightmare." },
      { patient: "rina", rating: 5, comment: "Shumë të kujdesshëm me fëmijët." },
    ],
    live: { confirmed: 2 },
  },
  {
    slug: "dentalux-gjilan", name: "Dentalux Gjilan", city: "Gjilan",
    address: "Rr. Adem Jashari 30", phone: "+38344150150", published: true,
    bookingMode: "APPROVAL", plan: "PRO", joinedDaysAgo: 3,
    aboutSq: "Protetikë dhe estetikë premium: kurora porcelani, faseta dhe rikthim i plotë i buzëqeshjes.",
    aboutEn: "Premium prosthetics and aesthetics: porcelain crowns, veneers and full smile makeovers.",
    owner: { name: "Dardan Aliu", email: "dardan@dentalux.dev" },
    dentists: [
      { name: "Dr. Merita Osmani", email: "merita@dentalux.dev", title: "Protetiste",
        bio: "15 vjet përvojë në protetikë dhe estetikë.", hours: weekdays(10, 18) },
    ],
    services: [
      { key: "checkup", priceEur: 45 },
      { key: "implantConsult", priceEur: 60 },
      { key: "whitening", priceEur: 180, depositEur: 50 },
      { key: "crown", priceEur: 320, depositEur: 100 },
    ],
    reviews: [
      { patient: "arber", rating: 5, comment: "Kurora e porcelanit duket krejtësisht natyrale." },
      { patient: "fisnik", rating: 5, comment: "Klinikë luksoze, shërbim i nivelit të lartë." },
      { patient: "vlora", rating: 4, comment: "Pricey, but top-quality work." },
    ],
    live: { pending: 2, confirmed: 1 },
  },
  {
    slug: "mitrovica-dent", name: "Mitrovica Dent", city: "Mitrovicë",
    address: "Rr. Mbretëresha Teutë 7", phone: "+38344160160", published: true, joinedDaysAgo: 20,
    aboutSq: "Kujdes dentar i përballueshëm në zemër të Mitrovicës.",
    aboutEn: "Affordable dental care in the heart of Mitrovica.",
    owner: { name: "Burim Zymberi", email: "burim@mitrovica-dent.dev" },
    dentists: [
      { name: "Dr. Driton Maliqi", email: "driton@mitrovica-dent.dev", title: "Dr. med. dent.",
        hours: weekdays(8, 16) },
    ],
    services: [
      { key: "checkup", priceEur: 15 },
      { key: "cleaning", priceEur: 25 },
      { key: "extraction", priceEur: 30 },
      { key: "filling", priceEur: 30 },
    ],
    reviews: [
      { patient: "mimoza", rating: 4, comment: "Çmime të lira dhe punë e mirë." },
      { patient: "albulena", rating: 3, comment: "U desh të prisja 30 minuta përtej orarit." },
      { patient: "rina", rating: 4, comment: "Dr. Dritoni ishte i shpejtë dhe i saktë." },
    ],
    live: { confirmed: 1 },
  },
  {
    slug: "dental-art-peja", name: "Dental Art Pejë", city: "Pejë",
    address: "Rr. William Walker 4", phone: "+38344170170", published: true,
    plan: "BASIC", joinedDaysAgo: 1,
    aboutSq: "Ekip i ri, pajisje të reja dhe rezervime online pa telefonata.",
    aboutEn: "A young team, new equipment and online booking without phone calls.",
    owner: { name: "Kaltrina Lleshi", email: "kaltrina@dentalart-peja.dev" },
    dentists: [
      { name: "Dr. Visar Gjonbalaj", email: "visar@dentalart-peja.dev", title: "Dr. med. dent." },
      { name: "Dr. Arta Rexhaj", email: "artar@dentalart-peja.dev", title: "Endodonte",
        bio: "Trajtime kanali me mikroskop.", only: ["rootCanal"] },
    ],
    services: [
      { key: "checkup", priceEur: 20 },
      { key: "cleaning", priceEur: 30 },
      { key: "whitening", priceEur: 110 },
      { key: "rootCanal", priceEur: 100, depositEur: 30 },
    ],
    reviews: [
      { patient: "drita", rating: 5, comment: "Shërbim i shkëlqyer, do të kthehem sërish." },
      { patient: "besnik", rating: 4, comment: "Pastrim i mirë me çmim korrekt." },
      { patient: "ilir", rating: 4, comment: "Easy to book online, no phone calls needed." },
    ],
    live: { confirmed: 2 },
  },
  {
    // Unpublished: shows up in the platform admin's approval queue.
    slug: "vushtrri-dental", name: "Vushtrri Dental", city: "Vushtrri",
    address: "Rr. Skënderbeu 16", phone: "+38344180180", published: false, joinedDaysAgo: 0,
    aboutSq: "Klinikë e re familjare në Vushtrri.",
    aboutEn: "A new family clinic in Vushtrri.",
    owner: { name: "Fitore Beqiri", email: "fitore@vushtrri-dental.dev" },
    dentists: [{ name: "Dr. Albin Hamiti", email: "albin@vushtrri-dental.dev", title: "Dr. med. dent." }],
  },
];

const PATIENTS: PatientSpec[] = [
  { key: "arber", name: "Arbër Krasniqi", phone: "+38344600101",
    favorites: ["klinika-arta", "dentistpro-prishtina", "dentalux-gjilan"] },
  { key: "drita", name: "Drita Gashi", phone: "+38344600102",
    favorites: ["dental-prizren", "gjakova-smile"] },
  { key: "liridon", name: "Liridon Berisha", phone: "+38344600103",
    favorites: ["dentistpro-prishtina", "dental-care-ferizaj"] },
  { key: "mimoza", name: "Mimoza Hoxha", phone: "+38344600104",
    favorites: ["bardhi-dental", "mitrovica-dent", "klinika-arta"] },
  { key: "besnik", name: "Besnik Morina", phone: "+38344600105",
    favorites: ["dental-prizren", "dental-art-peja"] },
  { key: "teuta", name: "Teuta Shala", phone: "+38344600106", locale: "en",
    favorites: ["dentistpro-prishtina"] },
  { key: "fisnik", name: "Fisnik Rexhepi", phone: "+38344600107",
    favorites: ["klinika-arta", "bardhi-dental", "dentalux-gjilan"] },
  { key: "albulena", name: "Albulena Kryeziu", phone: "+38344600108",
    favorites: ["gjakova-smile", "mitrovica-dent"] },
  { key: "ilir", name: "Ilir Bytyçi", phone: "+38344600109", locale: "en",
    favorites: ["dentistpro-prishtina", "dental-art-peja", "dental-care-ferizaj"] },
  { key: "vlora", name: "Vlora Aliu", phone: "+38344600110",
    favorites: ["klinika-arta", "dentalux-gjilan"] },
  { key: "egzon", name: "Egzon Hasani", phone: "+38344600111",
    favorites: ["gjakova-smile", "dentistpro-prishtina"] },
  { key: "rina", name: "Rina Zeqiri", phone: "+38344600112",
    favorites: ["dental-care-ferizaj", "mitrovica-dent"] },
];

const DEMO_TESTIMONIALS = [
  {
    authorName: "Vlora Aliu",
    role: "paciente në Prishtinë",
    quote: "Rezervimi u bë në pak minuta dhe kujtesa me SMS më kurseu nga një gjobë vonese. Shumë praktike!",
  },
  {
    authorName: "Ilir Bytyçi",
    role: "patient in Peja",
    quote: "Booking online meant I didn't have to call around clinics comparing prices. Found a good dentist in one afternoon.",
  },
  {
    authorName: "Dr. Blerim Gashi",
    role: "dentist, Klinika Dentare Arta",
    quote: "Paneli i stafit na kurseu orë të tëra çdo javë — orari, kërkesat dhe pacientët gjithçka në një vend.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Rng = () => number;

/** Small deterministic PRNG, so every run lays the data out the same way. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function localDateISO(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isDoubleBooking(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    const msg = (cur as { message?: unknown }).message;
    if (typeof msg === "string" && msg.includes("no_double_booking")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Per-dentist occupied intervals (epoch ms), seeded from the database so new
// appointments never collide with real ones or with each other.
const busy = new Map<string, { start: number; end: number }[]>();

function isFree(membershipId: string, start: number, end: number): boolean {
  return !(busy.get(membershipId) ?? []).some((b) => start < b.end && b.start < end);
}

function reserve(membershipId: string, start: number, end: number) {
  busy.set(membershipId, [...(busy.get(membershipId) ?? []), { start, end }]);
}

interface SeedDentist {
  id: string;
  hours: WeeklyHours[];
  services: { id: string; durationMin: number }[];
}
interface SeedClinic { id: string; timezone: string; dentists: SeedDentist[] }

/**
 * Picks a free slot for `dentist` on one of `dayOffsets` (days from today in
 * the clinic's timezone), inside the dentist's working hours on a 30-minute
 * grid. With `fallbackHours`, a day the dentist doesn't normally work falls
 * back to 09:00–17:00 — used for "today" so the dashboards always have data.
 */
function findSlot(
  rng: Rng,
  dentist: SeedDentist,
  durationMin: number,
  timeZone: string,
  dayOffsets: number[],
  opts: { fallbackHours?: boolean } = {},
): { startsAt: Date; endsAt: Date } | null {
  const today = localDateISO(new Date(), timeZone);
  for (const offset of shuffle(rng, dayOffsets)) {
    const dateISO = addDaysISO(today, offset);
    const weekday = weekdayOf(dateISO);
    let windows = dentist.hours.filter((h) => h.weekday === weekday);
    if (!windows.length && opts.fallbackHours) windows = weekdays(9, 17, [weekday]);
    const starts: number[] = [];
    for (const w of windows) {
      for (let t = w.startMin; t + durationMin <= w.endMin; t += 30) starts.push(t);
    }
    for (const t of shuffle(rng, starts)) {
      const startsAt = wallTimeToUtc(dateISO, t, timeZone);
      const endsAt = new Date(startsAt.getTime() + durationMin * 60 * 1000);
      if (isFree(dentist.id, startsAt.getTime(), endsAt.getTime())) {
        reserve(dentist.id, startsAt.getTime(), endsAt.getTime());
        return { startsAt, endsAt };
      }
    }
  }
  return null;
}

/** Fails fast on typos in the specs above, before anything is written. */
function validateSpecs() {
  const slugs = new Set(CLINICS.map((c) => c.slug));
  const patientKeys = new Set(PATIENTS.map((p) => p.key));
  for (const p of PATIENTS) {
    for (const slug of p.favorites) {
      if (!slugs.has(slug)) throw new Error(`patient "${p.key}" favorites unknown clinic "${slug}"`);
    }
  }
  for (const c of CLINICS) {
    for (const r of c.reviews ?? []) {
      if (!patientKeys.has(r.patient)) throw new Error(`${c.slug}: review by unknown patient "${r.patient}"`);
      if (r.rating < 1 || r.rating > 5) throw new Error(`${c.slug}: rating ${r.rating} is out of range`);
    }
    const listed = new Set((c.services ?? STANDARD_SERVICES).map((s) => s.key));
    for (const d of c.dentists) {
      for (const key of d.only ?? []) {
        if (!listed.has(key)) throw new Error(`${c.slug}: ${d.name} specialises in "${key}", which the clinic doesn't offer`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function createClinic(spec: ClinicSpec, passwordHash: string) {
  const joined = new Date(Date.now() - (spec.joinedDaysAgo ?? 30) * DAY_MS);
  const clinic = await db.clinic.create({
    data: {
      slug: spec.slug, name: spec.name, city: spec.city, address: spec.address, phone: spec.phone,
      aboutSq: spec.aboutSq ?? "", aboutEn: spec.aboutEn ?? "",
      bookingMode: spec.bookingMode ?? "INSTANT",
      published: spec.published,
      approvedAt: spec.published ? joined : null,
      createdAt: joined,
    },
  });

  const plan = spec.plan ?? "TRIAL";
  const periodEnd = new Date(Date.now() + 30 * DAY_MS);
  await db.subscription.create({
    data: {
      clinicId: clinic.id, plan, status: "ACTIVE",
      trialEndsAt: plan === "TRIAL" ? periodEnd : null,
      currentPeriodEnd: plan === "TRIAL" ? null : periodEnd,
    },
  });

  const staffUser = (person: PersonSpec) => db.user.upsert({
    where: { email: person.email },
    update: {},
    create: { name: person.name, email: person.email, passwordHash },
  });

  const owner = await staffUser(spec.owner);
  await db.membership.create({ data: { userId: owner.id, clinicId: clinic.id, role: "OWNER" } });
  for (const r of spec.receptionists ?? []) {
    const user = await staffUser(r);
    await db.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: "RECEPTIONIST" } });
  }

  const serviceIds = new Map<ServiceKey, string>();
  for (const s of spec.services ?? STANDARD_SERVICES) {
    const { nameSq, nameEn, durationMin } = SERVICE_CATALOG[s.key];
    const row = await db.service.create({
      data: { clinicId: clinic.id, nameSq, nameEn, durationMin, priceEur: s.priceEur, depositEur: s.depositEur },
    });
    serviceIds.set(s.key, row.id);
  }

  // Specialist services go only to the dentists who list them in `only`;
  // every other service goes to each dentist who isn't a specialist.
  const specialist = new Set(spec.dentists.flatMap((d) => d.only ?? []));
  for (const d of spec.dentists) {
    const user = await staffUser(d);
    const m = await db.membership.create({
      data: { userId: user.id, clinicId: clinic.id, role: "DENTIST", title: d.title, bio: d.bio },
    });
    const offers = d.only ?? [...serviceIds.keys()].filter((key) => !specialist.has(key));
    for (const key of offers) {
      await db.dentistService.create({ data: { membershipId: m.id, serviceId: serviceIds.get(key)! } });
    }
    for (const h of d.hours ?? weekdays(9, 17)) {
      await db.schedule.create({ data: { membershipId: m.id, ...h } });
    }
  }
}

async function upsertPatients(): Promise<Map<string, { id: string }>> {
  const rows = new Map<string, { id: string }>();
  for (const p of PATIENTS) {
    const user = await db.user.upsert({
      where: { phone: p.phone },
      update: {},
      create: { name: p.name, phone: p.phone, locale: p.locale ?? "sq" },
    });
    rows.set(p.key, user);
  }
  return rows;
}

/** Published seed clinics, with each dentist's hours and the services they offer. */
async function loadClinics(): Promise<Map<string, SeedClinic>> {
  const rows = await db.clinic.findMany({
    where: { slug: { in: CLINICS.map((c) => c.slug) }, published: true },
    include: {
      services: { where: { active: true }, include: { dentists: true } },
      memberships: { where: { role: "DENTIST" }, include: { schedules: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return new Map(rows.map((c): [string, SeedClinic] => [c.slug, {
    id: c.id,
    timezone: c.timezone,
    dentists: c.memberships
      .map((m) => ({
        id: m.id,
        hours: m.schedules.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })),
        // Same rule as availability: a service with no dentist links is offered by all.
        services: c.services
          .filter((s) => s.dentists.length === 0 || s.dentists.some((l) => l.membershipId === m.id))
          .map((s) => ({ id: s.id, durationMin: s.durationMin })),
      }))
      .filter((d) => d.services.length > 0),
  }]));
}

async function loadBusyIntervals(clinics: Map<string, SeedClinic>) {
  const ids = [...clinics.values()].flatMap((c) => c.dentists.map((d) => d.id));
  const rows = await db.appointment.findMany({
    where: {
      membershipId: { in: ids },
      status: { notIn: ["CANCELLED", "DECLINED"] },
      endsAt: { gt: new Date(Date.now() - 200 * DAY_MS) },
    },
    select: { membershipId: true, startsAt: true, endsAt: true },
  });
  for (const r of rows) reserve(r.membershipId, r.startsAt.getTime(), r.endsAt.getTime());
}

/** Completed past visits, each with the review written afterwards. Created once. */
async function seedHistory(clinics: Map<string, SeedClinic>, patients: Map<string, { id: string }>) {
  const rng = mulberry32(7);
  let created = 0;
  for (const spec of CLINICS) {
    const clinic = clinics.get(spec.slug);
    if (!clinic?.dentists.length) continue;
    for (const review of spec.reviews ?? []) {
      const tag = `${HIST_TAG}${spec.slug}:${review.patient}`;
      if (await db.appointment.findFirst({ where: { notes: tag }, select: { id: true } })) continue;

      const dentist = pick(rng, clinic.dentists);
      const service = pick(rng, dentist.services);
      const slot = findSlot(rng, dentist, service.durationMin, clinic.timezone, range(-120, -7));
      if (!slot) {
        console.warn(`no free past slot for ${tag}, skipping`);
        continue;
      }
      const patientUserId = patients.get(review.patient)!.id;
      await db.$transaction(async (tx) => {
        const appt = await tx.appointment.create({
          data: {
            clinicId: clinic.id, membershipId: dentist.id, patientUserId, serviceId: service.id,
            startsAt: slot.startsAt, endsAt: slot.endsAt, status: "COMPLETED", notes: tag,
            createdAt: new Date(slot.startsAt.getTime() - 3 * DAY_MS),
          },
        });
        await tx.review.create({
          data: {
            clinicId: clinic.id, patientUserId, appointmentId: appt.id,
            rating: review.rating, comment: review.comment,
            status: review.hidden ? "HIDDEN" : "PUBLISHED",
            createdAt: new Date(Math.min(slot.endsAt.getTime() + DAY_MS, Date.now())),
          },
        });
      });
      created++;
    }
  }
  return created;
}

type LiveKind = "today" | "confirmed" | "pending";

/** Today's and upcoming appointments. Rebuilt on every run. */
async function seedLive(clinics: Map<string, SeedClinic>, patients: Map<string, { id: string }>) {
  const rng = mulberry32(11);
  const patientIds = [...patients.values()].map((p) => p.id);
  let created = 0;
  for (const spec of CLINICS) {
    const clinic = clinics.get(spec.slug);
    if (!clinic?.dentists.length || !spec.live) continue;
    const plan: LiveKind[] = [
      ...Array<LiveKind>(spec.live.today ?? 0).fill("today"),
      ...Array<LiveKind>(spec.live.confirmed ?? 0).fill("confirmed"),
      ...Array<LiveKind>(spec.live.pending ?? 0).fill("pending"),
    ];
    for (const [i, kind] of plan.entries()) {
      const dentist = pick(rng, clinic.dentists);
      const service = pick(rng, dentist.services);
      const slot = kind === "today"
        ? findSlot(rng, dentist, service.durationMin, clinic.timezone, [0], { fallbackHours: true })
        : findSlot(rng, dentist, service.durationMin, clinic.timezone, range(1, 14));
      if (!slot) {
        console.warn(`no free ${kind} slot at ${spec.slug}, skipping`);
        continue;
      }
      // Pending requests must lie in the future: expireStalePending declines
      // any whose start has passed the moment staff open the requests page.
      const status = kind === "pending" ? "PENDING"
        : slot.startsAt.getTime() <= Date.now() ? "COMPLETED" : "CONFIRMED";
      try {
        await db.appointment.create({
          data: {
            clinicId: clinic.id, membershipId: dentist.id, patientUserId: pick(rng, patientIds),
            serviceId: service.id, startsAt: slot.startsAt, endsAt: slot.endsAt, status,
            notes: `${LIVE_TAG}${spec.slug}:${i}`,
          },
        });
        created++;
      } catch (e) {
        if (!isDoubleBooking(e)) throw e;
        console.warn(`slot clash at ${spec.slug} (${kind}), skipping`);
      }
    }
  }
  return created;
}

async function seedFavorites(patients: Map<string, { id: string }>) {
  const rows = await db.clinic.findMany({
    where: { slug: { in: CLINICS.map((c) => c.slug) } },
    select: { id: true, slug: true },
  });
  const clinicIds = new Map(rows.map((c): [string, string] => [c.slug, c.id]));
  let total = 0;
  for (const p of PATIENTS) {
    const userId = patients.get(p.key)!.id;
    for (const slug of p.favorites) {
      const clinicId = clinicIds.get(slug);
      if (!clinicId) continue;
      await db.favorite.upsert({
        where: { userId_clinicId: { userId, clinicId } },
        update: {},
        create: { userId, clinicId },
      });
      total++;
    }
  }
  return total;
}

/**
 * Published testimonials in Mongo, only when MONGODB_URI is configured and
 * the collection is still empty — this is a one-time seed, not an upsert,
 * since testimonials have no natural key to upsert on.
 */
async function seedTestimonials(): Promise<number> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("MONGODB_URI not set, skipping testimonials seed");
    return 0;
  }
  await mongoose.connect(uri);
  try {
    if (await Testimonial.countDocuments()) {
      console.log("testimonials already seeded, skipping");
      return 0;
    }
    await Testimonial.insertMany(
      DEMO_TESTIMONIALS.map((t) => ({ ...t, published: true })),
    );
    return DEMO_TESTIMONIALS.length;
  } finally {
    await mongoose.disconnect();
  }
}

function printSummary(stats: {
  history: number; live: number; replacedLive: number; favorites: number; testimonials: number;
}) {
  console.log("");
  console.log(`past visits with reviews created:  ${stats.history}`);
  console.log(`today/upcoming appointments:       ${stats.live} (replaced ${stats.replacedLive} from the last run)`);
  console.log(`demo patient favorites:            ${stats.favorites}`);
  console.log(`published testimonials seeded:     ${stats.testimonials}`);
  console.log("");
  console.log(`Staff logins (password for all: ${DEMO_PASSWORD})`);
  console.log(`  ${"admin@dentbook.dev".padEnd(32)} platform admin`);
  for (const c of CLINICS) {
    const note = !c.published ? " (awaiting approval)"
      : c.live?.pending ? " (approval mode, has pending requests)" : "";
    console.log(`  ${c.owner.email.padEnd(32)} owner, ${c.name}${note}`);
  }
  console.log("");
  console.log(`Demo patients: ${PATIENTS[0].phone} to ${PATIENTS[PATIENTS.length - 1].phone}. They sign in`);
  console.log("with a phone OTP at the booking step; with SMS_PROVIDER=console the code is");
  console.log("printed in the dev-server log.");
}

async function main() {
  validateSpecs();
  const pw = await bcrypt.hash(DEMO_PASSWORD, 10);

  await db.user.upsert({
    where: { email: "admin@dentbook.dev" },
    update: {},
    create: { name: "Platform Admin", email: "admin@dentbook.dev",
              passwordHash: pw, isPlatformAdmin: true },
  });

  for (const spec of CLINICS) {
    if (await db.clinic.findUnique({ where: { slug: spec.slug } })) {
      console.log(`clinic ${spec.slug} already seeded, skipping`);
      continue;
    }
    await createClinic(spec, pw);
    console.log(`seeded clinic ${spec.slug}`);
  }

  const patients = await upsertPatients();

  // Live rows go first so the busy map below reflects what's actually left.
  // A live row that has since picked up a review or payment is kept.
  const replaced = await db.appointment.deleteMany({
    where: { notes: { startsWith: LIVE_TAG }, review: { is: null }, payment: { is: null } },
  });

  const clinics = await loadClinics();
  await loadBusyIntervals(clinics);

  const history = await seedHistory(clinics, patients);
  const live = await seedLive(clinics, patients);
  const favorites = await seedFavorites(patients);
  const testimonials = await seedTestimonials();

  printSummary({ history, live, replacedLive: replaced.count, favorites, testimonials });
  console.log("\nSeed complete.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
