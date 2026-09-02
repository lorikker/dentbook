import { render, screen } from "@testing-library/react";
import { Button, ButtonLink } from "@/components/Button";

describe("Button", () => {
  it("renders a native button with the given text", () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole("button", { name: "Click me" });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");
  });

  it("ButtonLink renders a link with the given href", () => {
    render(<ButtonLink href="/products">Products</ButtonLink>);
    const link = screen.getByRole("link", { name: "Products" });
    expect(link).toHaveAttribute("href", "/products");
  });
});
