import { z } from "zod";
export const DAY = 86400000;
export const Kind = z.enum(["RECURRING_30D", "PREPAID_90D", "PREPAID_365D"]);
export type Kind = z.infer<typeof Kind>;
export const telegramId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine(
    (v) => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER),
    "Unsafe Telegram ID",
  );
export const chatTelegramId = z
  .string()
  .regex(/^-[1-9]\d{0,15}$/)
  .refine((v) => BigInt(v) >= BigInt(Number.MIN_SAFE_INTEGER));
export const planInput = z
  .object({
    name: z.string().trim().min(2).max(32),
    kind: Kind,
    stars: z.number().int().min(1).max(1000000),
    chatIds: z.array(z.string().uuid()).min(1).max(20),
    policyId: z.string().uuid(),
  })
  .superRefine((v, c) => {
    if (v.kind === "RECURRING_30D" && v.stars > 10000)
      c.addIssue({
        code: "custom",
        path: ["stars"],
        message: "Recurring price cannot exceed 10,000 Stars",
      });
    if (new Set(v.chatIds).size !== v.chatIds.length)
      c.addIssue({
        code: "custom",
        path: ["chatIds"],
        message: "Duplicate chats",
      });
  });
export const policyInput = z.object({
  terms: z.string().trim().min(10).max(1400),
  refunds: z.string().trim().min(10).max(600),
  support: z.string().trim().min(3).max(200),
  privacy: z.string().trim().min(10).max(1000),
});
export const reasonInput = z.object({
  reason: z.string().trim().min(5).max(500),
  confirm: z.literal(true),
});
export function duration(kind: Kind) {
  return kind === "RECURRING_30D" ? 30 : kind === "PREPAID_90D" ? 90 : 365;
}
export function label(kind: string) {
  return kind === "RECURRING_30D"
    ? "Every 30 days · auto-renewing"
    : kind === "PREPAID_90D"
      ? "90-day prepaid · one-time"
      : "365-day prepaid · one-time";
}
export function entitled(
  grants: { startsAt: Date; expiresAt: Date; revokedAt: Date | null }[],
  now = new Date(),
) {
  return grants.some(
    (g) => !g.revokedAt && g.startsAt <= now && g.expiresAt > now,
  );
}
export function interval(
  kind: Kind,
  paidAt: Date,
  existingEnd: Date | undefined,
  providerExpiry?: number,
) {
  if (kind === "RECURRING_30D") {
    if (
      !Number.isSafeInteger(providerExpiry) ||
      !providerExpiry ||
      providerExpiry * 1000 <= paidAt.getTime()
    )
      throw new Error("Missing or invalid recurring expiration");
    const end = new Date(providerExpiry * 1000);
    return { start: new Date(end.getTime() - 30 * DAY), end };
  }
  const start = new Date(
    Math.max(paidAt.getTime(), existingEnd?.getTime() ?? 0),
  );
  return { start, end: new Date(start.getTime() + duration(kind) * DAY) };
}
export function safeNumericId(value: bigint | string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Unsafe Telegram ID");
  return n;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
