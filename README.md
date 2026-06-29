# 🎟️ BookMySeat — Event Ticketing & Seat-Reservation System

A **MERN** app for booking event seats under high contention. The main goal is
to make sure two users can never book the same seat, even when many requests hit
the same seat at once, while holds expire automatically and payment retries
don't double-book.

---

## Overview

The focus is on the parts that get tricky under concurrency and scale:

| Challenge | How it's solved |
|---|---|
| **Double-booking** under concurrent requests | Atomic single-document compare-and-set: `findOneAndUpdate({ _id, status: 'AVAILABLE' }, { status: 'HELD' })`. The loser matches zero docs. |
| **Abandoned carts holding seats forever** | Seats go `AVAILABLE → HELD` with a TTL (`holdExpiresAt`); a Redis lock + sweeper auto-releases expired holds. |
| **Payment retries / double-clicks double-charging** | `idempotencyKey` with a UNIQUE index — a retry resolves to the same booking. |
| **Read-heavy event listings** | Cache-aside in Redis with short TTL + invalidation on writes. |
| **Stale writes** | Optimistic concurrency via a `version` field. |

Seat state machine:

```
AVAILABLE ──hold──▶ HELD ──confirm──▶ BOOKED
    ▲                │
    └──── expire ────┘   (hold TTL elapses, or user cancels)
```

---

## Tech stack

- **MongoDB** + Mongoose — per-seat documents for contention-free atomic updates
- **Redis** (ioredis) — distributed locks, hold expiry, cache-aside
- **Express** — versioned REST API (`/api/v1`)
- **JWT** (access + refresh) + bcrypt — authentication & RBAC (user/admin)
- **pino** — structured JSON logging with request IDs
- **Docker / docker-compose** — one-command local stack
- **GitHub Actions** — lint → test → docker build pipeline
- **Jest + supertest** — integration tests against live Mongo/Redis

---

## Project structure

```
bookmyseat/
├── docker-compose.yml          # mongo + redis + api
├── .github/workflows/ci.yml    # CI/CD pipeline
├── backend/
│   ├── Dockerfile              # multi-stage, non-root
│   ├── scripts/                # seed.js (demo data), loadtest.js
│   └── src/
│       ├── config/             # env, db, redis (fail-fast config)
│       ├── models/             # User, Event, Seat, Booking  ← schema design
│       ├── middleware/         # auth, error handler, rate limit
│       ├── services/           # auth, event, reservation, payment, token
│       ├── jobs/               # holdSweeper (expiry background job)
│       ├── routes/ controllers/ utils/
│       ├── app.js              # Express app (testable, no side effects)
│       └── server.js           # bootstrap + graceful shutdown
└── frontend/                   # React + Vite
    └── src/
        ├── api/                # fetch client w/ token refresh
        ├── auth/               # AuthContext
        ├── components/         # SeatMap, CountdownTimer, Navbar
        └── pages/              # Events, EventDetail, Login, MyBookings
```

---

## Quick start

```bash
# 1. Bring up the whole stack (mongo + redis + api)
docker compose up -d --build

# 2. Check it's healthy (API is published on host port 5000)
curl localhost:5000/api/healthz     # liveness
curl localhost:5000/api/readyz      # readiness (checks mongo + redis)
```

Or run the API locally against Dockerised infra:

```bash
docker compose up -d mongo redis
cd backend
cp .env.example .env
npm install
npm run seed      # creates demo admin/user + 2 published events
npm run dev       # API on http://localhost:4100
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev       # UI on http://localhost:5173 (proxies /api → :4100)
```

Then open http://localhost:5173 and log in with the demo account
`user@bookmyseat.dev` / `supersecret1`. The UI flow: browse events → pick seats
on the interactive map → **hold** (a live countdown shows the reservation timer)
→ **pay** → see it under *My Bookings*. The frontend talks only to the documented
REST API; the Vite dev server proxies `/api` so the browser stays same-origin.

> Local dev uses port **4100** for the API (4000 is often taken by other local
> stacks). The Dockerised stack still publishes the API on **5000**.

---

## API — Auth

Base path: `/api/v1/auth`

| Method | Path | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/register` | — | `{name,email,password}` | Create account, returns user + tokens |
| POST | `/login` | — (rate-limited: 5/15min/IP) | `{email,password}` | Returns user + tokens |
| POST | `/refresh` | — | `{refreshToken}` | Rotates tokens; old refresh is revoked |
| POST | `/logout` | — | `{refreshToken}` | Revokes the refresh token |
| GET | `/me` | Bearer access | — | Current user |

**Token model:** stateless 15-min access token (carries role, no DB hit on the
hot path) + 7-day refresh token whose `jti` is tracked in a Redis allowlist.
Refresh **rotates** (each use invalidates the prior token, so a stolen+reused
old token is rejected) and **logout revokes**.

```bash
# register
curl -sX POST localhost:5000/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Abhi","email":"a@b.dev","password":"supersecret1"}'

# call a protected route
curl localhost:5000/api/v1/auth/me -H "Authorization: Bearer <accessToken>"
```

---

## API — Events

Base path: `/api/v1/events`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | Bearer **admin** | Create event + bulk-generate seats (starts as DRAFT) |
| PATCH | `/:id/publish` | Bearer **admin** | DRAFT → PUBLISHED (only DRAFT can publish) |
| GET | `/` | — | Paginated list of PUBLISHED events (`?page=&limit=`) |
| GET | `/:id` | — | Event detail |
| GET | `/:id/seats` | — | Full seat-map + status summary `{AVAILABLE,HELD,BOOKED}` |

Create body — an event is described by **sections** (each a grid of rows ×
seats), and the API expands them into individual `Seat` documents:

```json
{
  "title": "Diljit Dosanjh Live",
  "venue": "JLN Stadium",
  "startsAt": "2026-09-01T18:00:00Z",
  "sections": [
    { "name": "VIP", "rows": 2, "seatsPerRow": 5, "tier": "VIP", "price": 5000 },
    { "name": "GA",  "rows": 3, "seatsPerRow": 10, "tier": "STANDARD", "price": 1200 }
  ]
}
```

> Seats are separate documents (not embedded) on purpose — that's what lets the
> reservation engine update a single seat atomically under contention. Labels
> are `A1, A2, …` and are unique per `(event, section)`.

### Caching

`GET /events` and `GET /events/:id` use **cache-aside** in Redis with a short
TTL and respond with an `X-Cache: HIT|MISS` header; publishing an event
invalidates the list + detail caches.

- **Why these and not the seat-map?** Listings tolerate a few seconds of
  staleness in the denormalised `availableSeats` counter; the **seat-map is
  never cached** because booking needs exact, live seat state.
- **Fail-open:** if Redis is down the cache layer falls through to MongoDB
  rather than erroring — a cache outage slows the system, never breaks it.
- **Invalidation** uses Redis `SCAN` (not blocking `KEYS`) to clear paginated
  list keys.

---

## API — Bookings

Base path: `/api/v1/bookings` (all require a Bearer access token)

| Method | Path | Description |
|---|---|---|
| POST | `/hold` | Hold seats → creates a PENDING booking with an expiry timer |
| POST | `/:id/confirm` | Checkout: take payment → CONFIRMED, seats → BOOKED |
| POST | `/:id/release` | Cancel your own hold, freeing the seats immediately |
| GET | `/me` | List your bookings |

Confirm body: `{ "paymentMethod"? }` (use `"declined-card"` to exercise the
failure path). Returns `201` on first confirm, `200` if already confirmed
(idempotent — no second charge), `402` on payment failure (hold kept so the
user can retry), `409` if the hold expired before checkout. Confirmation is
serialized per booking with a Redis lock, so a double-submit can't charge
twice. Payment goes through a mock gateway (`services/payment.service.js`) that
stands in for a real PSP.

Hold body: `{ "eventId", "seatIds": [...], "idempotencyKey"? }` (or send an
`Idempotency-Key` header). Returns `201` for a new hold, `200` if an existing
booking matched the key, `409` if any requested seat is unavailable.

**How double-booking is prevented:** each seat is claimed with an atomic
conditional update:

```js
Seat.findOneAndUpdate(
  { _id, event, status: 'AVAILABLE' },        // only if still free
  { status: 'HELD', heldBy, holdExpiresAt }   // claim it
)
```

MongoDB applies a single-document update atomically, so out of *N* concurrent
requests for one seat, exactly one matches `status: 'AVAILABLE'` and wins; the
rest match nothing and get `409`. **No locks are needed for correctness** — the
test suite fires 30 simultaneous requests at one seat and asserts exactly one
booking results.

Supporting mechanics:
- **All-or-nothing** multi-seat holds: on partial failure the already-held seats
  are released (compensation), since single-node Mongo has no transactions.
- **Idempotency**: a per-`(user, key)` Redis lock + a unique index make retries
  and double-clicks resolve to the same booking, never two.
- **Expiry sweeper**: a background job releases holds whose timer elapsed,
  claiming each via a conditional update so it's safe to run on every instance.

---

## Load test

`scripts/loadtest.js` fires many concurrent HTTP requests at
`POST /bookings/hold`, with far more requests than seats so several contend for
the same seat. It then checks the invariant against the live seat-map: the
number of successful holds should equal the number of seats that ended up HELD.
If a double-book happened, two requests would have succeeded for one seat and
the counts would differ.

Sample run (600 requests, 50 seats, concurrency 100):

```
--- Responses ---
  { "201": 50, "409": 550 }
--- Correctness ---
  successful holds (201) : 50
  conflicts (409)        : 550
  seats now HELD         : 50
✅ PASS — no double-booking: successful holds == seats held
Throughput ~568 req/s · p50 117ms · p95 630ms · p99 952ms
```

Run it (needs a running server + a PUBLISHED event id):

```bash
BASE_URL=http://localhost:5000 EVENT_ID=<id> REQUESTS=600 USERS=40 CONCURRENCY=100 \
  npm run loadtest
```

> Note: pick a server port that isn't on the WHATWG fetch "bad ports" list
> (e.g. avoid 5060/6000) — Node's `fetch` rejects those with a "bad port"
> error, though `curl` works fine.

---

## Roadmap

- [x] Project scaffold: Docker, compose, CI, models, app skeleton
- [x] Auth: register/login, JWT access+refresh w/ rotation+revocation, RBAC, login rate-limit
- [x] Events & seat-map: admin creates events (DRAFT→PUBLISHED) and bulk-generates seats; public listing + seat-map
- [x] **Reservation engine**: atomic holds, all-or-nothing compensation, idempotency lock, expiry sweeper — proven by a 30-way concurrency test
- [x] Checkout: idempotent confirmation w/ mock payment (PENDING → CONFIRMED, seats HELD → BOOKED), per-booking lock prevents double-charge
- [x] Cache-aside for event list + detail (Redis, short TTL, `X-Cache` header, invalidate on publish)
- [x] Concurrency load test — 600 concurrent holds on 50 seats → exactly 50 winners, 0 double-bookings
- [x] React frontend (Vite): browse → interactive seat-map → hold w/ countdown timer → checkout → my bookings
- [ ] Virtual queue / waiting room for flash sales (stretch)

---

## License

MIT
