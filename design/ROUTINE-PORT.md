# Porting the Routine page to a skin

The **Routine** page (route `/checklists`, labelled "Routine") is approved in the Whoop skin. The owner has iterated on it, so match it closely in function and structure. Read these:

- `client/src/skins/whoop/Routine.tsx`
- The "Routine" sections at the end of `client/src/skins/whoop/whoop.css`
- `client/src/core/routine.ts` (hooks and helpers)

## What the page must have (the owner approved this, keep every part)

1. **Hero.** A plain-words verdict ("10% of your windows landed on time over the last 9 closed days"), strongest and weakest item, then three stats: on time last 30 days, average day score, today so far.
2. **The routine list.** One plain list grouped Morning / Afternoon / Tonight / Anytime.
   - Each row reads: time · name · "1 h window · Every day" · weight chip (Must / Should / Could / Nice) · "N% on time".
   - Clicking a row expands an inline editor: name, start time, window, day toggles M to S, a weight segmented control with points, and a sentence saying what it earns. Add a **Remove item** button.
   - Changes auto-save through `useDraft` (port it as is: debounced save, keyed rows, unnamed new rows survive refetch) and show Saved / Saving.
   - "+ Add an item" sits at the bottom.
3. **Routine header.** The name (tabs if more than one routine), "N items · up to X points a day", a Saved indicator and a **⋯ menu**: Rename, Pause/Resume, New routine, and "Delete routine…" with an inline confirm. A paused banner with Resume appears when the routine is disabled.
4. **Right column**, in this order:
   - Day scores: a 16-week heatmap; click a day for the drill-in with items, results, reasons and reflection.
   - "Why things get missed": render nothing when there are no reasons.
   - "Just for today": one-offs.
   - **"Your day, top to bottom"**: the vertical timeline.
5. **The vertical timeline** (the owner explicitly wants it, and **letters must never collide**):
   - Slim window bars in lanes, names in one column.
   - A name that would collide is pushed down and joined by a leader line.
   - Drag a name or bar to move it, drag a bar's end to resize, in 15-minute snaps. Arrow keys move; Shift+arrows resize.
   - A now line.
   - Clicking or dragging an item opens it in the list.
   - Port the layout algorithm exactly.

## Your job

Write `client/src/skins/<id>/Routine.tsx` exporting `<Name>Routine`, plus styles appended to `client/src/skins/<id>/<id>.css` (prefix and root class as in that skin, e.g. `.ln`, `.rv`, `.th`). Re-implement the markup and CSS in **that skin's own visual language**, matching its Today page: palette `--k-*`, type, radii, density and controls.

- Linear is dense and precise, with hairlines.
- Revolut is bold black with big figures and pill buttons.
- Things is light, airy and tactile, with round checkboxes and soft tags.

Use the same hooks from `core/routine.ts` and the same data. Only edit your skin's `Routine.tsx` and its CSS file. The registry is already wired.

## Rules

- **Colour carries meaning:** good is green, bad is red, warn is amber, accent is interactive.
- **No em dashes:** no U+2014 characters anywhere.
- **Accessibility:** real buttons and inputs with aria-labels.
- **Type check:** `npx tsc -b` in `client/` must show no errors outside `pages/Trading/*`.
- **Don't change live data:** don't save, edit or delete anything against the live server; it's the owner's real routine.

## Verify

Take resting-state screenshots with headless Chrome at 1680×1400:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1680,1400 --virtual-time-budget=9000 --screenshot=<file> "http://localhost:5173/checklists?skin=<id>"
```

Put them in your scratch dir. Check that nothing overlaps, especially the timeline names.

Report back: the files changed, plus 2 lines.
