# Telegram integration evidence and release review

Official sources checked on 2026-10-19:

- [Digital goods / Stars](https://core.telegram.org/bots/payments-stars)
- [Bot API methods and objects](https://core.telegram.org/bots/api)
- [Telegram OIDC](https://core.telegram.org/bots/telegram-login)
- [Developer terms](https://telegram.org/tos/bot-developers)
- [Bot subscriptions context](https://core.telegram.org/api/subscriptions)

Only XTR invoices are implemented. The recurring invoice adapter uses one price and a 2,592,000-second subscription period, with a 10,000-Star price ceiling. The 90/365-day products use sendInvoice without recurrence. Checkout payloads are opaque and buyer-bound. Terms acceptance is persisted before an invoice is queued. /support, /paysupport, /terms and /privacy route members to creator-specific details.

Pre-checkout is synchronously checked and answered on the webhook path. No client callback or pre-checkout grants access. Confirmed provider charge references remain stored for bot-scoped refunds and cancellation. Successful recurring events provide expiration; membership state is observed independently. getStarTransactions reconciliation records provider events and discrepancies, never automatically credits unknown income.

Controlled invites use join requests and expiration, with no incompatible member_limit. Webhook update selection explicitly includes chat_member and my_chat_member. The requesting user ID is checked before approval. Bots must administer private channels/supergroups with invitation and restriction rights. Existing administrator actions and legacy invitation links may weaken exclusivity.

The web creator uses a separate platform OIDC client with state, PKCE and nonce. Client ID/secret come from BotFather login configuration. Signed profile id supplies the Telegram numeric ID; sub is stored separately. No Mini App or external in-Telegram digital payment alternative is implemented.

## NOT VERIFIED — pre-launch gates

- Actual Telegram Stars test-environment purchase, renewal, cancellation and refund.
- OIDC authorization with a registered real client and live Telegram JWKS/claims.
- Real private channel and supergroup capability checks, join delivery, bot contact restrictions, rate limits and independent moderation timing.
- Public HTTPS reachability, webhook certificate/secret rotation and recovery of real pending updates.
- Jurisdiction-specific creator eligibility, taxes, refund/consumer rules, privacy/retention, sanctions and Telegram/App Store policy interpretation.
- Production key management, backup restore drill, deployment/rollback and capacity/load testing.

Automated fake-provider and PostgreSQL tests do not satisfy these live gates. Qualified human legal/financial/security review is required; this document is not a compliance certification. No P1 SaaS billing or P2 payout capability is approved by this implementation.
