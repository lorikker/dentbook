import { describe, it, expect } from "vitest";
import { VonageSmsProvider } from "@/lib/sms/vonage";

const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("VonageSmsProvider", () => {
  it("POSTs the message and returns the message-id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({
        "message-count": "1",
        messages: [{ status: "0", "message-id": "MSG123" }],
      }), { status: 200 });
    }) as typeof fetch;
    const p = new VonageSmsProvider("key", "sec", "Dentbook", fakeFetch);
    const r = await p.send("+38344123456", "Test");
    expect(r.providerRef).toBe("MSG123");
    expect(calls[0].url).toBe("https://rest.nexmo.com/sms/json");
    const body = String(calls[0].init.body);
    expect(body).toContain("to=%2B38344123456");
    expect(body).toContain("text=Test");
    expect(body).toContain("from=Dentbook");
  });

  it("throws on non-2xx responses", async () => {
    const p = new VonageSmsProvider("key", "sec", "Dentbook", ok("nope", 401));
    await expect(p.send("+38344123456", "Test")).rejects.toThrow(/401/);
  });

  it("throws when Vonage returns 200 with a failure status", async () => {
    const p = new VonageSmsProvider("key", "sec", "Dentbook", ok({
      messages: [{ status: "4", "error-text": "Bad Credentials" }],
    }));
    await expect(p.send("+38344123456", "Test"))
      .rejects.toThrow(/status 4: Bad Credentials/);
  });
});
