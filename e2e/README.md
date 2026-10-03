# Browser checks (e2e)

Scripts that drive a real Chromium (or raw HTTP) against a **scratch copy**
of the app. They change data — never point them at a real database. Reseed
(step 1) before each run.

| Script | What it proves |
|---|---|
| `audit.js` | **The owner's whole day as one pipeline** — sign in (wrong then right password) → add lead → status → move the lead into a bed at a negotiated rent → change the bed's listed rent (resident unaffected) → renewal → part payment → receipt → over-payment blocked → full payment → Excel exports compared row-by-row with the API → edit phone → complaint → notice/inspection/deduction/settlement → expense add/delete → staff create/sign-in/reset/deactivate → Activity page. After every step it checks the change landed everywhere (Day Book numbers, beds, rent tracker, P&L, Activity log). Then it presses every filter, toggle, chip and "Open →" link on every page. |
| `multiuser.js` | **Several people at once**, each in their own browser: two staff pay the same rent at the same instant (counted once, the other is told), two staff book the same bed (one wins, the other is told), owner and staff edit the same resident, owner watches staff work live in Activity, password change on one device signs out the other, deactivation mid-session, staff typing owner-only addresses |
| `load.js` | **Many users** straight against the API: everyone signs in at once, then reads and writes for N seconds; reports p50/p95/max per action and proves no money was double-counted and every retry was answered once. `USERS=50 SECONDS=60 node load.js` (realistic pauses) or `MODE=stress …` (no pauses) |
| `flows.js` | Every feature end to end: part payment → receipt → WhatsApp, Excel export, bulk rooms, Excel import, search, renewal, lead → move-in, P&L, password reset/change, staff restrictions |
| `stress.js` | With every server reply randomly delayed 0–700 ms, fast toggling/month switching/typing always lands on the last choice; no crashes; expired or corrupted sessions return to sign-in |
| `layout-qa.js` | Every page and dialog at 1440 / 1280 / 1024 px: no sideways page scroll, no clipped text, nothing leaking out of its card, no overlapping elements. Screenshots in `output/layout/` |

## Run

```bash
# 1. Scratch backend on :8765 with a fresh demo database
cd backend
rm -f /tmp/pg-e2e.db
DATABASE_URL=sqlite:////tmp/pg-e2e.db .venv/bin/python seed.py
DATABASE_URL=sqlite:////tmp/pg-e2e.db ALLOWED_ORIGINS=http://localhost:5174 .venv/bin/uvicorn main:app --port 8765

# 2. Scratch frontend on :5174 pointed at it (new terminal)
cd frontend
VITE_API_URL=http://localhost:8765 npx vite --port 5174 --strictPort

# 3. Checks (new terminal)
cd e2e
npm install
npx playwright@1.47 install chromium   # once
npm run flows    # reseed (step 1) before re-running flows or stress
npm run stress
npm run layout
npm run audit      # reseed first
npm run multiuser  # reseed first
USERS=50 SECONDS=60 npm run load
```

**Results on 04/10/2026** (laptop, SQLite): audit 88/88 · multi-user 20/20 ·
flows 22/22 · stress 19/19 · layout clean at 1440/1280/1024 (84 screens).
Load, realistic, 50 users, one server process: 21 req/s, p50 7–93 ms,
p95 ≤ 2.6 s, 0 errors, 0 double-counted. Stress, 30 users with no pauses
(≈ several hundred real people), 4 processes: 68 req/s, p50 15–213 ms,
0 errors, 0 double-counted. The slow tail is SQLite's single writer plus
rent generation on every read — both on the go-live list (PostgreSQL,
nightly generation).

To use a Chromium already on the machine: `E2E_CHROME=/path/to/chrome npm run layout`.
