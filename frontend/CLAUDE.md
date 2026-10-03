# Frontend — Sunrise PG property manager UI

## Who uses this
A single property manager (owner) plus front-desk staff, checking
occupancy, following up on leads, and chasing rent — many short
sessions a day, not a marketing surface. Every screen should answer
"what needs my attention" fast; nothing here is meant to persuade or
delight a visitor.

## Design system (already built — don't reinvent per-page)
Token file: `src/styles/tokens.css`. The visual language is the
property manager's own back-office material — a ledger book, brass
room-key tags, rubber date-stamps — not a generic SaaS dashboard.
Signature element: every status anywhere in the app (lead stage, bed
occupancy, rent status) renders through the same rotated ink-stamp
badge, `src/components/common/StatusBadge.tsx`. Reuse it for any new
status-shaped data instead of inventing a new indicator style.

Shared building blocks, use these before writing new CSS:
- `src/components/common/Table.module.css` — ledger-style tables
- `src/components/common/Form.module.css` — inputs, buttons, field layout
- `src/components/common/Modal.tsx` — dialogs
- `src/components/common/StatTile.tsx` — dashboard/rent-tracker stat cards
- `src/pages/PageLayout.module.css` — page header/toggle/filter-bar layout

## API contract
`src/types/contract.ts` mirrors `../shared/contract.ts` exactly. Don't
add a field here without adding it there and in
`../backend/models/schemas.py` first — check with the user if backend
work is needed.

## Non-negotiables
- No handler that doesn't call a real endpoint in `src/api/client.ts`.
  If a button doesn't have a backed action yet, it doesn't belong in
  the UI yet — don't ship a `// TODO: wire this up` control.
- Auth token lives in `sessionStorage` (see `src/store/authStore.ts`),
  attached by `src/api/client.ts`'s `request()` helper automatically —
  don't hand-roll fetch calls elsewhere.
- Role-gating (`owner` vs `staff`) happens both in `App.tsx`
  (`RequireOwner`) and by simply not rendering the nav link in
  `AppShell.tsx` — keep both in sync if a new owner-only page is added.

## Mobile
Not built — see `../mobile/README.md`. Don't add responsive
breakpoints beyond graceful degradation on a laptop-vs-smaller-laptop
scale; a real mobile client is a separate future build, not a
squeezed-down version of this layout.
