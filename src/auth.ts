import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { verifyOtp } from "@/lib/otp";
import { verifyStaffLogin } from "@/lib/staff-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      id: "patient-otp",
      credentials: { phone: {}, code: {}, name: {} },
      async authorize(creds) {
        const parsed = z.object({
          phone: z.string().min(8),
          code: z.string().length(6),
          name: z.string().min(1),
        }).safeParse(creds);
        if (!parsed.success) return null;
        try {
          const user = await verifyOtp(
            parsed.data.phone, parsed.data.code, parsed.data.name);
          return { id: user.id, name: user.name,
                   isPlatformAdmin: user.isPlatformAdmin, kind: "patient" as const };
        } catch {
          return null;
        }
      },
    }),
    Credentials({
      id: "staff-login",
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const parsed = z.object({
          email: z.email(),
          password: z.string().min(1),
        }).safeParse(creds);
        if (!parsed.success) return null;
        const user = await verifyStaffLogin(
          parsed.data.email, parsed.data.password);
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email,
                 isPlatformAdmin: user.isPlatformAdmin, kind: "staff" as const };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.kind = user.kind;
        token.isPlatformAdmin = user.isPlatformAdmin;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.kind = token.kind as "patient" | "staff";
      session.user.isPlatformAdmin = token.isPlatformAdmin as boolean;
      return session;
    },
  },
});
