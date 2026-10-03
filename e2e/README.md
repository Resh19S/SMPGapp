# Browser checks (e2e)

Three scripts that drive a real Chromium against a **scratch copy** of the app.
`flows.js` and `stress.js` change data — never point them at a real database.

| Script | What it proves |
|---|---|
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
```

To use a Chromium already on the machine: `E2E_CHROME=/path/to/chrome npm run layout`.
