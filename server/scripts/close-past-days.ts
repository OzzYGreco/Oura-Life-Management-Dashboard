/**
 * Closes every past routine day that has no review yet, scoring each from the
 * times its items were ticked (the same rules as the live day). The server's
 * scheduler does this on start-up; this script runs it by hand.
 */
import { autoCloseOpenDays } from '../src/lib/day'

autoCloseOpenDays().then(days => {
  console.log(`Closed ${days.length} day(s)${days.length ? `: ${days[0]} to ${days[days.length - 1]}` : ''}`)
  process.exit(0)
})
