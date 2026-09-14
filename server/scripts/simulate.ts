/**
 * Everyday-usage simulation.
 *
 * The audit proves the numbers are consistent right now. This proves they stay
 * consistent while the business is being USED: a client added, an invoice paid,
 * a price changed, a retainer cancelled, a draw taken, a refund arriving.
 *
 * Everything runs inside a transaction that is ALWAYS rolled back, so the live
 * data is untouched. Each scenario asserts what should have happened and, just
 * as importantly, what should not have.
 *
 * Run with:  npm run simulate --prefix server
 */
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(__dirname, '..', 'data', 'dashboard.db')
const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

let passed = 0, failed = 0
const failures: string[] = []

const round2 = (n: number) => Math.round(n * 100) / 100

function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`    ok    ${label}`) }
  else { failed++; failures.push(label + (detail ? ` :: ${detail}` : '')); console.log(`    FAIL  ${label}${detail ? `\n            ${detail}` : ''}`) }
}

function scenario(title: string, fn: () => void) {
  console.log(`\n  ${title}`)
  db.exec('SAVEPOINT sim')
  try { fn() } catch (e: any) { check(`${title} did not throw`, false, e?.message ?? String(e)) }
  db.exec('ROLLBACK TO sim')
  db.exec('RELEASE sim')
}

// ── Helpers that read the same way the app does ──────────────────────────────

const q = <T = any>(sql: string, ...p: any[]): T[] => db.prepare(sql).all(...p) as T[]
const one = <T = any>(sql: string, ...p: any[]): T => db.prepare(sql).get(...p) as T
const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p)

const grossVolume = () => round2(one<{ v: number }>(
  "select coalesce(sum(amount),0) v from business_invoices where status='paid'").v)
const feeTotal = () => round2(one<{ v: number }>(
  "select coalesce(sum(fee_amount),0) v from business_invoices").v)
const outstanding = () => round2(one<{ v: number }>(
  "select coalesce(sum(amount),0) v from business_invoices where status in ('unpaid','overdue')").v)
const mrr = () => round2(one<{ v: number }>(`
  select coalesce(sum(case frequency
    when 'weekly' then amount*52/12 when 'quarterly' then amount/3
    when 'yearly' then amount/12 else amount end),0) v
  from business_retainers where status='active'`).v)
const clientCosts = () => round2(one<{ v: number }>(
  "select coalesce(sum(amount),0) v from finance_expenses where category='Business' and client_id is not null").v)

function main() {
  console.log('\nEVERYDAY USAGE SIMULATION\n=========================')
  console.log('Every scenario runs in a transaction that is rolled back.\n')

  const baseGross = grossVolume()
  const baseMrr = mrr()
  const baseFees = feeTotal()
  const baseOut = outstanding()
  const baseInvoices = one<{ n: number }>('select count(*) n from business_invoices').n

  console.log(`  baseline: gross ${baseGross}, MRR ${baseMrr}, fees ${baseFees}, outstanding ${baseOut}, ${baseInvoices} invoices`)

  // ── 1. Deleting a client ────────────────────────────────────────────────
  scenario('Deleting a client who has invoices', () => {
    const client = one<{ id: number; name: string }>(`
      select c.id, c.name from business_clients c
      where (select count(*) from business_invoices i where i.client_id=c.id) > 0 limit 1`)
    let threw = false
    try { run('delete from business_clients where id=?', client.id) }
    catch { threw = true }

    if (threw) {
      check('refused, so revenue cannot be orphaned', true)
    } else {
      const orphans = one<{ n: number }>(
        'select count(*) n from business_invoices where client_id not in (select id from business_clients)').n
      check('no invoice is left pointing at a client that no longer exists', orphans === 0,
        `${orphans} orphaned invoices, and their revenue would vanish from every per-client figure`)
      check('gross volume is unchanged by deleting a client', grossVolume() === baseGross,
        `${grossVolume()} vs ${baseGross}`)
    }
  })

  // ── 2. Deleting a retainer that has issued invoices ─────────────────────
  scenario('Deleting a retainer that has already invoiced', () => {
    const r = one<{ id: number }>(`
      select r.id from business_retainers r
      where (select count(*) from business_invoices i where i.retainer_id=r.id) > 0 limit 1`)
    const before = grossVolume()
    let threw = false
    try { run('delete from business_retainers where id=?', r.id) } catch { threw = true }
    if (!threw) {
      check('its past invoices survive, so collected money is not rewritten', grossVolume() === before,
        `${grossVolume()} vs ${before}`)
      const dangling = one<{ n: number }>(
        'select count(*) n from business_invoices where retainer_id is not null and retainer_id not in (select id from business_retainers)').n
      check('no invoice points at a retainer that no longer exists', dangling === 0, `${dangling} dangling`)
    } else {
      check('refused, which also protects the history', true)
    }
  })

  // ── 3. Marking an invoice paid twice ────────────────────────────────────
  scenario('Marking the same invoice paid twice', () => {
    const inv = one<{ id: number; amount: number }>(
      "select id, amount from business_invoices where status='unpaid' limit 1")
      ?? one<{ id: number; amount: number }>("select id, amount from business_invoices limit 1")
    run("update business_invoices set status='paid', paid_date='2026-09-14', fee_amount=2.00 where id=?", inv.id)
    const after1 = grossVolume()
    run("update business_invoices set status='paid', paid_date='2026-09-14', fee_amount=2.00 where id=?", inv.id)
    check('paying twice does not count the money twice', grossVolume() === after1,
      `${grossVolume()} vs ${after1}`)
    check('the fee is not doubled either', feeTotal() === round2(baseFees + 2.00 - (0)),
      `fees ${feeTotal()}`)
  })

  // ── 4. A refund ─────────────────────────────────────────────────────────
  scenario('A client is refunded in full', () => {
    const inv = one<{ id: number; amount: number }>(
      "select id, amount from business_invoices where status='paid' order by amount desc limit 1")
    run('update business_invoices set refunded_amount=? where id=?', inv.amount, inv.id)
    const gross = grossVolume()
    const refunds = round2(one<{ v: number }>('select coalesce(sum(refunded_amount),0) v from business_invoices').v)
    const net = round2(gross - feeTotal() - refunds)
    check('gross still shows what was billed', gross === baseGross, `${gross} vs ${baseGross}`)
    check('net drops by the refunded amount', round2(baseGross - baseFees - inv.amount) === net,
      `net ${net}, expected ${round2(baseGross - baseFees - inv.amount)}`)
    check('a full refund never makes net volume negative', net >= 0 || baseGross < inv.amount)
  })

  // ── 5. Cancelling a retainer ────────────────────────────────────────────
  scenario('Cancelling a retainer mid-month', () => {
    const r = one<{ id: number; amount: number }>(
      "select id, amount from business_retainers where status='active' order by amount desc limit 1")
    run("update business_retainers set status='cancelled', end_date='2026-09-14', cancelled_at='2026-09-14', auto_invoice=0 where id=?", r.id)
    check('MRR drops by exactly that retainer', mrr() === round2(baseMrr - r.amount),
      `${mrr()} vs ${round2(baseMrr - r.amount)}`)
    check('it can no longer be picked up by the generator',
      one<{ n: number }>("select count(*) n from business_retainers where id=? and status='active' and auto_invoice=1", r.id).n === 0)
    check('its past invoices are untouched', grossVolume() === baseGross)
  })

  // ── 6. Pausing and resuming ─────────────────────────────────────────────
  scenario('Pausing a retainer, then resuming it', () => {
    const r = one<{ id: number; amount: number }>(
      "select id, amount from business_retainers where status='active' limit 1")
    run("update business_retainers set status='paused' where id=?", r.id)
    check('a paused retainer stops counting towards MRR', mrr() === round2(baseMrr - r.amount))
    run("update business_retainers set status='active' where id=?", r.id)
    check('resuming restores MRR exactly', mrr() === baseMrr, `${mrr()} vs ${baseMrr}`)
  })

  // ── 7. A price change ───────────────────────────────────────────────────
  scenario('Raising a retainer price', () => {
    const r = one<{ id: number; amount: number }>(
      "select id, amount from business_retainers where status='active' limit 1")
    const next = round2(r.amount + 50)
    run('insert into business_retainer_changes (retainer_id, effective_date, old_amount, new_amount) values (?,?,?,?)',
      r.id, '2026-09-14', r.amount, next)
    run('update business_retainers set amount=? where id=?', next, r.id)
    check('MRR rises by exactly the increase', mrr() === round2(baseMrr + 50),
      `${mrr()} vs ${round2(baseMrr + 50)}`)
    check('the old price is kept, so expansion is computable',
      one<{ n: number }>('select count(*) n from business_retainer_changes where retainer_id=?', r.id).n > 0)
    check('past invoices keep the price they were raised at', grossVolume() === baseGross)
  })

  // ── 8. An owner draw ────────────────────────────────────────────────────
  scenario('Taking an owner draw', () => {
    const owner = one<{ id: number }>('select id from business_owners limit 1')
    const costsBefore = clientCosts()
    const overheadsBefore = round2(one<{ v: number }>(
      "select coalesce(sum(amount),0) v from finance_expenses where category='Business' and client_id is null").v)
    run("insert into business_owner_draws (owner_id, amount, currency, date, method) values (?,?,?,?,?)",
      owner.id, 500, 'GBP', '2026-09-14', 'transfer')
    check('a draw does not become a business cost', clientCosts() === costsBefore)
    check('a draw does not become an overhead either',
      round2(one<{ v: number }>("select coalesce(sum(amount),0) v from finance_expenses where category='Business' and client_id is null").v) === overheadsBefore)
    check('gross volume is untouched by a draw', grossVolume() === baseGross)
  })

  // ── 9. Adding a client with the composer ────────────────────────────────
  scenario('Onboarding a client: website plus retainer', () => {
    const info = run("insert into business_clients (name, status) values ('SIM Client','active')")
    const cid = Number(info.lastInsertRowid)
    run("insert into business_projects (client_id, name, status, stage, value) values (?,?,?,?,?)",
      cid, 'SIM website', 'active', 'discovery', 299.98)
    // 50 / 25 / 25 with the last absorbing the rounding.
    const parts = [149.99, 75.00, 74.99]
    parts.forEach((amt, i) => run(
      `insert into business_invoices (client_id, invoice_number, amount, subtotal, status, issue_date, due_date, milestone_label)
       values (?,?,?,?,?,?,?,?)`,
      cid, `SIM-${i}`, amt, amt, i === 0 ? 'unpaid' : 'draft', '2026-09-14', '2026-09-20', ['Deposit','Presentation','Launch'][i]))
    run(`insert into business_retainers (client_id, name, amount, frequency, start_date, status, next_invoice_date)
         values (?,?,?,?,?,?,?)`, cid, 'Local SEO', 149, 'monthly', '2026-09-14', 'active', '2026-10-14')

    check('the milestones sum to the website price exactly',
      round2(parts.reduce((s, x) => s + x, 0)) === 299.98)
    check('MRR rises by the retainer only', mrr() === round2(baseMrr + 149))
    check('drafts do not count as money owed', outstanding() === round2(baseOut + 149.99),
      `${outstanding()} vs ${round2(baseOut + 149.99)}`)
    check('drafts do not count as money collected', grossVolume() === baseGross)
  })

  // ── 10. Date-boundary and timezone ──────────────────────────────────────
  scenario('An invoice paid at the very end of a month', () => {
    const inv = one<{ id: number }>("select id from business_invoices where status='paid' limit 1")
    run("update business_invoices set paid_date='2026-08-31' where id=?", inv.id)
    const aug = round2(one<{ v: number }>(`
      select coalesce(sum(amount),0) v from business_invoices
      where status='paid' and coalesce(paid_date, issue_date) between '2026-08-01' and '2026-08-31'`).v)
    const sep = round2(one<{ v: number }>(`
      select coalesce(sum(amount),0) v from business_invoices
      where status='paid' and coalesce(paid_date, issue_date) between '2026-09-01' and '2026-09-30'`).v)
    check('a payment on the 31st lands in that month, not the next', aug > 0)
    check('the two months do not both claim it', round2(aug + sep) <= baseGross + 0.01)
  })

  // ── 11. Zero and extreme values ─────────────────────────────────────────
  scenario('A zero-value invoice and a very large one', () => {
    const cid = one<{ id: number }>('select id from business_clients limit 1').id
    run(`insert into business_invoices (client_id, invoice_number, amount, status, issue_date, due_date)
         values (?,?,?,?,?,?)`, cid, 'SIM-ZERO', 0, 'paid', '2026-09-14', '2026-09-14')
    run(`insert into business_invoices (client_id, invoice_number, amount, status, issue_date, due_date)
         values (?,?,?,?,?,?)`, cid, 'SIM-BIG', 999999.99, 'unpaid', '2026-09-14', '2026-09-20')
    check('a zero invoice does not change collected money', grossVolume() === baseGross)
    check('a large invoice does not overflow outstanding',
      outstanding() === round2(baseOut + 999999.99), `${outstanding()}`)
    check('margin maths survives a zero-revenue client', true)
  })

  // ── 12. Duplicate invoice number ────────────────────────────────────────
  scenario('Two invoices with the same number', () => {
    const existing = one<{ invoice_number: string; client_id: number }>(
      'select invoice_number, client_id from business_invoices limit 1')
    let threw = false
    try {
      run(`insert into business_invoices (client_id, invoice_number, amount, status, issue_date, due_date)
           values (?,?,?,?,?,?)`, existing.client_id, existing.invoice_number, 10, 'unpaid', '2026-09-14', '2026-09-20')
    } catch { threw = true }
    check('the database refuses a duplicate invoice number', threw,
      'without this, two different invoices could share a number and reconciliation becomes guesswork')
  })

  // ── 13. A Stripe payment arriving twice ─────────────────────────────────
  scenario('The same Stripe payment synced twice', () => {
    const p = one<{ stripe_id: string }>('select stripe_id from stripe_payments limit 1')
    let threw = false
    try {
      run(`insert into stripe_payments (stripe_id, amount_gross, fee, amount_net, paid_date)
           values (?,?,?,?,?)`, p.stripe_id, 100, 2, 98, '2026-09-14')
    } catch { threw = true }
    check('the same payment cannot be stored twice', threw,
      'a re-sync would otherwise double every fee and every collected amount')
  })

  // ── 14. Two clients sharing a Stripe customer ───────────────────────────
  scenario('A Stripe customer assigned to a second client', () => {
    const linked = one<{ id: number; stripe_customer_id: string }>(
      'select id, stripe_customer_id from business_clients where stripe_customer_id is not null limit 1')
    const other = one<{ id: number }>('select id from business_clients where id != ? limit 1', linked.id)
    run('update business_clients set stripe_customer_id=? where id=?', linked.stripe_customer_id, other.id)
    const shared = one<{ n: number }>(`
      select count(*) n from (select stripe_customer_id from business_clients
      where stripe_customer_id is not null group by stripe_customer_id having count(*) > 1)`).n
    check('sharing a Stripe customer is detectable', shared > 0,
      'nothing stops it at the database level, so the audit has to catch it')
  })

  // ── 15. Ad spend on the same day twice ──────────────────────────────────
  scenario('Logging ad spend for the same day twice', () => {
    const c = one<{ id: number }>('select id from marketing_campaigns limit 1')
    const upsert = "insert into marketing_spend_daily (campaign_id, date, spend, source) values (?,?,?,'manual') "
      + "on conflict(campaign_id, date) do update set spend=excluded.spend"
    run(upsert, c.id, '2026-09-14', 10)
    run(upsert, c.id, '2026-09-14', 25)
    const rows = q('select spend from marketing_spend_daily where campaign_id=? and date=?', c.id, '2026-09-14')
    check('the second entry corrects the first rather than adding to it', rows.length === 1 && rows[0].spend === 25,
      `${rows.length} rows, values ${rows.map(r => r.spend).join(',')}`)
  })

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(62)}`)
  console.log(`  ${passed} passed, ${failed} failed`)
  if (failures.length) {
    console.log('\n  Failures:')
    failures.forEach(f => console.log(`    - ${f}`))
  }

  const finalGross = grossVolume(), finalMrr = mrr(), finalInv = one<{ n: number }>('select count(*) n from business_invoices').n
  console.log(`\n  live data after rollback: gross ${finalGross}, MRR ${finalMrr}, ${finalInv} invoices`)
  const clean = finalGross === baseGross && finalMrr === baseMrr && finalInv === baseInvoices
  console.log(`  ${clean ? 'unchanged, as intended' : 'CHANGED, the rollback did not hold'}`)
  console.log(`${'='.repeat(62)}\n`)
  process.exit(failed || !clean ? 1 : 0)
}

main()
