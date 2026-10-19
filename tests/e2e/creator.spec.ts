import { test, expect } from "@playwright/test";
import { db } from "../../packages/db/src";
import { hash } from "../../packages/app/src/secrets";
import { processInbox } from "../../packages/app/src/webhooks";
import { reconcileSubscriber } from "../../packages/app/src/access";
import { FakeTelegram, telegram } from "../../packages/telegram/src";
test.beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("/teletier_e2e"))
    throw new Error("Refusing non-E2E database");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`,
  );
});
test.afterAll(() => db.$disconnect());
test("creator onboarding → accepted terms → paid pending → observed join → expire → renew", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByRole("button", { name: "Open local test workspace" }).click();
  await page.getByLabel("Workspace name").fill("The Test Community");
  await page.getByLabel("Display timezone").fill("UTC");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("combobox", { name: "Select workspace" }),
  ).toContainText("The Test Community");
  await expect(
    page.getByRole("heading", { name: "Community overview" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Bot & channels", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your creator bot" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect bot", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Bot token")
    .fill("900011:e2e_fake_token_abcdefghijklmnopqrstuvwxyz");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Activate / repair webhook" }).click();
  await page.getByRole("button", { name: "Confirm handover" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add private chat" }).click();
  await page
    .getByLabel("Private channel / supergroup ID")
    .fill("-1001234567811");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Permissions verified", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Support & terms", exact: true })
    .click();
  await page.getByRole("button", { name: "Publish policy" }).click();
  await page.getByLabel("Creator support contact").fill("@test_support");
  await page
    .getByLabel("Purchase terms", { exact: true })
    .fill(
      "30-day learning access. Automatically renews until canceled with /cancel.",
    );
  await page
    .getByLabel("Refund policy")
    .fill(
      "Contact creator support for legitimate payment disputes and refunds.",
    );
  await page
    .getByLabel("Privacy & data requests")
    .fill(
      "We retain identity and payment facts. Contact support for data requests.",
    );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Membership plans", exact: true })
    .click();
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page.getByLabel("Plan name").fill("Learning Circle");
  await page.getByLabel("Price in Stars").fill("450");
  await page.getByLabel("Purchase policy").selectOption({ index: 1 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("link", { name: "Open purchase link" }),
  ).toBeVisible();
  const bot = await db.bot.findFirstOrThrow();
  await db.bot.update({
    where: { id: bot.id },
    data: { secretHash: hash("e2e-secret") },
  });
  const plan = await db.plan.findFirstOrThrow(),
    chat = await db.chat.findFirstOrThrow();
  async function update(body: any) {
    const res = await page.request.post(`/api/webhooks/${bot.endpoint}`, {
      headers: { "x-telegram-bot-api-secret-token": "e2e-secret" },
      data: body,
    });
    expect(res.ok()).toBe(true);
    if (!body.pre_checkout_query) {
      const inbox = await db.inbox.findUniqueOrThrow({
        where: {
          botId_updateId: { botId: bot.id, updateId: BigInt(body.update_id) },
        },
      });
      await processInbox(bot, inbox.id);
    }
  }
  const user = { id: 300001, first_name: "Jamie Chen" },
    privateChat = { id: 300001, type: "private" };
  await update({
    update_id: 101,
    message: { from: user, chat: privateChat, text: "/start" },
  });
  await update({
    update_id: 102,
    callback_query: {
      id: "show-terms",
      from: user,
      message: { chat: privateChat },
      data: `offer:${plan.id}`,
    },
  });
  const offer = await db.offer.findFirstOrThrow();
  await update({
    update_id: 107,
    callback_query: {
      id: "accept-terms",
      from: user,
      message: { chat: privateChat },
      data: `agree:${offer.id}`,
    },
  });
  const c = await db.checkout.findFirstOrThrow(),
    s = await db.subscriber.findFirstOrThrow();
  expect(c.acceptedAt).toBeTruthy();
  const start = Date.now();
  await update({
    update_id: 103,
    pre_checkout_query: {
      id: "pre-e2e",
      from: user,
      invoice_payload: c.id,
      currency: "XTR",
      total_amount: 450,
    },
  });
  expect(Date.now() - start).toBeLessThan(10000);
  const pay = (id: number, charge: string, renewal = false) => ({
    update_id: id,
    message: {
      from: user,
      chat: privateChat,
      date: Math.floor(Date.now() / 1000),
      successful_payment: {
        currency: "XTR",
        total_amount: 450,
        invoice_payload: c.id,
        telegram_payment_charge_id: charge,
        is_recurring: true,
        ...(!renewal ? { is_first_recurring: true } : {}),
        subscription_expiration_date: Math.floor(Date.now() / 1000) + 2592000,
      },
    },
  });
  await update(pay(104, "e2e-charge"));
  await reconcileSubscriber(bot, s.id);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(
    page.getByRole("table").getByText("Access pending", { exact: true }),
  ).toBeVisible();
  const api = telegram(bot) as FakeTelegram;
  api.members.set(`${chat.telegramId}:300001`, "member");
  await update({
    update_id: 105,
    chat_member: {
      chat: { id: Number(chat.telegramId) },
      from: { id: 900011 },
      date: Math.floor(Date.now() / 1000),
      new_chat_member: { status: "member", user },
    },
  });
  await reconcileSubscriber(bot, s.id);
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(page.getByText("Active member", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await db.grant.updateMany({
    where: { subscriberId: s.id },
    data: {
      startsAt: new Date(Date.now() - 86400000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  await reconcileSubscriber(bot, s.id);
  expect((await db.membership.findFirstOrThrow()).platformBan).toBe(true);
  await update(pay(106, "e2e-renewal", true));
  await reconcileSubscriber(bot, s.id);
  expect(
    api.calls.some(
      (c) => c.method === "unbanChatMember" && c.fields.only_if_banned === true,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(page.getByText("e2e-renewal", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Community overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  // Accessibility smoke: named main landmark, labeled search, and named buttons.
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Search subscribers" }),
  ).toBeVisible();
  const unnamed = await page
    .getByRole("button")
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (b) =>
            !(
              b.getAttribute("aria-label") ||
              b.textContent?.trim() ||
              b.getAttribute("title")
            ),
        ).length,
    );
  expect(unnamed).toBe(0);
  expect(errors).toEqual([]);
});
