/**
 * The retainer generator, hammered.
 *
 * This is the one piece of automation that creates money rows on its own, on a
 * timer, without anyone watching. If it can ever issue the same month twice,
 * revenue is overstated and a client gets billed twice. It runs against a
 * throwaway COPY of the database, never the real one.
 *
 * Run with:  npm run test:generator --prefix server
 */
import { generateRetainerInvoices } from '../src/lib/retainerBilling'
import { db } from '../src/db'
import { businessInvoices, businessRetainers } from '../src/db/schema'
import { eq, sql } from 'drizzle-orm'

let passed = 0, failed = 0
const check = (label: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${!ok && detail ? `\n          ${detail}` : ''}`)
}

const count = async () => (await db.select({ n: sql<number>`count(*)` }).from(businessInvoices))[0].n
const gross = async () => (await db.select({ v: sql<number>`coalesce(sum(amount),0)` })
  .from(businessInvoices).where(sql`status='paid'`))[0].v

async function main() {
  if (!process.env.OURA_DB_PATH) {
    console.error('\n  Refusing to run without OURA_DB_PATH. This must never touch the real database.\n')
    process.exit(1)
  }
  console.log(`\nRETAINER GENERATOR\n==================\nagainst ${process.env.OURA_DB_PATH}\n`)

  const startCount = await count()
  const startGross = await gross()
  console.log(`  starting: ${startCount} invoices, ${startGross.toFixed(2)} collected\n`)

  // 1. Nothing is due, so nothing should be created however often it runs.
  await generateRetainerInvoices({ force: true })
  const afterFirst = await count()
  check('a run with nothing due creates nothing', afterFirst === startCount,
    `${afterFirst} vs ${startCount}`)

  for (let i = 0; i < 5; i++) await generateRetainerInvoices({ force: true })
  check('five more runs still create nothing', (await count()) === startCount)

  // 2. Make one retainer due and check exactly one invoice appears.
  const [r] = await db.select().from(businessRetainers).where(sql`status='active'`).limit(1)
  await db.update(businessRetainers)
    .set({ nextInvoiceDate: '2026-09-01', lastGeneratedDate: '2026-08-01' })
    .where(eq(businessRetainers.id, r.id))

  const before = await count()
  const made = await generateRetainerInvoices({ force: true })
  const after = await count()
  check('one overdue period produces exactly one invoice', after - before === 1,
    `created ${after - before}, generator reported ${made.length}`)

  const [fresh] = await db.select().from(businessRetainers).where(eq(businessRetainers.id, r.id))
  check('the high-water mark moved past the period just billed',
    !!fresh.nextInvoiceDate && fresh.nextInvoiceDate > '2026-09-01',
    `next is now ${fresh.nextInvoiceDate}`)

  // 3. The critical one: running again must not re-issue it.
  const repeat = await count()
  for (let i = 0; i < 5; i++) await generateRetainerInvoices({ force: true })
  check('running five more times does NOT re-issue that month', (await count()) === repeat,
    `${await count()} vs ${repeat}, which would mean double billing`)

  // 4. A cancelled retainer must never bill again.
  await db.update(businessRetainers)
    .set({ status: 'cancelled', endDate: '2026-08-01', nextInvoiceDate: '2026-08-15', autoInvoice: 0 })
    .where(eq(businessRetainers.id, r.id))
  const beforeCancel = await count()
  await generateRetainerInvoices({ force: true })
  check('a cancelled retainer issues nothing, even when overdue', (await count()) === beforeCancel)

  // 5. A long gap must not produce an unbounded run.
  const [r2] = await db.select().from(businessRetainers).where(sql`status='active'`).limit(1)
  if (r2) {
    await db.update(businessRetainers)
      .set({ nextInvoiceDate: '2020-01-01', lastGeneratedDate: '2019-12-01', status: 'active', autoInvoice: 1, endDate: null })
      .where(eq(businessRetainers.id, r2.id))
    const beforeGap = await count()
    const backlog = await generateRetainerInvoices({ force: true })
    const created = (await count()) - beforeGap
    check('a six-year gap is billed month by month, not infinitely', created > 0 && created < 200,
      `${created} invoices created`)
    check('the generator reports what it made', backlog.length === created)
  }

  // 6. Collected money is never touched by generation.
  check('generating invoices never changes collected money', (await gross()) === startGross,
    `${await gross()} vs ${startGross}`)

  // 7. Invoice numbers stay unique through a burst.
  const nums = await db.select({ n: businessInvoices.invoiceNumber }).from(businessInvoices)
  check('every invoice number is still unique after all that',
    new Set(nums.map(x => x.n)).size === nums.length,
    `${nums.length} invoices, ${new Set(nums.map(x => x.n)).size} distinct numbers`)

  console.log(`\n${'='.repeat(56)}\n  ${passed} passed, ${failed} failed\n${'='.repeat(56)}\n`)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('\ncrashed:', e?.message ?? e, '\n'); process.exit(2) })
