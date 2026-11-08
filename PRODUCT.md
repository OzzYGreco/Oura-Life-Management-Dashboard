# Arete: what it is for

A private operating system for one person. It runs the owner's day (routine, training, trading, business, money) and tells them honestly how it went. There are no other users, no onboarding and no marketing surface.

## The job
In under three seconds, any screen answers:
1. **What now?** The one thing to do next.
2. **How am I doing?** Today and this week, compared with the owner's own past, never with an ideal.
3. **How do I log it?** One line or one key, from anywhere.

## Why it failed before (never repeat)
- It was abandoned for months because ticking things off was meaningless: one-click "done" on everything, no timing, no consequence.
- Alerts lived in a browser tab and died at every login.
- Training, goals and finances only listed data. They gave no insight and no push.
- The look was generic and gave no reason to come back.

## The daily loop (the product)
- **Windows.** Routine items have time windows. On time = full credit, late = half, missed = an honest zero with a reason. **There is no Skip;** it was rejected as a cheat.
- **Day score.** Routine, workouts and trading discipline feed one score. The day runs 04:00 to 04:00.
- **Evening review.** It closes the day: give each miss a reason, then the score locks.
- **Weekly targets beat daily streaks.** A week is "beaten" at 7+ of 10. The week's goals are composed from suggestions based on history.
- **Native macOS notifications** come from the server scheduler (`server/src/lib/scheduler.ts`), run by a launchd agent (`npm run app:install`), so they survive logins.

## Rules for every feature
- **One step.** Every common job is one line or one key, prefilled from history. Friction leads to abandonment.
- **Suggest, never assume.** Nothing is auto-created; suggestions wait for one confirm.
- **Keep every feature.** A redesigned page keeps everything the old page did. Make a feature inventory of the old page before replacing it.
- **Honest data only.** Never invent numbers, wins or placeholders. An empty state says what to do.
- **Compare with yourself.** Progress is shown against the owner's own baseline (last week, same weekday, best this month), so improvement from a low base still feels like progress.

## Modules
Today, Routine (`/checklists`), Week (`/goals`), Trading, Business, Money (personal: take-home, burn, runway; business costs stay in Business), Training, Calendar, Notes. More will be added, so a new module must be cheap to add. See DESIGN.md, "Adding a module".
