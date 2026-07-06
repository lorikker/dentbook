import type { SmsProvider } from "./types";
import { ConsoleSmsProvider } from "./console";
import { TwilioSmsProvider } from "./twilio";

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsProvider();
    case "console":
    default:
      return new ConsoleSmsProvider();
  }
}
export type { SmsProvider };
