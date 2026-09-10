import { describe, it, expect } from "vitest";
import { MockPaymentProvider } from "@/lib/payments/mock";

describe("MockPaymentProvider", () => {
  it("checks out on the app's own mock pay page for the given reference", async () => {
    const s = await new MockPaymentProvider().createCheckout(
      { reference: "tok-123", amountEur: 10, description: "Deposit" });
    expect(s.checkoutUrl).toBe("/pay/tok-123");
    expect(s.providerRef).toMatch(/^mock_/);
  });

  it("issues a distinct providerRef per checkout", async () => {
    const p = new MockPaymentProvider();
    const input = { reference: "t", amountEur: 10, description: "d" };
    const a = await p.createCheckout(input);
    const b = await p.createCheckout(input);
    expect(a.providerRef).not.toBe(b.providerRef);
  });

  it.each(["SUCCEEDED", "FAILED"] as const)("normalises a %s webhook", async (outcome) => {
    expect(await new MockPaymentProvider().handleWebhook({ providerRef: "mock_1", outcome }))
      .toEqual({ providerRef: "mock_1", outcome });
  });

  it.each([null, { providerRef: "mock_1", outcome: "MAYBE" }, { outcome: "SUCCEEDED" }])(
    "rejects the malformed webhook %j", async (payload) => {
      await expect(new MockPaymentProvider().handleWebhook(payload)).rejects.toThrow();
    });
});
