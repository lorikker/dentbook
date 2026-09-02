import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateProfile, ProfileError } from "@/lib/profile";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = await request.json();
  try {
    const user = await updateProfile({ userId: session.user.id }, body);
    return NextResponse.json({ user });
  } catch (e) {
    if (e instanceof ProfileError) {
      return NextResponse.json({ error: e.code }, { status: 400 });
    }
    throw e;
  }
}
