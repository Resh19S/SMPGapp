# Backend — Sunrise PG API

## Stack
FastAPI + SQLAlchemy 2.0 + SQLite. Real persistence (`pg_rental.db`),
real bcrypt password hashing, real JWT bearer auth (`auth.py`) — this
is not a mock-data prototype like the sibling `clinical-decision-support`
project; treat every endpoint as production-shaped even though it
isn't deployed.

## Data model (`models/db_models.py`)
`StaffUser` (owner/staff) → `Property` → `Bed` (with `floor`) → `Tenant` →
`Payment` → `PaymentTransaction`, plus `TenantDocument`, `AgreementRenewal`,
`Complaint`, `MoveOutNotice` → `SettlementDeduction`, `Expense`, and the
append-only `AuditEvent`.

**Rent belongs to the tenant, not the bed.** `Bed.rent_amount` is the listed
rent for the *next* resident; `Tenant.rent_amount` is what was agreed at
move-in, and `serializers.py::rent_for_period` applies the latest
`AgreementRenewal` effective by that month. Editing a bed never re-prices
the person living in it. Occupancy is never a stored flag — a bed's
status is derived at read time from whether it has a `Tenant` with
`move_out_date IS NULL` (see `serializers.py::serialize_bed`). This
was a deliberate choice to avoid the two ever drifting out of sync. The
same goes for a bed's money state (`rentState`: paid / due / due-today /
late / reserved / vacant) — derived from its tenant's payments, never stored.

## Concurrency: the database enforces invariants (read before changing models)
Treat this like a ticket-booking system — see `../docs/ARCHITECTURE.md` §1.
One active tenant per bed (partial unique index), one payment row per
tenant-month (unique + `INSERT … ON CONFLICT DO NOTHING`), money increments
via a single conditional `UPDATE` (`payments.py::add_payment` — never
read-modify-write `amount_paid` in Python), idempotency keys on payments,
atomic "claim" on settlement, optimistic concurrency on renewals. Routers
pre-check for friendly errors and map `IntegrityError` to 409. Every new
invariant needs a DB constraint **and** a race test in `tests/`.

## Dates
Always `clock.today()` / `clock.utcnow()` — never `date.today()` (servers run
in UTC; rent is due on Indian dates). Tests freeze `clock.today`.

## Rent Tracker is computed, not authoritative data entry
`routers/payments.py::ensure_payments_up_to_date` generates missing
monthly `Payment` rows for every tenant from their move-in month
through the current month (plus next month once it's within
`ADVANCE_BILLING_DAYS` of falling due, so advance rent can be recorded), on
every read of `/dashboard`, `/beds` or `/payments`. There is no cron job — the generation is idempotent and
cheap enough to run inline. Do not add a "manually create a payment
record" endpoint; if the model changes (e.g. mid-month rent change),
adjust `Tenant`/`Bed` and let the next read regenerate correctly.

## Payments accumulate; they never overwrite
Recording rent adds a `PaymentTransaction` (`POST /payments/{id}/transactions`,
with an `Idempotency-Key` header from the UI) and bumps `Payment.amount_paid`
via `payments.py::add_payment`, so part payments add up. Paying more than the balance is rejected. `paid_date` is set
when the month becomes fully paid.

## Move-out is a process
`POST /tenants/{id}/notice` → inspection → deductions → `POST
/move-outs/{id}/settle` (`routers/operations.py`). `Tenant.move_out_date` is
only set on settlement, so the bed stays occupied and rent keeps accruing
until the resident actually leaves. Settlement recovers unpaid rent from the
deposit (method `"deposit"` transactions, oldest month first) and refunds the
rest minus deductions. Settling before the planned date is refused.

## Renewals and profit & loss
`POST /tenants/{id}/renewals` extends the agreement and schedules new rent
from a month (re-pricing already-billed months only if nothing was paid
against them). `routers/pnl.py` is owner-only and **cash basis**: income =
money received in the month + rent recovered from / charges kept out of
deposits at settlement; deposits themselves are liabilities, not income.

## Dashboard ("Day Book")
`routers/dashboard.py` builds a ranked decision queue (tier 1 act now → 3
this week, then by ₹ at risk), dues ageing buckets, and a next-seven-days
list. Rent under 30 days late rolls up into one line so it can't bury
everything else; add new item kinds there rather than new dashboard fields.

## Auth
JWT (`pyjwt`), bcrypt via the `bcrypt` package directly — not
`passlib`, which has a known incompatibility with modern `bcrypt`
releases (`AttributeError: module 'bcrypt' has no attribute
'__about__'`). `require_owner` gates `/staff` endpoints (except
`/staff/directory`, names only, for assigning complaints); everything else
just requires a valid token via `get_current_user`.

## Adding an endpoint
1. Add/extend the Pydantic schema in `models/schemas.py` — this must
   stay in sync with `../shared/contract.ts` and
   `../frontend/src/types/contract.ts`. Flag to the user before
   changing a field that's already in use by the frontend.
2. Add the ORM logic in the relevant router, using `serializers.py`
   for anything that needs a computed field (bed status, payment
   status) rather than duplicating that logic inline.
3. Every mutating endpoint requires `Depends(get_current_user)` (or
   `require_owner`) — there is no unauthenticated write path.

## Tests
`.venv/bin/pip install -r requirements-dev.txt`, then `.venv/bin/pytest`.
Fresh SQLite DB per test, `clock.today` frozen at 15/09/2026, race tests use
real threads. Keep them green; add one for every rule or bug fix.

## Seed data
`seed.py` is idempotent — it no-ops if a `Property` already exists.
Delete `pg_rental.db` to reseed from scratch — there are no migrations, so
do this after any model change. It seeds 3 floors / 72 beds / ~66 tenants,
all dates relative to today: mostly-paid history with a few late payers
and 2-month arrears, part payments, urgent complaints, one resident leaving
tomorrow with no inspection booked, agreements up for renewal, and two
upcoming move-ins — so every dashboard panel has something to show.
