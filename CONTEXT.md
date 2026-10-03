# Project: [Working title] — PG / Rental Property Management App (Prototype → Commercial)

## What this is
A management app for someone running a PG/hostel/rental property
business: tracking beds, leads, tenants, and rent. End user is the
property manager/owner, not the tenant.

Client input received 2026-08-01 (WhatsApp), verbatim intent below —
treat as the source of truth for v1 scope until superseded.

## v1 scope (client-specified, keep simple)

1. **Dashboard**
   - Total beds
   - Occupied beds
   - Vacant beds
   - Today's move-ins and move-outs

2. **Lead Management**
   - Name
   - Phone
   - Source (Broker / WhatsApp / Google)
   - Status (New, Visited, Booked, Lost)
   - Follow-up date

3. **Property & Bed Management**
   - Flat-wise bed status
   - Rent per bed
   - Occupancy

4. **Tenant Details**
   - Documents
   - Rent due date
   - Deposit
   - Agreement expiry

5. **Rent Tracker**
   - Paid
   - Due
   - Overdue

## Trajectory (explicit — do not build ahead of this)
- **Phase 1:** Web app, v1 scope only, mock/simple data, single
  property manager as the only user.
- **Phase 2:** Wrap/rebuild as a mobile app. Keep the web app's
  architecture "deployment-ready" in the sense of: no hardcoded
  single-tenant assumptions baked into the data model, clean
  API boundary between frontend and backend (mirror the sibling
  `clinical-decision-support/` project's pattern: a fixed shared
  contract file between FE and BE) — but do NOT actually deploy
  anywhere yet.
- **Do not deploy** (no live hosting, no domain, no production
  infra spend) until the client has finalized:
  - Their own fee/scope agreement
  - The deployment/hosting fee
  This is a hold point, not a technical blocker — the app should be
  functionally complete and deployable on demand, just not pushed live.

## Commercial-readiness notes (for later, not v1 gold-plating)
- Client said "upgrade later for commercial use" — interpret this as:
  keep the data model capable of multi-tenancy (multiple properties/
  owners) even though v1 UI only needs to support one. Don't build
  multi-tenant UI now, just don't paint the schema into a corner.
- Real tenant documents (ID proofs, agreements) will eventually be
  real PII — v1 can use placeholder/mock uploads, but note this is a
  future compliance concern, not a "no PII ever" project like the
  clinical one.

## Mobile path (decide later, don't pre-build)
Two realistic options once v1 web is validated:
1. **PWA / Capacitor wrapper** around the same web app — cheaper,
   faster, one codebase. Good fit for this kind of CRUD/forms/lists
   app. Recommended default unless app-store presence is required.
2. **True native (React Native / Flutter)** — needed only if the
   client wants Play Store/App Store distribution, push notifications
   for rent-due reminders, or native camera/document scanning.

**Update 2026-09-30 — direction chosen, not started:** Phase 2 will be
a **proper Play Store app** (option 2, React Native/Expo), matching the
resident app in the "Doshi PG" reference video (rent due + pay, receipts,
complaints, move-out notice; voice check-in optional). It starts **only
after the client has reviewed and signed off the current web app**. At
that point: write the Phase 2 plan here, scaffold `mobile/` against the
live `shared/contract.ts`, and resolve the open client questions first —
resident login method (SMS OTP cost), payment gateway (or none),
backend hosting/deployment (the app can't work against a laptop), and
consent/storage for real ID documents (DPDP Act). The client-facing
question list and rough pricing live in `private/DEMO_CHECKLIST.md` (local only, gitignored).

Rough fee shape to flag to the client when the time comes (not
committed numbers, just categories):
- Dev time (scales with option 1 vs 2 above)
- Hosting/infra (small, ongoing)
- Document storage (once real uploads exist)
- If native: Apple Developer Program ($99/yr), Google Play
  ($25 one-time)

## Explicit non-goals for now
- No live deployment until fees are finalized (see Trajectory)
- No multi-property/multi-user UI in v1 (single manager, one set
  of properties)
- No real tenant PII in v1 — mock/placeholder data
- No native mobile build yet — web first

## Open questions to confirm with the client before building
Resolved 2026-08-26 — decisions below, full rationale in `CLAUDE.md`
"Decisions locked for v1":
- [x] How many properties/flats does this need to support in v1 —
      one building, or several from day one?
      → One building to start; data model already supports more.
- [x] Single user (owner) or multiple staff logins with roles?
      → Multiple staff logins, two roles (owner/staff).
- [x] Is Rent Tracker a computed view (derived from Tenant Details +
      a payment log) or its own manually-updated record? This
      decides the data model.
      → Computed view over Tenant + a payment log — chosen as the
      more feasible option since it can't drift out of sync.
- [x] What happens to "Lost" leads — tracked/reportable, or just
      archived out of the active list?
      → Archived (kept, hidden from default view, toggle to show).
- [x] Currency/locale assumptions (seems India-based per phone
      number/context — confirm INR, DD/MM date format, etc.)
      → Confirmed: INR, DD/MM/YYYY.
- [x] Any existing spreadsheet/tool this is replacing, whose data
      should inform the schema or be migratable later?
      → None — v1 ships with realistic seed data, no migration path
      needed yet.

## Stack (proposed — confirm before building)
Mirror the sibling project's split for consistency and to keep a
clean web→mobile migration path later:
- Backend: FastAPI (or Node/Express — confirm)
- Frontend: React (Vite)
- A `shared/contract` file (as in `clinical-decision-support/`) once
  the API shape is settled, so frontend and backend don't drift.

## Related
See `../clinical-decision-support/` for the sibling project in this
repo — unrelated in domain, but its CLAUDE.md structure (fixed
contract file, explicit non-goals, demo-scenario-driven scope) is a
useful template for how this project's docs should evolve once
scope is finalized.
