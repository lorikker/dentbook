import bcrypt from "bcryptjs";
import { withDbContext } from "./tenant-db";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyStaffLogin(email: string, password: string) {
  return withDbContext({ role: "auth" }, async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  });
}
