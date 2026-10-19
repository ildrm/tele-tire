import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const source = new PrismaClient();
const target = new URL(process.env.DATABASE_URL!);
target.pathname = "/teletier_restore_verification";
const restored = new PrismaClient({
  datasources: { db: { url: target.toString() } },
});
async function counts(client: PrismaClient) {
  return {
    payments: await client.payment.count(),
    refunds: await client.refund.count(),
    grants: await client.grant.count(),
    subscriptions: await client.subscription.count(),
    inbox: await client.inbox.count(),
    jobs: await client.job.count(),
    audits: await client.audit.count(),
    versions: await client.planVersion.count(),
  };
}
try {
  const before = await counts(source),
    after = await counts(restored);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Restored record counts differ");
  console.log(
    JSON.stringify({ status: "PASS", isolatedRestore: true, counts: after }),
  );
} finally {
  await source.$disconnect();
  await restored.$disconnect();
}
