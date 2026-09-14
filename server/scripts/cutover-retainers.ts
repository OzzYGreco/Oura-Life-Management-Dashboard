/**
 * Cut recurring invoicing over from the legacy `is_recurring` templates to the
 * `business_retainers` table, without re-issuing anything.
 *
 * The two mechanisms had drifted. Seven invoices generated after the v2 backfill
 * (INV-053 to INV-059) carry no `retainer_id`, and the retainers' own
 * `last_generated_date` is up to a month behind the template that actually
 * issued them. Pointing the generator at the retainers in that state would
 * re-issue September for seven clients.
 *
 * So: link the orphans first, then lift every retainer's high-water mark to the
 * real last invoice, and only then let the retainer-driven generator run.
 *
 * Idempotent. Read-only until the final commit, and it refuses to commit if the
 * verification finds a duplicate.
 *
 * Run with:  npx tsx scripts/cutover-retainers.ts [--commit]
 */
import Database from 'better-sqlite3'
import path from 'path'
import { advance } from '../src/lib/recurrence'

const DB_PATH = path.join(__dirname, '..', 'data', 'dashboard.db')
const COMMIT  = process.argv.includes('--commit')

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

interface Row { [k: string]: any }

const money = (n: number) => '£' + n.toFixed(2)

function main() {
  const before = {
    invoices: db.prepare('SELECT COUNT(*) c FROM business_invoices').get() as Row,
    paid:     db.prepare("SELECT ROUND(SUM(amount),2) s FROM business_invoices WHERE status='paid'").get() as Row,
  }
  console.log(`Starting from ${before.invoices.c} invoices, ${money(before.paid.s)} collected.\n`)

  db.exec('BEGIN')

  // ---- 1. Link every orphan occurrence to the retainer its template names ----
  const orphans = db.prepare(`
    SELECT c.id, c.invoice_number, c.issue_date, c.amount, c.client_id,
           t.retainer_id, t.service_id, r.frequency, r.client_id AS ret_client
    FROM business_invoices c
    JOIN business_invoices t ON t.id = c.recurring_parent_id
    JOIN business_retainers r ON r.id = t.retainer_id
    WHERE c.is_recurring = 1
      AND c.recurring_parent_id IS NOT NULL
      AND c.retainer_id IS NULL
    ORDER BY c.id
  `).all() as Row[]

  const link = db.prepare(`
    UPDATE business_invoices
       SET retainer_id = ?, service_id = ?, subtotal = COALESCE(subtotal, amount),
           period_start = COALESCE(period_start, ?), period_end = COALESCE(period_end, ?)
     WHERE id = ?
  `)

  let linked = 0
  for (const o of orphans) {
    if (o.ret_client !== o.client_id) {
      throw new Error(`${o.invoice_number}: client ${o.client_id} does not match retainer ${o.retainer_id} client ${o.ret_client}`)
    }
    const end = advance(o.issue_date, o.frequency ?? 'monthly')
    link.run(o.retainer_id, o.service_id, o.issue_date, end, o.id)
    console.log(`  linked ${o.invoice_number}  ${money(o.amount)}  ${o.issue_date}  -> retainer ${o.retainer_id}`)
    linked++
  }
  console.log(linked ? `\n${linked} orphan invoices linked.\n` : 'No orphan invoices to link.\n')

  // ---- 2. Lift each retainer's high-water mark to its real last invoice ------
  const retainers = db.prepare(`
    SELECT r.id, r.name, r.frequency, r.last_generated_date, r.next_invoice_date, r.start_date,
           (SELECT MAX(i.issue_date) FROM business_invoices i WHERE i.retainer_id = r.id) AS real_last
    FROM business_retainers r
    ORDER BY r.id
  `).all() as Row[]

  const sync = db.prepare('UPDATE business_retainers SET last_generated_date = ?, next_invoice_date = ?, updated_at = datetime(\'now\') WHERE id = ?')

  let synced = 0
  for (const r of retainers) {
    const last = r.real_last ?? r.last_generated_date ?? r.start_date
    const next = advance(last, r.frequency ?? 'monthly')
    if (last === r.last_generated_date && next === r.next_invoice_date) continue
    sync.run(last, next, r.id)
    console.log(`  retainer ${String(r.id).padStart(2)}  ${r.name.padEnd(14)}  last ${r.last_generated_date} -> ${last}   next ${r.next_invoice_date} -> ${next}`)
    synced++
  }
  console.log(synced ? `\n${synced} retainers re-synced.\n` : 'All retainers already in sync.\n')

  // ---- 3. Verify: nothing generated, nothing duplicated ---------------------
  const problems: string[] = []

  const after = db.prepare('SELECT COUNT(*) c FROM business_invoices').get() as Row
  if (after.c !== before.invoices.c) problems.push(`invoice count changed: ${before.invoices.c} -> ${after.c}`)

  const paidAfter = db.prepare("SELECT ROUND(SUM(amount),2) s FROM business_invoices WHERE status='paid'").get() as Row
  if (paidAfter.s !== before.paid.s) problems.push(`collected changed: ${before.paid.s} -> ${paidAfter.s}`)

  const dupes = db.prepare(`
    SELECT client_id, issue_date, amount, COUNT(*) n
    FROM business_invoices
    GROUP BY client_id, issue_date, amount
    HAVING COUNT(*) > 1
  `).all() as Row[]
  for (const d of dupes) problems.push(`duplicate: client ${d.client_id} on ${d.issue_date} for ${money(d.amount)} x${d.n}`)

  const stillOrphan = db.prepare(`
    SELECT COUNT(*) c FROM business_invoices
    WHERE is_recurring = 1 AND recurring_parent_id IS NOT NULL AND retainer_id IS NULL
  `).get() as Row
  if (stillOrphan.c) problems.push(`${stillOrphan.c} recurring invoices still have no retainer`)

  // The whole point: no retainer may be due for an invoice it has already issued.
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const wouldFire = db.prepare(`
    SELECT id, name, next_invoice_date, last_generated_date
    FROM business_retainers
    WHERE status = 'active' AND auto_invoice = 1 AND next_invoice_date <= ?
  `).all(todayStr) as Row[]
  for (const w of wouldFire) {
    problems.push(`retainer ${w.id} (${w.name}) would issue immediately: next ${w.next_invoice_date} <= today ${todayStr}`)
  }

  if (problems.length) {
    db.exec('ROLLBACK')
    console.error('\nVERIFICATION FAILED, rolled back:\n')
    problems.forEach(p => console.error('  ' + p))
    process.exit(1)
  }

  console.log('Verification passed:')
  console.log(`  ${after.c} invoices, unchanged`)
  console.log(`  ${money(paidAfter.s)} collected, unchanged`)
  console.log('  no duplicate client/date/amount rows')
  console.log('  every recurring invoice is linked to its retainer')
  console.log(`  no active retainer is due to issue on or before ${todayStr}`)

  if (COMMIT) {
    db.exec('COMMIT')
    console.log('\nCommitted.')
  } else {
    db.exec('ROLLBACK')
    console.log('\nDry run, rolled back. Re-run with --commit to apply.')
  }
}

main()
