/**
 * Check a Stripe connection, and show what the matcher would do with real
 * payments, before anything is written.
 *
 * Run with:  npm run test:stripe --prefix server
 */
import { db } from '../src/db'
import { businessClients, businessInvoices } from '../src/db/schema'
import { sql } from 'drizzle-orm'
import { fetchCharges, matchCharge, stripeConfigured, stripeStatusNote } from '../src/lib/stripeSync'

const ok  = (m: string) => console.log(`  PASS  ${m}`)
const bad = (m: string, fix?: string) => { console.log(`  FAIL  ${m}`); if (fix) console.log(`        ${fix}`) }

async function main() {
  console.log('\nChecking the Stripe connection\n')

  if (!stripeConfigured()) {
    bad('STRIPE_SECRET_KEY is not set',
      'Put it in server/.env. A restricted key (rk_...) with read access to Charges and Balance transactions is enough.')
    process.exit(1)
  }
  ok(`Key is set. ${stripeStatusNote()}`)

  const since = Math.floor(Date.now() / 1000) - 90 * 86400
  let charges
  try {
    charges = await fetchCharges(since)
  } catch (e: any) {
    bad(e.message, 'If it mentions permissions, the restricted key needs read access to Charges AND Balance transactions.')
    process.exit(1)
  }
  ok(`${charges.length} succeeded payment(s) in the last 90 days`)

  if (!charges.length) {
    console.log('\n        Nothing to match yet. Live-mode keys only see live payments.\n')
    return
  }

  const withFees = charges.filter(c => c.fee > 0)
  if (withFees.length) {
    const totalFee = withFees.reduce((s, c) => s + c.fee, 0)
    const rates = withFees.map(c => (c.fee / c.gross) * 100)
    ok(`Fees are coming through: ${totalFee.toFixed(2)} across ${withFees.length} payment(s), `
      + `${Math.min(...rates).toFixed(2)}% to ${Math.max(...rates).toFixed(2)}%`)
  } else {
    bad('No fees came back', 'The key likely lacks read access to Balance transactions.')
  }

  const clients = await db.select().from(businessClients)
  // Every invoice, because a payment for one already marked paid still needs
  // matching: that is how the real fee gets onto history.
  const all = await db.select().from(businessInvoices)
  const taken = new Set<number>()

  let auto = 0, queue = 0
  console.log('\n  What would happen on a real sync:\n')
  for (const c of charges.slice(0, 25)) {
    const m = matchCharge(c, clients, all, taken)
    if (m.invoiceId && (m.confidence === 'exact' || m.confidence === 'high')) taken.add(m.invoiceId)
    const applied = m.confidence === 'exact' || m.confidence === 'high'
    applied ? auto++ : queue++
    const who = m.clientId ? clients.find(x => x.id === m.clientId)?.name ?? '?' : '-'
    console.log(`    ${(applied ? 'apply' : 'queue').padEnd(6)} ${c.gross.toFixed(2).padStart(9)}  fee ${c.fee.toFixed(2).padStart(6)}  `
      + `${(c.payerName ?? 'no name').slice(0, 22).padEnd(24)} ${who.padEnd(20)} ${m.reason}`)
  }
  if (charges.length > 25) console.log(`    ... and ${charges.length - 25} more`)

  console.log(`\n  ${auto} would be applied automatically, ${queue} would wait for you.`)
  console.log('\n  Nothing has been written. Restart the server to start the real sync.\n')
}

main().catch(e => { console.error('\nUnexpected failure:', e?.message ?? e, '\n'); process.exit(1) })
