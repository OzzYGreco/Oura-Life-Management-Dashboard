# Navigation layouts and tab order: brief

The owner can now choose, in any skin:

- **Sidebar (vertical)** or **Top tabs (horizontal)** navigation, or "Skin default". Whoop and Revolut default to top tabs; Linear and Things default to a sidebar.
- The **order** of the tabs, and which are **hidden**.

Both are already in the shared core, `client/src/skins/core.tsx`. `useSkin()` now returns:

- `nav: NavItem[]`: the visible tabs in the owner's order. Render THIS, not `NAV`.
- `navLayout: 'vertical' | 'horizontal'`: already resolved; render this orientation.
- `openCustomize()`: opens the shared "Customize tabs" panel.

## Your job: update the skin Shells you're assigned (only those files plus their CSS)

1. Replace every `NAV.map` with `nav.map`, and drop the `NAV` import if it becomes unused. Any counts or badges keyed by tab (e.g. Today's count) must look up by `n.key`, not by position.
2. Render BOTH orientations, each designed in that skin's own visual language (its colours, type, radii, hover and active states, spacing). The alternate orientation must look as if the skin's designer made it, not bolted on:
   - **Vertical:** a left sidebar, about 220 to 240 px wide, full height. It holds the brand at the top, the search/⌘K affordance, the nav list, and the skin picker/avatar at the bottom. The page sits to the right in the skin's main area.
   - **Horizontal:** a top bar holding the brand, the tabs, search/⌘K, and the skin picker/avatar on the right. The page sits below.
   - Things must keep its tinted frame and big rounded white panel in both orientations. In horizontal mode the tabs sit on the frame above the panel.
3. In every skin's picker menu (avatar or footer menu), add a **"Customize tabs…"** item that calls `openCustomize()` and closes the menu. Keep the existing skin list.
4. The main area keeps `flex: 1; min-height: 0; overflow: hidden` so pages scroll inside it.
5. Rules: colour carries meaning only (green good, red bad, amber warn, accent interactive); no em dash characters (U+2014) anywhere; real buttons with aria-labels; TypeScript strict. `npx tsc -b` in `client/` must show no errors outside `pages/Trading/*`, which has known pre-existing errors to ignore.

## How to test both orientations without touching the owner's saved choice

Settings live on the server, so preview by URL instead. Add support for a `?nav=vertical|horizontal` query param in **your Shell only**: if present, it overrides `navLayout` for rendering. That way:

- `http://localhost:5173/?skin=<id>&nav=vertical`
- `http://localhost:5173/?skin=<id>&nav=horizontal`

both work without saving anything.

Screenshot each at 1600×1000 and check one non-Today page in each orientation (`/trading?skin=<id>&nav=...`):

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,1000 --virtual-time-budget=9000 --screenshot=<scratch>/<name>.png "<url>"
```

Read the PNGs and fix every overlap, clipping or awkward spot. Never PUT to `/api/today/settings`: that changes the owner's real preferences.

Report back: the files changed, plus 2 lines on design choices.
