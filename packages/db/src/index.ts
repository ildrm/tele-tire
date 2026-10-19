import { PrismaClient, Prisma } from "@prisma/client";
export const db = new PrismaClient({ log: [] });
export type Tx = Prisma.TransactionClient;
export { Prisma };
export async function locked<T>(
  botId: string,
  fn: (tx: Tx) => Promise<T>,
  budget = { timeout: 25000, maxWait: 3000, lockWait: 3000 },
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(budget.lockWait)}, true)`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${botId}, 0))::text`;
      return fn(tx);
    },
    { timeout: budget.timeout, maxWait: budget.maxWait },
  );
}
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
