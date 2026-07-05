import type { SmsProvider } from "./types";
import { ConsoleSmsProvider } from "./console";

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "console":
    default:
      return new ConsoleSmsProvider(); // Twilio provider arrives in Plan 3
  }
}
export type { SmsProvider };
