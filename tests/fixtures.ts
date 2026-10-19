import { db, locked } from "../packages/db/src";
import { createSession, type Actor } from "../packages/app/src/auth";
import {
  configureWebhook,
  connectBot,
  createPolicy,
  enrollChat,
  savePlan,
} from "../packages/app/src/setup";
import { prepareCheckout, precheckout } from "../packages/app/src/payments";
import { hash } from "../packages/app/src/secrets";
import { receiveWebhook, processInbox } from "../packages/app/src/webhooks";
import type { Kind } from "../packages/domain/src";
export async function fixture(kind: Kind = "RECURRING_30D") {
  const session = await createSession({
    subject: "fixture-owner",
    telegramId: 100001n,
    name: "Alex Morgan",
  });
  const tenant = await db.tenant.create({
    data: {
      name: "The Learning Room",
      members: { create: { userId: session.user.id } },
    },
  });
  const actor: Actor = {
    userId: session.user.id,
    telegramId: 100001n,
    tenantId: tenant.id,
    role: "OWNER",
  };
  await connectBot(actor, {
    token: "900001:fixture_token_abcdefghijklmnopqrstuvwxyz",
  });
  await configureWebhook(actor, { confirm: true });
  const chat = await enrollChat(actor, { telegramId: "-1001234567890" });
  const policy = await createPolicy(actor, {
    terms:
      "Access to the learning community for the stated duration. Recurring memberships renew every 30 days until canceled.",
    refunds:
      "Contact support to request a refund for a legitimate payment dispute.",
    support: "@learning_room_support",
    privacy:
      "We retain your Telegram ID, paid-through dates and payment records. Contact support for data requests.",
  });
  const plan = await savePlan(actor, {
    name: "Learning Circle",
    kind,
    stars: 450,
    chatIds: [chat.id],
    policyId: policy.id,
  });
  await db.bot.update({
    where: { tenantId: tenant.id },
    data: { secretHash: hash("fixture-webhook-secret") },
  });
  const bot = await db.bot.findUniqueOrThrow({
    where: { tenantId: tenant.id },
  });
  const subscriber = await db.subscriber.create({
    data: {
      tenantId: tenant.id,
      botId: bot.id,
      telegramId: 200001n,
      name: "Jamie Chen",
      contacted: true,
    },
  });
  const checkout = await locked(bot.id, (tx) =>
    prepareCheckout(tx, bot, subscriber, plan.currentVersionId),
  );
  return {
    actor,
    session,
    tenant,
    bot,
    chat,
    policy,
    plan,
    subscriber,
    checkout,
    kind,
  };
}
export async function approve(f: Awaited<ReturnType<typeof fixture>>) {
  return precheckout(f.bot, {
    id: `pc-${f.checkout.id}`,
    from: { id: Number(f.subscriber.telegramId) },
    currency: "XTR",
    total_amount: 450,
    invoice_payload: f.checkout.id,
  });
}
export function paymentUpdate(
  f: Awaited<ReturnType<typeof fixture>>,
  updateId = 1,
  chargeId = "charge-initial",
  renewal = false,
  expiration = Math.floor(Date.now() / 1000) + 2592000,
) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number(f.subscriber.telegramId), type: "private" },
      from: {
        id: Number(f.subscriber.telegramId),
        first_name: f.subscriber.name,
      },
      successful_payment: {
        currency: "XTR",
        total_amount: 450,
        invoice_payload: f.checkout.id,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: "",
        ...(f.kind === "RECURRING_30D"
          ? {
              is_recurring: true,
              ...(!renewal ? { is_first_recurring: true } : {}),
              subscription_expiration_date: expiration,
            }
          : {}),
      },
    },
  };
}
export async function deliver(
  f: Awaited<ReturnType<typeof fixture>>,
  body: unknown,
) {
  await receiveWebhook(f.bot.endpoint, "fixture-webhook-secret", body);
  const inbox = await db.inbox.findUniqueOrThrow({
    where: {
      botId_updateId: {
        botId: f.bot.id,
        updateId: BigInt((body as any).update_id),
      },
    },
  });
  await processInbox(f.bot, inbox.id);
  return inbox;
}
