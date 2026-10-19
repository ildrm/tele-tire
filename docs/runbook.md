# Operating TeleTier

## Local services

Use Node 26 and pnpm 12.14.0. Copy .env.example to .env, supply a 32-byte hex encryption key, start PostgreSQL/Redis, install, generate Prisma, migrate and start the three processes. README contains exact commands. Enable DEV_LOGIN and TELEGRAM_FAKE only deliberately. The seed refuses live/provider mode and preserves an existing workspace.

## Bot setup / recovery

1. Register a separate platform login bot's OIDC allowed origin and callback in BotFather. Store client ID/secret through the deployment secret manager.
2. Creator signs in, connects their own bot, confirms webhook handover and enrolls a private chat after granting the bot invite/restrict rights.
3. Point PUBLIC_WEBHOOK_ORIGIN at the public reverse proxy. Forward `/api/webhooks/*` unchanged, including `X-Telegram-Bot-Api-Secret-Token`; cap body size at 256 KiB. Preserve the browser Origin for API mutations.
4. Run a dashboard health check. Fix DEGRADED status before new purchases. Membership expiry cannot be reported as successful during permission loss.
5. To rotate a bot token, issue it through BotFather, enter it in the secure dashboard form and reactivate the webhook. Do not paste production tokens into agent conversations. A same-bot rotation preserves history. A different bot is deliberately refused while the registry/history needs migration.
6. Disconnect is refused while valid grants remain. Agree an access-continuity plan and resolve memberships before disconnecting; charge history remains retained.

## Jobs / incidents

- PostgreSQL holds pending intent. The worker polls every two seconds; Redis wake-ups reduce latency. Sweep runs each minute and Star reconciliation each 15 minutes. Jobs retry up to eight attempts with exponential jitter or Telegram retry_after; dead jobs appear in Operations.
- Watch queue lag above 120 seconds and any DEAD job, DEGRADED bot or OPEN financial discrepancy. Dashboard shows current counts; worker emits redacted JSON errors. Connect these signals to your deployment alerting system; an external pager integration is not shipped.
- Fix permissions/network/provider configuration before replaying a job with a reason. Refund jobs cannot be blindly replayed through the generic repair endpoint.
- A refund left API_REQUESTED may already have succeeded. Check refund update/provider transactions first. Unmatched money records create incidents, never synthetic access. Reconcile proven outcome and escalate if still uncertain.
- Quarantined inbox metadata is available at GET `/api/inbox`; owner-only POST `/api/inbox/:id/replay` with `{confirm:true,reason}` creates a fresh durable replay intent. Use after correlating a delayed initial charge or repairing a snapshot issue. All financial checks still apply.
- Telegram errors/logs contain status codes and stable local IDs, never bot-token URLs. Do not turn on unrestricted HTTP body/URL logging in the reverse proxy.

## Backup, restore and deployment

Use encrypted scheduled backups of PostgreSQL and the credential wrapping keys. Redis is disposable for correctness; its AOF improves normal queue recovery.

```sh
pg_dump --format=custom --file=teletier.dump "$DATABASE_URL"
# Restore to a newly created isolated database; never point this at a live DB.
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" teletier.dump
```

After restore verify migrations, payment/refund counts, grant intervals, pending jobs, inbox uniqueness and decryptability with the correct key version. Start workers with Telegram egress disabled first, inspect due access/financial actions, then explicitly enable the reviewed integration. An isolated local pg_dump/pg_restore count-comparison drill passed; production disaster recovery, managed-key recovery and a timed RTO/RPO drill remain NOT VERIFIED.

Dockerfile supplies one immutable app image with web/API/worker entrypoints. Build with API_INTERNAL_URL appropriate to the internal API host. Apply migrations once with a migration role, start API (API_HOST=0.0.0.0 inside its container), worker and web behind HTTPS. Runtime secrets include DB/Redis URLs, encryption key and OIDC client secret. The image deliberately contains no .env or local database files. Container build and non-root public-page HTTP startup were verified locally. External deployment is NOT VERIFIED.

Rollback application images only after checking migration compatibility. Current migrations are additive; do not roll back by deleting append-only financial tables. Back up first and prefer a forward repair migration. SIGTERM closes the worker/queue and DB; leased jobs can be recovered after restart. Capacity and multi-replica deployment need a measured staging test.

## Privacy and retention

Processed inbox bodies are minimized after configured INBOX_RETENTION_DAYS (minimum seven, default thirty). Quarantined events are preserved for investigation. Expired login attempts/sessions are removed. Charges, refunds, grants and audit facts are retained for the applicable financial/support obligations; this implementation does not invent a legally valid global retention period.

For a verified subscriber data-access or deletion request: creator support verifies the requesting account, uses the owner-scoped export, records legal retention grounds, minimizes removable display/contact data and records completion in audit. No automatic destructive erasure UI is shipped. Request intake automation and tested erasure/anonymization are explicit OPS-06/P1 gaps.
