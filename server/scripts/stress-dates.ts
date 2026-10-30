/**
 * Dated events, checked by moving the clock: notice running out, a pause with
 * a restart date, a fixed-term end, and months paid ahead. Runs only against a
 * copy (OURA_DB_PATH is required) because it writes.
 */
import { db } from '../src/db'
import { businessClients, businessRetainers, businessInvoices } from '../src/db/schema'
import { eq } from 'drizzle-orm'
import { generateRetainerInvoices } from '../src/lib/retainerBilling'
import { loadBusinessData, invalidateBusinessData, retainerMrrOn } from '../src/lib/businessMetrics'
import { issueAhead } from '../src/lib/lifecycle'
import { recordManualPayment } from '../src/lib/payments'

if (!process.env.OURA_DB_PATH) { console.error('Set OURA_DB_PATH to a copy'); process.exit(2) }
let failed = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}
const run = (today: string) => generateRetainerInvoices({ force: true, today })
const invoicesOf = (rid: number) => db.select().from(businessInvoices).where(eq(businessInvoices.retainerId, rid)).all()
const retainer = (rid: number) => db.select().from(businessRetainers).where(eq(businessRetainers.id, rid)).get()!

async function main() {
  const svc = 2
  // Notice: billing on the 17th, last day 31 Dec.
  const c1 = db.insert(businessClients).values({ name: 'ZZ Notice', status: 'active', leavingOn: '2026-12-31' }).returning().get()
  const r1 = db.insert(businessRetainers).values({ clientId: c1.id, serviceId: svc, name: 'Local SEO', amount: 149, startDate: '2026-10-17', nextInvoiceDate: '2026-10-17', endDate: '2026-12-31' }).returning().get()
  await run('2026-12-20')
  check('notice: still billing in December', invoicesOf(r1.id).length === 3, invoicesOf(r1.id).map(i => i.issueDate).join(','))
  check('notice: still a client on 20 Dec', db.select().from(businessClients).where(eq(businessClients.id, c1.id)).get()!.status === 'active')
  await run('2027-01-20')
  const rr = retainer(r1.id)
  check('notice: no January bill', invoicesOf(r1.id).length === 3)
  check('notice: retainer closed on its last day', rr.status === 'cancelled' && rr.cancelledAt === '2026-12-31', `${rr.status} ${rr.cancelledAt}`)
  const cl = db.select().from(businessClients).where(eq(businessClients.id, c1.id)).get()!
  check('notice: client churned on the last day', cl.status === 'churned' && cl.churnedAt === '2026-12-31' && !cl.leavingOn, `${cl.status} ${cl.churnedAt}`)
  invalidateBusinessData()
  const d = await loadBusinessData()
  const r = d.retainers.find(x => x.id === r1.id)!
  check('notice: MRR counts it in December, not January', retainerMrrOn(r, '2026-12-15', d.changes) === 149 && retainerMrrOn(r, '2027-01-01', d.changes) === 0)

  // Pause until 3 Feb.
  const c2 = db.insert(businessClients).values({ name: 'ZZ Seasonal', status: 'active' }).returning().get()
  const r2 = db.insert(businessRetainers).values({ clientId: c2.id, serviceId: svc, name: 'Local SEO', amount: 149, startDate: '2026-09-03', nextInvoiceDate: '2026-11-03', lastGeneratedDate: '2026-10-03', status: 'paused', pausedAt: '2026-10-31', resumeOn: '2027-02-03' }).returning().get()
  await run('2027-01-31')
  check('pause: nothing billed while away', invoicesOf(r2.id).length === 0 && retainer(r2.id).status === 'paused')
  await run('2027-02-05')
  const r2b = retainer(r2.id)
  check('pause: restarts itself on 3 Feb and bills that day', r2b.status === 'active' && invoicesOf(r2.id).map(i => i.issueDate).join() === '2027-02-03', `${r2b.status} ${invoicesOf(r2.id).map(i => i.issueDate)}`)

  // Paid ahead for November, then the clock reaches December.
  const c3 = db.insert(businessClients).values({ name: 'ZZ Ahead', status: 'active' }).returning().get()
  const r3 = db.insert(businessRetainers).values({ clientId: c3.id, serviceId: svc, name: 'Local SEO', amount: 149, startDate: '2026-10-05', nextInvoiceDate: '2026-10-05' }).returning().get()
  await run('2026-10-31')
  db.transaction(tx => { const inv = issueAhead(tx, r3.id, '2026-11-05', 'ZZ-AHEAD-1', '2026-10-31'); recordManualPayment(tx, inv.id, { date: '2026-10-31' }) })
  await run('2026-12-10')
  const dates = invoicesOf(r3.id).map(i => i.issueDate).sort()
  check('ahead: November billed once, December billed as normal', dates.join() === '2026-10-05,2026-11-05,2026-12-05', dates.join())

  console.log(failed ? `\n${failed} failed` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
