import type { Bot, Subscriber } from "@prisma/client";
import { db, locked, type Tx } from "../../db/src";
import { AppError, label, requireThat, safeNumericId } from "../../domain/src";
import { enqueue, prepareCheckout } from "./payments";
import { nonce } from "./secrets";
export async function message(
  tx: Tx,
  bot: Bot,
  subscriber: Subscriber,
  text: string,
  key: string,
  markup?: unknown,
) {
  const n = await tx.notification.upsert({
    where: { key },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      subscriberId: subscriber.id,
      key,
      text,
    },
    update: {},
  });
  await enqueue(tx, bot, "NOTIFY", key, {
    notificationId: n.id,
    ...(markup ? { markup } : {}),
  });
}
export async function cancelSubscriptions(
  tx: Tx,
  bot: Bot,
  subscriber: Subscriber,
  key: string,
) {
  const subscriptions = await tx.subscription.findMany({
    where: {
      botId: bot.id,
      tenantId: bot.tenantId,
      subscriberId: subscriber.id,
      canceled: false,
    },
  });
  for (const s of subscriptions)
    await enqueue(tx, bot, "CANCEL", `cancel:${s.id}`, {
      subscriptionId: s.id,
    });
  await message(
    tx,
    bot,
    subscriber,
    subscriptions.length
      ? "Cancellation requested. We will confirm when Telegram accepts. Paid access remains until its paid-through date."
      : "No active auto-renewal found. Prepaid memberships do not renew automatically.",
    key,
  );
}
export async function botCommand(
  tx: Tx,
  bot: Bot,
  body: any,
  updateId: bigint,
) {
  const m = body.callback_query?.message ?? body.message;
  const from = body.callback_query?.from ?? body.message?.from;
  if (
    !from ||
    !Number.isSafeInteger(from.id) ||
    from.is_bot ||
    m?.chat?.type !== "private" ||
    m.chat.id !== from.id
  )
    return;
  const subscriber = await tx.subscriber.upsert({
    where: { botId_telegramId: { botId: bot.id, telegramId: BigInt(from.id) } },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      telegramId: BigInt(from.id),
      name: String(from.first_name ?? "Member").slice(0, 100),
      contacted: true,
    },
    update: {
      contacted: true,
      name: String(from.first_name ?? "Member").slice(0, 100),
    },
  });
  const key = `bot:${bot.id}:${updateId}`;
  const policies = await tx.policy.findMany({
    where: { tenantId: bot.tenantId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const policy = policies[0];
  const data = body.callback_query?.data as string | undefined;
  if (data) {
    await enqueue(tx, bot, "CALLBACK", `${key}:answer`, {
      callbackId: body.callback_query.id,
    });
    const [action, id] = data.split(":");
    if (action === "offer") {
      const plan = await tx.plan.findFirst({
        where: { id, tenantId: bot.tenantId, state: "ACTIVE" },
      });
      if (!plan)
        return message(
          tx,
          bot,
          subscriber,
          "This plan is unavailable. Open /plans.",
          key,
        );
      const v = await tx.planVersion.findFirstOrThrow({
        where: { id: plan.currentVersionId, tenantId: bot.tenantId },
      });
      const p = await tx.policy.findFirstOrThrow({
        where: { id: v.policyId, tenantId: bot.tenantId },
      });
      const offer = await tx.offer.create({
        data: {
          id: nonce(),
          tenantId: bot.tenantId,
          botId: bot.id,
          subscriberId: subscriber.id,
          versionId: v.id,
          policyId: p.id,
          expiresAt: new Date(Date.now() + 900000),
        },
      });
      return message(
        tx,
        bot,
        subscriber,
        `${v.name}\n${v.stars} Stars · ${label(v.kind)}\n\nTerms (${p.id}): ${p.terms}\n\nRefunds: ${p.refunds}\nSupport: ${p.support}\nPrivacy: ${p.privacy}\n\nAccept these terms to create your invoice.`,
        key,
        {
          inline_keyboard: [
            [
              {
                text: "Accept terms & continue",
                callback_data: `agree:${offer.id}`,
              },
            ],
          ],
        },
      );
    }
    if (action === "agree") {
      try {
        const offer = await tx.offer.findFirst({
          where: {
            id,
            botId: bot.id,
            tenantId: bot.tenantId,
            subscriberId: subscriber.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        requireThat(
          offer,
          400,
          "This purchase offer expired or belongs to another account. Open /plans to review and accept the current terms.",
        );
        await prepareCheckout(tx, bot, subscriber, offer.versionId);
        await tx.offer.update({
          where: { id: offer.id },
          data: { consumedAt: new Date() },
        });
      } catch (e) {
        if (e instanceof AppError)
          return message(tx, bot, subscriber, e.message, key);
        throw e;
      }
    }
    return;
  }
  const text = String(m?.text ?? "");
  const [command, arg] = text.split(/\s+/);
  if (command === "/start" && arg?.startsWith("p_")) {
    const plan = await tx.plan.findFirst({
      where: { id: arg.slice(2), tenantId: bot.tenantId, state: "ACTIVE" },
    });
    if (plan)
      return message(
        tx,
        bot,
        subscriber,
        "View the plan, Stars price and purchase terms before paying.",
        key,
        {
          inline_keyboard: [
            [{ text: plan.name, callback_data: `offer:${plan.id}` }],
          ],
        },
      );
  }
  if (["/start", "/plans", "/renew"].includes(command!)) {
    const plans = await tx.plan.findMany({
      where: { tenantId: bot.tenantId, state: "ACTIVE" },
      take: 30,
      orderBy: { createdAt: "asc" },
    });
    return message(
      tx,
      bot,
      subscriber,
      plans.length
        ? "Choose a membership. Prices are in Telegram Stars. Review terms before paying."
        : "No plans are available yet. Contact /support.",
      key,
      {
        inline_keyboard: plans.map((p) => [
          { text: p.name, callback_data: `offer:${p.id}` },
        ]),
      },
    );
  }
  if (command === "/status") {
    const grants = await tx.grant.findMany({
      where: {
        tenantId: bot.tenantId,
        subscriberId: subscriber.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    const memberships = await tx.membership.findMany({
      where: { tenantId: bot.tenantId, subscriberId: subscriber.id },
    });
    await enqueue(tx, bot, "ACCESS", `${key}:retry`, {
      subscriberId: subscriber.id,
    });
    return message(
      tx,
      bot,
      subscriber,
      `${grants.length ? `Paid/granted through ${new Date(Math.max(...grants.map((g) => g.expiresAt.getTime()))).toISOString()}` : "No current access grant."}\n${memberships.map((m) => `Access: ${m.desired}; observed: ${m.observed}${m.invite && m.inviteExpiresAt && m.inviteExpiresAt > new Date() ? `\nJoin: ${m.invite}` : ""}`).join("\n")}\nUse /renew for plans, /cancel for auto-renewal, /support for help.`,
      key,
    );
  }
  if (command === "/cancel")
    return cancelSubscriptions(tx, bot, subscriber, key);
  if (command === "/quiet" || command === "/reminders") {
    await tx.subscriber.update({
      where: { id: subscriber.id },
      data: { reminders: command === "/reminders" },
    });
    return message(
      tx,
      bot,
      subscriber,
      command === "/quiet"
        ? "Optional renewal reminders disabled. Purchase and payment support messages remain available."
        : "Renewal reminders enabled.",
      key,
    );
  }
  if (["/support", "/paysupport"].includes(command!))
    return message(
      tx,
      bot,
      subscriber,
      `Contact the creator for ${command === "/paysupport" ? "payment disputes and refund requests" : "support"}: ${policy?.support ?? "Creator has not configured support; please contact the community owner."}\nTelegram support cannot resolve this creator purchase. Include your charge receipt.`,
      key,
    );
  if (command === "/terms")
    return message(
      tx,
      bot,
      subscriber,
      policy
        ? `Terms ${policy.id}: ${policy.terms}\nRefunds: ${policy.refunds}\nSupport: ${policy.support}`
        : "No purchase policy has been published.",
      key,
    );
  if (command === "/privacy")
    return message(
      tx,
      bot,
      subscriber,
      policy
        ? `${policy.privacy}\nData requests: ${policy.support}`
        : "Contact the creator for privacy requests.",
      key,
    );
}
