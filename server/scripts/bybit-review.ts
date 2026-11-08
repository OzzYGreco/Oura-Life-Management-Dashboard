/**
 * Pull both accounts and print the review: what matches, what differs, what is
 * missing. Writes no trades unless an account's review was already applied.
 *   npx tsx --env-file=.env scripts/bybit-review.ts [--json out.json]
 */
import fs from 'fs'
import { syncAll, buildReview, positionsFor } from '../src/lib/bybit/sync'

;(async () => {
  for (const r of await syncAll()) console.log(`${r.name}: ${r.ok ? '' : 'FAILED '}${r.message}`)
  const out: any[] = []
  for (const id of [1, 2]) {
    const rv = buildReview(id)
    const { positions } = positionsFor(id)
    const net = positions.filter(p => p.closedAt).reduce((s, p) => s + p.net, 0)
    const counts: Record<string, number> = {}
    for (const m of rv.matches) for (const d of m.diffs) counts[d.field] = (counts[d.field] ?? 0) + 1
    console.log(`\n== ${rv.name}: ${positions.length} Bybit positions (net ${net.toFixed(4)}), ${rv.matches.length} matched (${rv.matches.filter(m => !m.diffs.length).length} identical), ${rv.missing.length} not logged, ${rv.unmatched.length} logged but not found, ${rv.notOnBybit.length} other broker`)
    console.log('   differences:', counts)
    for (const u of rv.unmatched) console.log(`   not found: #${u.tradeId} ${u.date} ${u.time} ${u.asset} ${u.direction} ${u.entryPrice}${u.samePositionAs ? ` (same position as #${u.samePositionAs})` : ''}`)
    out.push(rv)
  }
  const i = process.argv.indexOf('--json')
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 1))
  process.exit(0)
})()
