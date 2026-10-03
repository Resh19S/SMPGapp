# Project: Sunrise PG — Rental Property Management App (Phase 1: Web)

## What this is
A management app for a property manager running a PG/hostel/rental
business: beds, leads, tenants, rent. End user is the owner/staff, not
the tenant. See `CONTEXT.md` for the full brief and decision history —
that file is the source of truth for scope; this file is how the repo
is structured to deliver it.

## Status
Phase 1 (web) is built and functional against real persistence
(SQLite) — not a mockup. No live deployment yet; see `CONTEXT.md`
"Trajectory" for the hold point (client hasn't finalized fees).

## Architecture
- `backend/` — FastAPI + SQLAlchemy + SQLite. Real JWT auth, real
  password hashing, real computed rent tracker (never hand-maintained
  payment status — see `backend/routers/payments.py`). See
  `backend/CLAUDE.md`.
- `frontend/` — React (Vite + TS) property-manager UI. See
  `frontend/CLAUDE.md`.
- `shared/contract.ts` (mirrored by `backend/models/schemas.py` and
  `frontend/src/types/contract.ts`) — the fixed API contract. If a
  field changes, it changes in all three places together.
- `mobile/` — intentionally not built yet. See `mobile/README.md` for
  why, and what's already in place to make Phase 2 not a rewrite.

## Scope expansion (2026-09-29): match the "Doshi PG" reference video
The client-shared video in the repo root is the feature target for the
owner app. Decisions: keep OUR ledger visual identity (match features, not
Doshi's look); owner web app first, resident app later; UPI/WhatsApp stay
unconnected (honestly labelled, no fake controls) until the client decides
how payments will work. Added so far: "Now" decision-queue dashboard, dues
ageing, floor-wise bed grid coloured by rent state, part payments +
collection chart + deposits held, Operations (complaints, move-out →
inspection → deposit settlement). Our own additions beyond the video:
lead pipeline (+ lead → move-in), agreement renewals with rent history,
owner-only monthly Profit & Loss (cash basis) with expense logging,
printable receipts, WhatsApp click-to-chat reminders/receipts (wa.me
links — no paid API), Excel import/export, global search, vacancy cost.

## Repo workflow
GitHub `origin` = `Resh19S/SMPGapp`. Claude commits; **the user pushes
manually — never `git push`**. `private/` (pricing, client questions, demo
script) is gitignored on purpose; never put client-confidential content in
tracked files. CI (`.github/workflows/ci.yml`) runs backend tests, the
frontend build and a contract-mirror check on every push.

## Production readiness
`docs/ARCHITECTURE.md` is the plan for running this as a SaaS: booking-style
concurrency rules (built + tested), PostgreSQL (not Cassandra), document
storage/security, multi-tenancy (`org_id`) as the #1 gap before a second
customer. `docs/SECURITY.md` is the security model. Backend tests:
`cd backend && .venv/bin/pytest`. Browser checks (feature flows, slow-network
stress, layout at 1440/1280/1024): `e2e/README.md` — run them after UI changes.

## Decisions locked for v1 (superseding "open questions" in CONTEXT.md)
- **Scope:** one building/property to start. Schema supports more
  (`Property` ↔ `Bed` FK) but the UI doesn't expose multi-property
  switching yet — add it if/when a second building is real.
- **Staff:** multi-staff logins with two roles, `owner` and `staff`.
  Owner manages staff accounts (`/staff` page, owner-only).
- **Rent Tracker:** computed, not manually maintained. It's a view
  over `Tenant` (move-in date, rent due day) + a `Payment` log
  (`backend/routers/payments.py::ensure_payments_up_to_date`), which
  self-heals missing months rather than requiring a cron job. This was
  chosen over a manually-updated record because it can't drift out of
  sync with tenant data by construction.
- **Lost leads:** archived, not deleted — filtered out of the default
  Leads view, visible via "Show archived" toggle.
- **Locale:** INR, DD/MM/YYYY throughout.
- **Migration source:** none — v1 ships with realistic seed data
  (`backend/seed.py`), no spreadsheet import needed.

## Non-negotiables
- No dummy buttons/handlers — every control in `frontend/` calls a
  real backend endpoint that persists to SQLite. If a feature isn't
  wired up, it isn't in the UI yet.
- No hardcoded single-property/single-tenant assumptions in the data
  model (see `CONTEXT.md` "Commercial-readiness notes").
- Mock/placeholder tenant documents only (filename + upload timestamp,
  no real file storage) — real PII handling is future work, not v1.

## Local development
Backend:
```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python seed.py      # one-time, creates demo data + login accounts
.venv/bin/uvicorn main:app --reload
```
Frontend:
```
cd frontend && npm install
cp .env.local.example .env.local
npm run dev
```
Demo logins (from `seed.py`): `owner` / `owner123` (owner role),
`staff` / `staff123` and `ravi` / `ravi1234` (staff role). They're shown on
the sign-in page only if `VITE_SHOW_DEMO_LOGINS=true`. On a live server
never run `seed.py`; use `backend/manage.py create-owner` / `create-property`.
