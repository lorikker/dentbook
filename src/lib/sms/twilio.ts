import type { SmsProvider } from "./types";

/** Twilio REST API (supports +383). Selected via SMS_PROVIDER=twilio. */
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private sid: string = process.env.TWILIO_ACCOUNT_SID ?? "",
    private token: string = process.env.TWILIO_AUTH_TOKEN ?? "",
    private from: string = process.env.TWILIO_FROM ?? "",
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(to: string, message: string) {
    const res = await this.fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " +
            Buffer.from(`${this.sid}:${this.token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: this.from, Body: message }),
      });
    if (!res.ok) {
      throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { sid: string };
    return { providerRef: data.sid };
  }
}
