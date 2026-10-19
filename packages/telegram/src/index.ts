import { config } from "../../app/src/config";
import type { Bot } from "@prisma/client";
import { decrypt } from "../../app/src/secrets";
export type Fields = Record<string, unknown>;
export interface Telegram {
  call<T = any>(method: string, fields?: Fields, timeout?: number): Promise<T>;
}
export class TelegramError extends Error {
  constructor(
    public code: number,
    public retryAfter = 0,
  ) {
    super(`Telegram request failed (${code})`);
  }
}
export class HttpTelegram implements Telegram {
  constructor(
    private token: string,
    private test = false,
  ) {}
  async call<T>(
    method: string,
    fields: Fields = {},
    timeout = 4000,
  ): Promise<T> {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/${this.test ? "test/" : ""}${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fields),
          signal: AbortSignal.timeout(timeout),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        result: T;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (!data.ok)
        throw new TelegramError(
          data.error_code ?? res.status,
          data.parameters?.retry_after ?? 0,
        );
      return data.result;
    } catch (e) {
      if (e instanceof TelegramError) throw e;
      // Never surface fetch errors: their URLs can contain the bot token.
      throw new TelegramError(503);
    }
  }
}
export class FakeTelegram implements Telegram {
  calls: { method: string; fields: Fields }[] = [];
  members = new Map<string, string>();
  responses = new Map<string, unknown>();
  failures = new Map<string, TelegramError>();
  webhook = "";
  constructor(
    public botId = 900001,
    public ownerId = 100001,
  ) {}
  async call<T = any>(method: string, fields: Fields = {}): Promise<T> {
    this.calls.push({ method, fields });
    if (this.failures.has(method)) throw this.failures.get(method)!;
    if (this.responses.has(method)) return this.responses.get(method) as T;
    let result: unknown = true;
    const memberKey = `${fields.chat_id}:${fields.user_id}`;
    switch (method) {
      case "getMe":
        result = {
          id: this.botId,
          is_bot: true,
          username: "teletier_demo_bot",
          first_name: "Demo creator bot",
        };
        break;
      case "getWebhookInfo":
        result = { url: this.webhook, pending_update_count: 0 };
        break;
      case "setWebhook":
        this.webhook = String(fields.url);
        break;
      case "deleteWebhook":
        this.webhook = "";
        break;
      case "getChat":
        result = {
          id: Number(fields.chat_id),
          title: "Learning room",
          type: "supergroup",
        };
        break;
      case "getChatMember":
        result = {
          status:
            this.members.get(memberKey) ??
            (Number(fields.user_id) === this.botId
              ? "administrator"
              : Number(fields.user_id) === this.ownerId
                ? "creator"
                : "left"),
          can_invite_users: true,
          can_restrict_members: true,
        };
        break;
      case "createInvoiceLink":
        result = "https://t.me/$fake_invoice";
        break;
      case "sendInvoice":
        result = {
          message_id: 100,
          chat: { id: fields.chat_id },
          date: Math.floor(Date.now() / 1000),
        };
        break;
      case "createChatInviteLink":
        result = {
          invite_link: `https://t.me/+fake_${this.calls.length}`,
          creates_join_request: true,
          expire_date: fields.expire_date,
        };
        break;
      case "banChatMember":
        this.members.set(memberKey, "kicked");
        break;
      case "unbanChatMember":
        this.members.set(memberKey, "left");
        break;
      case "getStarTransactions":
        result = { transactions: [] };
        break;
    }
    return result as T;
  }
}
const fakes = new Map<string, FakeTelegram>();
export function telegram(bot: Bot): Telegram {
  if (config.TELEGRAM_FAKE) {
    if (!fakes.has(bot.id))
      fakes.set(
        bot.id,
        new FakeTelegram(
          Number(bot.telegramId),
          Number(config.DEV_OWNER_TELEGRAM_ID),
        ),
      );
    return fakes.get(bot.id)!;
  }
  return new HttpTelegram(
    decrypt(bot.tokenCipher, bot.tenantId, bot.keyVersion),
    config.TELEGRAM_ENV === "test",
  );
}
export function invoice(
  version: { name: string; kind: string; stars: number },
  payload: string,
  userId: number,
) {
  const base = {
    title: version.name,
    description:
      version.kind === "RECURRING_30D"
        ? "30-day membership. Automatically renews; cancel in /cancel."
        : `${version.kind === "PREPAID_90D" ? 90 : 365}-day prepaid membership. One-time purchase.`,
    payload,
    currency: "XTR",
    provider_token: "",
    prices: [{ label: version.name, amount: version.stars }],
  };
  return version.kind === "RECURRING_30D"
    ? {
        method: "createInvoiceLink",
        fields: { ...base, subscription_period: 2592000 },
      }
    : {
        method: "sendInvoice",
        fields: { ...base, chat_id: userId, start_parameter: `p_${payload}` },
      };
}
