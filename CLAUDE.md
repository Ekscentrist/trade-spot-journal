# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Personal Spot-trade monitor & journal for OKX, Bitget and Gate. Private WebSockets stream order fills into MySQL (Prisma), fills are announced in Telegram, and a Vue admin lets the user link sells to buys, close deals, track realized/unrealized PnL, "stake" buys (move coins to exchange Earn), archive orders and move buys between exchanges. README.md is in Russian; UI strings and code comments are in English.

## Commands

Backend (repo root, NestJS 12, ESM — `"type": "module"`):

```bash
npm run start:dev          # watch mode, listens on 127.0.0.1:${PORT:-3001}, prefix /api
npm run build              # nest build -> dist/
npm run lint               # oxlint src/ test/
npm run format             # prettier (single quotes, trailing commas)
npm test                   # vitest unit tests (**/*.spec.ts)
npx vitest run src/orders/trade-math.spec.ts   # single test file
npx vitest run -t "name"   # single test by name
npm run test:e2e           # vitest e2e (test/*.e2e-spec.ts) — boots full AppModule, needs DB
npx prisma db push         # apply prisma/schema.prisma to MySQL (no migrations dir)
npx prisma generate
```

Admin (`admin/`, Vue 3 + Vite, separate package.json):

```bash
cd admin && npm run dev     # Vite dev server, proxies /api -> 127.0.0.1:3001
cd admin && npm run build   # vue-tsc -b && vite build -> admin/dist
```

Production on this host: systemd unit `trade` runs `node dist/main.js` from `/var/www/trade` as www-data with `.env`; nginx serves `admin/dist` and proxies `/api`. Deploying a backend change = `npm run build` then `systemctl restart trade`; admin change = `cd admin && npm run build`.

## Architecture

**Imports use `.js` extensions** (NodeNext ESM) even for `.ts` sources — keep that when adding imports.

**Exchange abstraction.** `src/exchange.ts` defines `EXCHANGES = ['okx','bitget','gate']`, `parseExchange()` (defaults to okx) and is mirrored in `admin/src/exchange.ts`. Adding an exchange touches: this list, Prisma `Setting` credential columns, a `src/<ex>/` module set, `src/orders/<ex>-ticker.ts` + `tickers.ts`, settings controller/service, Earn routing in `OrdersService.moveEarnForBuy`, and the admin.

**Per-exchange module layout** (`src/okx`, `src/bitget`, `src/gate`, all parallel):
- `<ex>.service.ts` — private WS client (`OnModuleInit` connect, ping, 5s auto-reconnect, `getStatus()`, `reconnect()` called by SettingsController after credentials change). It normalizes exchange messages into the OKX-shaped `FillPayload` (`src/orders/orders.service.ts`): `instId` is always `BASE-QUOTE` (e.g. Bitget `BTCUSDT` -> `BTC-USDT`), `state` is OKX-style (`filled`/`partially_filled`/...). It calls `OrdersService.upsertFill()`, then sends Telegram and `markNotified()`. Messages are processed serially through a promise chain.
- `<ex>-rest.ts` — signed REST helper (HMAC), amount formatting/dust helpers.
- `bitget-fee.ts` / `gate-fee.ts` (with specs) — fee extraction is non-trivial: Bitget may report fees only in `feeDetail` (JSON rows), Gate splits them across `fee`/`fee_currency`, `gt_fee` (paid in GT) and `point_fee`. Change fee parsing there, not inline in the WS service.
- `<ex>-earn-fund.service.ts` + `<ex>-earn.controller.ts` in a separate `<ex>-earn.module.ts` — Spot↔Earn transfers (OKX Simple Earn, Bitget Flexible Savings, Gate Uni Earn) and the USDT/USDC stables panel. Earn modules deliberately do **not** depend on OrdersModule (OrdersModule imports them), avoiding cycles; WS modules use `forwardRef` for Settings/Orders/Telegram.

**OrdersService (`src/orders/orders.service.ts`) is the domain core:**
- `Order` rows are unique on `(exchange, ordId)`; `upsertFill` decides `shouldNotify`.
- Linking: a sell gets `matchedBuyId` + `allocatedSz`; same exchange/instrument, not staked/archived, total allocated ≤ buy size. Partial sells are allowed.
- `maybeCloseBuy`: when linked sells cover ≥ `CLOSE_THRESHOLD` (0.99) of the buy, a `Deal` is created in a transaction and `dealId` is set on the buy and its sells. Orders with `dealId` are immutable for link/stake/move operations.
- `stakedAt` hides a buy from Open into Staking (still MTM-valued); stake/unstake then calls `moveEarnForBuy` to move the remaining base size to/from Earn. Earn failures only notify Telegram — the DB flag is never rolled back.
- `changeExchange` moves a buy plus its open linked sells to another exchange (unstaking first if needed, checking ordId conflicts).
- Archive lifecycle: `archivedAt` removes an unlinked, unstaked, non-deal order from Open into Archive (`GET /orders/archive`, `POST :id/archive|unarchive`). `DELETE /orders/:id` is a soft delete (`deletedAt`), allowed only on archived non-deal orders; deleted orders are excluded from every list and `upsertFill` never notifies them (fills still upsert, so the row is not recreated).
- Mutating endpoints return refreshed `open`/`staking` lists so the admin can re-render without refetching.

**Numbers are strings.** Prices/sizes/fees are stored as `VarChar` strings; all math lives in `src/orders/trade-math.ts` (`parseNum`, `orderSize`, `orderPrice`, `feeInQuote`, `calcRoundTrip`, `formatNum`, `cleanDecimal` which strips binary-float noise). Fees in the base currency are converted to quote at trade price. Unit tests: `trade-math.spec.ts` plus the fee-parser specs. The admin mirrors parts of this client-side in `admin/src/num.ts` and `admin/src/stables.ts` (stablecoin spent/received per order, shown on Orders and Archive).

**MTM prices** come from public ticker REST per exchange (`src/orders/tickers.ts` dispatches).

**Config split.** `.env` holds only `DATABASE_URL`, `JWT_SECRET`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `PORT`. Exchange API keys and Telegram bot/chat are stored in the single-row `Setting` table (id=1), edited via `/api/settings` (secrets masked in responses; `SettingsService.getRaw()` returns unmasked for internal use).

**Auth.** Single admin login -> JWT (`src/auth`); controllers use `JwtAuthGuard`. Global `ValidationPipe({ whitelist, transform })` — DTOs with class-validator are required for request bodies or fields are stripped.

**Admin SPA** (`admin/src`): `api.ts` fetch wrapper (token in localStorage `trade_token`, 401 -> /login), views `OrdersView` (open buys/sells, drag-and-drop linking, Earn panel, transfer modal), `StakingView`, `DealsView`, `ArchiveView` (single list, restore/delete), `SettingsView`. Selected exchange is a header switcher passed as `?exchange=` to the API.

## Conventions

- Commit messages: Conventional Commits with optional scope, e.g. `feat(admin): ...`, `fix(okx): ...`.
- Lint config (`oxlint.json`) allows `any`; floating promises warn — use `void` for intentional fire-and-forget.
