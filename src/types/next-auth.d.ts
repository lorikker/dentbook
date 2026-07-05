import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      kind: "patient" | "staff";
      isPlatformAdmin: boolean;
    };
  }

  interface User {
    kind: "patient" | "staff";
    isPlatformAdmin: boolean;
  }
}
