export type PaymentOutcome = "SUCCEEDED" | "FAILED";

export interface CheckoutSession {
  /** The provider's id for this payment; webhooks refer back to it. */
  providerRef: string;
  /** Where to send the patient to pay. */
  checkoutUrl: string;
}

export interface WebhookResult {
  providerRef: string;
  outcome: PaymentOutcome;
}

/**
 * Spec §7. V1 ships MockPaymentProvider; a real gateway (Kosovo bank
 * e-commerce, or Stripe via a foreign entity) is a drop-in implementation.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: {
    /** Opaque reference of ours the checkout returns to. */
    reference: string;
    amountEur: number;
    description: string;
  }): Promise<CheckoutSession>;
  /** Verifies and normalises the provider's webhook payload. */
  handleWebhook(payload: unknown): Promise<WebhookResult>;
  refund(providerRef: string, amountEur: number): Promise<void>;
}
