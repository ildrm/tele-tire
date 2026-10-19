# TeleTier

A locally runnable Telegram Stars membership manager with a Next.js creator dashboard, NestJS API, PostgreSQL financial ledger and durable inbox/outbox, and a BullMQ worker.

The supplied prompt is preserved in [docs/source-prompt.md](docs/source-prompt.md), and developed into a concrete contract in [docs/IMPLEMENTATION_PROMPT.md](docs/IMPLEMENTATION_PROMPT.md). [FEATURE_TRACEABILITY.md](FEATURE_TRACEABILITY.md) records P0 coverage and [IMPLEMENTATION_STATE.md](IMPLEMENTATION_STATE.md) records actual verification and release gaps. This is a tested local implementation; live Telegram integration and production release remain gated.

## Run locally

Requires Node 26, pnpm 12.14.0, Docker Compose (or PostgreSQL 17 and Redis 7.4). Install pnpm with `npm install --global pnpm@12.14.0`, or invoke it using `npx --yes pnpm@12.14.0`.

```sh
cp .env.example .env
openssl rand -hex 32
# Put the generated value in TOKEN_ENCRYPTION_KEY in .env.
# For an explicitly simulated local workspace set DEV_LOGIN=true and TELEGRAM_FAKE=true.
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open **http://localhost:3000**. The local test login appears only when deliberately enabled. The seed creates The Learning Room with three plan types, simulated charges, paid access and pending joins. It makes no real Telegram calls and preserves an existing workspace. Without fixture flags, configure the real platform OIDC client and connect a creator bot through the dashboard.

API listens on `127.0.0.1:4000`, web on port 3000; PostgreSQL/Redis default to localhost 5432/6379. A public HTTPS origin is required for actual Telegram webhooks. API specification is served at `/api/docs` through the web proxy. The local `.env` is private and ignored by Git.

## Verify

```sh
pnpm db:prepare-tests
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Tests use explicitly named disposable databases `teletier_test` and `teletier_e2e` on the configured PostgreSQL server. They **truncate those test databases**, never the development database. PostgreSQL credentials need permission to create the test databases, or a database administrator must create them first. Redis must be available for the real BullMQ contract test.

If the Chromium download is unavailable and Chrome is installed, run `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`. Browser tests use a separate API on 4002, web server on 3002, isolated browser profile, isolated Next.js output directory and E2E database. They exercise creator onboarding, explicit terms acceptance, payment, pending access, observed join, expiry, safe restoration, mobile layout and accessible control names. Fake Telegram evidence is not live Stars evidence.

## Source map

| Path                      | Responsibility                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web`                | Landing/login, responsive creator dashboard, setup and management forms                 |
| `apps/api/src/main.ts`    | REST, session authorization, origin/CSRF limits, webhooks, OpenAPI                      |
| `apps/worker/src/main.ts` | BullMQ wake-up relay, database polling, lifecycle sweeps                                |
| `packages/domain/src`     | Amount/identity validators, exact durations, effective access rules                     |
| `packages/telegram/src`   | Redacted HTTP adapter, test environment, invoice contract, fake provider                |
| `packages/app/src`        | Authentication, encryption, setup, payments/refunds, access, bot UX, reconciliation     |
| `packages/db`             | Prisma schema, four SQL migrations, composite ownership constraints and immutable facts |
| `tests`                   | Domain, signature/HTTP, PostgreSQL/concurrency, Redis and browser tests                 |

Bot commands include `/start`, `/plans`, `/status`, `/renew`, `/cancel`, `/support`, `/paysupport`, `/terms`, `/privacy`, `/quiet` and `/reminders`. Payment authority comes only from authenticated Telegram successful-payment updates. Entitlement and observed chat membership are separate.

## Operating and release documentation

- [Product requirements and P1/P2 backlog](docs/PRD.md)
- [Architecture, ADRs and state transitions](docs/architecture.md)
- [Telegram source evidence and policy gates](docs/telegram-compliance.md)
- [Threat model](docs/threat-model.md)
- [Operations, credentials, backup/restore and rollback](docs/runbook.md)
- [Live test-environment checklist — not yet verified](docs/live-test-checklist.md)

The Dockerfile supports web, API and worker entrypoints. Use a dedicated staging database and `TELEGRAM_ENV=test` for Telegram's real test environment. Production rejects fake Telegram and development login. Managed KMS/key rotation, live OIDC/Stars tests, a production recovery drill, deployment validation and qualified policy/security review are pre-launch blockers. Automated deletion intake/erasure and all P1/P2 modules remain explicitly deferred. No external digital-payment bypass, fiat settlement, affiliate payouts or compliance certification is claimed.
