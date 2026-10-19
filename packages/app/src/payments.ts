import { z } from "zod";
import type { Bot, Checkout, PlanVersion, Subscriber } from "@prisma/client";
import { db, json, locked, type Tx } from "../../db/src";
import {
  AppError,
  interval,
  requireThat,
  safeNumericId,
  type Kind,
} from "../../domain/src";
import { invoice, telegram } from "../../telegram/src";
import { nonce } from "./secrets";
import { owner, type Actor } from "./auth";
export async function enqueue(
  tx: Tx,
  bot: Pick<Bot, "id" | "tenantId">,
  kind: string,
  key: string,
  payload: unknown,
) {
  await tx.job.createMany({
    data: [
      {
        tenantId: bot.tenantId,
        botId: bot.id,
        kind,
        key,
        payload: json(payload),
      },
    ],
    skipDuplicates: true,
  });
  return tx.job.findUniqueOrThrow({ where: { key } });
}
export async function incident(
  tx: Tx,
  bot: Bot,
  kind: string,
  key: string,
  detail: string,
) {
  return tx.incident.upsert({
    where: { key: `${bot.id}:${key}` },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      key: `${bot.id}:${key}`,
      kind,
      detail,
    },
    update: {},
  });
}
export async function prepareCheckout(
  tx: Tx,
  bot: Bot,
  subscriber: Subscriber,
  versionId: string,
) {
  requireThat(
    bot.status === "READY" &&
      (await tx.bot.count({
        where: { id: bot.id, tenantId: bot.tenantId, status: "READY" },
      })) === 1,
    409,
    "Creator bot is not ready. Contact creator support.",
  );
  const version = await tx.planVersion.findFirst({
    where: { id: versionId, tenantId: bot.tenantId },
  });
  requireThat(version, 404, "Plan unavailable");
  const plan = await tx.plan.findFirst({
    where: {
      id: version.planId,
      tenantId: bot.tenantId,
      state: "ACTIVE",
      currentVersionId: versionId,
    },
  });
  requireThat(
    plan,
    409,
    "Plan changed. Open /plans and accept the current terms.",
  );
  {
    const subs = await tx.subscription.findMany({
      where: { botId: bot.id, subscriberId: subscriber.id },
    });
    requireThat(
      !subs.some((s) => !s.canceled || s.paidThrough > new Date()),
      409,
      "An existing subscription is active. Use /status or /cancel before another purchase.",
    );
    const pending = await tx.checkout.findFirst({
      where: {
        botId: bot.id,
        subscriberId: subscriber.id,
        expiresAt: { gt: new Date() },
        status: { in: ["CREATED", "PRECHECKOUT_APPROVED"] },
      },
    });
    requireThat(
      !pending,
      409,
      "A purchase is already pending. Complete it or wait 15 minutes.",
    );
  }
  const checkout = await tx.checkout.create({
    data: {
      id: nonce(),
      tenantId: bot.tenantId,
      botId: bot.id,
      subscriberId: subscriber.id,
      versionId,
      policyId: version.policyId,
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 900000),
    },
  });
  await enqueue(tx, bot, "INVOICE", `invoice:${checkout.id}`, {
    checkoutId: checkout.id,
  });
  return checkout;
}
async function quote(
  tx: Tx,
  bot: Bot,
  payload: string,
  buyer: bigint,
  amount: number,
  currency: string,
) {
  const c = await tx.checkout.findFirst({
    where: { id: payload, botId: bot.id, tenantId: bot.tenantId },
  });
  requireThat(c, 400, "Unknown purchase. Open /plans to retry.");
  const [s, v] = await Promise.all([
    tx.subscriber.findFirst({
      where: { id: c.subscriberId, tenantId: bot.tenantId, botId: bot.id },
    }),
    tx.planVersion.findFirst({
      where: { id: c.versionId, tenantId: bot.tenantId },
    }),
  ]);
  requireThat(
    s &&
      s.telegramId === buyer &&
      v &&
      v.policyId === c.policyId &&
      c.acceptedAt,
    400,
    "Purchase identity or terms mismatch",
  );
  requireThat(
    currency === "XTR" && Number.isSafeInteger(amount) && amount === v.stars,
    400,
    "Purchase amount or currency mismatch",
  );
  return { c, s, v };
}
export const precheckoutSchema = z.object({
  id: z.string().min(1).max(200),
  from: z.object({ id: z.number().int().positive().safe() }),
  currency: z.string(),
  total_amount: z.number().int().positive().safe(),
  invoice_payload: z.string().min(1).max(128),
});
export async function precheckout(bot: Bot, raw: unknown) {
  const q = precheckoutSchema.parse(raw);
  let accepted = false;
  let decision = "Approved immutable purchase snapshot";
  try {
    await locked(
      bot.id,
      async (tx) => {
        requireThat(
          bot.status === "READY" &&
            (await tx.bot.count({
              where: { id: bot.id, tenantId: bot.tenantId, status: "READY" },
            })) === 1,
          409,
          "Creator bot is unavailable",
        );
        const { c, v } = await quote(
          tx,
          bot,
          q.invoice_payload,
          BigInt(q.from.id),
          q.total_amount,
          q.currency,
        );
        requireThat(
          c.expiresAt > new Date() &&
            ["CREATED", "PRECHECKOUT_APPROVED"].includes(c.status),
          400,
          "Purchase expired. Open /plans to retry.",
        );
        requireThat(
          !c.precheckoutId || c.precheckoutId === q.id,
          409,
          "This invoice is already in use",
        );
        requireThat(
          (await tx.plan.count({
            where: {
              id: v.planId,
              tenantId: bot.tenantId,
              currentVersionId: v.id,
              state: "ACTIVE",
            },
          })) === 1,
          409,
          "Plan changed. Open /plans to retry.",
        );
        {
          requireThat(
            (await tx.subscription.count({
              where: {
                botId: bot.id,
                subscriberId: c.subscriberId,
                OR: [{ canceled: false }, { paidThrough: { gt: new Date() } }],
              },
            })) === 0,
            409,
            "A subscription is already active",
          );
        }
        await tx.checkout.update({
          where: { id: c.id },
          data: { status: "PRECHECKOUT_APPROVED", precheckoutId: q.id },
        });
        accepted = true;
      },
      { timeout: 3000, maxWait: 300, lockWait: 1000 },
    );
  } catch (e) {
    accepted = false;
    decision =
      e instanceof AppError
        ? e.message
        : "Validation deadline or database unavailable; failed closed";
  }
  await telegram(bot).call(
    "answerPreCheckoutQuery",
    {
      pre_checkout_query_id: q.id,
      ok: accepted,
      ...(accepted
        ? {}
        : {
            error_message:
              "Purchase could not be validated. Open /plans or contact /paysupport.",
          }),
    },
    3500,
  );
  await db.audit.create({
    data: {
      tenantId: bot.tenantId,
      actorId: String(q.from.id),
      action: accepted ? "PRECHECKOUT_APPROVED" : "PRECHECKOUT_REJECTED",
      target: q.invoice_payload,
      reason: decision,
      result: { accepted, queryId: q.id },
    },
  });
  return accepted;
}
export const paymentSchema = z.object({
  currency: z.string(),
  total_amount: z.number().int().positive().safe(),
  invoice_payload: z.string().min(1).max(128),
  telegram_payment_charge_id: z.string().min(1).max(300),
  is_recurring: z.literal(true).optional(),
  is_first_recurring: z.literal(true).optional(),
  subscription_expiration_date: z.number().int().positive().safe().optional(),
});
export async function recordPayment(
  tx: Tx,
  bot: Bot,
  raw: unknown,
  buyer: bigint,
  paidAt: Date,
  updateId: bigint,
) {
  const p = paymentSchema.parse(raw);
  const old = await tx.payment.findUnique({
    where: {
      botId_chargeId: { botId: bot.id, chargeId: p.telegram_payment_charge_id },
    },
  });
  if (old) {
    requireThat(
      old.stars === p.total_amount && old.checkoutId === p.invoice_payload,
      409,
      "Duplicate charge has conflicting facts",
    );
    return old;
  }
  const { c, s, v } = await quote(
    tx,
    bot,
    p.invoice_payload,
    buyer,
    p.total_amount,
    p.currency,
  );
  const recurring = v.kind === "RECURRING_30D";
  requireThat(
    recurring === !!p.is_recurring && (!p.is_first_recurring || recurring),
    400,
    "Recurring payment shape mismatch",
  );
  const subscription = await tx.subscription.findUnique({
    where: { checkoutId: c.id },
  });
  const renewal = recurring && !p.is_first_recurring;
  if (renewal)
    requireThat(
      subscription &&
        subscription.subscriberId === s.id &&
        subscription.botId === bot.id,
      409,
      "Renewal has no canonical subscription; investigate payment",
    );
  else
    requireThat(
      c.status === "PRECHECKOUT_APPROVED",
      409,
      "Payment requires an approved checkout; investigate payment",
    );
  requireThat(
    !subscription || renewal,
    409,
    "A second initial charge requires investigation/refund",
  );
  requireThat(
    paidAt.getTime() <= Date.now() + 60000 &&
      paidAt.getTime() >= c.createdAt.getTime() - 60000,
    400,
    "Invalid payment event timestamp",
  );
  const versions = await tx.planVersion.findMany({
    where: { tenantId: bot.tenantId, planId: v.planId },
    select: { id: true },
  });
  const remainingGrants = await tx.grant.findMany({
    where: {
      tenantId: bot.tenantId,
      botId: bot.id,
      subscriberId: s.id,
      revokedAt: null,
      paymentId: { not: null },
    },
    select: { paymentId: true },
  });
  const previous = await tx.payment.findFirst({
    where: {
      botId: bot.id,
      subscriberId: s.id,
      versionId: { in: versions.map((v) => v.id) },
      id: { in: remainingGrants.map((g) => g.paymentId!) },
    },
    orderBy: { periodEnd: "desc" },
  });
  const tombstone = await tx.refund.findUnique({
    where: {
      botId_chargeId: { botId: bot.id, chargeId: p.telegram_payment_charge_id },
    },
  });
  requireThat(
    !tombstone || tombstone.stars === p.total_amount,
    409,
    "Refund tombstone and charge amount mismatch",
  );
  const { start, end } = interval(
    v.kind as Kind,
    paidAt,
    previous?.periodEnd,
    p.subscription_expiration_date,
  );
  const payment = await tx.payment.create({
    data: {
      tenantId: bot.tenantId,
      botId: bot.id,
      subscriberId: s.id,
      checkoutId: c.id,
      versionId: v.id,
      chargeId: p.telegram_payment_charge_id,
      updateId,
      stars: p.total_amount,
      recurring,
      firstRecurring: !!p.is_first_recurring,
      paidAt,
      periodStart: start,
      periodEnd: end,
    },
  });
  await tx.checkout.update({
    where: { id: c.id },
    data: { status: "CONFIRMED" },
  });
  if (recurring) {
    const effectiveEnd =
      tombstone?.status === "CONFIRMED"
        ? (subscription?.paidThrough ?? new Date(0))
        : end;
    if (subscription)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          paidThrough:
            subscription.paidThrough > effectiveEnd
              ? subscription.paidThrough
              : effectiveEnd,
        },
      });
    else
      await tx.subscription.create({
        data: {
          tenantId: bot.tenantId,
          botId: bot.id,
          subscriberId: s.id,
          checkoutId: c.id,
          initialChargeId: payment.chargeId,
          paidThrough: effectiveEnd,
        },
      });
  }
  const refund = await tx.refund.findUnique({
    where: { botId_chargeId: { botId: bot.id, chargeId: payment.chargeId } },
  });
  for (const chatId of v.chatIds)
    await tx.grant.create({
      data: {
        tenantId: bot.tenantId,
        botId: bot.id,
        subscriberId: s.id,
        chatId,
        paymentId: payment.id,
        startsAt: start,
        expiresAt: end,
        revokedAt: refund?.status === "CONFIRMED" ? new Date() : null,
      },
    });
  await enqueue(tx, bot, "ACCESS", `payment:${payment.id}`, {
    subscriberId: s.id,
  });
  await tx.audit.create({
    data: {
      tenantId: bot.tenantId,
      actorId: "telegram",
      action: "PAYMENT_CONFIRMED",
      target: payment.id,
      reason: "Verified successful_payment",
      result: { stars: payment.stars, chargeId: payment.chargeId },
    },
  });
  return payment;
}
export async function confirmRefund(tx: Tx, bot: Bot, raw: unknown) {
  const p = paymentSchema.parse(raw);
  requireThat(p.currency === "XTR", 400, "Unsupported refund currency");
  const payment = await tx.payment.findUnique({
    where: {
      botId_chargeId: { botId: bot.id, chargeId: p.telegram_payment_charge_id },
    },
  });
  if (payment)
    requireThat(
      payment.stars === p.total_amount &&
        payment.checkoutId === p.invoice_payload,
      409,
      "Refund facts mismatch",
    );
  const r = await tx.refund.upsert({
    where: {
      botId_chargeId: { botId: bot.id, chargeId: p.telegram_payment_charge_id },
    },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      chargeId: p.telegram_payment_charge_id,
      subscriberId: payment?.subscriberId,
      stars: p.total_amount,
      status: "CONFIRMED",
      reason: "Authenticated Telegram refund event",
      actorId: "telegram",
      confirmedAt: new Date(),
    },
    update: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  if (payment) {
    await tx.grant.updateMany({
      where: { tenantId: bot.tenantId, paymentId: payment.id },
      data: { revokedAt: new Date() },
    });
    await enqueue(tx, bot, "ACCESS", `refund:${r.id}`, {
      subscriberId: payment.subscriberId,
    });
    const subscription = await tx.subscription.findUnique({
      where: { checkoutId: payment.checkoutId },
    });
    if (subscription) {
      const refunded = await tx.refund.findMany({
        where: { botId: bot.id, status: "CONFIRMED" },
        select: { chargeId: true },
      });
      const last = await tx.payment.findFirst({
        where: {
          botId: bot.id,
          checkoutId: payment.checkoutId,
          chargeId: { notIn: refunded.map((r) => r.chargeId) },
        },
        orderBy: { periodEnd: "desc" },
      });
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { paidThrough: last?.periodEnd ?? new Date(0) },
      });
    }
  } else
    await incident(
      tx,
      bot,
      "UNMATCHED_REFUND",
      `refund:${p.telegram_payment_charge_id}`,
      "Refund arrived before its charge. Tombstone retained for safe late delivery.",
    );
  await tx.audit.create({
    data: {
      tenantId: bot.tenantId,
      actorId: "telegram",
      action: "REFUND_CONFIRMED",
      target: r.id,
      reason: r.reason,
      result: { chargeId: r.chargeId },
    },
  });
  return r;
}
export async function requestRefund(actor: Actor, id: string, reason: string) {
  owner(actor);
  const payment = await db.payment.findFirst({
    where: { id, tenantId: actor.tenantId },
  });
  requireThat(payment, 404, "Charge not found");
  const bot = await db.bot.findFirstOrThrow({
    where: { id: payment.botId, tenantId: actor.tenantId },
  });
  return locked(bot.id, async (tx) => {
    const existing = await tx.refund.findUnique({
      where: { botId_chargeId: { botId: bot.id, chargeId: payment.chargeId } },
    });
    if (existing) return existing;
    const r = await tx.refund.create({
      data: {
        tenantId: actor.tenantId,
        botId: bot.id,
        chargeId: payment.chargeId,
        subscriberId: payment.subscriberId,
        stars: payment.stars,
        status: "REQUESTED",
        actorId: actor.userId,
        reason,
      },
    });
    await enqueue(tx, bot, "REFUND", `request-refund:${r.id}`, {
      refundId: r.id,
    });
    await tx.audit.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: "REFUND_REQUESTED",
        target: r.id,
        reason,
        result: { status: "REQUESTED" },
      },
    });
    return r;
  });
}
export async function sendInvoice(bot: Bot, c: Checkout) {
  const [v, s] = await Promise.all([
    db.planVersion.findFirstOrThrow({
      where: { id: c.versionId, tenantId: bot.tenantId },
    }),
    db.subscriber.findFirstOrThrow({
      where: { id: c.subscriberId, tenantId: bot.tenantId },
    }),
  ]);
  if (c.status !== "CREATED" || c.expiresAt < new Date()) return;
  const request = invoice(v, c.id, safeNumericId(s.telegramId));
  const result = await telegram(bot).call(request.method, request.fields);
  if (request.method === "createInvoiceLink")
    await telegram(bot).call("sendMessage", {
      chat_id: safeNumericId(s.telegramId),
      text: "Your 30-day auto-renewing Stars membership. Cancel future renewal with /cancel. Access is confirmed after Telegram verifies payment.",
      reply_markup: {
        inline_keyboard: [[{ text: `Pay ${v.stars} Stars`, url: result }]],
      },
    });
}
