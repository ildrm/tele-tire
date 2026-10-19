# Live integration checklist — NOT VERIFIED

Record bot/client IDs (no secrets), environment, tester, timestamp, stable local record IDs and observed provider outcome for each test. Use Telegram's dedicated Stars test environment described in [official payments documentation](https://core.telegram.org/bots/payments-stars). Configure TELEGRAM_ENV=test in a dedicated isolated staging deployment/database with its own test-environment bots. The adapter then uses the official /test/ Bot API route. Never switch a live tenant's environment or reuse its database for testing.

- Register platform OIDC client, exact allowed origin and callback; perform login/logout, nonce/state replay, expired token and wrong audience tests with actual Telegram.
- Connect an independently owned creator bot, review existing webhook takeover and verify public HTTPS secret delivery. Exercise token and webhook-secret rotation.
- Enroll a private channel and private supergroup; reject public chat, non-admin creator and missing bot invite/restrict rights.
- Review/accept a published policy in the private bot. Buy each 30-day recurring / 90-day / 365-day prepaid product in test mode; verify exact XTR receipt and charge ID.
- Observe real recurring charge fields/expiration and duplicate delivery. Confirm native cancellation preserves the paid term; determine provider behavior after full refund.
- Copy a join-request link to an unpaid account and confirm rejection. Confirm paid approval followed by observed membership. Remove bot rights and verify truthful degraded status.
- Expire/reconcile access, confirm old invitations cannot rejoin, renew and restore only a proven platform ban. Apply independent human moderation and verify automation preserves it.
- Perform a real test-environment refund, reconcile the refunded_payment update and matching getStarTransactions outgoing transaction. Confirm original payment remains immutable and later valid intervals remain effective.
- Exercise bot-blocked DMs, 429 retry_after, provider timeout and uncertain refund recovery. Never infer a failed charge merely from missing messages.
- Test restored database/outbox, Redis restart, API/worker crash at commit/effect boundaries and multi-worker races.
- Complete qualified human security/privacy/consumer/refund/tax/platform-policy review, domain/trademark review, key management, backup restore and rollback drills.

Do not call the application production-ready until these gates have recorded real outcomes.
