import { render, screen } from "@testing-library/react";
import { Header } from "@/components/Header";

jest.mock("@/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
  signOut: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getTranslations: jest.fn().mockResolvedValue((key: string) => key),
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
