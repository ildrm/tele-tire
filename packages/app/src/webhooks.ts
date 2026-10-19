import { z } from "zod";
import type { Bot } from "@prisma/client";
import { db, json, locked } from "../../db/src";
import { requireThat } from "../../domain/src";
import { equalHash } from "./secrets";
import {
  enqueue,
  incident,
  precheckout,
  recordPayment,
  confirmRefund,
} from "./payments";
import { joinRequest, observeMember } from "./access";
import { botCommand } from "./bot";
const updateSchema = z
  .object({ update_id: z.number().int().nonnegative().safe() })
  .passthrough();
export async function receiveWebhook(
  endpoint: string,
  secret: string,
  raw: unknown,
) {
  const body = updateSchema.parse(raw);
  const { bot, inbox } = await db.$transaction(
    async (tx) => {
      const bot = await tx.bot.findUnique({ where: { endpoint } });
      requireThat(
        bot &&
          bot.status !== "DISCONNECTED" &&
          equalHash(secret, bot.secretHash),
        401,
        "Invalid webhook credentials",
      );
      // Receipt is durable before acknowledgement; duplicate delivery reuses the same inbox.
      await tx.inbox.createMany({
        data: [
          {
            tenantId: bot.tenantId,
            botId: bot.id,
            updateId: BigInt(body.update_id),
            body: json(body),
          },
        ],
        skipDuplicates: true,
      });
      const inbox = await tx.inbox.findUniqueOrThrow({
        where: {
          botId_updateId: { botId: bot.id, updateId: BigInt(body.update_id) },
        },
      });
      return { bot, inbox };
    },
    { timeout: body.pre_checkout_query ? 1500 : 5000, maxWait: 300 },
  );
  if (body.pre_checkout_query) {
    await precheckout(bot, body.pre_checkout_query);
    await db.inbox.update({
      where: { id: inbox.id },
      data: { status: "DONE", processedAt: new Date() },
    });
  } else
    await db.$transaction((tx) =>
      enqueue(tx, bot, "INBOX", `inbox:${inbox.id}`, { inboxId: inbox.id }),
    );
  return { ok: true };
}
export async function processInbox(bot: Bot, id: string) {
  await locked(bot.id, async (tx) => {
    const inbox = await tx.inbox.findFirst({
      where: { id, botId: bot.id, tenantId: bot.tenantId },
    });
    requireThat(inbox, 404, "Inbox not found");
    if (inbox.status === "DONE") return;
    const body = inbox.body as any;
    // Pure validation failures are quarantined; transient DB failures roll back and retry.
    try {
      const m = body.message;
      if (m?.successful_payment) {
        requireThat(
          m.chat?.type === "private" &&
            m.from?.id === m.chat?.id &&
            Number.isSafeInteger(m.from?.id) &&
            Number.isSafeInteger(m.date),
          400,
          "Invalid payment message identity",
        );
        await recordPayment(
          tx,
          bot,
          m.successful_payment,
          BigInt(m.from.id),
          new Date(m.date * 1000),
          inbox.updateId,
        );
      } else if (m?.refunded_payment)
        await confirmRefund(tx, bot, m.refunded_payment);
      else if (body.chat_join_request)
        await joinRequest(tx, bot, body.chat_join_request, inbox.updateId);
      else if (body.chat_member)
        await observeMember(tx, bot, body.chat_member, inbox.updateId);
      else if (body.my_chat_member) {
        const event = body.my_chat_member;
        const status = event.new_chat_member?.status;
        const good =
          status === "administrator" &&
          event.new_chat_member.can_invite_users &&
          event.new_chat_member.can_restrict_members;
        if (!good) {
          await tx.bot.update({
            where: { id: bot.id },
            data: { status: "DEGRADED" },
          });
          if (Number.isSafeInteger(event.chat?.id))
            await tx.chat.updateMany({
              where: {
                botId: bot.id,
                tenantId: bot.tenantId,
                telegramId: BigInt(event.chat.id),
              },
              data: { healthy: false },
            });
          await incident(
            tx,
            bot,
            "PERMISSION_LOSS",
            `permission-update:${inbox.updateId}`,
            "Bot lost required admin rights. Restore rights and run health check.",
          );
        }
      } else await botCommand(tx, bot, body, inbox.updateId);
      await tx.inbox.update({
        where: { id },
        data: { status: "DONE", processedAt: new Date(), error: null },
      });
    } catch (e) {
      if (!(e instanceof z.ZodError) && !(e instanceof Error && "status" in e))
        throw e;
      const detail =
        "Update failed domain validation; investigate in scoped database inbox. No unverified entitlement was issued.";
      await incident(tx, bot, "INVALID_UPDATE", `inbox:${id}`, detail);
      await tx.inbox.update({
        where: { id },
        data: { status: "QUARANTINED", error: detail },
      });
    }
  });
}
