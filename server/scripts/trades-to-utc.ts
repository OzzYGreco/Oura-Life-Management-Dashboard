/**
 * One-off: trade dates and times were typed in local time; from now on the
 * journal is UTC (Bybit's clock). Converts every trade that has a time, using
 * this machine's time zone (DST included), and records that it ran so a second
 * run changes nothing. Trades with a date but no time keep their date.
 *
 *   npx tsx scripts/trades-to-utc.ts            (real database)
 *   OURA_DB_PATH=/path/copy.db npx tsx scripts/trades-to-utc.ts
 */
import { db } from '../src/db'
import { trades, businessSettings } from '../src/db/schema'
import { eq, isNotNull } from 'drizzle-orm'

const MARK = 'tradesTimesUtc'

const done = db.select().from(businessSettings).where(eq(businessSettings.key, MARK)).all()
if (done.length) {
  console.log(`Already converted on ${done[0].value}. Nothing to do.`)
  process.exit(0)
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const rows = db.select({ id: trades.id, date: trades.date, time: trades.time }).from(trades).where(isNotNull(trades.time)).all()
let changed = 0
db.transaction(tx => {
  for (const r of rows) {
    if (!/^\d{2}:\d{2}/.test(r.time!)) continue
    const local = new Date(`${r.date}T${r.time!.slice(0, 5)}:00`)   // parsed in local time
    if (isNaN(local.getTime())) continue
    const iso = local.toISOString()
    tx.update(trades).set({ date: iso.slice(0, 10), time: iso.slice(11, 16) }).where(eq(trades.id, r.id)).run()
    changed++
  }
  tx.insert(businessSettings).values({ key: MARK, value: `${new Date().toISOString()} from ${tz}` }).run()
})
console.log(`Converted ${changed} trades from ${tz} to UTC.`)
