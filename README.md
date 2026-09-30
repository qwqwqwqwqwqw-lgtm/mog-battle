# MOGG BATTLE

Telegram Mini App: https://t.me/MoggBattleGameBot?startapp

Static UI is served by GitHub Pages. Telegram authentication, game mutations, Stars delivery and public photo storage are handled by Supabase Edge Functions and trusted database RPCs. No service credentials belong in the frontend or this repository.

## Product

Vote without uploading a photo → claim FIRST LIGHT → add your own photo → invite a friend to a 60-second duel → share a real result. Ranked retains the existing five-vote quorum and rating system. NPCs are labelled; no synthetic votes are counted as people. Cosmetics change presentation only.

The paid full looks contain a frame, background and title. Delivery uses Telegram's verified successful-payment webhook. Request replays do not multiply rewards or purchases. A confirmed refund removes the corresponding Stars items. Existing player balances, ratings and inventory were preserved.

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
deno test --allow-read --allow-env tests/portrait_test.ts
```

`tests/database.sql` verifies the real database functions inside a transaction, then rolls fixtures back. Run it in the trusted Supabase SQL editor. The frontend tests and SQL assertions do not replace a real payment receipt or a manual check in iOS/Android Telegram.

## Operations

Deploy both migrations before the new Edge Functions. Function entrypoints are under `supabase/functions/<name>/index.ts`; include `_shared/portrait.ts` and `_shared/raster.ts`. `player-api` authenticates signed Telegram initData, `telegram-bot` verifies the existing webhook secret, and `game-worker` verifies its private per-project secret; they use custom authentication instead of Supabase user JWTs.

Required project secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`. They are already managed by the project. The result-worker secret is generated in a private database schema and is never shipped to the browser. Cron leases group result deliveries with bounded retries. It sends only when a finished battle has an actual Telegram message to update.

Check open support requests and failed deliveries daily using `docs/metrics.sql`. `/terms`, `/support`, `/paysupport` and `/deleteaccount` are available in the bot. Game rules and operator information are in `rules.html`.

For an approved Stars refund, the operator must first confirm the refund through Telegram's `refundStarPayment`, then mark that exact order `refunded` in Supabase. The database removes paid bundle contents. Never mark an order paid manually to solve a support ticket. Account deletion is an operator-reviewed support flow, not automatic deletion from a public request.

Rollback: the frontend baseline is Git commit `57608915c23d7396491c5129e4fd676b8db9029f`. Original function versions before this release: player-api v29, telegram-bot v22. Restore compatible frontend and function versions together; additive tables can remain. Do not apply `docs/rollback-functions.sql` automatically: this release did not replace those legacy SQL functions.

## Launch

[Plan, five verified creator contacts, ready-to-send messages and video scripts](docs/launch-plan.md).
[Campaign and support queries](docs/metrics.sql).

There is no promised player income, wallet connection or purchased placement in this release. Pricing and creative choices are hypotheses to validate with real human cohorts.
