import type { Bot, Job } from "@prisma/client";
import { db, locked, type Tx } from "../../db/src";
import { entitled, requireThat, safeNumericId } from "../../domain/src";
import { telegram } from "../../telegram/src";
import { enqueue, incident } from "./payments";
import { verifyChat } from "./setup";
import { owner, type Actor } from "./auth";
export async function hasAccess(
  tx: Tx,
  bot: Bot,
  subscriberId: string,
  chatId: string,
  now = new Date(),
) {
  return (
    (await tx.grant.count({
      where: {
        tenantId: bot.tenantId,
        botId: bot.id,
        subscriberId,
        chatId,
        revokedAt: null,
        startsAt: { lte: now },
        expiresAt: { gt: now },
      },
    })) > 0
  );
}
export async function reconcileSubscriber(bot: Bot, subscriberId: string) {
  const subscriber = await db.subscriber.findFirst({
    where: { id: subscriberId, tenantId: bot.tenantId, botId: bot.id },
  });
  requireThat(subscriber, 404, "Subscriber not found in bot scope");
  const chats = await db.chat.findMany({
    where: { tenantId: bot.tenantId, botId: bot.id },
  });
  for (const chat of chats)
    await locked(bot.id, async (tx) => {
      const api = telegram(bot);
      const m = await tx.membership.upsert({
        where: { chatId_subscriberId: { chatId: chat.id, subscriberId } },
        create: {
          tenantId: bot.tenantId,
          botId: bot.id,
          chatId: chat.id,
          subscriberId,
        },
        update: {},
      });
      const desired = await hasAccess(tx, bot, subscriberId, chat.id);
      try {
        await verifyChat(bot, chat.telegramId);
      } catch (e) {
        await tx.chat.update({
          where: { id: chat.id },
          data: { healthy: false, checkedAt: new Date() },
        });
        await tx.bot.update({
          where: { id: bot.id },
          data: { status: "DEGRADED" },
        });
        await tx.membership.update({
          where: { id: m.id },
          data: { desired: "ERROR_NEEDS_OPERATOR" },
        });
        await incident(
          tx,
          bot,
          "PERMISSION_LOSS",
          `permissions:${chat.id}`,
          "Re-add the bot as administrator with invite/restrict rights and verify the private chat.",
        );
        return;
      }
      const current = await api.call("getChatMember", {
        chat_id: safeNumericId(chat.telegramId),
        user_id: safeNumericId(subscriber.telegramId),
      });
      const protectedUser =
        ["creator", "administrator"].includes(current.status) ||
        (await tx.tenantMember.count({
          where: {
            tenantId: bot.tenantId,
            role: "OWNER",
            user: { telegramId: subscriber.telegramId },
          },
        })) > 0;
      const present =
        ["creator", "administrator", "member"].includes(current.status) ||
        (current.status === "restricted" && current.is_member === true);
      const data: {
        observed: string;
        desired: string;
        observedAt: Date;
        platformBan?: boolean;
        invite?: string | null;
        inviteExpiresAt?: Date | null;
      } = {
        observed: current.status,
        desired: desired ? "ENTITLED_PENDING_JOIN" : "NOT_ENTITLED",
        observedAt: new Date(),
      };
      if (desired) {
        if (current.status === "kicked") {
          if (!m.platformBan) {
            data.desired = "MODERATOR_BLOCKED";
            await incident(
              tx,
              bot,
              "MODERATOR_BAN",
              `moderation:${chat.id}:${subscriberId}`,
              "Independent or ambiguous ban. Creator must review; automation will not unban.",
            );
            await tx.membership.update({ where: { id: m.id }, data });
            return;
          }
          await api.call("unbanChatMember", {
            chat_id: safeNumericId(chat.telegramId),
            user_id: safeNumericId(subscriber.telegramId),
            only_if_banned: true,
          });
          data.platformBan = false;
          await tx.accessOperation.create({
            data: {
              tenantId: bot.tenantId,
              botId: bot.id,
              chatId: chat.id,
              subscriberId,
              kind: "UNBAN",
              status: "SUCCEEDED",
              result: "Confirmed platform-owned ban lifted",
              completedAt: new Date(),
            },
          });
        }
        if (present) data.desired = "ACTIVE_MEMBER";
        else if (
          !m.invite ||
          !m.inviteExpiresAt ||
          m.inviteExpiresAt < new Date()
        ) {
          const expires = new Date(Date.now() + 600000);
          const link = await api.call("createChatInviteLink", {
            chat_id: safeNumericId(chat.telegramId),
            creates_join_request: true,
            expire_date: Math.floor(expires.getTime() / 1000),
            name: `TeleTier ${subscriber.telegramId}`.slice(0, 32),
          });
          data.invite = link.invite_link;
          data.inviteExpiresAt = expires;
          const notification = await tx.notification.create({
            data: {
              tenantId: bot.tenantId,
              botId: bot.id,
              subscriberId,
              key: `invite:${m.id}:${expires.getTime()}`,
              text: `Your paid access is ready to join: ${link.invite_link}\nJoin with the Telegram account that made the purchase. Access remains pending until membership is confirmed.`,
            },
          });
          await enqueue(tx, bot, "NOTIFY", notification.key, {
            notificationId: notification.id,
          });
        }
      } else if (!protectedUser && present) {
        // A crash after a successful ban rolls this transaction back. Without a matching
        // chat_member event proving the bot actor, a later kicked observation is treated
        // as ambiguous and never automatically unbanned.
        await api.call("banChatMember", {
          chat_id: safeNumericId(chat.telegramId),
          user_id: safeNumericId(subscriber.telegramId),
          revoke_messages: false,
        });
        data.platformBan = true;
        data.observed = "kicked";
        data.desired = "REVOKED_BY_PLATFORM";
        data.invite = null;
        data.inviteExpiresAt = null;
        await tx.accessOperation.create({
          data: {
            tenantId: bot.tenantId,
            botId: bot.id,
            chatId: chat.id,
            subscriberId,
            kind: "BAN",
            status: "SUCCEEDED",
            result: "Telegram confirmed expiry ban",
            completedAt: new Date(),
          },
        });
      } else if (protectedUser) data.desired = "PROTECTED_ADMIN";
      else if (current.status === "kicked")
        data.desired = m.platformBan
          ? "REVOKED_BY_PLATFORM"
          : "MODERATOR_BLOCKED";
      await tx.membership.update({ where: { id: m.id }, data });
    });
}
export async function joinRequest(
  tx: Tx,
  bot: Bot,
  request: any,
  updateId: bigint,
) {
  requireThat(
    Number.isSafeInteger(request.from?.id) &&
      Number.isSafeInteger(request.chat?.id),
    400,
    "Invalid join identity",
  );
  const chat = await tx.chat.findFirst({
    where: {
      telegramId: BigInt(request.chat.id),
      tenantId: bot.tenantId,
      botId: bot.id,
    },
  });
  if (!chat) return;
  const subscriber = await tx.subscriber.findUnique({
    where: {
      botId_telegramId: { botId: bot.id, telegramId: BigInt(request.from.id) },
    },
  });
  const allowed =
    subscriber && (await hasAccess(tx, bot, subscriber.id, chat.id));
  await enqueue(tx, bot, "JOIN", `join:${bot.id}:${updateId}`, {
    chatId: chat.id,
    telegramUserId: String(request.from.id),
    subscriberId: subscriber?.id ?? null,
    approved: !!allowed,
  });
}
export async function processJoin(bot: Bot, payload: any) {
  const chat = await db.chat.findFirst({
    where: { id: payload.chatId, tenantId: bot.tenantId, botId: bot.id },
  });
  requireThat(chat, 404, "Chat not found");
  await locked(bot.id, async (tx) => {
    const s = payload.subscriberId
      ? await tx.subscriber.findFirst({
          where: {
            id: payload.subscriberId,
            botId: bot.id,
            tenantId: bot.tenantId,
          },
        })
      : null;
    const allowed =
      s &&
      s.telegramId.toString() === payload.telegramUserId &&
      (await hasAccess(tx, bot, s.id, chat.id));
    if (allowed) await verifyChat(bot, chat.telegramId);
    const method = allowed
      ? "approveChatJoinRequest"
      : "declineChatJoinRequest";
    await telegram(bot).call(method, {
      chat_id: safeNumericId(chat.telegramId),
      user_id: safeNumericId(payload.telegramUserId),
    });
    if (s) {
      // Approval is an operation result, never a fabricated member observation.
      await tx.accessOperation.create({
        data: {
          tenantId: bot.tenantId,
          botId: bot.id,
          subscriberId: s.id,
          chatId: chat.id,
          kind: allowed ? "APPROVE_JOIN" : "DECLINE_JOIN",
          status: "SUCCEEDED",
          result: "Telegram confirmed request operation",
          completedAt: new Date(),
        },
      });
      await enqueue(tx, bot, "ACCESS", `join-observe:${crypto.randomUUID()}`, {
        subscriberId: s.id,
      });
    }
  });
}
export async function observeMember(
  tx: Tx,
  bot: Bot,
  event: any,
  updateId: bigint,
) {
  requireThat(
    Number.isSafeInteger(event.chat?.id) &&
      Number.isSafeInteger(event.new_chat_member?.user?.id),
    400,
    "Invalid membership identity",
  );
  const chat = await tx.chat.findFirst({
    where: {
      tenantId: bot.tenantId,
      botId: bot.id,
      telegramId: BigInt(event.chat.id),
    },
  });
  if (!chat) return;
  const subscriber = await tx.subscriber.upsert({
    where: {
      botId_telegramId: {
        botId: bot.id,
        telegramId: BigInt(event.new_chat_member.user.id),
      },
    },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      telegramId: BigInt(event.new_chat_member.user.id),
      name: String(event.new_chat_member.user.first_name ?? "Member").slice(
        0,
        100,
      ),
    },
    update: {},
  });
  const m = await tx.membership.upsert({
    where: {
      chatId_subscriberId: { chatId: chat.id, subscriberId: subscriber.id },
    },
    create: {
      tenantId: bot.tenantId,
      botId: bot.id,
      chatId: chat.id,
      subscriberId: subscriber.id,
    },
    update: {},
  });
  if (updateId <= m.observationUpdateId) return;
  const status = String(event.new_chat_member.status);
  const platformActor =
    Number.isSafeInteger(event.from?.id) &&
    BigInt(event.from.id) === bot.telegramId;
  await tx.membership.update({
    where: { id: m.id },
    data: {
      observed: status,
      observedAt: new Date(event.date * 1000),
      observationUpdateId: updateId,
      ...(status === "kicked"
        ? { platformBan: platformActor }
        : { platformBan: false }),
    },
  });
  await enqueue(tx, bot, "ACCESS", `observed:${bot.id}:${updateId}`, {
    subscriberId: subscriber.id,
  });
}
export async function manualGrant(
  actor: Actor,
  subscriberId: string,
  input: { chatId: string; expiresAt: Date; reason: string },
) {
  owner(actor);
  const bot = await db.bot.findUnique({ where: { tenantId: actor.tenantId } });
  requireThat(bot, 404, "Bot not found");
  return locked(bot.id, async (tx) => {
    requireThat(
      (await tx.subscriber.count({
        where: { id: subscriberId, tenantId: actor.tenantId, botId: bot.id },
      })) === 1,
      404,
      "Subscriber not found",
    );
    requireThat(
      (await tx.chat.count({
        where: { id: input.chatId, tenantId: actor.tenantId, botId: bot.id },
      })) === 1,
      404,
      "Chat not found",
    );
    const grant = await tx.grant.create({
      data: {
        tenantId: actor.tenantId,
        botId: bot.id,
        subscriberId,
        chatId: input.chatId,
        startsAt: new Date(),
        expiresAt: input.expiresAt,
        reason: input.reason,
      },
    });
    await tx.audit.create({
      data: {
        tenantId: actor.tenantId,
        actorId: actor.userId,
        action: "MANUAL_GRANT",
        target: grant.id,
        reason: input.reason,
        result: { expiresAt: input.expiresAt.toISOString() },
      },
    });
    await enqueue(tx, bot, "ACCESS", `manual:${grant.id}`, { subscriberId });
    return grant;
  });
}
