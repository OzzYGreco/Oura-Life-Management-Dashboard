/**
 * Pull every day of Meta spend since the campaigns started.
 *
 * One-off. After this the daily scheduler keeps things current on its own,
 * re-reading a trailing window each time because Meta restates recent days.
 *
 * Run with:  npx tsx --env-file-if-exists=.env scripts/backfill-meta-spend.ts [--commit]
 */
import { fetchMetaSpend, applySpendRows, metaConfigured } from '../src/lib/adSpendSync'
import { db } from '../src/db'
import { marketingCampaigns, marketingSpendDaily } from '../src/db/schema'
import { localToday } from '../src/lib/date'

const COMMIT = process.argv.includes('--commit')

async function main() {
  if (!metaConfigured()) {
    console.error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are not set.')
    process.exit(1)
  }

  const campaigns = await db.select().from(marketingCampaigns)
  const linked = campaigns.filter(c => c.externalId)
  if (!linked.length) {
    console.error('No campaign is linked to a Meta id yet.')
    process.exit(1)
  }

  const since = linked.map(c => c.startDate).sort()[0]
  const until = localToday()
  console.log(`\nPulling ${since} to ${until} for ${linked.length} linked campaign(s)\n`)

  const rows = await fetchMetaSpend(since, until)
  console.log(`  ${rows.length} day-rows returned by Meta`)

  const byCampaign = new Map<string, { name: string; total: number; days: number }>()
  for (const r of rows) {
    const e = byCampaign.get(r.externalId) ?? { name: r.externalName, total: 0, days: 0 }
    e.total += r.spend
    e.days++
    byCampaign.set(r.externalId, e)
  }
  console.log()
  for (const [id, e] of byCampaign) {
    const local = campaigns.find(c => c.externalId === id)
    console.log(`  ${e.total.toFixed(2).padStart(10)}  over ${String(e.days).padStart(3)} days   ${e.name}`)
    console.log(`  ${''.padStart(10)}  -> ${local ? `${local.name} (was ${local.spent?.toFixed(2)} by hand)` : 'NO LOCAL MATCH'}`)
  }

  if (!COMMIT) {
    console.log('\nDry run. Re-run with --commit to write.\n')
    return
  }

  const result = await applySpendRows(rows, 'meta')
  console.log(`\n  ${result.message}`)

  const [check] = await db.select().from(marketingSpendDaily).limit(1)
  const all = await db.select().from(marketingSpendDaily)
  const total = all.reduce((s, r) => s + r.spend, 0)
  console.log(`  ${all.length} daily rows stored, ${total.toFixed(2)} total`)
  console.log(`  earliest ${all.map(r => r.date).sort()[0]}, latest ${all.map(r => r.date).sort().at(-1)}`)
  console.log(check ? '\nDone.\n' : '\nNothing written.\n')
}

main().catch(e => { console.error('\nFailed:', e?.message ?? e, '\n'); process.exit(1) })
