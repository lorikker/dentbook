import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { hashPassword } from "./staff-auth";
import { logActivity } from "./models/activity-log";

export class RegisterError extends Error {
  constructor(public code:
    | "NAME_TOO_SHORT" | "INVALID_EMAIL" | "PASSWORD_TOO_SHORT"
    | "CLINIC_NAME_TOO_SHORT" | "CITY_TOO_SHORT" | "ADDRESS_TOO_SHORT"
    | "PHONE_TOO_SHORT" | "EMAIL_TAKEN" | "INVALID_INPUT") { super(code); }
}

const schema = z.object({
  ownerName: z.string().min(2),
  email: z.email(),
  password: z.string().min(8),
  clinicName: z.string().min(2),
  city: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().min(8),
});
export type RegisterInput = z.infer<typeof schema>;

/** Each field carries exactly one rule above, so its path maps to one code. */
const FIELD_ERROR_CODE: Record<string, RegisterError["code"]> = {
  ownerName: "NAME_TOO_SHORT",
  email: "INVALID_EMAIL",
  password: "PASSWORD_TOO_SHORT",
  clinicName: "CLINIC_NAME_TOO_SHORT",
  city: "CITY_TOO_SHORT",
  address: "ADDRESS_TOO_SHORT",
  phone: "PHONE_TOO_SHORT",
};

export function slugify(name: string): string {
  return name.toLowerCase()
    .replaceAll("ë", "e").replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function registerClinic(input: RegisterInput) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    throw new RegisterError(FIELD_ERROR_CODE[field] ?? "INVALID_INPUT");
  }
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);

  const result = await withDbContext({ role: "auth" }, async (tx) => {
    if (await tx.user.findUnique({ where: { email: d.email } })) {
      throw new RegisterError("EMAIL_TAKEN");
    }
    const base = slugify(d.clinicName);
    let slug = base;
    for (let i = 2; await tx.clinic.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }
    const user = await tx.user.create({
      data: { name: d.ownerName, email: d.email, passwordHash },
    });
    const clinic = await tx.clinic.create({
      data: { slug, name: d.clinicName, city: d.city,
              address: d.address, phone: d.phone },
    });
    await tx.membership.create({
      data: { userId: user.id, clinicId: clinic.id, role: "OWNER" },
    });
    await tx.subscription.create({
      data: { clinicId: clinic.id, plan: "TRIAL", status: "ACTIVE",
              trialEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });
    return { clinicId: clinic.id, userId: user.id, clinicName: clinic.name };
  });

  // Outside the transaction and non-fatal: the activity feed is a nice-to-have
  // view, not a condition of a successful registration.
  try {
    await logActivity("clinic_registered", `${result.clinicName} registered`,
      { clinicId: result.clinicId });
  } catch (e) {
    console.error("logActivity(clinic_registered) failed", e);
  }

  return { clinicId: result.clinicId, userId: result.userId };
}
