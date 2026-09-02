export interface AdminContext {
  userId: string;
}

/** For server components: redirects to "/" when not a platform admin. */
export async function requirePlatformAdmin(): Promise<AdminContext> {
  const [{ auth }, { redirect }] = await Promise.all([
    import("@/auth"),
    import("next/navigation"),
  ]);
  const session = await auth();
  if (!session?.user?.id || !session.user.isPlatformAdmin) return redirect("/");
  return { userId: session.user.id };
}
