# Restore every old feature, redesigned: spec for the Whoop skin

## What the owner wants (their words, binding)

"I never said any of the old features didn't work well or that I wanted to drop. I said that the design wasn't very helpful and took so many actions to log everything that I just gave up. ... this is not only for the look: the functionalities, how everything is laid out."

"I want to make my life EASIER but also measurable. Premium design, yes, but every action should be simple and not take 1,000 clicks, otherwise I will get lazy."

So the job is **every feature the old page had, kept and working, redesigned to take fewer actions, laid out better and showing better feedback.** Nothing gets dropped. Where an old feature was clumsy, keep the capability and make it one step.

The old pages are the feature reference; read them fully:

- `client/src/pages/Checklists/index.tsx`
- `client/src/pages/Goals/index.tsx`
- `client/src/pages/Training/index.tsx`
- `client/src/pages/Dashboard/index.tsx`

The new Whoop pages are the design reference, in `client/src/skins/whoop/`: `Today.tsx`, `Routine.tsx`, `Week.tsx`, `Training.tsx` and `whoop.css`. Shared logic lives in `client/src/core/*.ts`.

## Rules for every builder

1. **File ownership.** Only edit the files your section lists. Put ALL new CSS in your own new stylesheet (named in your section), imported from your page component. **Do not edit `whoop.css`.** You may override its classes from your file.
2. **Server changes** go only in the route/lib files your section lists. **No database migrations**: the needed columns already exist. App settings already include `alertLeadMin` and `goalsSettings` (JSON per horizon: max, threshold, defaultPoints). Read and write them via `GET`/`PUT /api/today/settings`.
3. **Never write to the live database while testing.**
   - Never click save, tick, score, log or delete against http://localhost:5173.
   - To test writes, copy the database: `sqlite3 server/data/dashboard.db ".backup '<scratch>/x.db'"`, then run a tiny express app with your router under `OURA_DB_PATH=<scratch>/x.db npx tsx <script>`, as earlier tests in `server/scripts` did. Delete any temp scripts afterwards.
4. **Visual rules.**
   - Colour carries meaning only: good is green, bad is red, warn is amber, accent is interactive.
   - No em dash characters (U+2014) anywhere.
   - Real buttons with aria-labels.
   - The look must match the Whoop pages exactly: same cards, type and spacing.
5. **Effortless.** Every common job is one screen and as few clicks as possible: smart defaults from history, Enter to add, click to edit in place, no "edit mode" walls. Measurable: every section opens with a plain answer in words.
6. **Done means checked.**
   - `npx tsc -b` in `client/` shows no errors outside `pages/Trading/*`.
   - `npx tsc --noEmit -p .` in `server/` is clean.
   - Screenshot your page(s) with headless Chrome at 1680×1200 (`?skin=whoop`) and fix every overlap.
   - Then go through the checklist below and report each item as DONE, or NOT DONE with the reason. No item may be silently skipped.

---

## A. Training (files: `client/src/skins/whoop/Training.tsx`, new `client/src/skins/whoop/training.css`, `client/src/core/training.ts`, `server/src/routes/training.ts`)

Body weight logging and the Body Composition Signal were just restored. Keep them and add the charts below.

- [ ] **Workout categories.** Strength, cardio, sport, HIIT and mobility, with the old colours mapped to meaning-neutral series colours. The logger has a category picker (it defaults to the template's category) and saves it. Today everything is hard-coded `'strength'`.
- [ ] **Workouts per week chart stacked by category**, keeping the target line.
- [ ] **Free-text workout name** in the logger, prefilled with the template name.
- [ ] **RPE.**
  - Per exercise: a quick 1 to 10 picker, one tap.
  - Per workout: an overall RPE.
  - Peak RPE shown in history.
- [ ] **Workout notes.** Entered in the logger and shown in history.
- [ ] **Edit an existing workout.** Open the same logger prefilled with that workout, and save with PUT.
- [ ] **Full workout history**, not just the last 8:
  - a category filter;
  - each workout expandable to a detail table (sets, reps, kg, volume, RPE);
  - edit and delete actions.
- [ ] **Stats.**
  - Workouts this week (exists).
  - **Volume this week** (kg moved).
  - **Average session length**.
  - The old streak was intentionally replaced by weekly target adherence, so don't restore a daily streak. But do show the "weeks in a row hitting target" streak.
- [ ] **Personal records grid**: heaviest set (kg × reps, with its date) per exercise, alongside the e1RM table.
- [ ] **Exercise progress chart with a selector**: pick an exercise to see max weight and e1RM over time.
- [ ] **Workout template management.**
  - Create, edit (name, category, exercises with default sets) and delete templates.
  - "Save this workout as a template" from the logger or history.
- [ ] **Body metrics charts.**
  - Weight and body-fat lines over time, with deltas.
  - Body metric entries can be edited, not only deleted.

## B. Week, the Goal crushers (files: `client/src/skins/whoop/Week.tsx`, new `client/src/skins/whoop/week.css`, `client/src/core/week.ts`, `server/src/routes/week.ts`)

- [ ] **Horizons.** Weekly, Monthly, Yearly and 3-Year, switched by a segmented control on the page.
  - Each horizon has its record strip, its scorecard and its composer.
  - Period defaults: monthly = calendar month, yearly = calendar year, 3-year from the start.
  - Data: `goals.horizon` already supports all four.
  - Server: generalise the week routes to take `?horizon=`, keeping the weekly behaviour identical.
- [ ] **Settings.** Max score, success threshold and default points per horizon, stored in app setting `goalsSettings`.
  - Opened from a small gear button on the page.
  - Replaces the hard-coded `BEATEN_AT = 7`.
  - On the first load, migrate the owner's existing browser setting from localStorage key `oura-goals-settings` into the server setting, if present and the server still has defaults.
- [ ] **Threshold marker** on the scorecard progress bar and on the record tiles. The tile tooltip shows the date range, %, and "Beaten" or "Missed · needed X".
- [ ] **Create a goal when none exists for the current period**, in the composer (mode 'current' must work without an existing goal).
- [ ] **Custom period start and end dates** in the composer, defaulting to the natural period.
- [ ] **Any points value per task.** Type it in the composer; keep −/+.
- [ ] **Typed score input as well as the segment bar**: click the score number to type it, and Enter jumps to the next task.
- [ ] **Score past periods** (any period), from that period's scorecard.
- [ ] **Edit any period** (past included) with the composer.
- [ ] **Delete a period**, with an inline confirm.
- [ ] **Close a period by hand** ("Mark complete"), which then offers "Set up next period". Automatic rollover still works.
- [ ] **Past periods list view** with expand and collapse all, as an alternative to the tile strip: a toggle between tiles and list.

## C. Routine and Today (files: `client/src/skins/whoop/Routine.tsx`, `client/src/skins/whoop/Today.tsx`, new `client/src/skins/whoop/routine-today.css`, `client/src/core/routine.ts`, `client/src/core/today.ts`, `server/src/routes/routine.ts`, `server/src/routes/today.ts`, `server/src/lib/today.ts`, `server/src/lib/day.ts`, `server/src/lib/scheduler.ts`)

### Routine features to restore

- [ ] **Weekly routines.** The old template "type: weekly" never worked. Make it real.
  - A routine marked Weekly holds tasks done once per week, any day Sunday to Saturday.
  - They show on Today in a "This week" list and get ticked once per week.
  - They are not part of the day score; the Week page can score them through a new auto source only if trivial, otherwise not.
  - Store one entry per week (date = the week's Sunday), and make `ensureDay` skip weekly routines.
  - The type is chosen when creating a routine and can be changed in the ⋯ menu.
- [ ] **One-time tasks** (schedule `once:YYYY-MM-DD`). In the row editor, "Just once on <date>" sits alongside the day toggles. The quick-add parser understands "once", "today" and "tomorrow".
- [ ] **Paste many lines at once.** The quick add accepts a multi-line paste, shows a preview of every parsed line, and adds them all with Enter. Same in "Just for today".
- [ ] **Task streak 🔥**: consecutive days on time per item, shown on Routine rows and on Today. Use a small flame glyph in SVG or text, not an emoji.
- [ ] **Per-routine progress on Today**: "N done · N left" per routine, with a progress bar.
- [ ] **Collapse a routine's list on Today**, remembered per routine.
- [ ] **Hide or show completed items on Today** (the old "archive completed").
- [ ] **One-off tasks.**
  - Importance as well as time, added from Today itself (not only Routine), and addable to any date via the date stepper.
  - Delete a one-off even after it's done.
- [ ] **View any day and tick it.** On Today: a date stepper (‹ Fri 6 Nov ›) plus a date picker.
  - An open day can be ticked as now.
  - A closed day shows its results and offers "Correct this day": it reopens the day (removing its `day_reviews` row) so items can be ticked or unticked, then it is closed again by the review or at 04:00.
  - A tick made on a past day counts as late, which is honest.
- [ ] **Reminder settings** on Routine, in a "Reminders" card:
  - notifications on or off;
  - an alert lead time of 0, 5, 10, 15 or 30 minutes before the window (`alertLeadMin`; make `scheduler.ts` fire at window start minus the lead);
  - the evening review time;
  - quiet hours;
  - a "Send a test notification" button.

  Use `GET`/`PUT /api/today/settings`.

### The home page (Today): keep everything the old Dashboard showed

Add it without crowding. Use the right column and compact rows, each section a plain answer first.

- [ ] **Trading today:** $ P&L, trade count, average R, and today's trade list (asset, direction, R, $), each linking to `/trading?trade=<id>`.
- [ ] **Trading this month:** P&L, trade count, win rate, average R, and a 7-day P&L mini bar chart.
- [ ] **A currency selector** for the money figures, using the existing `CurrencySelector` and `useFmtView` conventions.
- [ ] **Business:** MRR and net new this month, revenue this month, margin, active clients, total owed, and the next invoice due (exists).
- [ ] **This week's focus** (from `week.focus`) shown with the week card.
- [ ] **Last workout:** name, date and duration.
- [ ] **Coming up:** the next calendar events (from `/api/dashboard/summary` `upcomingEvents`, or the calendar API).
- [ ] **Section headers link to their tabs:** Trading, Routine, Business, Week, Calendar, Training.

You may extend `server/src/lib/today.ts` (the `pulse` block) to supply these. The existing `server/src/routes/dashboard.ts` already computes most of them and can be reused or called.
