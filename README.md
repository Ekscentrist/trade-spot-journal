# Trade — Spot monitor & journal (OKX + Bitget)

Личный сервис для учёта Spot-сделок на OKX и Bitget: исполнения приходят по WebSocket, пишутся в MySQL, уведомления уходят в Telegram. В админке на Vue можно переключать биржу, связать sell с buy и считать PnL.

## Стек

- **Backend:** NestJS (TypeScript), Prisma, MySQL
- **Realtime:** OKX / Bitget private WebSocket (`orders` / SPOT)
- **Market data:** exchange public tickers (mark-to-market PnL)
- **Frontend:** Vue 3 + Vite (тёмная админка)
- **Infra:** nginx + systemd

## Что умеет

- Мониторинг Spot fills по API key (OKX и Bitget)
- Переключение биржи в шапке админки
- Telegram-уведомления о исполнениях
- Ручная привязка sell → buy (drag-and-drop), частичные продажи
- Закрытие в **Deal** при продаже ≥99% объёма покупки
- Realized PnL в Deals (минус комиссии)
- Unrealized / MTM PnL по открытым buy (текущая цена × остаток)
- Staking: временно убрать buy из открытых с живым uPnL
- Архивация buy/sell
- Фильтры по монетам, JWT-админка
- **OKX Simple Earn (Spot mode):** после buy — если монета доступна в Flexible Earn, кладётся туда; после каждого fill — проверка `liab`, redeem из Earn и погашение через `spot-manual-borrow-repay`


## Структура

```
src/           Nest API (auth, settings, orders, deals, okx, bitget, telegram)
admin/         Vue SPA
prisma/        схема БД (Order, Deal, Setting)
```

## Запуск

```bash
# API
cp .env.example .env   # DATABASE_URL, JWT_SECRET, ADMIN_LOGIN, ADMIN_PASSWORD
npm install
npx prisma db push
npm run start:dev

# Admin
cd admin && npm install && npm run dev
```

Ключи бирж и Telegram задаются в Settings админки (не в `.env`).

Прод: `npm run build`, `cd admin && npm run build`, systemd-сервис `trade`, nginx раздаёт `admin/dist` и проксирует `/api`.

## API (кратко)

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/api/auth/login` | JWT |
| GET/PUT | `/api/settings` | OKX + Bitget + Telegram |
| GET | `/api/status` | статус WS обеих бирж |
| GET | `/api/orders/open?exchange=okx\|bitget` | открытые buy/sell + MTM |
| POST | `/api/orders/link` | связать sell с buy |
| GET | `/api/deals?exchange=okx\|bitget` | закрытые сделки + PnL |

## Безопасность

- В `.env` только админ-логин и БД; ключи бирж/Telegram — в Settings (маскируются в API)
- **Bitget:** достаточно **Read**
- **OKX:** для мониторинга — **Read**; для auto Earn/repay нужны ещё **Earn** + **Loan** (и желательно **Transfer**). **Trade** / **Withdraw** не нужны. Ограничьте ключ Trusted IP сервера.
- Не коммитьте `.env` и реальные секреты

## Лицензия

UNLICENSED — личный / портфолио-проект.
