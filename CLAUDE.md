# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both servers (run from repo root)
npm run dev

# Client only (port 5173)
npm run dev --prefix client

# Server only (port 3001)
npm run dev --prefix server

# Type-check client
cd client && npx tsc --noEmit

# Build client for production
npm run build

# Database: generate migration after schema changes
npm run db:generate   # runs drizzle-kit generate in server/

# Database: apply pending migrations
npm run db:migrate    # runs drizzle-kit migrate in server/

# NOTE: drizzle-kit migrate sometimes fails silently on manually-created migration files.
# If columns are missing after db:migrate, apply them directly:
#   cd server && node -e "const Database=require('./node_modules/better-sqlite3'); const db=new Database('./data/dashboard.db'); db.exec('ALTER TABLE ... ADD COLUMN ...')"
```

There are no tests. The app is always dark mode — there is no light mode toggle.

## Architecture

This is a **local-only** life management dashboard (no auth, no cloud). Two processes run concurrently:

- **Client**: Vite + React 18 + TypeScript at `localhost:5173`. The Vite dev server proxies `/api/*` and `/uploads/*` to the backend, so all `api.get('/api/...')` calls work without a base URL.
- **Server**: Node.js + Express at `localhost:3001`. SQLite database at `server/data/dashboard.db`. Uploaded images stored under `server/uploads/` (gitignored).

### Server (`server/src/`)

Entry point: `src/index.ts` mounts all routers under `/api/<module>`. On startup it calls two async materialization functions (fire-and-forget, errors logged):

```ts
materializeRecurring()          // from routes/finances.ts
materializeRecurringInvoices()  // from routes/business.ts
```

**Database** (`src/db/`):
- `schema.ts` — all Drizzle table definitions. JSON columns use `text('col', { mode: 'json' })` for arrays. Current migration level: `0009_recurring_invoices`.
- `index.ts` — initializes `better-sqlite3` with WAL mode and FK enforcement, exports `db`.
- Migrations are in `src/db/migrations/`. After changing `schema.ts`, run `db:generate` then `db:migrate`.

**Routes** (`src/routes/`): One file per module — `trades`, `checklists`, `goals`, `finances`, `business`, `training`, `calendar`, `notes`, `dashboard`. All routes use `try/catch` and pass errors to `next(e)` for the central error handler.

**Computed trade fields** are calculated in `src/routes/trades.ts:computeTradeFields()` before every INSERT/UPDATE — never stored raw:
```
realizedPnl  = (exit - entry) × size × (Long=+1, Short=-1)
rrRatio      = realizedPnl / riskDollars
deviationPct = |loss / riskDollars - 1| × 100
```
**Trading P&L is always USD** — use `formatCurrency()` everywhere, never `formatGBP()` for trade amounts.

**Goal progress propagation**: `PUT /api/goals/:id` calls `updateParentProgress()` recursively after save, averaging children's `progressPct` up the tree (`src/routes/goals.ts`).

**Image uploads** (`src/middleware/upload.ts`): Two Multer instances — `screenshotUpload` (saves to `uploads/screenshots/`) and `noteImageUpload` (saves to `uploads/note-images/`). Files are named with UUIDs. Served as static files at `/uploads/*`.

---

### Recurring Materialization Pattern

Both `financeExpenses`/`financeIncome` and `businessInvoices` support auto-generation of recurring occurrences. The pattern is the same for all three:

**Schema columns added to recurring-capable tables:**
- `recurringParentId integer` — null on the template entry, set to the template's `id` on auto-generated children
- `lastGeneratedDate text` — high-water mark on the template; controls where the next generation run starts. **Never reset this backwards** — doing so causes duplicate entries.
- `isRecurring integer` (expenses, invoices) / `frequency text != 'one-time'` (income) — marks a template

**`materializeRecurring()` in `finances.ts`:**
- Rate-limited to once per 5 minutes via `lastMaterializedAt` module variable
- Called on server startup and on every `GET /api/finance/expenses|income` request
- Also triggered immediately (by resetting `lastMaterializedAt = 0`) when a new recurring expense/income is created via POST
- Advances `lastGeneratedDate` forward only — never backwards
- Three update cases: (1) new entries generated → set to last generated date; (2) first-ever run, nothing to generate → set to template's own date; (3) subsequent run, nothing new → **leave unchanged**

**`materializeRecurringInvoices()` in `business.ts`:**
- Same rate-limit and trigger pattern
- Auto-generates invoice number via `nextInvoiceNumber()`: scans all `invoiceNumber` values, extracts the max numeric suffix, increments with the same prefix + zero-padding (e.g. `INV-003` → `INV-004`, `ZAV-0010` → `ZAV-0011`)
- Carries net payment terms forward: computes `dueDate = newIssueDate + (originalDueDate - originalIssueDate)`
- Auto-generated invoices start as `status: 'unpaid'`

**Supported frequencies:** `weekly`, `monthly`, `quarterly`, `yearly`. The `advanceDate()` helper handles end-of-month clamping (Jan 31 → Feb 28 → Mar 31).

---

### Client (`client/src/`)

**Data layer** (`src/hooks/`): One hook file per module. All hooks use TanStack Query v5. Key API patterns:
- `useQuery` with `queryKey: ['module', filters]`
- Mutations call `qc.invalidateQueries({ queryKey: ['module'] })` on success
- Use `isPending` (not `isLoading`) for loading state in v5

**API client** (`src/lib/api.ts`): Axios instance with empty `baseURL` — relies on Vite proxy. All calls use `/api/...` paths directly.

**Utilities** (`src/lib/`):
- `utils.ts` — `cn()` (clsx + tailwind-merge), `formatCurrency()` (USD $), `formatGBP()` (£), `formatPnl()`, `formatDate()`, `pnlColor()`, `today()`
- `constants.ts` — all enums: `INSTRUMENTS`, `DIRECTIONS`, `ORDER_TYPES`, `HORIZONS`, `MISTAKES`, `EXPENSE_CATEGORIES`, `EVENT_CATEGORIES` (personal / business / health / trading / **focus**), etc.

**Currency rules:**
- `formatCurrency()` ($) — trading P&L, trade amounts, any USD value
- `formatGBP()` (£) — business invoices, business expenses, Zavabuild revenue
- `formatCurrency()` ($) — personal finance (accounts, income, expenses) — these use $ in the Finance page

**Routing**: Single layout route in `App.tsx` with `<Outlet>`. The `<Layout>` renders `<Sidebar>` + `<TopBar>` + `<main>`. Sidebar collapse state is persisted to `localStorage`.

**Styling**: Tailwind CSS v3, always dark ("Obsidian OS" design system). Custom color tokens in `tailwind.config.ts`:
- Backgrounds: `bg-primary` (#09090f), `bg-secondary` (#0e0e1a), `bg-card` (#13131f), `bg-border` (rgba white 7%), `bg-hover` (rgba white 4%)
- P&L: `pnl-profit` (#34d399 emerald), `pnl-loss` (#f87171 red)
- Text: `text-primary` (#eeeef5), `text-secondary` (#8b8baa), `text-muted` (#4b4b6b)
- Accent: `accent-blue` (#818cf8 indigo), `accent-purple` (#a78bfa violet), `accent-cyan` (#22d3ee)
- Monospace numbers: `className="num"` (JetBrains Mono). UI text uses Inter.
- Gradient utilities in config: `bg-gradient-primary` (indigo→violet), `bg-gradient-emerald`, `bg-gradient-cyan`
- Glass utility class `.glass` defined in `index.css`; gradient text via `.gradient-text`
- Cards/modals/inputs use `rgba(255,255,255,N)` borders and backgrounds (not solid colors) for depth
- Body has a subtle radial violet glow (`background-image` in `index.css`) — do not overwrite with `bg-bg-primary` on layout root
- Primary buttons use inline `style` gradient (not Tailwind `bg-gradient-to-r`) to avoid Tailwind purging the gradient classes
- `StatCard` accepts `iconBg`, `iconColor`, `accent` props for per-card color treatment

**Recharts**: All `<ResponsiveContainer>` must be wrapped in a `<div>` with an explicit height class (e.g. `h-56`), otherwise charts render at zero height.

**Type imports**: `verbatimModuleSyntax` is enabled in `tsconfig.app.json`. Type-only imports must use `import type { ... }` or inline `type` keyword: `import { type Foo } from '...'`.

---

### Module map

| Route | Page | Server prefix |
|---|---|---|
| `/` | Dashboard | `/api/dashboard` |
| `/trading` | Trading Journal + Analytics | `/api/trades` |
| `/checklists` | Daily checklists + template editor | `/api/checklists` |
| `/goals` | Goal cascade tree | `/api/goals` |
| `/finances` | Accounts, income, expenses, net worth | `/api/finance` |
| `/business` | Zavabuild clients/projects/invoices/notes | `/api/business` |
| `/training` | Workouts + body metrics | `/api/training` |
| `/calendar` | Life OS calendar (Day/Week/Month/Year) | `/api/calendar` |
| `/notes` | Tiptap rich text notes | `/api/notes` |

---

### Business Module — key behaviours

**Invoices:**
- Auto-number: when the `InvoiceModal` opens for a new invoice, the `#` field is pre-filled with the next sequential number computed client-side from all existing invoice numbers.
- Recurring grouping: `InvoicesTab` separates invoices into recurring groups (template + auto-generated children, collapsible) and standalone invoices. Templates show a `↻ frequency retainer` badge; children inherit `isRecurring: 1`.
- Project assignment: invoices optionally linked to a project via `projectId`. When a client is selected in the modal, a project selector appears showing only that client's projects. Project Profitability table and project cards show `collected / value` with a progress bar.
- Client meeting quick-book: when an event with `category: 'business'` is created in the Calendar and a `clientId` is provided, a meeting note is auto-created in the business module.

**Time logging:**
- Hours and minutes are entered as separate integer fields (`h` + `m`), combined to decimal hours on submit: `totalHours = h + m/60`.
- Displayed as `fmtHours()` helper: `1.5` → `1h 30m`, `0.9` → `54m`, `2.0` → `2h`.

**Project collected revenue:**
- `collectedByProject` is computed in both `OverviewTab` and `ProjectsTab` by filtering paid invoices with a `projectId`.
- Project cards show `£collected / £value` + a colour-coded progress bar (amber < 50%, indigo 50–99%, green = 100%).

---

### Finance Module — key behaviours

**Recurring expenses/income**: Any `financeExpense` with `isRecurring: 1` or any `financeIncome` with `frequency != 'one-time'` is treated as a template. The materialization engine auto-generates occurrence rows on the server.

**Exclude Business Expenses toggle** (`useFinanceSettings.ts` key `excludeBusinessExpenses`):
- Stored in localStorage under `'oura-finance-settings'`
- When on, passes `excludeBusiness: '1'` query param to `/api/finance/expenses`, `/api/finance/summary`, and `/api/finance/cashflow`
- The server's `GET /api/finance/expenses` adds `ne(financeExpenses.category, 'Business')` to the WHERE clause when this param is set
- `ExpensesTab` and `BudgetsTab` use `useFinanceSettings()` to conditionally pass the param

**`streamParams()` in `useFinances.ts`** — builds the standard param set shared by `useFinanceSummary`, `useCashFlow`, `useIncomeStreams`:
```ts
{ includeTrading, includePaidInvoices, excludeBusiness }
```

---

### Calendar Module — key behaviours

**Views**: Day / Week / Month / Year — toggled via a segmented control. All derive ranges from a single `selectedDay: Date` state. Navigation arrows advance by 1 day / 7 days / 1 month / 1 year respectively.

**Day view** (the "Life OS" view):
- Left panel: 24-hour time grid (midnight → midnight), scrollable, with a layer system
- Right panel: collapsible intel sections auto-populated from other modules (Trading P&L, Checklists, Fitness, Business invoices due, Goal deadlines, Finances)
- Grid layers (persisted to localStorage under `'cal-layers-v2'`):
  - **Events** — calendar events as coloured blocks
  - **Checklist** — checklist items that have a `time` field, rendered as 20px bars at their scheduled time
  - **Plans** — trading session bands + planned workout ghost blocks
- **Checklist item time parsing**: times may be stored as `"14:30PM"` (24h hours + redundant AM/PM suffix). The `timeToPct()` helper strips the suffix, then only applies 12h→24h correction when the hour is genuinely < 12. Never use `Number("30PM")` — it returns `NaN`.

**Trading sessions config** (gear icon ⚙ next to the Plans toggle):
- Stored in localStorage under `'cal-trading-sessions'`
- Three sessions: NYSE (14:30–21:00 indigo), London (08:00–16:30 emerald), Asia (00:00–09:00 amber) — UK/BST defaults
- Each session: toggle on/off, start time, end time (native `<input type="time">`)
- Rendered as coloured translucent bands in the time grid on weekdays when Plans layer is on
- Asia session (00:00–09:00): the grid starts at 00:00 so the visible portion is 00:00–09:00

**"Now" indicator**: Apple Calendar-style — a red time pill (`HH:MM`) in the left gutter + solid red line spanning full width. Rendered at the outer grid container level (not per-column), so it correctly sits on top of all session bands and events. A `setInterval` ticks every 60 s to keep it live.

**Week view**: 7-column time grid, each column clickable to switch to day view. Activity dots (amber=trades, emerald=workout, red=invoice due, violet=events) in each column header.

**Month / Year views**: Click a day → switch to day view. Month view shows event pill titles per day. Year view shows 12 mini-month calendars with activity dots.

**Intel panel — collapsible sections**:
- Each section shows a one-line summary when collapsed (e.g. `3 trades · +$234.50`)
- Sections are hidden entirely when there's no data for that day
- Trading P&L always uses `formatCurrency()` ($), never `formatGBP()`

---

### Adding a new module

1. Add tables to `server/src/db/schema.ts`, run `db:generate` + `db:migrate`
2. Create `server/src/routes/<module>.ts`, mount in `server/src/index.ts`
3. Create `client/src/hooks/use<Module>.ts` with query/mutation hooks
4. Create `client/src/pages/<Module>/index.tsx` using `<PageShell>`
5. Add route to the `children` array in `client/src/App.tsx`
6. Add nav entry to `NAV` array in `client/src/components/layout/Sidebar.tsx`
