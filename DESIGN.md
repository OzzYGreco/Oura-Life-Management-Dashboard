# Arete design system

Status: **live, 2026-11-08.** Arete is the only layout (`client/src/skins/next/`, on the frame in `client/src/skins/whoop/`).

## Decision: one layout, light and dark
Each page has **one layout**, built once and polished deeply. The old Linear, Revolut, Things and Whoop skins were retired on 2026-11-08 after a feature inventory; what they had that Arete lacked was ported (the coach line and day summary, the pace word, the day's closing time, Close the day with R, the loss-limit bars, the red/amber/green heatmap bands).
Appearance is **Dark, Light or Match Mac** (L toggles), set from the top bar or the avatar menu (`core/mode.ts`). The `whoop/` folder stays only as Arete's frame and the shared sheets (composer, logger, routine editor).

## What we fix (seen on the real screen, 2026-11-07)
1. **One message per moment.** Today said "behind you" three times (headline, status card, Discipline 0%). Each fact appears once, in the place it belongs.
2. **No card kit.** Every block was the same rounded card, with rows boxed again inside. The page is the surface; group with space and one hairline. A box is used only for a thing you act on as a unit (the Now block, a sheet, a popover).
3. **History never shames.** The day-score heatmap was a wall of red because the average is 19. History uses a **single-hue intensity ramp** (faint to good-green). Red is reserved for something you can still act on now.
4. **One type family, one scale.** whoop.css used 20+ font sizes. Use the scale below and nothing else.
5. **No repeated chrome.** No grey second line under every headline, no `·`-joined meta strings everywhere, no label above every block.

## Tokens
Tokens live in `client/src/skins/skins.css`. `--k-*` is the theme palette; `--c-*` is the app-wide mapping used by Tailwind (`client/tailwind.config.ts`). Components read semantic tokens only, never raw hex.

### Colour (Night)
| Token | Hex | Use |
|---|---|---|
| bg | `#0B0E14` | page |
| raised | `#121722` | the few boxes: Now block, sheets, popovers |
| ink / ink-2 / ink-3 | `#ECEFF4` / `#B4BCC9` / `#7F8899` | text, 3 levels only |
| line | `rgba(255,255,255,.07)` | the one hairline |
| good | `#6FD3A0` | on time, money made, done |
| warn | `#E9B65E` | late, warning |
| bad | `#EC7C6E` | missed, loss, and only when actionable |
| accent | `#DCE3EE` | interactive (buttons, focus, links) |

**Colour carries meaning only.** Used allowance is never green, and decoration is never coloured.

### Type
- **SF Pro, the system font** (owner's choice, 2026-11-08): `-apple-system` gives SF Pro Text and Display, switching by size as on iOS. It replaces Inter, Inter Tight, Manrope and the trial of Instrument Sans, which read as too rectangular. Non-Apple devices fall back to their system font.
- **Big display numbers** (dial score, week score, panel figures) use **SF Pro Rounded** (`--k-round`) at weight 600, as iOS Fitness and Health do. SF Pro Rounded is installed in `/Library/Fonts` on the owner's Mac. Safari also reaches it through `ui-rounded`.
- Tracking follows iOS: about -0.01em for 34px headlines and -0.02em for the 64px score. Never condense.
- **No monospace** for labels. Times and numbers use tabular figures of the same family.
- **Scale (px):** 12 · 13 · 15 · 18 · 24 · 34 · 80. Body is 15, rows are 13 or 15, section titles 18, the Now headline 34, and the score 80. Line height is 1.45 for text and 1.05 for display numbers.
- **Sentence case** everywhere. No all-caps labels, and no single-word highlight in headlines.

### Space, radius, depth
- **Space:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64. Sections are separated by 48, not by boxes.
- **Radius by role:** 8 for small controls and chips, 12 for 44px buttons, 10 for rows and inputs, 16 for sheets, 20 for the hero. Never one radius on everything.
- **Depth:** the page has none; boxes get 1px line plus one soft shadow; sheets get the modal shadow. No gradients.

## Layout
```
┌ nav (top, one row) ───────────────────────── ⌘K search · date · theme ┐
│ NOW            the one thing to do next, its window, [Done] / log line │
│                ─────────────────────────────────────────────────────── │
│ TODAY  score 64px      vs last same weekday · best this month          │
│        timeline of windows (single row)                                │
│ ───────────────────────────────────────────────── │ WEEK  gauge        │
│ module sections: routine rows, trading, money...  │ goals as rows      │
└────────────────────────────────────────────────────────────────────────┘
```
- Left aligned throughout. Main column max 880px; side column 360px; content centred at 2940px wide with empty margins, not stretched.
- Must hold at 1280px and up to 2940px.
- **Rows, not cards:** time · name · state · action, aligned on a shared grid, with the hairline between.

## No dead space (owner's rule)
- Never leave one column long and the other empty. Lay a page out in **rows of things that belong together**, so each row ends at one height.
- Fix gaps by restructuring with meaning (move a block to where it belongs, merge short related blocks, show the data a real chart needs), never with filler.
- **One 3-column grid, one gap, for the whole page.** The hero spans two columns, the week one. Day lanes and pulse panels sit on the same three columns, so every edge lines up from top to bottom.
- Today's rows: hero + week (how am I doing), then the day as Morning / Afternoon / Tonight / Anytime / This week / Coming up lanes (what's on). On a light day the lanes share the row (1 = full width, 2 = halves). Then the pulse: Trading, Business, Training.

## Pulse panels
Every module panel has the same five layers on a shared CSS subgrid, so they align across the row:
1. title + unit tag
2. one big figure + a line of context
3. a 64px visual
4. three small figures
5. an action

## Currency (owner's rule)
- **Trading is USD only.** No currency selector.
- **Business earns in GBP.** Show GBP first, with the USD and EUR equivalents and the live rate (`useCurrencyRates`, rates against GBP).

## The hero (Today)
One card holds the Whoop-style score dial and the one thing to do. That's the only box on the page.
- **Dial:** earned arc in good, still-reachable arc faint, last-week marker as a dashed ring, best-this-month as a dot.
- **Action side:** state line, headline, chips (points, deadline, late value), then Done and Missed buttons with their keys.
- **Foot:** facts (on time, late, missed, versus last week, best this month), label over number, never a sentence. Beside them, the last 7 days as labelled bars with the shown day marked.

## Text budget
- No paragraphs on a dashboard. A fact is a figure with a small label, a chip, or a caption under the row it belongs to (for example "Biggest lever, +1.75 still open").
- No pill tags inline with a row's title: they push titles onto two lines. Use a small coloured caption under the title, and move the flagged row to the top of its list.
- At most one short line of prose per section, and only when a number can't say it.

## Buttons
- 44px tall, sentence-case verb, with the key hint inside (`Done D`).
- Primary is solid accent with an inner highlight. Secondary is a faint fill with a 1px inset line.
- Press scales to 0.96 over 150ms with ease-out, never when disabled. Hover styles only under `(hover: hover)`.
- Checkboxes are 20px with a 44px hit area.

## Entry (non-negotiable)
- **Quick-add line** on every module page, parsed in one line (`parseQuick` in `client/src/core/routine.ts` is the model): "Read 10 pages 22:30 30m weekdays must".
- **⌘K** (`openPalette` in `client/src/skins/core.tsx`) can add to any module and jump anywhere.
- **Single keys** on lists: `N` new, `Enter` done, `L` late, `M` missed, `E` edit, `↑↓` move.
- Suggestions come from history and are shown inline; one `Enter` accepts.

## Motion (Emil skills: `animate`, `choreograph`, `review-animations`)
- No motion on keyboard actions or on anything that updates often.
- **Done:** the row settles in 150ms with ease-out and the score number ticks up. This answers the action.
- **Closing the day** is the one orchestrated moment in the whole app: the score locks and the week gauge moves.
- Respect `prefers-reduced-motion`. Animate transform and opacity only.

## Adding a module
1. Data: a server route plus a `client/src/core/<module>.ts` view-model hook. Logic is never put inside page components.
2. Page: one component in the base layout using the rows, quick-add line, section and number primitives. No new colours, sizes or radii.
3. Register it in `NAV` (`skins/core.tsx`) and in ⌘K.
4. Ship only after the 1280px and 2560px screenshots are checked.

## Banned
Nested cards; identical rounded cards in grids; gradient fills and washes; decorative charts with no question behind them; all-caps eyebrows; `01 / 02` markers on non-sequences; `→` appended to buttons; em dashes (U+2014) in code or copy; invented data.
