import type { Bot, Job } from "@prisma/client";
import { db, json, locked } from "../../db/src";
import { DAY, requireThat, safeNumericId } from "../../domain/src";
import { TelegramError, telegram } from "../../telegram/src";
import { config } from "./config";
import { confirmRefund, enqueue, incident, sendInvoice } from "./payments";
import { processInbox } from "./webhooks";
import { processJoin, reconcileSubscriber } from "./access";
export async function reconcileStars(bot: Bot) {
  let offset = bot.reconcileOffset;
  for (let page = 0; page < 5; page++) {
    const result = await telegram(bot).call("getStarTransactions", {
      offset,
      limit: 100,
    });
    requireThat(
      Array.isArray(result.transactions),
      502,
      "Invalid Telegram transactions response",
    );
    for (const event of result.transactions)
      await locked(bot.id, async (tx) => {
        const key = `star:${bot.id}:${event.id}:${event.source ? "in" : "out"}:${event.date}`;
        if (await tx.providerEvent.findUnique({ where: { key } })) return;
        await tx.providerEvent.create({
          data: {
            tenantId: bot.tenantId,
            botId: bot.id,
            key,
            data: json(event),
          },
        });
        const p = await tx.payment.findUnique({
          where: {
            botId_chargeId: { botId: bot.id, chargeId: String(event.id) },
          },
        });
        const s = p
          ? await tx.subscriber.findFirst({
              where: {
                id: p.subscriberId,
                botId: bot.id,
                tenantId: bot.tenantId,
              },
            })
          : null;
        if (
          event.source?.type === "user" &&
          event.source.transaction_type === "invoice_payment"
        ) {
          if (
            !p ||
            !s ||
            event.amount !== p.stars ||
            String(event.source.user?.id) !== String(s.telegramId) ||
            event.source.invoice_payload !== p.checkoutId ||
            (event.nanostar_amount ?? 0) !== 0
          )
            await incident(
              tx,
              bot,
              "STAR_MISMATCH",
              key,
              "Incoming provider invoice transaction does not match the local charge amount, payload or buyer. No access credited.",
            );
        } else if (
          event.receiver?.type === "user" &&
          p &&
          s &&
          String(event.receiver.user?.id) === String(s.telegramId) &&
          event.amount === p.stars &&
          (event.nanostar_amount ?? 0) === 0
        ) {
          await confirmRefund(tx, bot, {
            currency: "XTR",
            total_amount: p.stars,
            invoice_payload: p.checkoutId,
            telegram_payment_charge_id: p.chargeId,
          });
        } else
          await incident(
            tx,
            bot,
            "UNMATCHED_STAR_EVENT",
            key,
            "Uncorrelated provider transaction requires review. This may be an unrelated bot transaction.",
          );
      });
    offset += result.transactions.length;
    await db.bot.update({
      where: { id: bot.id },
      data: { reconcileOffset: result.transactions.length < 100 ? 0 : offset },
    });
    if (result.transactions.length < 100) {
      // Only after a complete provider scan: allow a short delivery lag before
      // flagging local charges absent from the provider journal. Never synthesize
      // a refund or remove paid access from this discrepancy alone.
      for (let skip = 0; ; skip += 200) {
        const charges = await db.payment.findMany({
          where: {
            tenantId: bot.tenantId,
            botId: bot.id,
            paidAt: { lt: new Date(Date.now() - 300000) },
          },
          orderBy: { id: "asc" },
          take: 200,
          skip,
        });
        for (const charge of charges) {
          const seen = await db.providerEvent.count({
            where: {
              tenantId: bot.tenantId,
              botId: bot.id,
              key: { startsWith: `star:${bot.id}:${charge.chargeId}:in:` },
            },
          });
          if (!seen)
            await locked(bot.id, (tx) =>
              incident(
                tx,
                bot,
                "LOCAL_CHARGE_MISSING",
                `missing-charge:${charge.id}`,
                "Local confirmed charge is absent from a completed provider ledger scan after the delivery-lag window. Investigate; financial/access state is unchanged.",
              ),
            );
        }
        if (charges.length < 200) break;
      }
      return;
    }
    // Pagination is bounded; the next scheduled run resumes from the durable cursor.
  }
}
export async function dispatch(job: Job) {
  const bot = await db.bot.findFirst({
    where: { id: job.botId, tenantId: job.tenantId },
  });
  requireThat(
    bot && bot.status !== "DISCONNECTED",
    409,
    "Bot disconnected or job scope invalid",
  );
  const p = job.payload as any;
  switch (job.kind) {
    case "INBOX":
      return processInbox(bot, p.inboxId);
    case "ACCESS":
      return reconcileSubscriber(bot, p.subscriberId);
    case "JOIN":
      return processJoin(bot, p);
    case "INVOICE":
      return sendInvoice(
        bot,
        await db.checkout.findFirstOrThrow({
          where: { id: p.checkoutId, tenantId: bot.tenantId, botId: bot.id },
        }),
      );
    case "CALLBACK":
      await telegram(bot).call("answerCallbackQuery", {
        callback_query_id: p.callbackId,
      });
      return;
    case "NOTIFY": {
      const n = await db.notification.findFirst({
        where: { id: p.notificationId, tenantId: bot.tenantId, botId: bot.id },
      });
      requireThat(n, 404, "Message not found");
      if (n.status === "DELIVERED" || n.status === "UNREACHABLE") return;
      const s = await db.subscriber.findFirstOrThrow({
        where: { id: n.subscriberId, botId: bot.id, tenantId: bot.tenantId },
      });
      if (!s.contacted) {
        await db.notification.update({
          where: { id: n.id },
          data: { status: "UNREACHABLE" },
        });
        return;
      }
      try {
        await telegram(bot).call("sendMessage", {
          chat_id: safeNumericId(s.telegramId),
          text: n.text,
          ...(p.markup ? { reply_markup: p.markup } : {}),
        });
        await db.notification.update({
          where: { id: n.id },
          data: { status: "DELIVERED" },
        });
      } catch (e) {
        await db.notification.update({
          where: { id: n.id },
          data: {
            status:
              e instanceof TelegramError && e.code === 403
                ? "UNREACHABLE"
                : "RETRY",
          },
        });
        if (e instanceof TelegramError && e.code === 403) return;
        throw e;
      }
      return;
    }
    case "CANCEL": {
      const s = await db.subscription.findFirst({
        where: { id: p.subscriptionId, tenantId: bot.tenantId, botId: bot.id },
      });
      requireThat(s, 404, "Subscription not found");
      if (s.canceled) return;
      const member = await db.subscriber.findFirstOrThrow({
        where: { id: s.subscriberId, botId: bot.id, tenantId: bot.tenantId },
      });
      await telegram(bot).call("editUserStarSubscription", {
        user_id: safeNumericId(member.telegramId),
        telegram_payment_charge_id: s.initialChargeId,
        is_canceled: true,
      });
      await locked(bot.id, async (tx) => {
        await tx.subscription.update({
          where: { id: s.id },
          data: { canceled: true },
        });
        const key = `cancel-confirmed:${s.id}`;
        const n = await tx.notification.upsert({
          where: { key },
          create: {
            tenantId: bot.tenantId,
            botId: bot.id,
            subscriberId: member.id,
            key,
            text: `Auto-renewal cancelled. Already-paid access remains through ${s.paidThrough.toISOString()}.`,
          },
          update: {},
        });
        await enqueue(tx, bot, "NOTIFY", key, { notificationId: n.id });
        await tx.audit.create({
          data: {
            tenantId: bot.tenantId,
            actorId: member.telegramId.toString(),
            action: "SUBSCRIPTION_CANCELED",
            target: s.id,
            reason: "Subscriber requested cancellation",
            result: { confirmed: true },
          },
        });
      });
      return;
    }
    case "REFUND": {
      const r = await db.refund.findFirst({
        where: { id: p.refundId, tenantId: bot.tenantId, botId: bot.id },
      });
      requireThat(r, 404, "Refund not found");
      if (r.status === "CONFIRMED") return;
      if (r.status !== "REQUESTED") {
        await locked(bot.id, (tx) =>
          incident(
            tx,
            bot,
            "UNCERTAIN_REFUND",
            `uncertain:${r.id}`,
            "Refund API outcome is uncertain. Reconcile before any further financial action.",
          ),
        );
        throw new Error("Refund requires reconciliation");
      }
      const pay = await db.payment.findUniqueOrThrow({
        where: { botId_chargeId: { botId: bot.id, chargeId: r.chargeId } },
      });
      const s = await db.subscriber.findFirstOrThrow({
        where: { id: pay.subscriberId, tenantId: bot.tenantId, botId: bot.id },
      });
      const won = await db.refund.updateMany({
        where: { id: r.id, status: "REQUESTED" },
        data: { status: "API_REQUESTED" },
      });
      if (!won.count) return;
      await telegram(bot).call("refundStarPayment", {
        user_id: safeNumericId(s.telegramId),
        telegram_payment_charge_id: r.chargeId,
      });
      await locked(bot.id, (tx) =>
        confirmRefund(tx, bot, {
          currency: "XTR",
          total_amount: pay.stars,
          invoice_payload: pay.checkoutId,
          telegram_payment_charge_id: pay.chargeId,
        }),
      );
      return;
    }
    case "STARS":
      return reconcileStars(bot);
    default:
      throw new Error("Unknown durable job kind");
  }
}
export async function runOne() {
  const now = new Date();
  const eligible = {
    OR: [
      { status: "PENDING", nextAt: { lte: now } },
      { status: "RUNNING", leaseUntil: { lt: now } },
    ],
  };
  const candidate = await db.job.findFirst({
    where: eligible,
    orderBy: { nextAt: "asc" },
  });
  if (!candidate) return false;
  const lease = new Date(Date.now() + 120000);
  const token = crypto.randomUUID();
  const won = await db.job.updateMany({
    where: { id: candidate.id, ...eligible },
    data: {
      status: "RUNNING",
      leaseUntil: lease,
      leaseToken: token,
      attempts: { increment: 1 },
    },
  });
  if (!won.count) return true;
  const job = await db.job.findUniqueOrThrow({ where: { id: candidate.id } });
  const heartbeat = setInterval(
    () =>
      db.job
        .updateMany({
          where: { id: job.id, status: "RUNNING", leaseToken: token },
          data: { leaseUntil: new Date(Date.now() + 120000) },
        })
        .catch(() => {}),
    30000,
  );
  try {
    await dispatch(job);
    await db.job.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: token },
      data: {
        status: "DONE",
        leaseUntil: null,
        leaseToken: null,
        completedAt: new Date(),
        error: null,
      },
    });
  } catch (e) {
    const dead = job.attempts >= 8;
    const delay =
      e instanceof TelegramError && e.retryAfter
        ? e.retryAfter * 1000
        : Math.min(300000, 1000 * 2 ** job.attempts);
    const error =
      e instanceof TelegramError
        ? e.message
        : "Operation failed; inspect scoped incident and provider configuration";
    await db.job.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: token },
      data: {
        status: dead ? "DEAD" : "PENDING",
        leaseUntil: null,
        leaseToken: null,
        nextAt: new Date(Date.now() + delay + Math.floor(Math.random() * 500)),
        error,
      },
    });
    if (dead) {
      const bot = await db.bot.findUnique({ where: { id: job.botId } });
      if (bot)
        await locked(bot.id, (tx) =>
          incident(
            tx,
            bot,
            "DEAD_JOB",
            `dead:${job.id}`,
            `${job.kind} exhausted retries; repair configuration before replay.`,
          ),
        );
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export async function sweep(now = new Date()) {
  const bots = await db.bot.findMany({
    where: { status: { not: "DISCONNECTED" } },
  });
  const bucket = Math.floor(now.getTime() / 60000);
  for (const bot of bots) {
    for (let skip = 0; ; skip += 200) {
      const subscribers = await db.subscriber.findMany({
        where: { botId: bot.id, tenantId: bot.tenantId },
        take: 200,
        skip,
        orderBy: { id: "asc" },
      });
      for (const subscriber of subscribers)
        await db.$transaction((tx) =>
          enqueue(
            tx,
            bot,
            "ACCESS",
            `sweep:${bot.id}:${subscriber.id}:${bucket}`,
            { subscriberId: subscriber.id },
          ),
        );
      if (subscribers.length < 200) break;
    }
    await db.$transaction((tx) =>
      enqueue(
        tx,
        bot,
        "STARS",
        `stars:${bot.id}:${Math.floor(bucket / 15)}`,
        {},
      ),
    );
    const payments = await db.payment.findMany({
      where: {
        botId: bot.id,
        periodEnd: {
          gte: new Date(now.getTime() - DAY),
          lte: new Date(now.getTime() + 3 * DAY),
        },
      },
    });
    for (const payment of payments) {
      const s = await db.subscriber.findFirstOrThrow({
        where: { id: payment.subscriberId, tenantId: bot.tenantId },
      });
      if (!s.reminders || !s.contacted) continue;
      if (
        await db.refund.count({
          where: {
            botId: bot.id,
            chargeId: payment.chargeId,
            status: "CONFIRMED",
          },
        })
      )
        continue;
      // Do not send obsolete reminders when a later paid period covers the same plan.
      if (
        await db.payment.count({
          where: {
            botId: bot.id,
            subscriberId: s.id,
            versionId: payment.versionId,
            periodEnd: { gt: payment.periodEnd },
          },
        })
      )
        continue;
      const remaining = payment.periodEnd.getTime() - now.getTime();
      const window =
        remaining <= 0 ? "expired" : remaining <= DAY ? "1d" : "3d";
      const key = `reminder:${payment.id}:${window}`;
      await db.$transaction(async (tx) => {
        const n = await tx.notification.upsert({
          where: { key },
          create: {
            tenantId: bot.tenantId,
            botId: bot.id,
            subscriberId: s.id,
            key,
            text: `Membership ${window === "expired" ? "period ended" : "paid through"} ${payment.periodEnd.toISOString()}. ${payment.recurring ? "Auto-renewal only extends access after a successful Stars charge." : "Prepaid membership does not auto-renew."} Use /status, /renew or /paysupport. /quiet disables reminders.`,
          },
          update: {},
        });
        await enqueue(tx, bot, "NOTIFY", key, { notificationId: n.id });
      });
    }
  }
  const orphaned = await db.inbox.findMany({
    where: { status: "PENDING" },
    take: 200,
    orderBy: { createdAt: "asc" },
  });
  for (const inbox of orphaned)
    await db.$transaction((tx) =>
      enqueue(
        tx,
        { id: inbox.botId, tenantId: inbox.tenantId },
        "INBOX",
        `inbox:${inbox.id}`,
        { inboxId: inbox.id },
      ),
    );
  // Retain immutable money/audit facts. Minimize processed raw event data only.
  const retention = new Date(now.getTime() - config.INBOX_RETENTION_DAYS * DAY);
  await db.inbox.updateMany({
    where: { status: "DONE", createdAt: { lt: retention } },
    data: { body: { redacted: true } },
  });
  await db.authAttempt.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
}
