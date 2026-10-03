# Mobile — reserved, not yet built

This folder is intentionally empty of code. Phase 2 of this project
(see `../CONTEXT.md`) wraps the same backend behind a mobile client
once the web app (Phase 1) is validated with the client. Building a
mobile shell now, before that decision is made, would just be dead
code — every screen would either duplicate `frontend/` with no real
users, or drift out of sync with it. Neither is useful; both look
"vibe-coded" (functionality that exists to look finished, not because
anything needs it yet).

## What's already true, so Phase 2 is not a rewrite

- `shared/contract.ts` is the API boundary. A mobile client (React
  Native/Expo, or a Capacitor wrapper around `frontend/`) talks to the
  same FastAPI backend through the same contract — no backend changes
  required to add a mobile client.
- Auth is real JWT bearer tokens (`backend/auth.py`), not
  session/cookie-based, so a mobile client can store the token however
  is idiomatic for that platform (Keychain/Keystore, not a cookie jar).
- The data model has no single-tenant assumptions baked in (see
  `Property`/`Bed` foreign keys throughout `backend/models/db_models.py`)
  — a mobile client doesn't need a schema migration to work against it.

## When this actually gets built

Per `../CONTEXT.md`'s "Mobile path" section, decide between:
1. **PWA / Capacitor wrapper** around `frontend/` — the default unless
   Play Store/App Store presence specifically is required.
2. **True native (React Native/Flutter)** — only if push notifications
   for rent-due reminders or native camera/document scanning become
   real requirements.

Whichever path is chosen, scaffold it here as `mobile/` at that time,
against the live `shared/contract.ts` — not against a guess made now.
