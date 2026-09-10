import type { PaymentProvider } from "./types";
import { MockPaymentProvider } from "./mock";

export function getPaymentProvider(): PaymentProvider {
  return new MockPaymentProvider();
}
export type { PaymentProvider };
