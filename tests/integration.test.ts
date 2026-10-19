import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { db, locked } from "../packages/db/src";
import { DAY } from "../packages/domain/src";
import { approve, deliver, fixture, paymentUpdate } from "./fixtures";
import {
  FakeTelegram,
  TelegramError,
  telegram,
} from "../packages/telegram/src";
import { precheckout, requestRefund } from "../packages/app/src/payments";
import { receiveWebhook } from "../packages/app/src/webhooks";
import {
  reconcileSubscriber,
  manualGrant,
  processJoin,
} from "../packages/app/src/access";
import {
  dispatch,
  runOne,
  sweep,
  reconcileStars,
} from "../packages/app/src/jobs";
import { enrollChat, healthBot, savePlan } from "../packages/app/src/setup";
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("/teletier_test"))
    throw new Error("Refusing to reset a non-test database");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`,
  );
});
afterAll(() => db.$disconnect());
describe("PostgreSQL financial/access invariants", () => {
  it("flags a local charge absent from a completed provider scan without deleting its paid grant", async () => {
    const f = await fixture("PREPAID_90D");
    await approve(f);
    const past = new Date(Date.now() - 600000);
    await db.checkout.update({
      where: { id: f.checkout.id },
      data: { createdAt: past, expiresAt: new Date(0) },
    });
    const update = paymentUpdate(f);
    update.message.date = Math.floor(past.getTime() / 1000) + 1;
    await deliver(f, update);
    await reconcileStars(f.bot);
    expect(
      await db.incident.count({ where: { kind: "LOCAL_CHARGE_MISSING" } }),
    ).toBe(1);
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(1);
    expect(await db.payment.count()).toBe(1);
  });
  it("multiple chat grants keep their union across a version change and a partial history refund", async () => {
    const f = await fixture("PREPAID_90D");
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const chat2 = await enrollChat(f.actor, { telegramId: "-1001234567891" });
    const plan = await savePlan(
      f.actor,
      {
        name: "Learning Circle Plus",
        kind: "PREPAID_90D",
        stars: 450,
        chatIds: [f.chat.id, chat2.id],
        policyId: f.policy.id,
      },
      f.plan.id,
    );
    const { prepareCheckout } = await import("../packages/app/src/payments");
    const checkout = await locked(f.bot.id, (tx) =>
      prepareCheckout(tx, f.bot, f.subscriber, plan.currentVersionId),
    );
    const next = { ...f, plan, checkout };
    await approve(next);
    await deliver(next, paymentUpdate(next, 80, "multi-chat-charge"));
    expect(await db.grant.count()).toBe(3);
    expect(await db.planVersion.count()).toBe(2);
    const pay = await db.payment.findFirstOrThrow({
      where: { chargeId: "multi-chat-charge" },
    });
    await requestRefund(f.actor, pay.id, "Refund new product only");
    await dispatch(
      await db.job.findFirstOrThrow({ where: { kind: "REFUND" } }),
    );
    expect(
      await db.grant.count({ where: { chatId: f.chat.id, revokedAt: null } }),
    ).toBe(1);
    expect(
      await db.grant.count({ where: { chatId: chat2.id, revokedAt: null } }),
    ).toBe(0);
  });
  it("schedules one reminder per period/window and honors subscriber preferences", async () => {
    const f = await fixture("PREPAID_90D");
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const p = await db.payment.findFirstOrThrow();
    const when = new Date(p.periodEnd.getTime() - 2 * DAY);
    await sweep(when);
    await sweep(when);
    expect(
      await db.notification.count({
        where: { key: { startsWith: "reminder:" } },
      }),
    ).toBe(1);
    await deliver(f, {
      update_id: 50,
      message: {
        from: { id: 200001 },
        chat: { id: 200001, type: "private" },
        text: "/quiet",
      },
    });
    await sweep(new Date(p.periodEnd.getTime() - DAY / 2));
    expect(
      await db.notification.count({
        where: { key: { startsWith: "reminder:" } },
      }),
    ).toBe(1);
    expect(await db.payment.count()).toBe(1);
  });
  it("does not repeat an uncertain refund or revoke access before confirmation", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const p = await db.payment.findFirstOrThrow();
    await requestRefund(f.actor, p.id, "Legitimate refund request");
    const job = await db.job.findFirstOrThrow({ where: { kind: "REFUND" } }),
      api = telegram(f.bot) as FakeTelegram;
    api.failures.set("refundStarPayment", new TelegramError(503));
    await expect(dispatch(job)).rejects.toThrow();
    api.failures.delete("refundStarPayment");
    await expect(dispatch(job)).rejects.toThrow("reconciliation");
    expect(
      api.calls.filter((c) => c.method === "refundStarPayment"),
    ).toHaveLength(1);
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(1);
    await deliver(f, {
      update_id: 70,
      message: {
        refunded_payment: paymentUpdate(f).message.successful_payment,
      },
    });
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(0);
  });
  it("requires an unexpired buyer-bound terms offer and consumes acceptance only once", async () => {
    const f = await fixture("PREPAID_90D");
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const callback = (update_id: number, buyer: number, data: string) => ({
      update_id,
      callback_query: {
        id: `q-${update_id}`,
        from: { id: buyer, first_name: "Member" },
        message: { chat: { id: buyer, type: "private" } },
        data,
      },
    });
    await deliver(f, callback(30, 200001, `agree:${f.plan.currentVersionId}`));
    expect(await db.checkout.count()).toBe(1);
    await deliver(f, callback(31, 200001, `offer:${f.plan.id}`));
    const offer = await db.offer.findFirstOrThrow();
    await deliver(f, callback(32, 200002, `agree:${offer.id}`));
    expect(await db.checkout.count()).toBe(1);
    await deliver(f, callback(33, 200001, `agree:${offer.id}`));
    expect(await db.checkout.count()).toBe(2);
    await deliver(f, callback(34, 200001, `agree:${offer.id}`));
    expect(await db.checkout.count()).toBe(2);
  });
  it("fails pre-checkout closed within the deadline when the financial lock is contended", async () => {
    const f = await fixture();
    let unlock!: () => void, ready!: () => void;
    const signal = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
    const held = locked(f.bot.id, async () => {
      ready();
      await gate;
    });
    await signal;
    try {
      const start = Date.now();
      expect(await approve(f)).toBe(false);
      expect(Date.now() - start).toBeLessThan(8000);
      expect(await db.payment.count()).toBe(0);
    } finally {
      unlock();
      await held;
    }
  });
  it("1–2: requires current webhook/private chat and creator/bot authority for READY", async () => {
    const f = await fixture();
    expect(f.bot.status).toBe("READY");
    const api = telegram(f.bot) as FakeTelegram;
    api.responses.set("getChat", {
      type: "supergroup",
      username: "public_chat",
      title: "Public",
    });
    await expect(
      enrollChat(f.actor, { telegramId: "-1009999999999" }),
    ).rejects.toThrow("private");
    api.responses.delete("getChat");
    api.members.set("-1009999999999:100001", "member");
    await expect(
      enrollChat(f.actor, { telegramId: "-1009999999999" }),
    ).rejects.toThrow("administer");
    api.members.set(`${f.chat.telegramId}:${f.bot.telegramId}`, "left");
    expect((await healthBot(f.actor)).status).toBe("DEGRADED");
  });
  it("4–6: rejects forged streams, client callbacks, wrong buyer/amount/currency, expired quotes", async () => {
    const f = await fixture();
    await expect(
      receiveWebhook(f.bot.endpoint, "wrong", paymentUpdate(f)),
    ).rejects.toThrow("credentials");
    await deliver(f, {
      update_id: 2,
      message: {
        from: { id: 200001 },
        chat: { id: 200001, type: "private" },
        text: "paid=true",
      },
    });
    expect(await db.payment.count()).toBe(0);
    for (const override of [
      { from: { id: 200002 } },
      { total_amount: 451 },
      { currency: "USD" },
      { invoice_payload: "unknown" },
    ])
      expect(
        await precheckout(f.bot, {
          id: "q",
          from: { id: 200001 },
          total_amount: 450,
          currency: "XTR",
          invoice_payload: f.checkout.id,
          ...override,
        }),
      ).toBe(false);
    await db.checkout.update({
      where: { id: f.checkout.id },
      data: { expiresAt: new Date(0) },
    });
    expect(await approve(f)).toBe(false);
    expect(await db.grant.count()).toBe(0);
  });
  it("7–10,28: concurrent duplicate and late renewal deliveries grant once with provider expiration", async () => {
    const f = await fixture();
    expect(await approve(f)).toBe(true);
    const body = paymentUpdate(f);
    const deliveries = await Promise.allSettled(
      Array.from({ length: 8 }, () => deliver(f, body)),
    );
    expect(deliveries.every((result) => result.status === "fulfilled")).toBe(
      true,
    );
    expect(await db.payment.count()).toBe(1);
    expect(await db.grant.count()).toBe(1);
    const end = Math.floor(Date.now() / 1000) + 50 * 86400;
    await db.checkout.update({
      where: { id: f.checkout.id },
      data: { expiresAt: new Date(0) },
    });
    await deliver(f, paymentUpdate(f, 3, "charge-renewal", true, end));
    expect(
      (await db.subscription.findFirstOrThrow()).paidThrough.getTime(),
    ).toBe(end * 1000);
    expect(await db.payment.count()).toBe(2);
    expect(await db.grant.count()).toBe(2);
    const rejected = paymentUpdate(f, 4, "another-first", false);
    await deliver(f, rejected);
    expect(await db.payment.count()).toBe(2);
    expect(await db.incident.count()).toBe(1);
    await expect(db.payment.updateMany({ data: { stars: 1 } })).rejects.toThrow(
      "Append-only",
    );
  });
  it("9: a late approved initial charge survives quote TTL expiration", async () => {
    const f = await fixture("PREPAID_90D");
    await approve(f);
    await db.checkout.update({
      where: { id: f.checkout.id },
      data: { expiresAt: new Date(0) },
    });
    await deliver(f, paymentUpdate(f));
    expect(await db.payment.count()).toBe(1);
    const p = await db.payment.findFirstOrThrow();
    expect(p.periodEnd.getTime() - p.periodStart.getTime()).toBe(90 * DAY);
  });
  it("11–12: cancellation preserves paid access and prepaid has no automatic charge", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const s = await db.subscription.findFirstOrThrow();
    await deliver(f, {
      update_id: 8,
      message: {
        from: { id: 200001 },
        chat: { id: 200001, type: "private" },
        text: "/cancel",
      },
    });
    await dispatch(
      await db.job.findFirstOrThrow({ where: { kind: "CANCEL" } }),
    );
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: s.id } }))
        .canceled,
    ).toBe(true);
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(1);
  });
  it("13–14,27: copied join links are declined and approval does not invent membership", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const api = telegram(f.bot) as FakeTelegram;
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect((await db.membership.findFirstOrThrow()).desired).toBe(
      "ENTITLED_PENDING_JOIN",
    );
    const fields = api.calls.find(
      (c) => c.method === "createChatInviteLink",
    )!.fields;
    expect(fields.creates_join_request).toBe(true);
    expect(fields).not.toHaveProperty("member_limit");
    await processJoin(f.bot, {
      chatId: f.chat.id,
      telegramUserId: "200002",
      subscriberId: f.subscriber.id,
    });
    expect(api.calls.at(-1)?.method).toBe("declineChatJoinRequest");
    await processJoin(f.bot, {
      chatId: f.chat.id,
      telegramUserId: "200001",
      subscriberId: f.subscriber.id,
    });
    expect(api.calls.at(-1)?.method).toBe("approveChatJoinRequest");
    expect((await db.membership.findFirstOrThrow()).observed).toBe("left");
  });
  it("15–19: grants union, expiry ban, safe restore, moderator bans and admin protection", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    const api = telegram(f.bot) as FakeTelegram;
    const key = `${f.chat.telegramId}:200001`;
    api.members.set(key, "member");
    await db.grant.updateMany({
      data: {
        expiresAt: new Date(Date.now() - 1000),
        startsAt: new Date(Date.now() - DAY),
      },
    });
    const override = await manualGrant(f.actor, f.subscriber.id, {
      chatId: f.chat.id,
      expiresAt: new Date(Date.now() + DAY),
      reason: "Documented support exception",
    });
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect(api.calls.filter((c) => c.method === "banChatMember")).toHaveLength(
      0,
    );
    await db.grant.update({
      where: { id: override.id },
      data: { revokedAt: new Date() },
    });
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect(api.members.get(key)).toBe("kicked");
    expect((await db.membership.findFirstOrThrow()).platformBan).toBe(true);
    await manualGrant(f.actor, f.subscriber.id, {
      chatId: f.chat.id,
      expiresAt: new Date(Date.now() + DAY),
      reason: "Renewal support grant",
    });
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect(
      api.calls.find((c) => c.method === "unbanChatMember")?.fields
        .only_if_banned,
    ).toBe(true);
    api.members.set(key, "kicked");
    await db.membership.updateMany({ data: { platformBan: false } });
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect((await db.membership.findFirstOrThrow()).desired).toBe(
      "MODERATOR_BLOCKED",
    );
    await db.grant.updateMany({ data: { revokedAt: new Date() } });
    api.members.set(key, "administrator");
    const bans = api.calls.filter((c) => c.method === "banChatMember").length;
    await reconcileSubscriber(f.bot, f.subscriber.id);
    expect(api.calls.filter((c) => c.method === "banChatMember")).toHaveLength(
      bans,
    );
  });
  it("18 extension: independent moderation invalidates platform provenance", async () => {
    const f = await fixture();
    await db.membership.create({
      data: {
        tenantId: f.tenant.id,
        botId: f.bot.id,
        chatId: f.chat.id,
        subscriberId: f.subscriber.id,
        platformBan: true,
      },
    });
    await deliver(f, {
      update_id: 6,
      chat_member: {
        chat: { id: Number(f.chat.telegramId) },
        from: { id: 777777 },
        date: Math.floor(Date.now() / 1000),
        new_chat_member: { status: "kicked", user: { id: 200001 } },
      },
    });
    expect((await db.membership.findFirstOrThrow()).platformBan).toBe(false);
  });
  it("20: provider 429 preserves pending work and honors retry_after", async () => {
    const f = await fixture();
    const api = telegram(f.bot) as FakeTelegram;
    api.failures.set("createInvoiceLink", new TelegramError(429, 30));
    await runOne();
    const j = await db.job.findFirstOrThrow({ where: { kind: "INVOICE" } });
    expect(j.status).toBe("PENDING");
    expect(j.nextAt.getTime() - Date.now()).toBeGreaterThan(29000);
  });
  it("21–22,29: authorized refund preserves original charge and later renewal coverage", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    await deliver(
      f,
      paymentUpdate(
        f,
        2,
        "later",
        true,
        Math.floor(Date.now() / 1000) + 50 * 86400,
      ),
    );
    const first = await db.payment.findUniqueOrThrow({
      where: {
        botId_chargeId: { botId: f.bot.id, chargeId: "charge-initial" },
      },
    });
    const r = await requestRefund(
      f.actor,
      first.id,
      "Legitimate payment dispute",
    );
    await dispatch(
      await db.job.findFirstOrThrow({ where: { kind: "REFUND" } }),
    );
    expect(
      (await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status,
    ).toBe("CONFIRMED");
    expect(await db.payment.count()).toBe(2);
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(1);
    expect(
      await db.audit.count({ where: { action: "REFUND_REQUESTED" } }),
    ).toBe(1);
    const later = await db.payment.findFirstOrThrow({
      where: { chargeId: "later" },
    });
    expect(
      await db.grant.count({ where: { paymentId: later.id, revokedAt: null } }),
    ).toBe(1);
  });
  it("refund-before-charge tombstone prevents any delayed grant", async () => {
    const f = await fixture();
    await approve(f);
    const payment = paymentUpdate(f);
    await deliver(f, {
      update_id: 10,
      message: { refunded_payment: payment.message.successful_payment },
    });
    await deliver(f, payment);
    expect(await db.payment.count()).toBe(1);
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(0);
    expect(
      (await db.subscription.findFirstOrThrow()).paidThrough.getTime(),
    ).toBe(0);
  });
  it("23: unmatched provider invoice creates discrepancy and no entitlement", async () => {
    const f = await fixture();
    const api = telegram(f.bot) as FakeTelegram;
    api.responses.set("getStarTransactions", {
      transactions: [
        {
          id: "unmatched",
          amount: 450,
          date: 1,
          source: {
            type: "user",
            transaction_type: "invoice_payment",
            user: { id: 200001 },
            invoice_payload: f.checkout.id,
          },
        },
      ],
    });
    await reconcileStars(f.bot);
    expect(await db.incident.count()).toBe(1);
    expect(await db.payment.count()).toBe(0);
    await reconcileStars(f.bot);
    expect(await db.incident.count()).toBe(1);
  });
  it("24,26: blocked messages leave grants intact and database outbox survives Redis absence", async () => {
    const f = await fixture();
    await approve(f);
    await deliver(f, paymentUpdate(f));
    await reconcileSubscriber(f.bot, f.subscriber.id);
    const api = telegram(f.bot) as FakeTelegram;
    api.failures.set("sendMessage", new TelegramError(403));
    const j = await db.job.findFirstOrThrow({ where: { kind: "NOTIFY" } });
    await dispatch(j);
    expect((await db.notification.findFirstOrThrow()).status).toBe(
      "UNREACHABLE",
    );
    expect(await db.grant.count({ where: { revokedAt: null } })).toBe(1);
    const inboxJob = await db.job.findFirstOrThrow({
      where: { kind: "INBOX" },
    });
    await db.job.update({
      where: { id: inboxJob.id },
      data: { status: "RUNNING", leaseUntil: new Date(0) },
    });
    for (let i = 0; i < 10; i++) await runOne();
    expect(
      (await db.job.findUniqueOrThrow({ where: { id: inboxJob.id } })).status,
    ).toBe("DONE");
  });
  it("25: rejects cross-tenant plans, overrides and database relationships", async () => {
    const f = await fixture();
    const other = await db.tenant.create({ data: { name: "Other" } });
    const a = { ...f.actor, tenantId: other.id };
    await expect(
      savePlan(a, {
        name: "Stolen",
        kind: "PREPAID_90D",
        stars: 1,
        chatIds: [f.chat.id],
        policyId: f.policy.id,
      }),
    ).rejects.toThrow();
    await expect(
      manualGrant(a, f.subscriber.id, {
        chatId: f.chat.id,
        expiresAt: new Date(Date.now() + DAY),
        reason: "Forged override",
      }),
    ).rejects.toThrow();
    await expect(
      db.grant.create({
        data: {
          tenantId: other.id,
          botId: f.bot.id,
          subscriberId: f.subscriber.id,
          chatId: f.chat.id,
          startsAt: new Date(),
          expiresAt: new Date(Date.now() + DAY),
        },
      }),
    ).rejects.toThrow();
  });
});
