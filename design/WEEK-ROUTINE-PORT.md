# Port the Week page and the Routine updates to a skin

**The governing principle** (the owner's words): "I want to make my life EASIER but also measurable. Premium design, yes, but every action should be simple and not take 1,000 clicks, otherwise I will get lazy." Every job is one step, with smart defaults from history. Nothing is created or assumed behind the user's back.

The Whoop skin is the approved reference for both pages. Port them faithfully in function and structure, **in your skin's own visual language**: match that skin's Today and Routine pages for palette (`--k-*`), type, radii, density, controls and buttons. Only edit the files named below for your skin.

## 1. Routine page updates (your `client/src/skins/<id>/Routine.tsx` + CSS)

Read the updated `client/src/skins/whoop/Routine.tsx` and the end of `whoop.css`. Then add:

- **One-line quick add:** `QuickAdd`, using `parseQuick` from `core/routine.ts`. It goes at the top of the routine list, saves through the draft's new `addParsed` (port `addParsed` into your `useDraft`), and shows a live preview of what was understood plus an Enter hint. The old "+ Add an item" button stays below the list as "+ Add an item field by field".
- **"Just for today":** the same `QuickAdd`, with `add.mutate({ label, time })`.
- **Inline edits in each row's summary, without expanding:**
  - The time is an `<input type="time">` that edits in place. Stop click propagation so the row doesn't toggle.
  - The weight chip is a button that cycles Must, Should, Could, Nice.
  - The row summary is a `div role=button` (not a `<button>`), so it can contain these controls.

## 2. Week page ("Goal crushers")

Write `client/src/skins/<id>/Week.tsx` exporting `<Name>Week`, replacing the placeholder, plus CSS. Port everything in `client/src/skins/whoop/Week.tsx`:

- **Record strip:** Streak, Win rate, Beaten and Best, counting a week as beaten at **7+ points** (`BEATEN_AT`). Below them, a scrollable tile per week (green when beaten, dashed for this week) and a "Next" tile when next week exists. Clicking a tile opens that week's scorecard.
- **Scorecard:**
  - An eyebrow reading "Goal crushers · Week N", plus the focus and the date range.
  - A big total coloured by progress, and an "Earned: X" pill (or "N more for X").
  - A progress bar with reward marks.
  - The task table (Task | Max | Score), with the **one-click segmented score bar** (`SegScore`: a segment per 0.25 and a 0 button) on hand-scored tasks of the current week. Auto tasks show an "auto" tag, the source and note, and a "Score by hand" link.
  - A TOTAL row and the reward chips.
  - **Copy as image** (via `copyScorecard` from `core/scorecardImage.ts`, with a `ScorecardTheme` built from **your** skin's palette; Things is light, so give it a light theme). Also "Edit week" (current week) or "Change next week" (next week).
- **Composer** (`Composer`, modes 'next' and 'current'), as a sheet:
  - Focus chips from `suggestions.focuses`.
  - Goal suggestion chips (tap to add or remove, with a "Nw" count), plus type-and-Enter for new goals.
  - Picked goals with a source select, a −/+ points control and remove.
  - A live total.
  - Rewards shown in one line, with "change" to edit them inline.
  - One save button.
  - `?plan=1` opens it directly.
- **Right column:**
  - The Next week card ("Plan next week" / "Next week is set · Change").
  - Keeps slipping.
  - Hand score vs your data, only when it applies.

All data comes from `client/src/core/week.ts` hooks; read that file.

## Rules

- **Colour carries meaning:** good is green, bad is red, warn is amber, accent is interactive.
- **No em dashes:** no U+2014 characters anywhere.
- **Accessibility:** real buttons with aria-labels.
- **Type check:** `npx tsc -b` in `client/` must show no errors outside `pages/Trading/*`.
- **Don't change live data:** do NOT score, save, plan or edit anything against the live server; it is the owner's real data. Opening the composer by `?plan=1` to look is fine, but don't press save.

## Verify

Take headless Chrome screenshots at 1680×1100 of `/goals?skin=<id>`, `/goals?skin=<id>&plan=1` and `/checklists?skin=<id>`. Check that nothing overlaps.

Report back: the files changed, plus 2 lines.
