# Security — what protects the data, and what's still to do

No system is unbreachable. The goal: make attacks expensive, limit the
**blast radius** of any single failure, and **detect** problems fast. This
is the technical companion to `docs/ARCHITECTURE.md`.

## What we protect, and from whom

| Asset | Threat | Control (✅ built · ☐ at deployment · ◇ when real documents arrive) |
|---|---|---|
| Staff/owner accounts | Password guessing | ✅ bcrypt hashing · ✅ 5-failure lockout per user and IP (15 min) · ☐ lockout in Redis/proxy for multi-server · ☐ owner OTP 2FA |
| Sessions | Stolen or lingering tokens | ✅ JWT expiry (8 h) · ✅ `token_version`: password change/reset/deactivation revokes all sessions · ✅ token in `sessionStorage` (closes with the tab) · ☐ shorter access token + refresh token |
| Money records | Fraud, mistakes, races | ✅ owner/staff roles enforced server-side · ✅ append-only `audit_events` for payments, settlements, renewals, imports, staff changes, tenant edits · ✅ DB constraints + atomic updates (no double payment/booking) · ✅ idempotency keys |
| Tenant personal data | Leak via app bugs | ✅ every endpoint requires auth; owner-only routes checked on the server, not just hidden in the UI · ✅ ORM parameterised queries (no SQL injection) · ✅ React escapes output (no stored XSS) · ✅ strict input validation (types, lengths, formats) |
| Tenant ID documents | Leak of Aadhaar/agreements | ✅ **not stored yet** (filename placeholders only) · ◇ private bucket, server-side encryption · ◇ presigned URLs (~5 min) issued only after an auth + role check · ◇ view/download audit log · ◇ masked Aadhaar only · ◇ consent at upload · ◇ retention job deletes N days after move-out · ◇ file type/size allow-list, optional malware scan |
| Database | Direct access | ☐ not exposed to the internet (private network / firewall) · ☐ least-privilege DB user for the app · ☐ encrypted disk + encrypted off-site backups · ☐ monthly restore test |
| Server | Takeover | ☐ SSH keys only, no root login, firewall (80/443 only) · ☐ unattended security updates · ☐ secrets in env/secret manager, never in git (`.env` gitignored) · ✅ app refuses to start in production with a weak `JWT_SECRET` |
| Traffic | Eavesdropping, tampering | ☐ HTTPS only + HSTS · ☐ security headers (CSP, frame-ancestors, nosniff) at the proxy · ✅ CORS limited to configured origins |
| Supply chain | Vulnerable dependencies | ✅ CI on every push · ☐ Dependabot / `pip-audit` / `npm audit` in CI |
| Availability | Outage, data loss | ☐ uptime + error alerts (UptimeRobot, Sentry) · ☐ daily backups, point-in-time recovery |

## Multi-tenant SaaS (before a second customer)
Every row gets `org_id`; every query is scoped through one dependency;
PostgreSQL row-level security as a second lock; isolation tests (org A's
token gets 404 for org B's IDs). Without this, one PG could see another's
residents. See `docs/ARCHITECTURE.md` §5.

## Compliance (India)
DPDP Act 2023 applies once real personal data is stored: notice and
consent, purpose limitation, retention limits, residents' right to
correction/erasure, reasonable security safeguards, and breach
notification to the Data Protection Board and affected people. For
Aadhaar: collect masked copies only and never store the full number in a
database field.

## People and process
One login per person (no shared owner password) · deactivate staff on exit
· owner 2FA · review the audit log monthly · a written "what we do if
there's a breach" page (who to call, how to rotate secrets, how to notify).

## Verifying it
- Backend tests cover auth, roles, lockout, session revocation, validation,
  races and idempotency (`backend/tests/`).
- Before scaling to many PGs: an external penetration test.
