import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PaymentProvider, CheckoutSession, WebhookResult } from "./types";

const webhookSchema = z.object({
  providerRef: z.string().min(1),
  outcome: z.enum(["SUCCEEDED", "FAILED"]),
});

/**
 * Spec §7 mock: no money moves. Checkout is the app's own /pay page, where the
 * patient explicitly confirms or cancels — so the UX flow is real — and that
 * page posts the "webhook" back through handleDepositWebhook.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createCheckout(input: {
    reference: string; amountEur: number; description: string;
  }): Promise<CheckoutSession> {
    return { providerRef: `mock_${randomUUID()}`, checkoutUrl: `/pay/${input.reference}` };
  }

  async handleWebhook(payload: unknown): Promise<WebhookResult> {
    const parsed = webhookSchema.safeParse(payload);
    if (!parsed.success) throw new Error("Invalid mock payment webhook");
    return parsed.data;
  }

  async refund(): Promise<void> {
    // Nothing was captured, so there is nothing to give back.
  }
}
