import type { SmsProvider } from "./types";
import { ConsoleSmsProvider } from "./console";
import { TwilioSmsProvider } from "./twilio";
import { VonageSmsProvider } from "./vonage";

export function getSmsProvider(): SmsProvider {
  switch (process.env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsProvider();
    case "vonage":
      return new VonageSmsProvider();
    case "console":
    default:
      return new ConsoleSmsProvider();
  }
}
export type { SmsProvider };
