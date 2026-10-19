import "dotenv/config";
import { db, locked } from "../packages/db/src";
import { config } from "../packages/app/src/config";
import { createSession, type Actor } from "../packages/app/src/auth";
import {
  configureWebhook,
  connectBot,
  createPolicy,
  enrollChat,
  savePlan,
} from "../packages/app/src/setup";
import {
  prepareCheckout,
  precheckout,
  recordPayment,
} from "../packages/app/src/payments";
import { telegram, FakeTelegram } from "../packages/telegram/src";
import { reconcileSubscriber } from "../packages/app/src/access";
if (!config.TELEGRAM_FAKE || config.NODE_ENV === "production")
  throw new Error("Seed requires an explicit non-production fake adapter");
const session = await createSession({
  subject: "dev:local-owner",
  telegramId: BigInt(config.DEV_OWNER_TELEGRAM_ID),
  name: "Alex Morgan",
});
const existing = await db.tenantMember.findFirst({
  where: { userId: session.user.id },
});
if (existing) {
  console.log("Local workspace already exists; preserving data.");
  await db.$disconnect();
  process.exit(0);
}
const tenant = await db.tenant.create({
  data: {
    name: "The Learning Room",
    timezone: "UTC",
    members: { create: { userId: session.user.id } },
  },
});
const actor: Actor = {
  tenantId: tenant.id,
  userId: session.user.id,
  telegramId: session.user.telegramId,
  role: "OWNER",
};
await connectBot(actor, {
  token: "900001:development_only_fake_token_abcdefghijklmnopqrstuvwxyz",
});
await configureWebhook(actor, { confirm: true });
const chat = await enrollChat(actor, { telegramId: "-1001234567890" });
const bot = await db.bot.findUniqueOrThrow({ where: { tenantId: tenant.id } });
const policy = await createPolicy(actor, {
  terms:
    "Learning Circle includes private study discussions and shared learning resources. 30-day plans renew automatically until canceled. Prepaid plans are one-time 90- or 365-day purchases. Use /cancel for recurring memberships.",
  refunds:
    "Contact creator support for payment disputes or refund requests. Include your Telegram payment receipt. Requests are reviewed individually.",
  support: "@learning_room_support",
  privacy:
    "We store Telegram identity, membership dates, payment facts and access operations to deliver your membership. Contact creator support for a copy of your information or a deletion request. Financial facts may need to be retained.",
});
for (const [name, kind, stars] of [
  ["Learning Circle", "RECURRING_30D", 450],
  ["Deep Dive", "PREPAID_90D", 1200],
  ["Year of Learning", "PREPAID_365D", 4200],
] as const)
  await savePlan(actor, {
    name,
    kind,
    stars,
    policyId: policy.id,
    chatIds: [chat.id],
  });
const plan = await db.plan.findFirstOrThrow({
  where: { tenantId: tenant.id, name: "Learning Circle" },
});
for (const [i, name] of [
  "Jamie Chen",
  "Sofia Rivera",
  "Noah Williams",
  "Ava Patel",
  "Leo Andersson",
].entries()) {
  const s = await db.subscriber.create({
    data: {
      tenantId: tenant.id,
      botId: bot.id,
      telegramId: BigInt(200001 + i),
      name,
      contacted: true,
    },
  });
  if (i === 4) continue;
  const c = await locked(bot.id, (tx) =>
    prepareCheckout(tx, bot, s, plan.currentVersionId),
  );
  await precheckout(bot, {
    id: `seed-${i}`,
    from: { id: Number(s.telegramId) },
    currency: "XTR",
    total_amount: 450,
    invoice_payload: c.id,
  });
  const now = new Date();
  await locked(bot.id, (tx) =>
    recordPayment(
      tx,
      bot,
      {
        currency: "XTR",
        total_amount: 450,
        invoice_payload: c.id,
        telegram_payment_charge_id: `demo-charge-${i + 1}`,
        is_recurring: true,
        is_first_recurring: true,
        subscription_expiration_date:
          Math.floor(now.getTime() / 1000) + 2592000,
      },
      s.telegramId,
      now,
      BigInt(i + 1),
    ),
  );
  const fake = telegram(bot) as FakeTelegram;
  if (i < 3) fake.members.set(`${chat.telegramId}:${s.telegramId}`, "member");
  await reconcileSubscriber(bot, s.id);
}
console.log(
  "Created explicitly simulated local workspace: The Learning Room. No real Telegram requests or Stars charges were made.",
);
await db.$disconnect();
