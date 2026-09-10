import type { SmsProvider } from "./types";

/**
 * Vonage (Nexmo) SMS API. Selected via SMS_PROVIDER=vonage.
 *
 * Unlike Twilio's current free trial, Vonage's trial allows custom message
 * bodies, so OTP codes come through. Trial accounts append
 * "[FREE SMS DEMO, TEST MESSAGE]" and can only reach verified test numbers.
 */
export class VonageSmsProvider implements SmsProvider {
  constructor(
    private key: string = process.env.VONAGE_API_KEY ?? "",
    private secret: string = process.env.VONAGE_API_SECRET ?? "",
    private from: string = process.env.VONAGE_FROM ?? "",
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(to: string, message: string) {
    const res = await this.fetchFn("https://rest.nexmo.com/sms/json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_key: this.key, api_secret: this.secret,
        to, from: this.from, text: message,
      }),
    });
    if (!res.ok) {
      throw new Error(`Vonage ${res.status}: ${await res.text()}`);
    }
    // Vonage answers 200 even when the send failed; the real result is in
    // messages[0].status, where "0" means accepted.
    const data = (await res.json()) as {
      messages?: { status?: string; "message-id"?: string;
                   "error-text"?: string }[];
    };
    const m = data.messages?.[0];
    if (!m || m.status !== "0") {
      throw new Error(
        `Vonage status ${m?.status ?? "unknown"}: ${m?.["error-text"] ?? "no message returned"}`);
    }
    return { providerRef: m["message-id"] ?? "" };
  }
}
