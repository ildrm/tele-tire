import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { map } from "rxjs";
import { DocumentBuilder, SwaggerModule, ApiTags } from "@nestjs/swagger";
import {
  json as expressJson,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { db, json, locked } from "../../../packages/db/src";
import {
  AppError,
  DAY,
  reasonInput,
  requireThat,
} from "../../../packages/domain/src";
import {
  actorFor,
  cookie,
  cookies,
  createSession,
  getSession,
  loginCallback,
  loginStart,
  owner,
} from "../../../packages/app/src/auth";
import { config } from "../../../packages/app/src/config";
import { equalHash, hash } from "../../../packages/app/src/secrets";
import {
  audit,
  configureWebhook,
  connectBot,
  createPolicy,
  enrollChat,
  healthBot,
  savePlan,
} from "../../../packages/app/src/setup";
import { receiveWebhook } from "../../../packages/app/src/webhooks";
import { enqueue, requestRefund } from "../../../packages/app/src/payments";
import { manualGrant } from "../../../packages/app/src/access";
import { telegram } from "../../../packages/telegram/src";
@Catch()
class Errors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      e instanceof AppError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : e instanceof HttpException
            ? e.getStatus()
            : (e as any)?.code === "P2002"
              ? 409
              : 500;
    res.status(status).json({
      error:
        e instanceof AppError
          ? e.message
          : e instanceof z.ZodError
            ? e.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")
            : status === 409
              ? "This record is already registered"
              : "Request failed. Retry or check operational incidents.",
    });
  }
}
const actor = (req: Request) =>
  actorFor(
    req.headers.cookie,
    req.headers["x-tenant-id"] as string | undefined,
  );
@ApiTags("TeleTier")
@Controller()
class Api {
  @Get("health") async health() {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", fake: config.TELEGRAM_FAKE };
  }
  @Get("config") publicConfig() {
    return { developmentLogin: config.DEV_LOGIN, fake: config.TELEGRAM_FAKE };
  }
  @Get("auth/login") async login(@Res() res: Response) {
    const start = await loginStart();
    res.setHeader("Set-Cookie", cookie("tt_login", start.state, 600));
    res.redirect(start.url);
  }
  @Get("auth/callback") async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const session = await loginCallback(code, state, req.headers.cookie);
    res.setHeader("Set-Cookie", [
      cookie("tt_session", session.token, 604800),
      cookie("tt_login", "", 0),
    ]);
    res.redirect(`${config.APP_ORIGIN}/dashboard`);
  }
  @Post("auth/dev") async dev(@Res() res: Response) {
    requireThat(
      config.DEV_LOGIN && config.NODE_ENV !== "production",
      404,
      "Route unavailable",
    );
    const session = await createSession({
      subject: "dev:local-owner",
      telegramId: BigInt(config.DEV_OWNER_TELEGRAM_ID),
      name: "Alex Morgan",
    });
    res.setHeader("Set-Cookie", cookie("tt_session", session.token, 604800));
    res.json({ ok: true });
  }
  @Post("auth/logout") async logout(@Req() req: Request, @Res() res: Response) {
    const raw = cookies(req.headers.cookie).tt_session;
    if (raw) await db.session.deleteMany({ where: { id: hash(raw) } });
    res.setHeader("Set-Cookie", cookie("tt_session", "", 0));
    res.json({ ok: true });
  }
  @Get("session") async session(@Req() req: Request) {
    const s = await getSession(req.headers.cookie);
    return {
      csrf: s.csrf,
      user: { name: s.user.name, telegramId: s.user.telegramId.toString() },
      tenants: s.user.members.map((m) => ({
        id: m.tenantId,
        name: m.tenant.name,
        timezone: m.tenant.timezone,
        role: m.role,
      })),
      fake: config.TELEGRAM_FAKE,
    };
  }
  @Post("tenants") async tenant(@Req() req: Request, @Body() input: unknown) {
    const s = await getSession(req.headers.cookie);
    const values = z
      .object({
        name: z.string().trim().min(2).max(80),
        timezone: z
          .string()
          .default("UTC")
          .refine((v) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }, "Invalid IANA timezone"),
      })
      .parse(input);
    requireThat(s.user.members.length < 10, 409, "Workspace limit reached");
    return db.tenant.create({
      data: {
        ...values,
        members: { create: { userId: s.userId, role: "OWNER" } },
      },
    });
  }
  @Get("state") async state(
    @Req() req: Request,
    @Query() query: Record<string, string>,
  ) {
    const a = await actor(req),
      now = new Date();
    const filter = z
      .object({
        search: z.string().max(100).optional(),
        records: z.string().max(100).optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(query);
    const from = filter.from
        ? new Date(filter.from)
        : new Date(now.getTime() - 30 * DAY),
      to = filter.to ? new Date(filter.to) : now;
    requireThat(
      from < to && to.getTime() - from.getTime() <= 366 * DAY,
      400,
      "Choose a date range up to 366 days",
    );
    const scope = { tenantId: a.tenantId };
    const search = filter.search;
    const subscriberFilter = {
      ...scope,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              ...(/^[1-9]\d{0,15}$/.test(search) &&
              BigInt(search) <= BigInt(Number.MAX_SAFE_INTEGER)
                ? [{ telegramId: BigInt(search) }]
                : []),
            ],
          }
        : {}),
    };
    const term = filter.records;
    const textMatch = (fields: string[]) =>
      term
        ? {
            OR: fields.map((field) => ({
              [field]: { contains: term, mode: "insensitive" as const },
            })),
          }
        : {};
    const [
      tenant,
      bot,
      chats,
      plans,
      versions,
      policies,
      subscribers,
      subscriberCount,
      payments,
      refunds,
      grants,
      memberships,
      jobs,
      incidents,
      audits,
      notifications,
    ] = await Promise.all([
      db.tenant.findUniqueOrThrow({ where: { id: a.tenantId } }),
      db.bot.findUnique({
        where: { tenantId: a.tenantId },
        select: {
          id: true,
          username: true,
          telegramId: true,
          status: true,
          checkedAt: true,
          webhookUrl: true,
        },
      }),
      db.chat.findMany({ where: scope, orderBy: { title: "asc" } }),
      db.plan.findMany({ where: scope, orderBy: { createdAt: "asc" } }),
      db.planVersion.findMany({ where: scope }),
      db.policy.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.subscriber.findMany({
        where: subscriberFilter,
        take: 50,
        skip: (filter.page - 1) * 50,
        orderBy: { createdAt: "desc" },
      }),
      db.subscriber.count({ where: subscriberFilter }),
      db.payment.findMany({
        where: {
          ...scope,
          paidAt: { gte: from, lt: to },
          ...textMatch(["id", "chargeId", "checkoutId", "subscriberId"]),
        },
        orderBy: { paidAt: "desc" },
        take: 100,
      }),
      db.refund.findMany({
        where: {
          ...scope,
          createdAt: { gte: from, lt: to },
          ...textMatch(["id", "chargeId", "reason"]),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.grant.findMany({ where: scope }),
      db.membership.findMany({ where: scope }),
      db.job.findMany({
        where: { ...scope, status: { not: "DONE" } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.incident.findMany({
        where: { ...scope, ...textMatch(["id", "kind", "detail", "key"]) },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.audit.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.notification.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const [gross, refunded, openIncidents, lag, paymentRefunds, quarantined] =
      await Promise.all([
        db.payment.aggregate({
          where: { ...scope, paidAt: { gte: from, lt: to } },
          _sum: { stars: true },
        }),
        db.refund.aggregate({
          where: {
            ...scope,
            status: "CONFIRMED",
            confirmedAt: { gte: from, lt: to },
          },
          _sum: { stars: true },
        }),
        db.incident.count({ where: { ...scope, status: "OPEN" } }),
        db.job.findFirst({
          where: { ...scope, status: { in: ["PENDING", "RUNNING"] } },
          orderBy: { createdAt: "asc" },
        }),
        db.refund.findMany({
          where: {
            ...scope,
            chargeId: { in: payments.map((p) => p.chargeId) },
          },
        }),
        db.inbox.findMany({
          where: { ...scope, status: "QUARANTINED" },
          select: {
            id: true,
            updateId: true,
            status: true,
            error: true,
            createdAt: true,
          },
          take: 100,
          orderBy: { createdAt: "desc" },
        }),
      ]);
    const active = new Set(
      grants
        .filter(
          (g) =>
            g.paymentId &&
            !g.revokedAt &&
            g.startsAt <= now &&
            g.expiresAt > now,
        )
        .map((g) => g.subscriberId),
    );
    return json({
      tenant,
      bot,
      chats,
      plans: plans.map((p) => ({
        ...p,
        version: versions.find((v) => v.id === p.currentVersionId),
      })),
      policies,
      subscribers,
      subscriberCount,
      page: filter.page,
      payments,
      refunds,
      paymentRefunds,
      quarantined,
      grants,
      memberships,
      jobs,
      incidents,
      audits,
      notifications,
      metrics: {
        activePaid: active.size,
        pending: memberships.filter(
          (m) => m.desired === "ENTITLED_PENDING_JOIN",
        ).length,
        gross: gross._sum.stars ?? 0,
        refunded: refunded._sum.stars ?? 0,
        net: (gross._sum.stars ?? 0) - (refunded._sum.stars ?? 0),
        openIncidents,
        queueLagSeconds: lag
          ? Math.floor((Date.now() - lag.createdAt.getTime()) / 1000)
          : 0,
      },
      period: { from, to },
      fake: config.TELEGRAM_FAKE,
    });
  }
  @Post("bots") async connect(@Req() req: Request, @Body() v: unknown) {
    return connectBot(await actor(req), v);
  }
  @Post("bots/webhook") async webhook(@Req() req: Request, @Body() v: unknown) {
    return configureWebhook(await actor(req), v);
  }
  @Post("bots/health") async botHealth(@Req() req: Request) {
    return healthBot(await actor(req));
  }
  @Post("bots/disconnect") async disconnect(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input),
      b = await db.bot.findUnique({ where: { tenantId: a.tenantId } });
    requireThat(b, 404, "Bot not found");
    return locked(b.id, async (tx) => {
      requireThat(
        (await tx.grant.count({
          where: {
            tenantId: a.tenantId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        })) === 0,
        409,
        "Active memberships remain. Resolve access continuity before disconnecting.",
      );
      requireThat(
        (await tx.subscription.count({
          where: { tenantId: a.tenantId, canceled: false },
        })) === 0,
        409,
        "Cancel all native recurring subscriptions before disconnecting.",
      );
      requireThat(
        (await tx.checkout.count({
          where: {
            tenantId: a.tenantId,
            OR: [
              { status: "PRECHECKOUT_APPROVED" },
              { status: "CREATED", expiresAt: { gt: new Date() } },
            ],
          },
        })) === 0,
        409,
        "A checkout is outstanding. Resolve it before disconnecting.",
      );
      requireThat(
        (await tx.refund.count({
          where: {
            tenantId: a.tenantId,
            status: { in: ["REQUESTED", "API_REQUESTED"] },
          },
        })) === 0,
        409,
        "Resolve outstanding refunds before disconnecting.",
      );
      await telegram(b).call("deleteWebhook", { drop_pending_updates: false });
      await tx.bot.update({
        where: { id: b.id },
        data: { status: "DISCONNECTED" },
      });
      await tx.audit.create({
        data: {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: "BOT_DISCONNECTED",
          target: b.id,
          reason: v.reason,
          result: { confirmed: true },
        },
      });
      return { ok: true };
    });
  }
  @Post("chats") async chat(@Req() req: Request, @Body() v: unknown) {
    return enrollChat(await actor(req), v);
  }
  @Post("policies") async policy(@Req() req: Request, @Body() v: unknown) {
    return createPolicy(await actor(req), v);
  }
  @Post("plans") async plan(@Req() req: Request, @Body() v: unknown) {
    return savePlan(await actor(req), v);
  }
  @Patch("plans/:id") async editPlan(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() v: unknown,
  ) {
    return savePlan(await actor(req), v, id);
  }
  @Post("plans/:id/archive") async archive(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input);
    const updated = await db.plan.updateMany({
      where: { id, tenantId: a.tenantId },
      data: { state: "ARCHIVED" },
    });
    requireThat(updated.count, 404, "Plan not found");
    await audit(a, "PLAN_ARCHIVED", id, v.reason);
    return { ok: true };
  }
  @Post("payments/:id/refund") async refund(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const v = reasonInput.parse(input);
    return requestRefund(await actor(req), id, v.reason);
  }
  @Post("subscribers/:id/grants") async grant(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const v = reasonInput
      .extend({
        chatId: z.string().uuid(),
        expiresAt: z.iso
          .datetime()
          .transform((v) => new Date(v))
          .refine(
            (d) => d > new Date() && d.getTime() < Date.now() + 366 * DAY,
            "Choose a future expiry within 366 days",
          ),
      })
      .parse(input);
    return manualGrant(await actor(req), id, v);
  }
  @Post("grants/:id/revoke") async revoke(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input);
    const g = await db.grant.findFirst({
      where: { id, tenantId: a.tenantId, paymentId: null },
    });
    requireThat(
      g,
      404,
      "Manual grant not found. Paid grants require a refund.",
    );
    await locked(g.botId, async (tx) => {
      await tx.grant.update({
        where: { id: g.id },
        data: { revokedAt: new Date() },
      });
      await enqueue(
        tx,
        { id: g.botId, tenantId: g.tenantId },
        "ACCESS",
        `revoke:${id}`,
        { subscriberId: g.subscriberId },
      );
      await tx.audit.create({
        data: {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: "MANUAL_GRANT_REVOKED",
          target: id,
          reason: v.reason,
          result: {},
        },
      });
    });
    return { ok: true };
  }
  @Post("jobs/:id/retry") async retry(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input);
    const job = await db.job.findFirst({
      where: { id, tenantId: a.tenantId, status: { in: ["DEAD", "PENDING"] } },
    });
    requireThat(job, 404, "Retryable job not found");
    requireThat(
      job.kind !== "REFUND",
      409,
      "Financial outcomes require reconciliation before retry",
    );
    await db.job.update({
      where: { id },
      data: { status: "PENDING", attempts: 0, nextAt: new Date(), error: null },
    });
    await audit(a, "JOB_REPLAY", id, v.reason);
    return { ok: true };
  }
  @Post("incidents/:id/resolve") async resolve(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input);
    const count = await db.incident.updateMany({
      where: { id, tenantId: a.tenantId },
      data: { status: "RESOLVED" },
    });
    requireThat(count.count, 404, "Incident not found");
    await audit(a, "INCIDENT_RESOLVED", id, v.reason);
    return { ok: true };
  }
  @Get("inbox") async inbox(@Req() req: Request) {
    const a = await actor(req);
    return db.inbox
      .findMany({
        where: { tenantId: a.tenantId, status: "QUARANTINED" },
        select: {
          id: true,
          updateId: true,
          status: true,
          error: true,
          createdAt: true,
        },
        take: 100,
        orderBy: { createdAt: "desc" },
      })
      .then(json);
  }
  @Post("inbox/:id/replay") async replay(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    const a = await actor(req);
    owner(a);
    const v = reasonInput.parse(input);
    const inbox = await db.inbox.findFirst({
      where: { id, tenantId: a.tenantId, status: "QUARANTINED" },
    });
    requireThat(inbox, 404, "Quarantined inbox record not found");
    await locked(inbox.botId, async (tx) => {
      await tx.inbox.update({
        where: { id },
        data: { status: "PENDING", error: null },
      });
      await enqueue(
        tx,
        { id: inbox.botId, tenantId: a.tenantId },
        "INBOX",
        `replay:${id}:${crypto.randomUUID()}`,
        { inboxId: id },
      );
      await tx.audit.create({
        data: {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: "INBOX_REPLAY",
          target: id,
          reason: v.reason,
          result: {},
        },
      });
    });
    return { ok: true };
  }
  @Get("export") async exportData(@Req() req: Request) {
    const a = await actor(req);
    owner(a);
    await audit(
      a,
      "DATA_EXPORTED",
      a.tenantId,
      "Owner requested scoped JSON export",
    );
    return json({
      subscribers: await db.subscriber.findMany({
        where: { tenantId: a.tenantId },
      }),
      payments: await db.payment.findMany({ where: { tenantId: a.tenantId } }),
      refunds: await db.refund.findMany({ where: { tenantId: a.tenantId } }),
    });
  }
  @Get("operator") async operator(@Req() req: Request) {
    const a = await actor(req);
    requireThat(
      config.OPERATOR_TELEGRAM_IDS.split(",").includes(a.telegramId.toString()),
      403,
      "Platform operator permission required",
    );
    await audit(
      a,
      "OPERATOR_VIEW",
      "platform",
      "Bounded cross-tenant operational inspection",
    );
    return {
      incidents: await db.incident.findMany({
        where: { status: "OPEN" },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
      jobs: await db.job.findMany({
        where: { status: "DEAD" },
        select: {
          id: true,
          tenantId: true,
          kind: true,
          status: true,
          error: true,
        },
        take: 100,
      }),
    };
  }
  @Post("webhooks/:endpoint") async ingress(
    @Param("endpoint") endpoint: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return receiveWebhook(
      endpoint,
      String(req.headers["x-telegram-bot-api-secret-token"] ?? ""),
      body,
    );
  }
}
@Module({ controllers: [Api] })
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new Errors());
  app.useGlobalInterceptors({
    intercept: (_context, next) =>
      next
        .handle()
        .pipe(map((value) => (value === undefined ? null : json(value)))),
  });
  app.use(expressJson({ limit: "256kb" }));
  const limits = new Map<string, { count: number; until: number }>();
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    const webhook = req.path.startsWith("/api/webhooks/");
    const key = `${req.ip}:${req.path.startsWith("/api/auth/") ? "auth" : webhook ? "webhook" : "app"}`;
    const current = limits.get(key);
    const bucket =
      current && current.until > Date.now()
        ? current
        : { count: 0, until: Date.now() + 60000 };
    bucket.count++;
    limits.set(key, bucket);
    if (limits.size > 10000)
      for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
    if (
      bucket.count >
      (webhook ? 1000 : req.path.startsWith("/api/auth/") ? 15 : 300)
    ) {
      res.status(429).json({ error: "Too many requests. Retry in a minute." });
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !webhook) {
      if (req.headers.origin !== config.APP_ORIGIN) {
        res.status(403).json({ error: "Invalid request origin" });
        return;
      }
      if (req.path !== "/api/auth/dev") {
        try {
          const s = await getSession(req.headers.cookie);
          const supplied = String(req.headers["x-csrf-token"] ?? "");
          requireThat(
            supplied && equalHash(supplied, hash(s.csrf)),
            403,
            "Invalid CSRF token",
          );
        } catch (e) {
          res.status(e instanceof AppError ? e.status : 403).json({
            error:
              e instanceof AppError ? e.message : "Session validation failed",
          });
          return;
        }
      }
    }
    next();
  });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("TeleTier API")
      .setVersion("0.1")
      .addCookieAuth("tt_session")
      .build(),
  );
  // OpenAPI intentionally contains no provider secrets or development credentials.
  SwaggerModule.setup("api/docs", app, document);
  app.enableShutdownHooks();
  return app;
}
if (process.env.VITEST !== "true") {
  const app = await createApp();
  await app.listen(config.API_PORT, config.API_HOST);
  console.log(
    JSON.stringify({
      event: "api_started",
      port: config.API_PORT,
      fake: config.TELEGRAM_FAKE,
    }),
  );
}
