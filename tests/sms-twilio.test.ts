import { describe, it, expect } from "vitest";
import { TwilioSmsProvider } from "@/lib/sms/twilio";

describe("TwilioSmsProvider", () => {
  it("POSTs the message to the Twilio API and returns the sid", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ sid: "SM123" }), { status: 201 });
    }) as typeof fetch;
    const p = new TwilioSmsProvider("AC1", "tok", "+15550001111", fakeFetch);
    const r = await p.send("+38344123456", "Test");
    expect(r.providerRef).toBe("SM123");
    expect(calls[0].url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const body = String(calls[0].init.body);
    expect(body).toContain("To=%2B38344123456");
    expect(body).toContain("Body=Test");
    expect(String((calls[0].init.headers as Record<string, string>).Authorization))
      .toContain("Basic ");
  });
  it("throws on non-2xx responses", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const p = new TwilioSmsProvider("AC1", "tok", "+15550001111", fakeFetch);
    await expect(p.send("+38344123456", "Test")).rejects.toThrow(/401/);
  });
});
