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
