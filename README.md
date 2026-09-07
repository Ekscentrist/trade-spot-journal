# Trade — OKX Spot monitor & journal

Личный сервис для учёта Spot-сделок на OKX: исполнения приходят по WebSocket, пишутся в MySQL, уведомления уходят в Telegram. В админке на Vue можно связать sell с buy и считать PnL.

## Стек

- **Backend:** NestJS (TypeScript), Prisma, MySQL
- **Realtime:** OKX private WebSocket (`orders` / SPOT)
- **Market data:** OKX public ticker (mark-to-market PnL)
- **Frontend:** Vue 3 + Vite (тёмная админка)
- **Infra:** nginx + systemd

## Что умеет

- Мониторинг Spot fills по read-only API key
- Telegram-уведомления о исполнениях
- Ручная привязка sell → buy (drag-and-drop), частичные продажи
- Закрытие в **Deal** при продаже ≥99% объёма покупки
- Realized PnL в Deals (минус комиссии)
- Unrealized / MTM PnL по открытым buy (текущая цена × остаток)
- Архивация buy/sell (вывод, покупки с другой биржи и т.п.)
- Фильтры по монетам, JWT-админка

## Структура

```
src/           Nest API (auth, settings, orders, deals, okx, telegram)
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

Прод: `npm run build`, `cd admin && npm run build`, systemd-сервис `trade`, nginx раздаёт `admin/dist` и проксирует `/api`.

## API (кратко)

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/api/auth/login` | JWT |
| GET/PUT | `/api/settings` | OKX + Telegram |
| GET | `/api/orders/open` | открытые buy/sell + MTM |
| POST | `/api/orders/link` | связать sell с buy |
| GET | `/api/deals` | закрытые сделки + PnL |

## Безопасность

- В `.env` только админ-логин и БД; ключи OKX/Telegram — в Settings (маскируются в API)
- Для OKX достаточно ключа **Read**
- Не коммитьте `.env` и реальные секреты

## Лицензия

UNLICENSED — личный / портфолио-проект.
