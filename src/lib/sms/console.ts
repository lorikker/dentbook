import type { SmsProvider } from "./types";

/** Dev/test provider: prints the SMS to stdout. */
export class ConsoleSmsProvider implements SmsProvider {
  async send(to: string, message: string) {
    console.log(`[SMS → ${to}] ${message}`);
    return { providerRef: `console-${Date.now()}` };
  }
}
