import { render, screen } from "@testing-library/react";
import { Header } from "@/components/Header";

jest.mock("@/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
  signOut: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getTranslations: jest.fn().mockResolvedValue((key: string) => key),
}));

// Same Prisma-under-Jest incompatibility documented in profile-route.jest.ts:
// mock the lib boundary so this render test never touches the real client.
// Header only calls this for logged-in patients, which isn't exercised below,
// but importing @/components/Header still pulls the module in transitively.
jest.mock("@/lib/favorites", () => ({
  countFavorites: jest.fn().mockResolvedValue(0),
}));

describe("Header", () => {
  it("renders nav links and shows login when logged out", async () => {
    render(await Header());

    expect(screen.getByRole("link", { name: "clinics" })).toHaveAttribute("href", "/clinics");
    expect(screen.getByRole("link", { name: "products" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: "about" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "login" })).toHaveAttribute("href", "/login");
  });
});
