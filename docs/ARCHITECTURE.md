# Architecture & production readiness — Sunrise PG as a SaaS

Status as of 30/09/2026. Covers what is **built and tested now**, and what
has to happen **before the first paying customer** runs on it.

---

## 1. The ticket-booking lens

A PG app is a booking system with monthly billing. The failures that sink
booking systems are the same ones that would sink this app:

| Booking system | Sunrise PG | Failure if done naively |
|---|---|---|
| Seat | Bed | Two staff move two people into one bed |
| Hold / reservation | Future move-in (`reserved`) | Bed shown free while promised |
| Booking | Move-in (`Tenant` row) | Double booking under concurrency |
| Payment / checkout | Rent `PaymentTransaction` | Double charge on double-click or retry |
| Invoice generation | Monthly `Payment` row | Duplicate invoices from parallel requests |
| Cancellation / refund | Move-out settlement | Deposit refunded or applied twice |
| Business day | Rent due date | Wrong "today" on a UTC server |

**The rule:** anything that must stay true when two requests race is
enforced **by the database**, not by "check, then insert" in Python. The
code still checks first, so users get a friendly message. Losing a race
turns the database's refusal into a clean `409`, never a `500` and never
bad data.

### What's enforced now

| Invariant | How | Where |
|---|---|---|
| One current resident per bed | Partial unique index `bed_id WHERE move_out_date IS NULL` | `models/db_models.py` `Tenant` |
| One rent row per tenant per month | `UNIQUE(tenant_id, period_month)` + `INSERT … ON CONFLICT DO NOTHING` | `Payment`, `payments.py::ensure_payments_up_to_date` |
| No overpaying / double-paying a month | Balance check and increment in **one** conditional `UPDATE … WHERE amount_due - amount_paid >= :amount` | `payments.py::add_payment` |
| A retried or double-clicked payment records once | `Idempotency-Key` header → `UNIQUE(client_ref)`; a retry returns the first result | `payments.py::record_payment`, `RecordPaymentModal.tsx` |
| Deposit applied once at settlement | Settlement "claims" the notice with a conditional `UPDATE … WHERE status != 'settled'`; the whole settlement is one transaction | `operations.py::settle_move_out` |
| Two people renewing one agreement | Optimistic concurrency: `UPDATE … WHERE agreement_expiry = <value we read>` | `tenants.py::renew_agreement` |
| No duplicate bed labels in a room | `UNIQUE(property_id, room_number, bed_label)` | `Bed` |
| Business dates are Indian dates | Every "today" goes through `clock.today()` (Asia/Kolkata) | `clock.py` |
| Referential integrity in dev | `PRAGMA foreign_keys=ON` (SQLite ignores FKs otherwise) | `database.py` |
| Unanticipated conflicts don't crash | Global `IntegrityError` → 409 handler | `main.py` |
| Who did what with money | Append-only `audit_events`, written in the same transaction as the change | `audit.py` |

### Tested

`backend/tests/`, 127 tests. Run with `cd backend && .venv/bin/pytest`.
They cover:

- **Races, fired from real parallel threads:** two staff booking one bed →
  exactly one succeeds; two paying the last balance → paid once; a
  double-click with the same key → recorded once; six parallel dashboard
  loads → no duplicate months; double settlement → deposit applied once;
  two renewals at once → one applies.
- **Rent rules:** first month never due before move-in; due day 31 in
  February; advance billing for rent paid early; no advance bill for
  residents leaving first; future move-ins reserved but not billed; a
  change to a bed's listed rent doesn't re-price the current resident.
- **Input:** Indian mobile numbers (normalised from `+91 98…`, `0…`,
  dashes), blank names, rupee amounts with 3 decimals, ₹6L typos,
  agreement ending before move-in, dates in 1990, future payment,
  expense and refund dates, malformed months in query strings.
- **Access:** staff vs owner endpoints, deactivated users' tokens, garbage
  tokens, brute-force lockout after 5 wrong passwords.
- **Money flows:** deposit covers the oldest month first and the rest
  stays owed; refunds never go negative; settled move-outs are frozen;
  profit & loss is cash-basis and counts deposit recoveries.

**Not yet covered:** frontend unit tests, load testing, and the
browser-driven end-to-end scripts. Those were run by hand in Chromium for
this release but aren't checked in.

---

## 2. Target deployment (single region, India)

```
 Browser (owner/staff)          Play Store app (Phase 2, residents)
        │                                   │
        └──────────── HTTPS ────────────────┘
                         │
                 ┌───────▼────────┐   static SPA on CDN (Cloudflare / S3+CloudFront)
                 │  Load balancer │
                 └───────┬────────┘
            ┌────────────┴────────────┐
      ┌─────▼─────┐             ┌─────▼─────┐   FastAPI in containers, 2+ instances,
      │  API  #1  │             │  API  #2  │   stateless (JWT), health-checked
      └─────┬─────┘             └─────┬─────┘
            │        ┌───────────────┐│
            ├───────►│ PostgreSQL    │◄┤   managed; point-in-time recovery;
            │        │ (primary)     │ │   daily off-site backup
            │        └───────────────┘ │
            │        ┌───────────────┐ │
            ├───────►│ Redis (later) │◄┘   rate limits across instances, OTP codes
            │        └───────────────┘
            │        ┌───────────────┐
            └───────►│ Object storage│     private bucket: ID proofs, agreements,
                     │ (S3/R2/Spaces)│     photos. Presigned URLs only.
                     └───────────────┘
   Worker (cron/queue): rent reminders, SMS/WhatsApp, nightly rent generation, backups check
   Observability: Sentry (errors), uptime ping on /health, structured logs
```

A reasonable Indian-region setup is DigitalOcean Bangalore or AWS Mumbai.
Rough cost at 1–20 PGs: **₹2,500–6,000/month**, covering managed
Postgres, 2 small app instances, storage, and backups.

---

## 3. Database: PostgreSQL, not Cassandra

**Use PostgreSQL.** Move to it from SQLite at deployment.

Cassandra is built for massive write volumes spread across many
datacentres. It gives that up for exactly the guarantees this app depends
on:

- **No multi-row transactions.** Settlement (update notice, set move-out,
  apply the deposit across months, write the audit row) must happen all
  or nothing.
- **No unique constraints, and no partial unique index.** That is our
  double-booking protection. Without it, the bugs in section 1 come back.
- **No joins or ad-hoc aggregates.** Profit & loss, dues ageing and the
  dashboard are all relational queries.

**The scale doesn't need it either.** 1,000 PGs × 100 beds × 12 months is
about 1.2M rent rows a year. A single small Postgres instance handles that
easily. Scaling order when it's ever needed: indexes (done for the hot
columns) → read replica for reports → partitioning payments by year.
Cassandra is never on that list.

**Do at migration time:**

- **Alembic migrations.** `create_all` is already disabled when
  `APP_ENV=production`.
- **Money columns from `Float` to `NUMERIC(12,2)`.** Floats are exact for
  whole rupees, but paise sums can drift. The API already rejects amounts
  with more than 2 decimals.
- **Move rent generation off page loads.** `ensure_payments_up_to_date`
  runs on every read today. Move it to a nightly worker job per
  organisation (it's already idempotent), and keep the on-read call as a
  fallback.

---

## 4. Documents (ID proofs, agreements, photos)

Today, documents are **placeholders only** (filename + timestamp), as
agreed in CLAUDE.md. When real uploads arrive, here's the design.

### Storage

Store files in **object storage** (S3 / Cloudflare R2 / DO Spaces) in a
**private bucket**, never in the database and never on the app server's
disk:

- **Path layout:** `org/{org_id}/tenant/{tenant_id}/{uuid}.{ext}`. The
  path never contains a name or an Aadhaar number.
- **The database holds metadata only:** type, original filename, size,
  content type, checksum, uploaded_by, uploaded_at, storage key.

### Upload flow

1. The app asks the API for an upload slot. The API checks the user's role
   and organisation, then returns a presigned PUT URL valid for 5 minutes.
   Only PDF/JPG/PNG are allowed, up to 10 MB.
2. The browser or app uploads straight to storage, so large files never
   pass through the API.
3. The API confirms the upload: it verifies size and type, then records the
   metadata.
4. Photos are downscaled on the phone before upload (the Phase 2 app).
   This saves storage and makes them load faster.

### Viewing

The API checks auth and organisation, writes an **audit row** ("Ravi viewed
Arjun's ID proof"), and returns a presigned GET URL that expires in about
5 minutes.

### Caching: no Redis for documents

Files come straight from object storage, which is already fast. Putting
private ID documents in a shared cache or a public CDN adds a leak path
for no real gain. If download speed ever matters, use a CDN with
**signed URLs** (CloudFront signed URLs or R2 plus signed tokens), with
the same 5-minute expiry. Redis is for rate limiting and OTP codes, not
for documents.

### Security and compliance (DPDP Act 2023; Aadhaar rules)

- **Encryption at rest** (bucket server-side encryption) and **TLS in
  transit**.
- **Consent screen** at upload: purpose ("identity verification for
  tenancy") and how long the file is kept.
- **Masked Aadhaar only:** ask residents for the masked Aadhaar (last 4
  digits visible). Never store a full Aadhaar number in any database field.
- **Retention:** delete ID documents N days after move-out settlement,
  with N agreed with the client (e.g. 180). Run it as a nightly worker
  job, and write the deletion to the audit log.
- **Access:** owner, plus staff the owner allows. Residents see only their
  own documents (Phase 2).
- **No public links, ever.** A leaked URL stops working within minutes.

---

## 5. Multi-tenant SaaS: the #1 gap before a second customer

The app currently assumes **one organisation per database**. That's fine
for this client. To sell it as a SaaS to many PG owners:

1. **Add an `Organization` table and `org_id` on every table.** Staff
   belong to one organisation, and their JWT carries `org_id`.
2. **Scope every query by `org_id`** through one dependency or repository
   layer. Don't rely on each router remembering to filter.
3. **Turn on Postgres Row-Level Security** as a second lock, so a missed
   filter still can't leak another PG's data.
4. **Scope uniqueness rules per organisation.** Staff usernames, and bed
   labels via property, become unique within an organisation, not
   globally.
5. **Add isolation tests:** org A's token must get 404 on every one of
   org B's resource IDs.
6. **Add sign-up, a trial and billing** for the SaaS itself: per-bed or
   per-property subscription.

Estimate: about 1–1.5 weeks including tests. Do it **before onboarding
a second customer**, not after.

---

## 6. Security checklist

**Done:**
- bcrypt password hashing
- JWT with expiry
- owner/staff role checks on both API and UI
- login throttling (5 failures per 15 minutes, per username and per IP)
- refuses to start in production with a weak JWT secret
- CORS origins from environment
- strict input validation
- audit log for money and residents
- no unauthenticated write path

**Before going live:**
- **HTTPS only**, plus HSTS and security headers at the proxy.
- **Short-lived access tokens with refresh tokens and revocation.** Today
  it's an 8-hour token with no revoke, other than deactivating the user.
- **Password reset**, via owner-assisted reset or an email/SMS OTP.
- **Owner 2FA (OTP).** Recommended, since the owner sees all the money.
- **Rate limiting in Redis/the proxy.** The login throttle is in-process,
  so it's per instance.
- **Secrets in a secrets manager**, not `.env` files on the server.
- **Automated dependency and security scanning in CI.**
- **Backups:** daily, off-site, with a **restore actually tested** once a
  month.

---

## 7. Reliability

- **Retries are safe:** payments are idempotent, and rent generation is
  conflict-safe.
- **Clean conflict errors:** every conflict is a 409 with a human message
  the UI shows.
- **Health check:** `/health` for the load balancer and uptime monitoring.
- **Planned — error tracking:** Sentry on the API and the frontend.
- **Planned — structured logs:** JSON logs with request IDs.
- **Planned — safe deploys:** migrations run before the new version;
  rolling deploys across two instances, so there's no downtime.

---

## 8. Order of work to production

1. Postgres + Alembic + `NUMERIC` money (2–3 days)
2. Multi-tenant `org_id` + row-level security + isolation tests (1–1.5 weeks)
3. Deployment: containers, managed Postgres, HTTPS, backups, Sentry, CI (3–4 days)
4. Auth hardening: refresh tokens, password reset, owner OTP (3–4 days)
5. Real documents: storage, presigned URLs, consent, retention job (4–5 days)
6. Phase 2 resident Play Store app (see `CONTEXT.md`), on top of all of the above
