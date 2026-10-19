# TeleTier — expanded, self-contained implementation prompt

The original requirements follow, with a normative clarification appendix at the end. Read both before implementing. The appendix resolves ambiguous technical choices; it does not waive payment, access, tenant-isolation or release-verification gates.

# TeleTier: Super-Mega Implementation Prompt

> **Use:** Paste this entire prompt into the coding agent operating in the target repository, with tool access enabled. If available, also attach `teletier_implementation_blueprint.md`. This prompt is intentionally self-contained. Set the model's reasoning effort to **high**, then give it access to file editing, shell, tests, and documentation lookup. A prompt cannot guarantee perfect implementation; independently verified test results and human policy review are release requirements.

---

## 0. Operating contract and mandate

You are the **implementation lead and hands-on senior engineering team** for **TeleTier — Telegram Paid Membership & Subscription Manager**, a secure multi-tenant SaaS that lets Telegram creators connect their own bots, sell compliant paid memberships using Telegram Stars, control access to private channels/supergroups, and manage paying subscribers.

**Your task is to IMPLEMENT a real, maintainable, locally runnable, tested application in the current repository, not merely to describe or scaffold one.** Use the tools actually available to inspect, write, migrate, run, test, and fix code. Finish a complete P0 vertical slice before spending implementation time on optional P1/P2 features. Do not claim to have executed commands, verified provider responses, deployed services or completed acceptance tests unless evidence actually exists.

### Fundamental rules

1. **Inspect first:** read existing repository contents, package manager, environment constraints, tests, conventions and version control status. Preserve working code. If the repository is empty, create the reference stack below. Do not overwrite user work without necessity.
2. **Verify external facts:** consult current *official* Telegram developer documentation before implementing method names, fields, subscription semantics, admin permissions, login requirements and payments. Pin tested library versions. If internet is unavailable, identify API assumptions explicitly and isolate them in adapters and contract tests. Do not invent Bot API endpoints.
3. **Build, don't just advise:** create all needed files, actual implementations, migrations, tests, scripts, and documentation; execute install/build/lint/typecheck/tests when tools permit; fix discovered issues. If external secrets are absent, use a fake Bot API test adapter and an explicitly opt-in development login fixture, never production-bypass defaults.
4. **No shortcuts with money or user access:** no entitlement based on a client payment callback; no double-credit for duplicate updates; no cross-tenant leakage; no unbanning independently moderated users; no external/crypto payments for in-Telegram digital goods.
5. **No unsupported guarantees:** report `VERIFIED`, `TESTED`, `ASSUMED`, `NOT VERIFIED`, and `BLOCKED` accurately. A simulated provider test is not a live Stars payment test. AI-generated content cannot certify lawfulness or security.
6. **Do not become stuck planning:** limit initial discovery to essential facts and architectural decisions, then implement. Maintain small durable checklists and documented decisions. Avoid sprawling speculative frameworks.
7. **Use disciplined continuation:** if bounded by context, preserve `IMPLEMENTATION_STATE.md` with exact completed files, commands/results, failures, remaining tasks and immediate next actions. Do not claim P0 complete when unfinished. Continue implementation in the current run as far as possible.
8. **Ask only when genuinely blocked** by unavailable legal/business credentials or an irreversible external decision. Use secure documented defaults for reversible technical choices. Never request a production bot token to be pasted into the model conversation.

### Required sequential expert perspectives (not imaginary parallel agents)

Take these perspectives *one after another* at relevant gates, with concrete work and checks:
- **Product owner / BA:** map requirements to journeys, P0-P2 backlog and Given/When/Then acceptance tests; approve no ambiguous billing descriptions.
- **Solution architect:** choose boundaries, state machines, multi-tenant ownership, data and outbox strategy, ADRs.
- **Telegram API specialist:** verify Bot API, Stars billing, OIDC, webhooks, join requests, admin rights, bot limitations.
- **Payment & ledger engineer:** validate amounts, events, recurring charges, cancellation, refund, reconciliation, idempotency and concurrency.
- **Backend/database engineer:** implement schema, service authorization, APIs, durable webhooks, workers and access reconciliation.
- **Frontend/UX/accessibility engineer:** implement responsive dashboard, onboarding, error states, self-service and meaningful reports.
- **Security/privacy engineer:** attack each trust boundary, secrets path, OIDC flow, webhook, tenancy, financial action and auditability.
- **QA/SDET:** automated unit/integration/E2E, adversarial scenarios, mocked Telegram API and a documented real test-environment procedure.
- **DevOps/SRE:** Docker/local dev, CI checks, migrations, backup/restore, alerting, deployment/rollback, observability.
- **Compliance/legal reviewer perspective:** list matters requiring actual qualified human review; do not assert certified compliance.
- **SEO/growth & technical writer:** truthful SEO pages where in scope, public terminology, docs, operational handover.

For each completed major feature, briefly self-review through at least these four perspectives: domain correctness, Telegram integration, security, adversarial testing. Correct the code, not just the write-up.

## 1. Product identity, users and success

**Brand:** TeleTier.
**SEO title:** `TeleTier — Telegram Paid Membership & Subscription Manager`.
**Positioning:** `Automate Telegram Stars subscriptions, private-channel access, renewals and paid community management.`
**Initial niche:** educators and owners of paid Telegram learning groups/channels; design reusable infrastructure for additional eligible creators later.

**Actors:** platform superadmin, creator owner, future creator manager/finance/content editor, Telegram subscriber, operational service principal, Telegram Bot API, independent legal reviewer.

**Successful P0 user journey:**
1. Creator logs in safely to web dashboard using a verified Telegram identity.
2. Creator connects one bot created via BotFather, is warned about existing webhook takeover, and the platform confirms ownership of that bot token with `getMe`.
3. Creator adds the bot as administrator to an authorized **private** Telegram channel or supergroup; app verifies creator's admin authority and bot's required rights.
4. Creator configures one or more Stars-priced membership plans, explicitly maps each to distinct private chat access, and publishes a purchase/start link.
5. Subscriber opens the creator bot, sees exact Stars price, real duration, recurrence, terms/refund/support contact, explicitly accepts the versioned purchase terms, and purchases.
6. Telegram confirms a successful charge; backend binds it to the correct bot/tenant/plan/user, records it only once, and grants a time-bounded entitlement.
7. Bot sends a controlled join-request link; the *requesting Telegram user ID* is checked again before approving. Observed chat membership is stored separately from desired entitlement.
8. Reminders are sent if messaging is technically allowed; renewal extends paid-through only on observed successful charge.
9. At actual entitlement expiration, an authorized worker removes only a member with no alternative valid grants and records the Telegram response. Upon valid renewal, it restores a platform-owned ban and issues a fresh invitation.
10. Creator can view accurate active membership, pending access, XTR transactions/refunds and operational problems, and handle refund/support requests.

## 2. Non-negotiable Telegram policy and API facts to re-verify

Official sources (re-check actual current method signatures immediately before coding):
- `https://core.telegram.org/bots/payments-stars`
- `https://core.telegram.org/bots/api`
- `https://core.telegram.org/api/subscriptions`
- `https://telegram.org/tos/bot-developers`
- `https://core.telegram.org/bots/telegram-login`
- `https://core.telegram.org/bots/webapps`
- `https://core.telegram.org/bots/features`

### Payment paths

**Digital goods/services purchased inside Telegram require Telegram Stars (`currency: "XTR"`).** Do not implement Stripe, PayPal, crypto, TON, payment links to outside services, disguised gifts or redirect-based bypass for those purchases from the bot/Mini App. Physical goods and genuinely independent external websites have different requirements; do not silently fold them into this MVP.

**MVP plan types, exactly:**
- `RECURRING_30D`: Stars via `createInvoiceLink`, `subscription_period: 2592000`, `currency: "XTR"`, `provider_token: ""`; 30-day periods, not calendar months. Telegram's currently documented recurring subscription price ceiling is 10,000 Stars. Confirm current limits before coding.
- `PREPAID_90D`: Stars one-time invoice via `sendInvoice`, no native recurring period. Label *90-day prepaid membership*, not native quarterly auto-renewal.
- `PREPAID_365D`: Stars one-time invoice via `sendInvoice`, no native recurring period. Label *365-day prepaid membership*, not native annual auto-renewal.
- The Stars invoice has exactly one `LabeledPrice`. Never use floating point for XTR amounts.

**Do not confuse** `createChatSubscriptionInviteLink` with this design: paid channel-invite subscriptions are channel-only, independently managed, auto-renewing 30-day Stars access and have separate settlement/lifecycle rules. Do not combine or double-charge the same membership using both systems in the MVP. If later supported, place behind a separate integration module and explicit accounting model.

### Payment event invariants

- `answerPreCheckoutQuery` must arrive within Telegram's **10-second deadline**; process that high-priority path synchronously with strict timeouts and inexpensive checks, while safely recording the event.
- `pre_checkout_query` authorizes a possible payment, **not proof it succeeded**. Only a verified `successful_payment` update creates a charge and entitlement. A renewal may arrive long after the initial checkout expires; correlate subsequent genuine recurring charges to the established subscription and immutable original purchase terms, never require the original checkout TTL to remain active for a renewal.
- Validate webhook secret in `X-Telegram-Bot-Api-Secret-Token`, bot connection, tenant, actual buyer Telegram ID, order payload, Stars amount, plan snapshot and state before accepting a charge. The endpoint is exposed over HTTPS with an opaque per-bot route and secret; do not log token-bearing URLs.
- Store original `telegram_payment_charge_id` with global uniqueness in scope of the connected bot; support `is_recurring`, `is_first_recurring`, and `subscription_expiration_date` where Telegram provides them. On recurring renewal, use the supplied expiration instead of blindly adding 30 days or assuming an auto-charge succeeded.
- For cancellation, call `editUserStarSubscription` (after verifying current docs) and preserve access to the end of already-paid time unless a legitimate refund or explicit manual revocation dictates otherwise.
- For refunds, provide `/paysupport` and use bot-scoped `refundStarPayment` after authorization. Persist original charge, refund intent/provider outcome, the relevant `refunded_payment` event, and recompute grants. Do not delete or mutate original charges into invisibility.
- Run reconciliation using bot-scoped `getStarTransactions`, paginated and rate-limited; flag mismatches and uncorrelated provider events. Do not invent settled fiat revenue or missing failed-charge callbacks.
- A bot's Stars belong to the bot owner/creator account; TeleTier doesn't silently split or custody the Stars. TeleTier's separate B2B SaaS billing is P1 and subject to independent web/provider/legal review.

### Telegram access boundaries

- Bot must be an administrator with `can_invite_users` and `can_restrict_members` where applicable. Check per-chat capabilities; surface unsupported configurations and permission regressions.
- Only private channels and private supergroups are paywall-eligible. A public chat cannot be made exclusively paid by UI labeling. Existing legacy invitation links and other administrators can weaken exclusivity—explain this honestly.
- For controlled access, use short-lived bot-generated `createChatInviteLink` links with `creates_join_request=true` and `expire_date`, and do **not** combine `creates_join_request` with `member_limit` (incompatible). Authenticate the join request using `chat_join_request.from.id`; reject unpaid users who copy the link.
- Subscribe explicitly to the `chat_member` update type; it is not included in the default webhook update set. Track `my_chat_member` for lost bot permissions. For managed users, verify actual membership through `getChatMember` (bot must be admin for reliable checks). Do not assume Telegram lets bots enumerate all historic members.
- On expiry, `banChatMember` makes user unable to rejoin with old links while unentitled; **do not immediately unban**. On renewed entitlement, only lift a ban proven to have been imposed by TeleTier, using `unbanChatMember(...only_if_banned=true)` and a fresh invite. Never erase a separate moderator safety ban.
- Do not ban creator owners, admins, whitelisted exceptions, or members still entitled through a second plan/manual grant.
- `getChatMemberCount` measures a different concept from paid active entitlements. Display separately if included.
- Bot cannot assume it can DM a person who has never started or authorized it; private message failures are logged/retried appropriately, not counted as expired access.

### Authentication / Mini App

- Web creator dashboard: use the **platform's separate login bot** and Telegram OpenID Connect authorization code + PKCE; verify ID token signature/JWKS, issuer, audience, state, nonce where applicable, `exp`, and subject, then issue secure server-side web sessions. Verify official config/claims at implementation time. Never trust client-posted identity or Telegram username. A Telegram ID should be serialized safely (decimal string/API edge; BIGINT database).
- A Telegram Mini App is **P1**. If added, verify its `initData` HMAC with that *specific creator bot token* on the server, validate freshness of `auth_date`, and never authorize with `initDataUnsafe` alone.
- Avoid claiming advanced account recovery or a native trial/quarterly/annual recurring payment mechanism Telegram does not actually provide.

## 3. P0 feature scope (must deliver, with stable tracking IDs)

For each feature, implement UI/API/worker behavior where relevant; a database table or a mocked screen by itself does not count as implemented. Maintain `FEATURE_TRACEABILITY.md` mapping ID -> endpoints/files -> tests -> manual steps.

**Creator setup:**
- `ID-01` verified creator login/session.
- `ID-02` tenant/org creation and strict tenant context.
- `ID-03` connect, encrypt, inspect, rotate/disconnect one BYOB bot per tenant; unique Telegram bot ID across tenant registry.
- `ID-04` explicit webhook handover/config/verification and recovery.
- `ID-05` enroll private channels/supergroups only after creator's Telegram admin/owner authority and bot permissions verified.
- `ID-06` health checks for invite/restrict permissions; show re-authorization instructions.
- `ID-07` support multiple registered chats; one creator-owned bot is enough for P0.

**Products and payment:**
- `PL-01` create/edit/archive multiple plans with validated integer Star price and lifecycle state.
- `PL-02` plan-to-chat grants, including more than one chat; access union.
- `PL-03` 30-day native recurring Stars invoice-link purchase.
- `PL-04` prepaid 90- and 365-day one-time Stars purchases.
- `PL-05` immutable price/product snapshot for checkout and ledger.
- `PAY-01` opaque expiring buyer- and plan-bound checkout payload <=128 bytes.
- `PAY-02` fast, correctly validated pre-checkout response (<10s).
- `PAY-03` verified successful-payment only, order/amount/identity cross-check.
- `PAY-04` integer Stars transaction ledger with original Telegram charge reference.
- `PAY-05` webhook/update/charge idempotency, concurrency safety and recovery.
- `PAY-06` real recurring renewal event processing with original-subscription correlation even after initial quote expiration, and provider-dated expiration.
- `PAY-07` subscription cancellation without premature paid access removal.
- `PAY-08` auditable authorized Stars refunds and `/paysupport` handling.
- `PAY-09` entitlement recomputation after refunds, including competing active grants.
- `PAY-10` scheduled Telegram Star transaction reconciliation and discrepancy alerts.
- `PAY-11` honest initiated/confirmed/refunded/error status labels; no fabricated failed-payment data.

**Access and lifecycle:**
- `ACC-01` numeric verified subscriber identity.
- `ACC-02` short-lived join-request invitation workflow.
- `ACC-03` live entitlement check before approval.
- `ACC-04` observed vs desired membership state and reconciler.
- `ACC-05` expiry removal with admin/override/multiple-entitlement checks.
- `ACC-06` safe restoration from platform-owned ban.
- `ACC-07` retry/DLQ repair actions for Telegram errors/429/outages.
- `ACC-08` detect lost permissions and flag intervention, without reporting success.
- `ACC-09` audited creator-owner dated manual overrides, without changing ledger.
- `LIFE-01` explicit subscription/entitlement/access status machine.
- `LIFE-02` renewal reminders, idempotent per member/period/window, delivery result.
- `LIFE-03` subscriber `/start`, `/plans`, `/status`, `/renew`, `/cancel`, `/support`, `/paysupport`, `/terms`, `/privacy`.
- `LIFE-04` message audit and preference handling; distinguish required transaction support from marketing.
- `LIFE-05` chat-level union of entitlements.

**Dashboard, support, ops:**
- `DASH-01` scoped active entitlements, pending joins, gross/refunded/net Star figures by period.
- `DASH-02` searchable subscribers, plan, expiration, actual access and supported override actions.
- `DASH-03` searchable charge/refund/incident history with stable IDs.
- `DASH-04` consistent UTC storage/date filters with creator display timezone.
- `SUP-01` creator-specific support and payment-dispute routing.
- `SUP-02` versioned creator purchase terms, explicit pre-payment acknowledgement persisted with time/user/version, refund/support details before checkout and accessible in bot.
- `SUP-03` append-only administrative audit log.
- `SUP-04` protected platform operator views for failing tenants, webhooks and jobs.
- `OPS-01` durable database inbox/outbox, queue consumers and replay/recovery.
- `OPS-02` health, structured logs, actionable alerts and queue lag metrics.
- `OPS-03` encrypted credentials, rotation and secret redaction.
- `OPS-04` hardened auth, CSRF, input validation and least-privilege infrastructure.
- `OPS-05` local setup, migrations, CI, backup/restore, operational runbooks.
- `OPS-06` retention/deletion handling and scoped data export strategy.

**Deliberately NOT P0:** affiliate commissions/payouts; full LMS/course drip; broad marketing automation; Telegram Mini App; advanced analytics or automatic fiat conversion; free trial auto-billing; paid channel invite-link mode; automated platform SaaS invoices; external digital payment gateway offered inside Telegram. Implement stable module boundaries but do not consume P0 time building these.

### P1 implementation, after all P0 financial/access gates pass

- **Creator operations and RBAC:** creator profile/logo/support details, invite/revoke limited manager/finance/content-editor team roles, separately authorize view/refund/override actions, set plan/quota limits without terminating already-paid customer access unexpectedly.
- **Content management:** per-tenant text, images, videos, PDFs and link resources; private server-controlled file storage with validation and malware/security checks; modules/collections, plan-content grant checks, purchase visibility and purchase history. Use short-lived signed delivery URLs or Telegram-supported file delivery; only promise access/download tracking at server-visible touchpoints, never DRM or prevention of screenshots/shares.
- **Subscriber Mini App:** verified per-bot `initData` with strict timestamp freshness, responsive plan/status/content views, real Stars invoice support, server-verified confirmation, and a fallback to bot controls. P1 must not introduce alternate in-Telegram digital payment methods.
- **Creator SaaS billing:** subscription tiers/usage based on creator organizations, a separate independent web-only PSP integration only after platform/provider/legal review, and billing events separate from subscriber Star charges. Clear dunning/support; prevent silent abandonment of existing consumers.
- **Customer experience/analytics:** permissioned CSV export with formula escaping, precise churn/cohort definitions, honest recurring Stars run-rate estimates and conversion denominators, better support inbox, localization, explicit consent for optional marketing, opt-out and data-access/deletion flows.
- **Free trial/grace:** optionally manual or product-granted trial entitlements and bounded grace state with dated, audited conditions. Never represent trials as zero-price native auto-renewing Stars invoices without supported proof.

### P2 implementation, only after P1 stability and policy review

- **Referral attribution:** creator-specific deep links within Telegram start parameter limits, campaign/source/time-window attribution, server-side anti-self-referral and conversion rules, purchase/refund reversals.
- **Affiliate commissions:** pending/earned/void balances and waiting periods; human review of fraud; payout ledger and eligible disbursement only with a verified, legally permitted provider mechanism. Do not assume bot-to-user programmable Stars transfers exist.
- **Marketing campaigns:** welcomed/renewal/inactive/new-content announcements, segmentation, time-zone-safe schedules, strict opt-in for promotions, rate limits and unsubscribes. Distinguish transactional notifications.
- **Drip learning:** scheduled content releases, modules, time-limited access revocation and idempotent delivery with a clear time zone and cancellation semantics.
- **Advanced analytics and integration:** churn, retention, LTV and conversion metrics with defensible measurement definitions, exported reports, API/webhook integrations, usage metering and abuse review.

**Long-term mandate:** P0 must be fully tested first, but the entire project includes P1 and P2. If tools, credentials, and time permit, implement those phases incrementally after the respective gates; otherwise produce concrete backlog, schema/API extension points, acceptance tests and explicit incomplete status. Never claim deferred modules exist merely because a menu entry is present.

## 4. Default stack and repository shape

If the repository already uses a coherent compatible stack, **prefer adapting that stack** with short written ADR rather than rewriting it. If empty, use:

- Strict **TypeScript**, pinned `pnpm` monorepo.
- `apps/web`: **Next.js App Router**, Tailwind CSS, accessible component primitives and validated server components/actions where appropriate. No hidden business rules in client rendering.
- `apps/api`: **NestJS** HTTP/REST application with versioned REST routes, OpenAPI, request schema validation, central authorization, Telegram webhook controller and Telegram API integration services.
- `apps/worker`: independent Node/BullMQ workers for outbox relay, access reconciliation, reminders, and Star reconciliation.
- `packages/domain`: pure TS domain entities/state transitions/validators/types.
- `packages/telegram`: **grammY** and/or typed Telegram Bot API adapter, mocks/fixtures, bot-specific client creation and caching without cross-bot token mixups.
- `packages/db`: **PostgreSQL** and **Prisma** schema, migrations, constraints, seeds for local dev only, repositories.
- **Redis/BullMQ** for job scheduling/delivery. PostgreSQL inbox/outbox is durable source of work; design for worker crashes and Redis restarts.
- **Vitest/Jest** for unit/contract/integration as compatible, **Playwright** for real browser E2E.
- Docker Compose for Postgres/Redis/local services, example env file without secrets, CI workflow for format/lint/typecheck/test/build.
- Production-ready adapter interfaces for secrets/KMS and observability; no real object storage dependency before P1.

Suggested modules: `Auth`, `Tenants`, `BotConnections`, `TelegramWebhookIngress`, `Chats`, `Plans`, `Checkout`, `PaymentsLedger`, `Subscriptions`, `Entitlements`, `JoinAndAccess`, `Refunds`, `Notifications`, `Reconciliation`, `Dashboard`, `Support`, `Audit`, `Operator`.

Choose library versions by checking current stable release compatibility and **commit an exact lockfile**. Do not pretend a dependency installed successfully until a real command confirms it.

## 5. Required database/data-integrity design

Implement real migrations, foreign keys, check constraints and indexes. Use tenant ownership in **every** sensitive row; enforce it in query access as well as API guards. Tables/structures at minimum:

- `users`, `auth_identities`, `web_sessions` (verified Telegram OIDC identity, session expiry/revocation).
- `tenants`, `tenant_members` (owner, role, timezone and status).
- `telegram_bots` (global unique Telegram bot ID, tenant ID, encrypted token/key version, username, opaque webhook endpoint ID, secret verifier, handover/health status).
- `telegram_chats` (bot, tenant, Telegram chat ID, private state, type, permission checks, unique controlling tenant/chat to avoid conflicting automation).
- `plans`, `plan_versions`, `plan_chat_grants` (integer XTR, `RECURRING_30D|PREPAID_90D|PREPAID_365D`, release state and immutable snapshots).
- `subscribers` (tenant, bot, Telegram user ID, bot-contact state/preferences).
- `checkout_sessions` (opaque nonce, buyer ID, specific bot and plan version, amount, expiry, accepted terms version/time and state); `creator_policy_versions` (published terms/refund/support identity).
- `telegram_update_inbox` unique `(bot_id, update_id)` with raw minimally necessary event data under retention policy.
- `outbox_events` with status, attempts, expected version, next run, dead-letter metadata.
- `payments` append-only charge facts, unique `(bot_id, telegram_payment_charge_id)`, source update ID and subscription expiration for recurring.
- `payment_events`, `refund_requests`, `refund_events`, `star_reconciliation_cursor` and `reconciliation_discrepancies`.
- `subscriptions` (logical recurring purchase, initial charge, cancellation flag, paid-through, state transitions).
- `entitlement_grants` (date intervals, plan/payment/manual source), `desired_chat_access` or projection, `observed_chat_memberships`.
- `join_links`, `access_operations` (pending/succeeded/failed, platform-ban provenance), `manual_overrides`.
- `notifications`, `notification_preferences`, `audit_logs`, `platform_incidents`, `usage_events`.

Use PostgreSQL `BIGINT` for Telegram identifiers, with decimal-string transport to avoid unsafe 32-bit assumptions. Amounts in integer Stars; UTC timestamps and explicit time calculations; stable unique IDs. Scope sensitive relations with composite foreign keys or invariant checks. Use transactions/optimistic versions/row locks where concurrent payment and expiry jobs meet. Include indexes for `(tenant_id, created_at)`, `(tenant_id, status, expires_at)`, `(bot_id, update_id)`, `(chat_id, telegram_user_id)` as appropriate.

**The effective chat access rule is a projection:** user has access iff at least one valid, non-refunded/unrevoked plan grant, applicable grace or audited manual entitlement permits it at current time, subject to independent moderator bans. Actual Telegram membership is observed separately. Recalculate this projection rather than trusting a fragile mutable `is_paid` boolean.

**Idempotency boundary:** the same webhook can be delivered more than once and out of order; no amount can be counted twice and no grant may be duplicated. Insert verified charge + entitlement effects + outbox in one DB transaction. Retries of external Telegram API effects must check the desired state again before executing. Pre-checkout races and reused links must be guarded, and any truly duplicate charge must be surfaced for refund/recovery rather than silently credited.

## 6. State machines and workflows to implement

Define state diagrams in `docs/architecture.md` and *test transitions*.

### A. Creator connection state
`NOT_CONNECTED -> TOKEN_VERIFIED -> WEBHOOK_ACTIVE -> CHAT_PERMISSIONS_VERIFIED -> READY`, plus `DEGRADED`, `DISCONNECTED`, `REVOKED`.

Dashboard must not claim READY until webhook and required chat rights really pass. Explain before overwriting an existing webhook on a creator-owned bot. On disconnect, stop consuming events and provide a controlled plan for outstanding memberships; don't silently delete charge history. Reconfiguration is audited.

### B. Checkout state
`CREATED -> PRECHECKOUT_APPROVED -> CONFIRMED`; branches `EXPIRED`, `REJECTED`, `ERROR`, `REQUIRES_RECONCILIATION`. A `successful_payment` delivered late can still be legitimate if its pre-checkout and charge are authentic; treat timeouts as delivery problems, not grounds to discard a genuine charge.

**Pre-checkout:** find correct bot by opaque endpoint, validate secret, resolve checkout by opaque payload, lock/check nonce and buyer, compare exact integer amount and `XTR`, product active/version, tenant and state, answer within 10 seconds. Use predictable code paths and short database deadlines. Reject stale/inconsistent requests with a safe Telegram error message and audit the reason.

**Successful charge:** verify message originates in that bot's configured webhook stream and proper user identity, charge and payload; process atomically, store charge and expiration, project entitlements, create outbox side effect. Never grant on `pre_checkout_query`, payment-screen callback, screenshot, or unverified webhook. Store unexpected/unmappable charges as incidents for investigation and appropriate refund, not free access.

**Recurring renewal:** correlate to the canonical subscription and original buyer/bot/plan/price snapshot; do not reapply the initial checkout TTL or require a new pre-checkout for every automatic debit. Consume each distinct successful recurring charge once, use provider `subscription_expiration_date`, and ensure cancellation renewal status is not confused with paid-term access. Telegram permits multiple concurrent subscriptions for a user; guard creating duplicates, detect if they occur and supply an explicit recovery path.

**Prepaid:** after a verified charge, grant 90/365 days from a documented anchor (`max(now, current valid paid-through)` for same plan when renewal is eligible). No calendar-month mislabeling. If changing plans while an active recurring product exists, prevent accidental double billing by requiring an explicit later P1 upgrade/downgrade policy.

### C. Access state
`NOT_ENTITLED`, `ENTITLED_PENDING_JOIN`, `ACTIVE_MEMBER`, `GRANT_RETRY`, `EXPIRED_PENDING_REVOKE`, `REVOKED_BY_PLATFORM`, `MODERATOR_BLOCKED`, `ERROR_NEEDS_OPERATOR`.

Build independent, convergent workers:
1. Change to financial/entitlement projection queues an access-reconcile event.
2. Reconciler determines desired access using fresh database state, not stale job payload.
3. If newly entitled: if known platform ban -> lift only that ban; issue short-expiry join-request invite, send where allowed; on join request verify identity + current entitlement and approve; record chat-member observation. An invitation is not proof of actual membership.
4. If membership expired: if valid second entitlement/manual override/admin/whitelist -> retain; else remove using required admin rights, record platform-ban provenance and log outcome. Do not unban immediately after expired removal.
5. On renewal after a genuine platform-owned ban, `unbanChatMember` with `only_if_banned=true` and invite again. A separate moderation ban is not reversed automatically.
6. Periodic sweeper re-evaluates due members and observed/desired state so missed webhooks and worker crashes do not leave permanent inconsistency. Bot API does not offer full historic member enumeration; handle unknown joins via tracked `chat_member` events and warn about manual invite exposure.

### D. Refund state
`REQUESTED -> APPROVED -> API_REQUESTED -> CONFIRMED/FAILED -> ENTITLEMENTS_RECONCILED`. Authorization and reason required. Avoid irreversibly updating entitlement before provider outcome; reconcile late provider update. A refund of a prior renewal cannot void a later separately paid/unrefunded interval. Preserve immutable charge data and append correcting events.

### E. Notifications
Schedule before paid-through (choose configurable safe defaults such as 3 days and 1 day and one expiry notice), idempotent per `(subscriber, period, template)`; best effort if bot can message the user. Add sensible rate limiting and quiet hours if feasible; expose failures. Do not mix transactional support/reminders with marketing consent. All marketing blasts are P1/P2 and require opt-in and unsubscribe flow.

## 7. Required web/dashboard surfaces and bot UX

**Creator web app (responsive, desktop and mobile):**
- Marketing landing / pricing explanation, honest Stars and subscription wording; login.
- Onboarding wizard: connect own bot, webhook takeover explanation, bot health; add private channel/group, permission checklist; create plan and get test purchase link.
- Overview: active paid users, pending joins, paid-through expiries, gross/refunded/net **Stars** for date range, failed access actions and reconciliation alerts.
- Bots/chats: masked bot identity and active webhook, verified role/rights, connection repair; private chat status.
- Plans: create/edit/disable/archive, 30/90/365 durations shown truthfully, price, chat grants and buyer-facing policy.
- Subscribers: search Telegram ID/username display, status, paid-through, actual membership, available manual grant/revoke with reason and confirmation.
- Transactions: Stars amounts, charge reference, recurring flag, refund action with permissions/confirmation, audit event trace.
- Support/terms: creator-defined visible payment support details and basic support inquiry routing.
- Operational incidents: stuck bot, missing admin rights, unreachable subscribers, unresolved payment reconciliation, worker retries.
- Operator-only incident screen protected by distinct platform role.

Ensure accessibility, keyboard focus, semantic forms, loading/empty/error states, destructive action confirmation, client-visible error remediation, paginated queries, scoped server-side filtering and no leaked bot credentials or PII. Never show a green 'access granted' check merely because a purchase succeeded; show `Access pending` until Telegram membership is confirmed.

**Subscriber bot:** `/start`, `/plans`, `/status`, `/renew`, `/cancel`, `/support`, `/paysupport`, `/terms`, `/privacy`, plus inline buttons. Show correct creator identity, plan duration and Stars price, recurring vs prepaid, refund rules, next paid-through timestamp, cancel instructions and join status. On error, give a working self-service retry/support action; do not imply purchase failed just because a message could not be sent. Use Telegram formatting safely to avoid injection.

**SEO implementation, after reliable P0:** brand in site title; primary page `/telegram-paid-membership`; supportive pages `/telegram-subscription-bot`, `/telegram-channel-access`, `/for-educators`; truthful FAQ, canonical/sitemap/robots, accessible HTML and relevant `SoftwareApplication` schema if applicable. Domain/trademark clearance remains a separate human task. Do not spend P0 build cycles inventing extensive marketing copy.

## 8. Security, financial controls and operations

Threat-model and test:
- Stolen bot token; forged Telegram header; guessed webhook endpoint; webhook replay/reordered updates; reused invoices; forged Mini App initData; forged/expired OIDC ID token; session fixation/CSRF; tenant IDOR; bot shared across tenants; access grant by copying invite link; forced unban; unauthorized refund/owner impersonation; logged secrets; DB/Redis outage; high-volume spam; insecure exports.
- Protect bot token at rest with a KMS-backed secrets envelope for production; dev fallback only with deliberately supplied key. Restrict decryption to service roles, never return decrypted tokens to browser, never log Bot API URL with token, support disconnection/rotation and credential compromise procedure.
- Maintain tenancy at every endpoint and background job; put tenant/bot IDs in every event context and validate them on entry. No trust from arbitrary client-supplied tenant ID. Platform superadmin use tightly bounded and audited.
- Telegram OIDC: standard library or vetted provider; JWKS verified server-side, state+PKCE, nonce if required, issuer/audience, time checks, secure HttpOnly cookies, logout, session revocation, rate limits and anti-CSRF measures.
- Webhook ingress: HTTPS, body size caps, header secret constant-time comparison, opaque URL IDs, unknown-bot/secret rejection, structured no-PII logs, durable acknowledgment and replay protection.
- Monetary changes: integer Stars, snapshots, immutable charge events, audited refunds; never equate Stars with guaranteed fiat exchange rate, payouts or cash received.
- Admin actions: use fine-grained permissions, reason and action confirmation for refunds, disconnects and manual access overrides. Validate server-side.
- Messaging: suppress duplicates, follow bot contact rules, rate-limit and record 429 `retry_after` with jitter/backoff, observability for Telegram errors.
- Data lifecycle: clear privacy/terms and creator support contact, retention configuration and legally required financial record preservation, subscriber access/deletion and incident playbook. Do not promise global legal compliance; list local issues for human review.
- Infrastructure: least-privilege DB roles, per-environment secrets, immutable deploy images, HTTPS, migrations, CI, database backups and tested restore instructions, metrics, alert thresholds, rollback procedure, graceful shutdown and DLQ repair.

## 9. Acceptance and adversarial test matrix — mandatory

Create tests that demonstrate these **Given/When/Then** properties, not placeholder test names:

1. Given an authorized creator and valid private channel with correct rights, when a bot is connected, then the health state becomes READY only after webhook and rights check.
2. Given an unauthorized creator or public channel, when registering, then enrollment is denied with accurate remediation.
3. Given a 30-day Stars recurring plan, when purchasing, then the API uses `createInvoiceLink` and correct `XTR`/`2592000` fields; 90/365 prepaid uses one-time invoice without subscription period.
4. Given a client 'paid' callback, when no `successful_payment` exists, then no charge or entitlement is created.
5. Given a forged/wrong webhook secret or an invalid OIDC identity, when requesting mutation, then the system rejects without side effects.
6. Given mismatched buyer, tenant, amount, currency, payload, plan snapshot or expired pre-checkout, when answering checkout, or missing terms acceptance, then it rejects within the specified deadline.
7. Given valid `successful_payment`, when handled once, then exactly one immutable charge and effective entitlement exists.
8. Given simultaneous duplicate update deliveries, when handled concurrently, then no duplicate charge, access action or ledger total exists.
9. Given late legitimate successful-payment delivery after webhook retries, when replayed, then valid payment is not silently discarded due to processing delay.
10. Given a recurring renewal, when successful and carrying new provider expiration, then paid-through matches provider expiration, not a guessed period.
11. Given an auto-renew cancellation request, when Telegram confirms cancellation, then access remains until already-paid expiration.
12. Given a prepaid plan, when due, then no fabricated automatic payment occurs and member is reminded with a repurchase path.
13. Given an unpaid user with a copied invite link, when requesting to join, then their ID fails entitlement authorization.
14. Given a valid paid join request, when approved, then the system records actual access separately and can recover from transient Telegram errors.
15. Given expiry but another valid plan/manual override covering the same chat, when reconciling, then no ban is issued.
16. Given expired unentitled ordinary member, when reconciling with valid rights, then platform records a controlled ban and will not let stale links restore access.
17. Given a previously platform-banned user who renews, when reconciling, then lift only that ban and reissue invite.
18. Given a separate human moderation ban, when a person buys, then do not override ban; surface support incident.
19. Given the creator/admin account, when a mistaken expiry job runs, then it is never banned.
20. Given permission loss or Telegram 429, when access operation fails, then record pending error, retry safely and alert if stuck.
21. Given a refund of a charge, when provider confirms, then audit/ledger records refund and entitlement union is recalculated without deleting original charge.
22. Given an older charge refunded but later paid coverage exists, when recalculating, then paid coverage remains intact.
23. Given reconciliation finds an unmatched provider transaction, when scanned, then raise incident without unverified entitlement credit.
24. Given a subscriber blocked the bot, when renewal reminder is scheduled, then send failure is recorded without mutating membership/payment.
25. Given another tenant's IDs, when accessing dashboard/API/workers or modifying plans, then authorization denies every attempt.
26. Given service interruption after DB commit/before queue send, when workers recover, then transactional outbox replays exactly the outstanding intent (external calls safe on retry).
27. Given creator UI, when purchase is confirmed but Telegram join isn't, then UI says pending and provides repair, not falsely completed access.
28. Given repeated subscription link attempts, when an already-active recurring purchase would create a second subscription, then prevent/flag clearly to avoid unintentional double charge.
29. Given audit-sensitive operations, when executed, then actor/tenant/target/time/reason and external result are preserved without secrets.
30. Given public release checklist, when run, then documentation names all live-credential/manual tests not actually performed as `NOT VERIFIED`.

Testing layers:
- Unit: pure domain state machines, date arithmetic, valid grant union, refund scope.
- Provider contract: fixture-based Telegram update schemas and outbound API request assertions; fake failure/rate limit/duplicate cases.
- Integration: real test Postgres and Redis, migrations, outbox, row locks, tenancy constraints and workers.
- UI E2E: at least one full mocked creator onboarding -> paid member -> join -> expire/renew scenario and unauthorized/error states; browser accessibility smoke checks.
- External manual: documented Telegram Bot API Stars **test environment** end-to-end checklist for real bot tokens, private test channel, user accounts, purchase/refund/cancel; don't imply passing this without real credentials.
- CI: format/lint/typecheck/test/build plus vulnerability/dependency review where available.

## 10. Execution phases with mandatory evidence gates

### Phase 0 — Focused discovery and evidence
1. Print concise current repo inventory, environment/tool constraints, relevant latest official Telegram API facts, and 5-10 essential ADRs. Avoid assumptions about bot API methods when docs can be checked.
2. Create `docs/PRD.md`, `docs/architecture.md` (components, boundaries, state transitions, Mermaid diagrams), `docs/telegram-compliance.md` (Stars, support, channel limits, what needs human review), `docs/threat-model.md`, `FEATURE_TRACEABILITY.md`, `IMPLEMENTATION_STATE.md`.
3. Define P0 acceptance tests and exact data model including tenant boundaries. **Gate:** no contradictory payment requirements, every P0 feature mapped.

### Phase 1 — Foundation and credential safety
1. Create monorepo, DB/Redis Docker Compose, env schema validation, actual database migrations, role/tenant authorization, Telegram OIDC server-side login/session, bot credential encrypt/decrypt abstraction, masked bot setup, creator channel admin/permission checks, webhook `setWebhook` management.
2. Add unit/integration tests for auth, tenant isolation, bot uniqueness, missing admin rights and secret handling; run and fix them.
3. **Gate:** creator can sign in in a correctly configured environment, create tenant, connect valid bot, enroll authorized private chat; test environment uses mocks and does not claim real external linkage.

### Phase 2 — True financial vertical slice
1. Implement plan configurations and immutable snapshots, XTR recurring invoice link and prepaid invoice, checkout payload/pre-checkout handling, verified successful payment, immutable ledger, durable webhook inbox/outbox, idempotency and contract tests.
2. Add refund, recurring renewal/cancellation, transaction reconciliation with safe pagination/retries, deliberate error handling.
3. Test wrong-buyer/amount/bot/tenant, concurrency, duplicate/reordered/late events, missing subscriptions and refund regressions.
4. **Gate:** financial invariants all pass in automated tests; no access or revenue is granted on client assertions.

### Phase 3 — Access-control vertical slice
1. Build union-of-entitlements projector, short-lived join request links, checks by Telegram user ID, chat member observation, periodic expiry/reconciliation, platform-ban provenance, safe restoration, permission loss responses, reliable backoffs.
2. Implement reminders with idempotency, support commands, subscriber self-service and response logging.
3. Test all 30 mandatory scenarios relevant to completed modules; run integration/mocked E2E.
4. **Gate:** mocked full purchase -> access -> expiration -> renewal/restoration works; no wrongful ban of protected members.

### Phase 4 — Creator UX, admin and operations
1. Build responsive dashboard and onboarding wizard, plans, subscriber/transaction tables, audit, refund/support actions, operational status, operator incident view.
2. Add accurate Star metrics/date filters, error/pending state, safe session/auth UI, automation health.
3. Add telemetry, backups/runbooks, CI/deployment docs, env.example, migrations and seeds, accessibility review.
4. **Gate:** clean local install and build, typecheck, tests, documented demo and recoverable operations.

### Phase 5 — Adversarial review and release handoff
1. Re-run all automated checks; inspect authorization guards, token leakage, secret handling, tenant data access, retry correctness and ledger counts.
2. Create `docs/TEST_EVIDENCE.md`: exact commands and actual results with timestamp, test coverage limitations and red/green status.
3. Create `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/TELEGRAM_TEST_ENVIRONMENT.md`, `docs/LAUNCH_BLOCKERS.md` and README with quickstart, environment table, walkthrough, API endpoint list, database migration instructions, backup/restore, webhook registration and rollback instructions.
4. Provide outstanding items requiring Telegram credentials, payment testing, launch domain and human legal/privacy/tax review. Do **not** label production-ready if real end-to-end confirmation or necessary human compliance review is still pending.

### Phase 6 — P1 product expansion (only after P0 gates)
1. Implement private digital-content storage/library/collection permissions, creator team RBAC, Mini App identity/content/status, ethical marketing preferences, refined analytics and CSV exports.
2. Add creator SaaS billing in a **separate payment subsystem** only after documented external web/channel policy/provider/legal approval. Do not let SaaS billing change member Stars settlement records.
3. Extend migrations/API/docs and write tests for cross-tenant content, expired access to files, forged Mini App data, role changes, exports, and creator billing failure transitions.
4. **Gate:** each shipped P1 module has working UI/backend, negative authorization tests, documented provenance and actual test evidence; unapproved payment integration remains feature-disabled.

### Phase 7 — P2 monetization expansion (only after P1 gates)
1. Implement referral event attribution, refund-reversible affiliate ledger, consent-based campaigns, drip scheduler and advanced retention analytics with precise definitions.
2. Gate any actual affiliate payout on verified platform/provider capability, local legal approval, fraud controls and financial reconciliation. Offer payout **tracking** instead of fake automated payouts where no compliant mechanism is available.
3. Test copied links, self-referrals, replay, refunded sales, withheld commissions, campaign opt-out, scheduler replay and old-content authorization.
4. **Gate:** report exactly which P2 features are operational and which remain design/backlog; never hide limitations.

## 11. Output and verification format

As you work, write concise checkpoints with:

`PHASE | REQUIREMENT IDs | FILES CHANGED | COMMANDS ACTUALLY RUN | PASS/FAIL/NOT VERIFIED | RISKS/REMEDIATION`.

At the end, provide:

1. **Implemented:** only actual working features, grouped by P0 ID.
2. **Source tree summary:** important files and how to start locally.
3. **Evidence:** actual lint/typecheck/tests/build results and links/paths to test cases.
4. **Infrastructure:** migrations, services, secrets, webhook setup, backups, deploy/rollback instructions.
5. **Unverified external integration:** real Telegram Stars purchases, bot permissions, OIDC credentials, test and live environment steps.
6. **Open issues with severity:** critical launch blockers first, followed by explicit P1/P2 backlog.
7. **Security & compliance review:** documented mitigations and human legal/financial policy signoffs required.
8. **Feature traceability:** every P0 ID either implemented and tested, implemented but `NOT VERIFIED`, or explicitly incomplete—never silently omit.

For every critical issue discovered, fix and rerun its regression test. Avoid false green checklists. Prefer a smaller **correct end-to-end implementation** over an impressive but fake feature-complete UI.

## 12. Completion definition

Do **not** call the implementation finished unless:

- A clean checkout of the repo can be configured with documented development credentials and run with documented commands.
- Migrations apply from empty database; work queue/inbox/outbox survives process restarts in tests.
- Creator auth, secure bot connection, authorized private chat setup and plan configuration work.
- 30-day recurring invoice link and 90-/365-day prepaid Stars invoice requests conform to validated Telegram schemas in contract tests.
- Correct `successful_payment` event -> single ledger charge -> membership entitlement -> identity-checked join -> observed access passes integration/mock E2E.
- Expiration, safe ban/restoration, cancellation, refund, reminders and ledger reconciliation have positive and adversarial tests.
- No known critical cross-tenant, payment integrity or unauthorized-access vulnerability remains.
- Creator can manage paid subscribers and inspect accurate XTR dashboard and financial/action logs.
- CI, docs, backups, security checklist and exact test evidence exist.
- Unperformed live Telegram tests, current policy interpretations and human legal reviews are plainly marked **NOT VERIFIED** / **PRE-LAUNCH BLOCKER** rather than described as successful.

**Now inspect the current repository, establish the feature/test traceability matrix, and implement the P0 working vertical slice. Do not stop after generating a plan.**


---

# TeleTier expanded implementation contract

This repository implements the supplied `teletier_super_mega_implementation_prompt.md`. The original is preserved in `docs/source-prompt.md`. This extension resolves implementation choices and adds executable acceptance gates; it does not relax its financial or security requirements.

## Delivery priorities

Ship the complete P0 financial/access vertical slice before P1/P2. Use strict TypeScript, Next.js, NestJS, PostgreSQL/Prisma, and BullMQ. Keep business logic in a shared application package so HTTP and workers cannot diverge. Record real evidence in IMPLEMENTATION_STATE.md and map every P0 ID in FEATURE_TRACEABILITY.md. Never promote a fake Telegram response or local fixture into live integration evidence.

## Clarified invariants

1. Telegram OIDC `sub` is an opaque identity, not the Telegram user ID. Verify RS256 signature, issuer, audience, state, nonce, timestamps and PKCE, request profile scope and validate the numeric `id` claim before checking chat authority. Store both. Use an independent platform login client.
2. All tenant selection comes from a server-side session and a checked tenant membership. Decimal-string IDs at boundaries; BIGINT inside PostgreSQL; serialize safely. Mutation routes require same-origin and a session CSRF token. Development login and fake Telegram are explicit, non-production configuration only.
3. Serialize financial and access transitions using a transaction-scoped per-bot advisory lock. Insert inbox, immutable payment, grants, and durable outbox atomically. HTTP delivery success never substitutes for a durable write. Replaying a failed inbox is supported. Reject unknown update shapes and quarantine uncorrelated money events.
4. Separate message event time, receipt time, and processing time. For prepaid access anchor at the authenticated message timestamp or existing paid-through for the same plan. For recurring access use the provider expiration; preserve one grant per charge interval. A late renewal cannot shrink paid-through. Refund an individual charge interval only. Out-of-order refunds create a tombstone and prevent a later arriving charge from granting access.
5. Bind each opaque checkout to immutable plan version, buyer, bot, tenant, grants and terms version. Terms acceptance must come from a verified private bot callback. Reserve recurring checkout per buyer/plan to avoid two outstanding invoices. Match pre-checkout query ID for retries. Approve pre-checkout synchronously with bounded deadlines. No original TTL requirement for established subscription renewals or approved late successful charges.
6. External side effects are at least once. Persist operation intent before dispatch and reconcile fresh provider state after uncertainty. Database remains the work source; Redis is a wake-up mechanism. Worker lease expiration recovers crashes. Do not promise exactly-once Telegram messages. Distinguish an invitation, approved join request and observed membership.
7. Check current bot rights, privacy, creator/admin protection, independent moderation state, and the union of all valid grants before every access mutation. Never lift a human ban. Persist confirmed platform ban provenance and invalidate it when an independent moderator ban arrives. Ambiguous ban outcomes require operator review.
8. Refund intent is durable and authorized with a reason. A successful refund API response or matched refund update confirms it; timeouts require reconciliation. Never blindly retry uncertain financial writes. Subscription cancellation preserves paid-through. Charge facts cannot be edited or deleted by the app.
9. Reconciliation is bot-scoped, paginated, rate-limited and restartable. Match charge ID, amount, payload, buyer and direction; refunds may share original charge ID. Unknown provider records become incidents, not access grants. Re-scan overlap and periodically reset scan to catch late adjustments.
10. Keep creator audit facts append-only. Never return tokens, webhook secrets, identity tokens or raw inbox bodies from list APIs. Encrypt credentials with an explicitly supplied AES-256-GCM key and version; production deployment requires managed key wrapping/service isolation.

## Usable product requirements

Deliver a responsive dashboard with real APIs for overview, bots/chats, plans/policies, searchable members, financial history/refunds, audit/incident repair, and settings. Empty, loading, validation, permission and provider failure states must have useful remedies. Mark fake mode prominently. Forms must be keyboard usable with labeled inputs and focus treatment. No placeholder modules or invented metrics. Stars totals always identify the filtered period; actual access remains separate from paid status.

## Acceptance extensions

- Simultaneous charge deliveries produce one charge, one set of grants, and one durable reconcile intent.
- A refund arriving before its charge prevents any temporary access grant on delayed delivery.
- A later recurring interval remains valid when an earlier interval is refunded.
- An observed independent moderator ban invalidates old platform-ban provenance.
- Crash after committing an intent and before Redis publish is recovered from PostgreSQL.
- An expired worker lease can be reclaimed without executing stale access intent.
- OIDC sub/profile-ID confusion, forged signatures, replayed state, CSRF and cross-tenant IDs are rejected.
- A dashboard purchase remains “Access pending” until membership observation confirms it.

## Release gates and deferred work

Automated domain/provider tests, PostgreSQL integration tests, browser E2E, formatting, typecheck and production builds must have recorded commands/results. Live OIDC, Stars test-environment purchase/refund/cancel, HTTPS webhook delivery and human policy review remain explicit pre-launch gates until performed. P1/P2 remain a concrete backlog when these gates are pending; do not represent menus or schemas as shipped capabilities.
