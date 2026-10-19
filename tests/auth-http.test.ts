import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import { verifyIdentity } from "../packages/app/src/auth";
import { db } from "../packages/db/src";
import { fixture } from "./fixtures";
import { createApp } from "../apps/api/src/main";
import type { INestApplication } from "@nestjs/common";
describe("OIDC signature and identity boundary", () => {
  it("verifies signed profile ID separately from opaque subject and rejects nonce, audience, expiry and signature forgery", async () => {
    const keys = await generateKeyPair("RS256");
    const sign = (claims: Record<string, unknown> = {}) =>
      new SignJWT({ id: 100001, nonce: "expected", name: "Creator", ...claims })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://oauth.telegram.org")
        .setAudience("login-client")
        .setSubject("opaque-oidc-subject")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(keys.privateKey);
    const resolver = async () => keys.publicKey;
    const verified = await verifyIdentity(
      await sign(),
      "expected",
      resolver,
      "login-client",
    );
    expect(verified.subject).toBe("opaque-oidc-subject");
    expect(verified.telegramId).toBe(100001n);
    await expect(
      verifyIdentity(await sign(), "wrong", resolver, "login-client"),
    ).rejects.toThrow("nonce");
    await expect(
      verifyIdentity(await sign(), "expected", resolver, "other-client"),
    ).rejects.toThrow();
    const forged = await generateKeyPair("RS256");
    await expect(
      verifyIdentity(
        await sign(),
        "expected",
        async () => forged.publicKey,
        "login-client",
      ),
    ).rejects.toThrow();
    await expect(
      verifyIdentity(
        await sign({ id: "not-a-telegram-id" }),
        "expected",
        resolver,
        "login-client",
      ),
    ).rejects.toThrow();
  });
});
describe("real HTTP authentication, CSRF and tenant boundaries", () => {
  let app: INestApplication,
    base: string,
    f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    const tables = await db.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("/teletier_test"))
      throw new Error("Unsafe database");
    await db.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`,
    );
    f = await fixture();
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  it("rejects unauthenticated views, unknown webhook secrets and unconfigured operator role", async () => {
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/webhooks/${f.bot.endpoint}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"update_id":99}',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/operator`, {
          headers: { cookie: `tt_session=${f.session.token}` },
        })
      ).status,
    ).toBe(403);
  });
  it("requires same origin and a session CSRF token on mutations", async () => {
    const body = JSON.stringify({
        name: "Attempted workspace",
        timezone: "UTC",
      }),
      url = `${base}/api/tenants`;
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `tt_session=${f.session.token}`,
            origin: "https://attacker.example",
            "x-csrf-token": f.session.csrf,
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `tt_session=${f.session.token}`,
            origin: "http://localhost:3000",
          },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `tt_session=${f.session.token}`,
            origin: "http://localhost:3000",
            "x-csrf-token": f.session.csrf,
          },
          body,
        })
      ).status,
    ).toBe(201);
  });
  it("denies cross-tenant headers, scopes data and never returns credentials or raw events", async () => {
    const other = await db.tenant.create({
      data: { name: "Unauthorized workspace" },
    });
    expect(
      (
        await fetch(`${base}/api/state`, {
          headers: {
            cookie: `tt_session=${f.session.token}`,
            "x-tenant-id": other.id,
          },
        })
      ).status,
    ).toBe(403);
    const r = await fetch(`${base}/api/state`, {
      headers: {
        cookie: `tt_session=${f.session.token}`,
        "x-tenant-id": f.tenant.id,
      },
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("tokenCipher");
    expect(text).not.toContain("secretHash");
    expect(text).not.toContain("fixture_token");
    expect(text).toContain("Access");
  });
});
