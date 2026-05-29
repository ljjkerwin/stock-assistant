# Stock Assistant

A personal stock assistant supporting A-share and Hong Kong stock watchlist management, K-line chart viewing, and price alert monitoring.

中文版本：[README.md](./README.md)

---

## Features

- **Watchlist** — Search and save A-shares, HK stocks (including ETFs); drag-to-reorder and pin to top
- **K-line charts** — Timeshare / 1min / 5min / 15min / 30min / 60min / Daily / Weekly; volume and MACD(4,35,4) sub-charts; auto-refresh every 30 s during trading hours
- **Stock detail** — Current price, change %, turnover, market cap, PE, and more
- **Price alerts** — Configure price-threshold or MA-crossover rules; triggers deliver real-time SSE push + email notification; message center shows alert history

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Ant Design · Lightweight Charts (TradingView) · Zustand |
| Backend | NestJS · TypeORM · SQLite (default) · MySQL (optional) |
| Data sources | East Money (search + real-time quotes) · Sina Finance (A-share / ETF K-line) · Yahoo Finance (HK K-line) |

---

## Project Structure

```
stock-assistant/
├── frontend/src/
│   ├── components/
│   │   ├── Sidebar/              # Watchlist sidebar
│   │   ├── KLineChart/           # Shared K-line chart component
│   │   ├── StockSearch/          # Stock search
│   │   └── StockMonitorButton/   # Per-stock alert button (in detail page header)
│   ├── pages/
│   │   └── StockDetail/          # Stock detail page
│   ├── store/                    # Zustand global state
│   ├── api/                      # Backend API client
│   └── types/                    # TypeScript type definitions
└── backend/src/
    ├── stocks/                   # Search & basic info
    ├── kline/                    # K-line data (unified multi-market interface)
    ├── favorites/                # Watchlist CRUD
    ├── monitor/                  # Alert rules, messages & SSE push
    ├── cache.ts                  # In-process TTL cache
    └── main.ts
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Development

```bash
# Backend (port 3000)
cd backend
pnpm install
pnpm start:dev

# Frontend (port 5173, /api proxied to 3000)
cd frontend
pnpm install
pnpm dev
```

The frontend's `/api` requests are proxied to the backend on port 3000 by Vite's dev server.

---

## Configuration

Copy the env template and fill in as needed:

```bash
cp backend/.env.example backend/.env
```

| Variable | Description | Required |
|---|---|---|
| `MYSQL_HOST` | MySQL host | No |
| `MYSQL_USERNAME` | MySQL username | No |
| `MYSQL_PASSWORD` | MySQL password | No |
| `MYSQL_DATABASE` | Database name | No |
| `EMAIL_USER` | 163 email account (sender) | No |
| `EMAIL_PASS` | 163 SMTP authorization code | No |
| `EMAIL_TO` | Recipient email address | No |

**Database**: When all three MySQL variables (`MYSQL_HOST`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`) are set, MySQL is used. If any one is missing, the app automatically falls back to local SQLite (`./stock-assistant.db`) with no additional setup required.

**Email alerts**: When `EMAIL_USER` and `EMAIL_PASS` are set, alert triggers send email notifications via 163 SMTP. Email is silently disabled when unconfigured and does not affect other features.

---

## Production Deployment

### Build

```bash
cd backend && pnpm build
cd frontend && pnpm build
```

### Nginx

See `deploy/nginx.conf`. Adjust the frontend `dist` path and backend port to your environment. The SSE endpoint `/api/monitor/events` requires `proxy_buffering off` and an extended `proxy_read_timeout`.

### Start Backend

```bash
cd backend && node dist/main
```

---

## API Overview

| Method | Path | Description |
|---|---|---|
| GET | `/api/favorites` | Get watchlist |
| POST | `/api/favorites` | Add to watchlist |
| DELETE | `/api/favorites/:id` | Remove from watchlist |
| PATCH | `/api/favorites/:id` | Update order or pin |
| GET | `/api/stocks/search?q=` | Search stocks (A-share + HK) |
| GET | `/api/stocks/:market/:code` | Stock basic info |
| GET | `/api/kline/:market/:code?period=` | K-line data |
| GET | `/api/monitor/rules` | List alert rules |
| POST | `/api/monitor/rules` | Create alert rule |
| DELETE | `/api/monitor/rules/:id` | Delete alert rule |
| PATCH | `/api/monitor/rules/:id` | Toggle rule active state |
| GET | `/api/monitor/messages?page=` | Alert messages (paginated) |
| GET | `/api/monitor/messages/unread-count` | Unread message count |
| PATCH | `/api/monitor/messages` | Batch mark as read |
| DELETE | `/api/monitor/messages` | Clear all messages |
| GET (SSE) | `/api/monitor/events` | Real-time alert event stream |

**`market`**: `A` (A-shares + ETFs) / `HK` (Hong Kong stocks)

**`period`**: `timeshare` `1min` `5min` `15min` `30min` `60min` `daily` `weekly`

---

## License

MIT
