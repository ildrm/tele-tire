import { describe, it, expect } from "vitest";
import {
  DAY,
  entitled,
  interval,
  planInput,
  telegramId,
} from "../packages/domain/src";
import {
  invoice,
  FakeTelegram,
  HttpTelegram,
  TelegramError,
} from "../packages/telegram/src";
import { decrypt, encrypt } from "../packages/app/src/secrets";
describe("domain and Telegram contract", () => {
  it("uses one XTR price and exact native 30-day period; prepaid never recurs", () => {
    for (const [kind, method] of [
      ["RECURRING_30D", "createInvoiceLink"],
      ["PREPAID_90D", "sendInvoice"],
      ["PREPAID_365D", "sendInvoice"],
    ]) {
      const request = invoice(
        { name: "Membership", kind: kind!, stars: 450 },
        "opaque",
        200001,
      );
      expect(request.method).toBe(method);
      expect(request.fields.currency).toBe("XTR");
      expect(request.fields.prices).toEqual([
        { label: "Membership", amount: 450 },
      ]);
      expect(request.fields).toHaveProperty("provider_token", "");
      if (kind === "RECURRING_30D")
        expect(request.fields).toHaveProperty("subscription_period", 2592000);
      else expect(request.fields).not.toHaveProperty("subscription_period");
    }
  });
  it("validates integer Stars, recurring ceiling, and safe decimal identity", () => {
    const p = {
      name: "Plan",
      kind: "RECURRING_30D",
      stars: 10001,
      chatIds: ["aa2323aa-1111-4111-8111-aabbccddeeff"],
      policyId: "aa2323aa-1111-4111-8111-aabbccddeeff",
    };
    expect(planInput.safeParse(p).success).toBe(false);
    expect(planInput.safeParse({ ...p, stars: 2.5 }).success).toBe(false);
    expect(telegramId.safeParse("9007199254740993").success).toBe(false);
  });
  it("preserves access union and isolates refund revocation", () => {
    const now = new Date();
    const a = {
      startsAt: new Date(now.getTime() - DAY),
      expiresAt: new Date(now.getTime() + DAY),
      revokedAt: now,
    };
    expect(entitled([a], now)).toBe(false);
    expect(entitled([a, { ...a, revokedAt: null }], now)).toBe(true);
  });
  it("uses provider dates and exact prepaid days across calendar boundaries", () => {
    const start = new Date("2026-01-31T12:00:00Z");
    expect(
      interval("PREPAID_90D", start, undefined).end.getTime() - start.getTime(),
    ).toBe(90 * DAY);
    expect(
      interval("PREPAID_365D", start, undefined).end.getTime() -
        start.getTime(),
    ).toBe(365 * DAY);
    expect(
      interval("RECURRING_30D", start, undefined, 1800000000).end.getTime(),
    ).toBe(1800000000000);
    expect(() => interval("RECURRING_30D", start, undefined)).toThrow();
  });
  it("encrypts credentials with authenticated tenant context", () => {
    const encrypted = encrypt("secret-token", "tenant-a");
    expect(encrypted).not.toContain("secret-token");
    expect(decrypt(encrypted, "tenant-a", "local-v1")).toBe("secret-token");
    expect(() => decrypt(encrypted, "tenant-b", "local-v1")).toThrow();
  });
});
