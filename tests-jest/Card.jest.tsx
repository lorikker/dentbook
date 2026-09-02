import { render, screen } from "@testing-library/react";
import { Card } from "@/components/Card";

describe("Card", () => {
  it("renders title and subtitle", () => {
    render(<Card title="Test Clinic" subtitle="Pristina · Main St" />);
    expect(screen.getByText("Test Clinic")).toBeInTheDocument();
    expect(screen.getByText("Pristina · Main St")).toBeInTheDocument();
  });
  it("renders as a link when href is given", () => {
    render(<Card href="/clinics/test" title="Test Clinic" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/clinics/test");
  });
});
