import { z } from "zod";
import { db, json, locked } from "../../db/src";
import {
  chatTelegramId,
  planInput,
  policyInput,
  requireThat,
  safeNumericId,
} from "../../domain/src";
import {
  FakeTelegram,
  HttpTelegram,
  telegram,
  type Telegram,
} from "../../telegram/src";
import { config } from "./config";
import { encrypt, hash, nonce } from "./secrets";
import { owner, type Actor } from "./auth";
import type { Bot } from "@prisma/client";
export async function audit(
  actor: Actor,
  action: string,
  target: string,
  reason: string,
  result: unknown = {},
) {
  return db.audit.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action,
      target,
      reason,
      result: json(result),
    },
  });
}
export async function connectBot(actor: Actor, input: unknown) {
  owner(actor);
  const { token } = z
    .object({ token: z.string().regex(/^\d{5,16}:[A-Za-z0-9_-]{20,100}$/) })
    .parse(input);
  const api: Telegram = config.TELEGRAM_FAKE
    ? new FakeTelegram(Number(token.split(":")[0]), Number(actor.telegramId))
    : new HttpTelegram(token, config.TELEGRAM_ENV === "test");
  const me = await api.call("getMe");
  requireThat(
    me.is_bot && Number.isSafeInteger(me.id),
    400,
    "Token is not a supported bot",
  );
  requireThat(
    String(me.id) !== config.OIDC_CLIENT_ID,
    400,
    "Use a separate creator bot; the platform login bot cannot collect memberships",
  );
  const existing = await db.bot.findUnique({
    where: { tenantId: actor.tenantId },
  });
  const duplicate = await db.bot.findUnique({
    where: { telegramId: BigInt(me.id) },
  });
  requireThat(
    !duplicate || duplicate.tenantId === actor.tenantId,
    409,
    "This bot is already registered",
  );
  requireThat(
    !existing || existing.telegramId === BigInt(me.id),
    409,
    "Disconnect the existing bot before choosing a different bot; outstanding memberships require a migration plan",
  );
  const info = await api.call("getWebhookInfo");
  const values = {
    telegramId: BigInt(me.id),
    username: String(me.username),
    tokenCipher: encrypt(token, actor.tenantId),
    keyVersion: config.TOKEN_KEY_VERSION,
    status: "TOKEN_VERIFIED",
    checkedAt: new Date(),
  };
  const bot = await db.bot.upsert({
    where: { tenantId: actor.tenantId },
    create: {
      tenantId: actor.tenantId,
      ...values,
      endpoint: nonce(),
      secretHash: hash(nonce()),
    },
    update: values,
  });
  await audit(
    actor,
    existing ? "BOT_TOKEN_ROTATED" : "BOT_TOKEN_VERIFIED",
    bot.id,
    "Creator supplied bot token",
    { hasExistingWebhook: !!info.url },
  );
  return {
    id: bot.id,
    username: bot.username,
    status: bot.status,
    existingWebhook: !!info.url,
  };
}
export async function configureWebhook(actor: Actor, input: unknown) {
  owner(actor);
  z.object({ confirm: z.literal(true) }).parse(input);
  const bot = await db.bot.findUnique({ where: { tenantId: actor.tenantId } });
  requireThat(bot, 404, "Connect a bot first");
  const secret = nonce(),
    url = `${config.PUBLIC_WEBHOOK_ORIGIN}/api/webhooks/${bot.endpoint}`;
  requireThat(url.startsWith("https:"), 400, "Public webhook must use HTTPS");
  // Rotate the verifier before changing the provider; uncertain outcomes remain DEGRADED.
  await db.bot.update({
    where: { id: bot.id },
    data: { secretHash: hash(secret), status: "DEGRADED", webhookUrl: url },
  });
  await telegram(bot).call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: [
      "message",
      "callback_query",
      "pre_checkout_query",
      "chat_join_request",
      "chat_member",
      "my_chat_member",
    ],
    drop_pending_updates: false,
  });
  const info = await telegram(bot).call("getWebhookInfo");
  requireThat(
    info.url === url,
    502,
    "Telegram webhook could not be verified; retry setup",
  );
  await db.bot.update({
    where: { id: bot.id },
    data: { status: "WEBHOOK_ACTIVE", checkedAt: new Date() },
  });
  await audit(
    actor,
    "WEBHOOK_CONFIGURED",
    bot.id,
    "Creator confirmed webhook handover",
    { verified: true },
  );
  return healthBot(actor);
}
export async function verifyChat(bot: Bot, chatId: bigint, creatorId?: bigint) {
  const api = telegram(bot);
  const chat = await api.call("getChat", { chat_id: safeNumericId(chatId) });
  requireThat(
    ["channel", "supergroup"].includes(chat.type) &&
      !chat.username &&
      !chat.active_usernames?.length,
    400,
    "Only private channels and supergroups are eligible. Remove public usernames first.",
  );
  const botMember = await api.call("getChatMember", {
    chat_id: safeNumericId(chatId),
    user_id: safeNumericId(bot.telegramId),
  });
  requireThat(
    botMember.status === "administrator" &&
      botMember.can_invite_users &&
      botMember.can_restrict_members,
    400,
    "Give the bot Invite Users and Ban/Restrict Members admin rights",
  );
  if (creatorId) {
    const creator = await api.call("getChatMember", {
      chat_id: safeNumericId(chatId),
      user_id: safeNumericId(creatorId),
    });
    requireThat(
      ["creator", "administrator"].includes(creator.status),
      403,
      "Your verified Telegram account must own or administer this chat",
    );
  }
  return chat;
}
export async function enrollChat(actor: Actor, input: unknown) {
  owner(actor);
  const data = z.object({ telegramId: chatTelegramId }).parse(input);
  const bot = await db.bot.findUnique({ where: { tenantId: actor.tenantId } });
  requireThat(bot, 404, "Connect a bot first");
  requireThat(
    ["WEBHOOK_ACTIVE", "READY"].includes(bot.status),
    409,
    "Configure and verify the webhook first",
  );
  const chat = await verifyChat(bot, BigInt(data.telegramId), actor.telegramId);
  const old = await db.chat.findUnique({
    where: { telegramId: BigInt(data.telegramId) },
  });
  requireThat(
    !old || old.tenantId === actor.tenantId,
    409,
    "Chat is controlled by another workspace",
  );
  const saved = await db.chat.upsert({
    where: { telegramId: BigInt(data.telegramId) },
    create: {
      tenantId: actor.tenantId,
      botId: bot.id,
      telegramId: BigInt(data.telegramId),
      title: chat.title,
      type: chat.type,
      healthy: true,
    },
    update: { title: chat.title, healthy: true, checkedAt: new Date() },
  });
  await db.bot.update({ where: { id: bot.id }, data: { status: "READY" } });
  await audit(
    actor,
    "CHAT_ENROLLED",
    saved.id,
    "Private chat authority and bot rights verified",
  );
  return saved;
}
export async function healthBot(actor: Actor) {
  const bot = await db.bot.findUnique({ where: { tenantId: actor.tenantId } });
  requireThat(bot, 404, "Connect a bot first");
  let healthy = bot.status !== "DISCONNECTED",
    webhook = false;
  try {
    const info = await telegram(bot).call("getWebhookInfo");
    webhook = !!bot.webhookUrl && info.url === bot.webhookUrl;
    healthy = healthy && webhook;
  } catch {
    healthy = false;
  }
  const chats = await db.chat.findMany({ where: { tenantId: actor.tenantId } });
  for (const chat of chats) {
    let valid = true;
    try {
      await verifyChat(bot, chat.telegramId);
    } catch {
      valid = false;
    }
    await db.chat.update({
      where: { id: chat.id },
      data: { healthy: valid, checkedAt: new Date() },
    });
    healthy = healthy && valid;
  }
  const status = healthy
    ? chats.length
      ? "READY"
      : "WEBHOOK_ACTIVE"
    : "DEGRADED";
  await db.bot.update({
    where: { id: bot.id },
    data: { status, checkedAt: new Date() },
  });
  await audit(
    actor,
    "BOT_HEALTH_CHECK",
    bot.id,
    "Requested current webhook and chat permission checks",
    { status },
  );
  return { status, webhookVerified: webhook };
}
export async function createPolicy(actor: Actor, input: unknown) {
  owner(actor);
  const values = policyInput.parse(input);
  const result = await db.policy.create({
    data: { tenantId: actor.tenantId, ...values },
  });
  await audit(
    actor,
    "POLICY_PUBLISHED",
    result.id,
    "New immutable purchase policy version",
  );
  return result;
}
export async function savePlan(actor: Actor, input: unknown, id?: string) {
  owner(actor);
  const values = planInput.parse(input);
  return db.$transaction(async (tx) => {
    requireThat(
      (await tx.policy.count({
        where: { tenantId: actor.tenantId, id: values.policyId },
      })) === 1,
      404,
      "Publish a purchase policy first",
    );
    requireThat(
      (await tx.chat.count({
        where: {
          tenantId: actor.tenantId,
          id: { in: values.chatIds },
          healthy: true,
        },
      })) === values.chatIds.length,
      400,
      "Select verified chats from this workspace",
    );
    if (id)
      requireThat(
        (await tx.plan.count({ where: { id, tenantId: actor.tenantId } })) ===
          1,
        404,
        "Plan not found",
      );
    const planId = id ?? crypto.randomUUID(),
      versionId = crypto.randomUUID();
    await tx.plan.upsert({
      where: { id: planId },
      create: {
        id: planId,
        tenantId: actor.tenantId,
        name: values.name,
        currentVersionId: versionId,
      },
      update: { name: values.name, currentVersionId: versionId },
    });
    await tx.planVersion.create({
      data: { id: versionId, tenantId: actor.tenantId, planId, ...values },
    });
    await tx.audit.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: id ? "PLAN_VERSIONED" : "PLAN_CREATED",
        target: planId,
        reason: "Immutable product and chat snapshot",
        result: { versionId },
      },
    });
    return tx.plan.findUniqueOrThrow({ where: { id: planId } });
  });
}
