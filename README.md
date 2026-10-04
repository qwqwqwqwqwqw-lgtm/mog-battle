# MOGG BATTLE

Telegram Mini App: https://t.me/MoggBattleGameBot?startapp

Static UI is served by GitHub Pages. Telegram authentication, game mutations, verified partner rewards and public photo storage are handled by Supabase Edge Functions and trusted database RPCs. No service credentials belong in the frontend or this repository.

## Product

Vote without uploading a photo → claim FIRST LIGHT → add your own photo → invite a friend to a 60-second duel → share a real result. Ranked retains the existing five-vote quorum and rating system. The arena opens on human pairs; NPC-vs-NPC filler is neither generated nor returned. Quick matchmaking waits for people. An optional practice button explicitly starts a non-rated game against a labelled virtual opponent; votes still come only from people. Cosmetics change presentation only.

The current release focuses on human photo battles, ratings and optional verified partner tasks. New Stars invoices and virtual opponents are disabled. Existing player balances, ratings, inventory and previous-payment support are preserved. Generated NPC portraits and cryptocurrency assets have been removed from the client.

## Local verification

```
npm install
npx playwright install chromium
npm run check
npm test
```

The UI test starts its own local HTTP server and mocks Telegram and backend responses. It never buys anything or sends messages. For an existing Chromium binary set `CHROMIUM_EXECUTABLE=/absolute/path/to/chrome`. Screenshots are optional: `QA_SCREENSHOTS=/absolute/existing/directory`.

Edge checks (Deno 2; package versions are pinned in imports):

```
deno check supabase/functions/player-api/index.ts supabase/functions/telegram-bot/index.ts supabase/functions/game-worker/index.ts
deno test --allow-read --allow-env tests/portrait_test.ts tests/partners_test.ts
```

`tests/database.sql` verifies the real database functions inside a transaction, then rolls fixtures back. Run it in the trusted Supabase SQL editor. The frontend tests and SQL assertions do not replace a real partner membership check or a manual check in iOS/Android Telegram.

## Operations

Deploy the migrations before the new Edge Functions. Function entrypoints are under `supabase/functions/<name>/index.ts`; include `_shared/portrait.ts`, `_shared/raster.ts` and `_shared/partners.ts`. `player-api` authenticates signed Telegram initData, `telegram-bot` verifies the existing webhook secret, and `game-worker` verifies its private per-project secret; they use custom authentication instead of Supabase user JWTs.

Required project secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`. They are already managed by the project. The result-worker secret is generated in a private database schema and is never shipped to the browser. Cron leases group result deliveries with bounded retries. It sends only when a finished battle has an actual Telegram message to update.

Check open support requests and failed deliveries daily using `docs/metrics.sql`. `/terms`, `/support`, `/paysupport` and `/deleteaccount` are available in the bot. Game rules and operator information are in `rules.html`.

For an approved Stars refund, the operator must first confirm the refund through Telegram's `refundStarPayment`, then mark that exact order `refunded` in Supabase. The database removes paid bundle contents. Never mark an order paid manually to solve a support ticket. Account deletion is an operator-reviewed support flow, not automatic deletion from a public request.

Rollback: the frontend baseline is Git commit `57608915c23d7396491c5129e4fd676b8db9029f`. Original function versions before this release: player-api v29, telegram-bot v22. Restore compatible frontend and function versions together; additive tables can remain. Do not apply `docs/rollback-functions.sql` automatically: this release did not replace those legacy SQL functions.

## Launch

[Plan, five verified creator contacts, ready-to-send messages and video scripts](docs/launch-plan.md).
[Campaign and support queries](docs/metrics.sql).

There is no promised player income, wallet connection or purchased placement in this release. Pricing and creative choices are hypotheses to validate with real human cohorts.

## Ready-to-post promotion kit

Open `promo.html` to download one of three 1080×1350 PNG posters and copy its matching caption. Referral captions require the player's own link from their profile. Generate and check posters with `node tests/promo.cjs` (Playwright browser required). Current launch approach is ordinary posts, short videos, genuine player referrals and creator partnerships; the original event-based plan is archived.

## Partner release

[Barter setup, campaign attribution, reward verification and launch checklist](docs/partner-launch.md). Partner campaigns start empty until a real agreement is made. All rewards use internal Points and never increase RP.
