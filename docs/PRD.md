# TeleTier product requirements

TeleTier helps educators sell access to private Telegram communities using a creator-owned bot and Telegram Stars. The platform does not custody, split, convert or settle creator Stars. Every user-visible metric must identify its measurement, period, currency and observed versus desired state.

## P0 journeys and acceptance

1. **Creator setup**: verified platform OIDC login → workspace → encrypted creator bot token → explicit webhook handover → private chat authority and bot rights → READY. Given a public chat, missing bot rights, or non-admin creator, enrollment must fail with remediation. Test: integration case 1–2 and HTTP authorization tests.
2. **Product**: publish a versioned support/terms/privacy policy → create plan with chat grants → share bot start link. Given a price change, prior accepted purchase snapshots remain immutable. Recurring price ≤10,000 integer Stars; 90/365-day products are prepaid.
3. **Purchase**: private bot user reviews an offer → accepts its policy version → buyer-bound invoice → bounded synchronous pre-checkout → authenticated successful charge → immutable ledger and grants → durable access intent. Client assertions never issue access. Tests cover wrong secret, identity, amount, currency, TTL, replays and simultaneous delivery.
4. **Access**: entitled member receives short-lived join-request invitation → requesting Telegram ID is checked → Telegram request approved → membership separately observed. Given expiry, check all alternative grants and admin status before removing. Given a human moderation ban, never restore automatically.
5. **Lifecycle**: renew only after a distinct observed charge, use provider expiration, cancel future renewal without shortening paid access, confirm refunds before revoking their intervals, issue optional idempotent reminders and creator-specific /paysupport.
6. **Operations**: inspect accurate XTR totals, members, charges, refunds, notifications and append-only audit. Retry safe jobs; reconcile uncertain financial outcomes before repeating them. Scoped JSON export and retention support documented privacy handling.

## Product decisions

- One creator bot per workspace, multiple private chats, multiple plans and union of grants.
- Owner role only in P0. Platform operators are an explicit numeric-ID allowlist and every view is audited.
- Period filters use UTC, display dates use the workspace IANA timezone.
- A purchased membership can be paid but not joined; never call that active membership.
- Native Telegram subscriptions are 30-day periods. No claim of calendar-month, quarterly, annual or trial native recurrence.
- Native channel subscription invite links are not combined with invoice products.
- Financial/audit facts remain append-only. Applicable retention and erasure decisions require a documented human policy.

## Deferred backlog and acceptance contracts

| Priority | Module                 | Next concrete implementation                                                          | Acceptance gate                                                                        |
| -------- | ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1       | Team roles             | Invite membership, per-action view/refund/override/content grants, owner revocation   | Cross-tenant and role-change tests; owner-only refunds cannot be escalated             |
| P1       | Private content        | Scanned uploads, collections, signed download delivery and plan grants                | Expired entitlement and another tenant's URL cannot read a file; no DRM claims         |
| P1       | Mini App               | Bot-scoped HMAC/freshness validation, plan/status/content views                       | Forged or stale initData rejected; never trust initDataUnsafe                          |
| P1       | Creator SaaS billing   | Separate web-only billing subsystem and provider integration                          | Written provider/channel/legal decision first; never alter member XTR settlement       |
| P1       | Analytics/export       | Cursor filters, formula-safe CSV, measured churn/cohorts, localization                | Denominators and time windows tested; no fabricated settlement or LTV                  |
| P1       | Data lifecycle         | Verified request intake, legal retention decision and automated erasure/anonymization | Cannot erase required money facts or another tenant's data; request completion audited |
| P2       | Referral attribution   | Signed campaign/source events, attribution window and reversal                        | Reject self-referrals, replay and copied-link misattribution                           |
| P2       | Affiliate tracking     | Pending/earned/void commission facts and review queue                                 | Refund reversal; no payout unless provider capability and legal approval verified      |
| P2       | Campaigns/drip         | Opt-in segmentation, unsubscribe, timezone scheduling and idempotent release          | Opt-out and revoked-content access honored on replay                                   |
| P2       | Retention/integrations | Precise cohort reporting, scoped webhooks and usage limits                            | Measured evidence, HMAC and tenant isolation tests                                     |

P1/P2 are not implemented and are not represented as working navigation entries. External P0 integration and production release gates must pass before expansion.
