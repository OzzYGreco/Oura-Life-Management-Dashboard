# Building a skin: brief for the Linear, Revolut and Things skins

ŌURA is the owner's private life dashboard (React 19, Vite, Tailwind 3, TanStack Query). It has four switchable skins. Each skin has its OWN full layout, not just different colours. The **Whoop skin is finished** and is the reference implementation: read it first.

- `client/src/skins/whoop/Shell.tsx`, `Today.tsx`, `whoop.css`

## What you build (only these files; touch nothing else)

For skin `<id>` (Component prefix `<Name>`):

- `client/src/skins/<id>/Shell.tsx` exports `<Name>Shell({ children })`: the app frame and navigation, in the draft's style. It renders `children` (the current page) in a scrollable or `h-full` main area. Non-Today pages are the app's older pages; they use `h-full` and scroll inside themselves, so the main area must be `flex-1 min-h-0 overflow-hidden` like Whoop's `.wh-main`.
- `client/src/skins/<id>/Today.tsx` exports `<Name>Today()`: the home screen, a faithful port of the draft, driven by real data.
- `client/src/skins/<id>/<id>.css`: all styles, every class prefixed with a short skin prefix (`ln-`, `rv-`, `th-`) and scoped under a root class, so nothing leaks between skins.

Placeholder files exist; overwrite them.

## Visual spec

The approved draft (a static 1440×900 mock with illustrative data):

- Linear: `design/drafts/a-linear.html` (+ `.png`)
- Revolut: `design/drafts/c-revolut.html` (+ `.png`)
- Things: `design/drafts/d-things.html` (+ `.png`)

Port its look faithfully (palette, type, spacing, radii, components, composition), but make the layout fluid. It must fill a wide display (the owner uses 2940 px) using CSS grid with sensible max widths, and it must not break at 1280 px. Palette variables already exist as `--k-*` under `:root[data-skin="<id>"]` in `client/src/skins/skins.css`; use them, and don't edit skins.css. Fonts (Inter, Inter Tight, Manrope) are already loaded.

## Data and actions (shared, never fork them)

From `client/src/core/today.ts`:

- `useToday()` returns the `TodayView`; read the type carefully.
- `useTick()`: `tick.mutate({ id })` ticks an item. The server scores it by the time; a 409 response carries `error` text (e.g. not open yet). Show it.
- Helpers: `duration`, `partOfDay`, `isDone`, `resultLabel`, `MISS_REASONS`.

From `client/src/skins/core.tsx`:

- `NAV` is the nav list. Use it, in this order, with `NavLink` and `end` for `/`.
- `SKINS` and `useSkin()` give `{ skin, setSkin, openPalette }`. Every Shell needs a **skin picker** (in the sidebar footer or an avatar menu) and a ⌘K/search affordance that calls `openPalette`.
- `useOpenReview()` opens the shared evening-review sheet. Show a "Close the day" action when the day has no windows left, or when items are overdue.

Mirror the Whoop page's states: the current window open (Done button), an overdue item (Done late at half credit), between windows, the day closed, no weekly goal (`week === null`), no wins (an honest empty line, never fake wins), and no routine items. Real data today: 15 routine items running 09:15 to 01:45 (the day runs 04:00 to 04:00), 0 to 5 wins, 1 to 2 trading accounts in the pulse, and possibly no invoice due.

## Rules (binding)

- **Colour carries meaning only.** Good is green (money made, on time). Bad is red (loss, missed). Warn is amber (late, warning). Accent is interactive. Used allowance is never green.
- No em dash characters (U+2014) anywhere, in code, comments or copy. Use a colon, a comma or a spaced hyphen.
- No invented data. Show only what the view model provides. Where the draft showed something the data doesn't have, either derive it honestly or leave it out.
- Keep all copy plain and human.
- Accessibility: real buttons, `aria-label`s on icon buttons, visible focus.
- TypeScript strict. `npx tsc -b` from `client/` must show no errors in your files (errors in `pages/Trading/*` already exist; ignore those).

## Verify (required)

The dev server runs at http://localhost:5173 (API on :3001). Preview your skin without changing the saved one at `http://localhost:5173/?skin=<id>`.

Screenshot at two widths:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,1000 --virtual-time-budget=9000 --screenshot=<scratch>/<id>-1600.png "http://localhost:5173/?skin=<id>"
```

Repeat at `--window-size=2560,1300`. Also check one non-Today page, e.g. `http://localhost:5173/trading?skin=<id>`, so the Shell frames it properly.

Look at the PNGs with the Read tool and fix every overlap, clipping, misalignment or awkward gap. Iterate until it is as good as the draft. Put screenshots in your scratch dir, not the repo.

Report back: the files written, and 3 lines on any deviation from the draft and why.
