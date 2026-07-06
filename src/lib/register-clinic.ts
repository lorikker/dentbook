import { z } from "zod";
import { withDbContext } from "./tenant-db";
import { hashPassword } from "./staff-auth";

export class RegisterError extends Error {
  constructor(public code: "INVALID_INPUT" | "EMAIL_TAKEN") { super(code); }
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

export function slugify(name: string): string {
  return name.toLowerCase()
    .replaceAll("ë", "e").replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function registerClinic(input: RegisterInput) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new RegisterError("INVALID_INPUT");
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);

  return withDbContext({ role: "auth" }, async (tx) => {
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
    return { clinicId: clinic.id, userId: user.id };
  });
}
