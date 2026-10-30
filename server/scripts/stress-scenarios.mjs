/**
 * Business stress scenarios, run against a TEST server over HTTP.
 *
 * Each scenario is a situation a small agency meets (a client paying ahead, a
 * discount, notice, a fixed-term contract, a winter pause, a payment on the
 * wrong client, a partner paying a cost personally...) and checks that the
 * dashboard handles it in the way it should.
 *
 * It creates clients named "ZZ ..." and writes real records, so it refuses to
 * run unless STRESS_API points somewhere other than the live server:
 *
 *   OURA_DB_PATH=/tmp/copy.db PORT=3011 npx tsx src/index.ts      (a copy)
 *   STRESS_API=http://localhost:3011/api/business node scripts/stress-scenarios.mjs
 *
 * The date-driven cases (notice running out, a pause restarting) are in
 * stress-dates.ts, which moves the clock instead.
 */
const B = process.env.STRESS_API
if (!B || /:3001\b/.test(B)) { console.error('Set STRESS_API to a test server, never the live one on 3001'); process.exit(2) }
const F = B.replace(/\/business$/, '/finance')
async function api(method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const get = p => api('GET', p).then(r => r.body)
const post = (p, b) => api('POST', p, b)
const put = (p, b) => api('PUT', p, b)
let n = 0
async function client(name) { return (await post('/clients', { name: `ZZ ${name} ${++n}` })).body }
async function invoicesOf(cid) { return (await get(`/invoices?clientId=${cid}`)).filter?.(i => i.clientId === cid) ?? [] }
let failed = 0
function verdict(id, title, ok, detail) { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title}${detail ? `\n       ${detail}` : ''}`) }
const svc = await get('/services'); const seo = svc.find(s => s.name === 'Local SEO'); const web = svc.find(s => s.name === 'Website Build')
const mrr = async () => (await get('/metrics')).mrr.current
const ret = async (cid, amount = 149, startDate = '2026-10-05', extra = {}) => (await post('/retainers', { clientId: cid, serviceId: seo.id, name: 'Local SEO', amount, startDate, ...extra })).body
const open = async cid => (await invoicesOf(cid)).filter(i => i.status !== 'void')

// S1 pay two months ahead
{ const c = await client('Prepay'); await ret(c.id); await invoicesOf(c.id)
  const pre = await post(`/clients/${c.id}/payments`, { amount: 298, dryRun: true })
  await post(`/clients/${c.id}/payments`, { amount: 298 })
  const inv = await open(c.id)
  verdict('S1', 'Pays two months up front: Oct and Nov paid, nothing extra raised', inv.length === 2 && inv.every(i => i.status === 'paid') && inv.some(i => i.issueDate === '2026-11-05'),
    `preview ahead ${pre.body.ahead?.map(a => a.periodStart)}; invoices ${inv.map(i => `${i.issueDate} ${i.status}`)}`)
  await put(`/retainers/${(await get('/retainers')).find(r => r.clientId === c.id).id}`, { notes: 'touch' })
  const again = await open(c.id)
  verdict('S1b', 'November is not billed a second time later', again.length === 2, `${again.length}`)
}
{ const c = await client('PrepayOdd'); await ret(c.id); await invoicesOf(c.id)
  await post(`/clients/${c.id}/payments`, { amount: 200 })
  const inv = await open(c.id); const nov = inv.find(i => i.issueDate === '2026-11-05')
  verdict('S1c', 'Pays £200 on £149/mo: Oct paid, Nov part-paid £51', !!nov && nov.status === 'unpaid', inv.map(i => `${i.issueDate} ${i.status} ${i.amount}`).join(' | '))
}
{ const c = await client('PrepayFor'); await ret(c.id); await invoicesOf(c.id)
  await post(`/clients/${c.id}/payments`, { amount: 249, restFor: 'Logo design' })
  const inv = await open(c.id)
  verdict('S1d', 'Extra money that was for something else becomes its own paid invoice', inv.some(i => i.notes === 'Logo design' && i.status === 'paid'), inv.map(i => i.notes).join(', '))
}
// S2 discount
{ const c = await client('Coupon'); const inv = (await post('/invoices', { clientId: c.id, amount: 149, issueDate: '2026-10-10' })).body
  await post(`/invoices/${inv.id}/pay`, { amount: 74.5 })
  const r = await post(`/invoices/${inv.id}/settle`, { reason: 'First month half price' })
  const after = await get(`/invoices/${inv.id}`)
  verdict('S2', 'Half-price first month: accept what arrived as payment in full', r.status === 200 && (after.status ?? after.invoice?.status) === 'paid', `${r.status} ${r.body.note}`)
  const inv2 = (await post('/invoices', { clientId: c.id, amount: 100 })).body
  const r2 = await post(`/invoices/${inv2.id}/settle`, {})
  verdict('S2b', 'Settling with nothing paid points to write off instead', r2.status === 409, r2.body.error)
}
// S3 notice
{ const c = await client('Notice'); await ret(c.id, 149, '2026-09-17'); await invoicesOf(c.id)
  const before = await mrr()
  const pre = await post(`/clients/${c.id}/drop`, { endDate: '2026-12-31', dryRun: true })
  await post(`/clients/${c.id}/drop`, { endDate: '2026-12-31', reason: 'Moving to in-house' })
  const cl = (await get('/clients')).find(x => x.id === c.id)
  const after = await mrr()
  verdict('S3', 'Client gives notice to 31 Dec: still active and in MRR until then', cl.status === 'active' && cl.leavingOn === '2026-12-31' && Math.abs(after - before) < 0.01,
    `still to bill: ${pre.body.stillToBill?.map(x => x.periodStart).join(', ')}; status ${cl.status}, leaving ${cl.leavingOn}`)
  await post(`/clients/${c.id}/reactivate`, {})
  const r = (await get('/retainers')).find(x => x.clientId === c.id)
  const cl2 = (await get('/clients')).find(x => x.id === c.id)
  verdict('S3b', 'They change their mind: notice taken back, retainer open-ended again', !r.endDate && !cl2.leavingOn, `end ${r.endDate}, leaving ${cl2.leavingOn}`)
}
// S33 fixed term
{ const c = await client('FixedTerm'); const r = await ret(c.id, 100, '2026-08-01'); await invoicesOf(c.id)
  const before = await mrr()
  const x = await post(`/retainers/${r.id}/cancel`, { endDate: '2027-02-01', reason: '6 month contract' })
  const after = await mrr(); const row = (await get('/retainers')).find(y => y.id === r.id)
  verdict('S33', 'Six-month contract: end date set ahead, still billing and in MRR', x.status === 200 && row.status === 'active' && row.endDate === '2027-02-01' && Math.abs(after - before) < 0.01, `bills still: ${x.body.stillToBill?.length}`)
}
// S36 pause with restart
{ const c = await client('Seasonal'); const r = await ret(c.id, 149, '2026-09-03'); await invoicesOf(c.id)
  const x = await post(`/retainers/${r.id}/pause`, { resumeOn: '2027-02-03' })
  const row = (await get('/retainers')).find(y => y.id === r.id)
  verdict('S36', 'Paused for winter with a restart date', row.status === 'paused' && row.resumeOn === '2027-02-03', `${x.status}`)
  const bad = await post(`/retainers/${r.id}/pause`, { resumeOn: '2026-01-01' })
  verdict('S36b', 'A restart date in the past is refused', bad.status === 400, bad.body.error)
}
// S15 comeback new terms
{ const c = await client('Comeback'); const r = await ret(c.id, 149, '2026-06-01'); await invoicesOf(c.id)
  await post(`/clients/${c.id}/drop`, { endDate: '2026-08-01' })
  await post(`/clients/${c.id}/reactivate`, { reinstateRetainerIds: [r.id], prices: { [r.id]: 99 }, startDate: '2026-11-01' })
  const rs = (await get('/retainers')).filter(x => x.clientId === c.id && x.status === 'active')
  verdict('S15', 'Comes back at £99 from 1 Nov, in one step', rs[0]?.amount === 99 && rs[0]?.startDate === '2026-11-01', rs.map(x => `${x.amount} ${x.startDate}`).join())
}
// S12 website cancelled
{ const c = await client('Website')
  await post('/deals', { clientId: c.id, project: { name: 'Site' }, items: [{ serviceId: web.id, amount: 1200 }], sendFirst: true })
  const dep = (await open(c.id)).find(i => i.status === 'unpaid'); await post(`/invoices/${dep.id}/pay`, {})
  const proj = (await get('/projects')).find(p => p.clientId === c.id)
  await put(`/projects/${proj.id}`, { status: 'cancelled' })
  const left = (await open(c.id)).filter(i => i.status !== 'paid')
  verdict('S12', 'Website cancelled after deposit: unsent stages go, deposit stays', left.length === 0, left.map(i => i.milestoneLabel).join())
}
// S22 lower a paid invoice
{ const c = await client('Overpaid'); const r = await ret(c.id, 99, '2026-10-05'); await invoicesOf(c.id)
  const typo = (await post('/invoices', { clientId: c.id, amount: 149, issueDate: '2026-10-01', status: 'paid' })).body
  const ask = await put(`/invoices/${typo.id}`, { amount: 99 })
  verdict('S22', 'Lowering a paid invoice asks where the £50 goes', ask.status === 409 && ask.body.excess === 50, ask.body.error)
  const cr = await put(`/invoices/${typo.id}`, { amount: 99, excess: 'credit' })
  const inv = await open(c.id)
  verdict('S22b', '£50 credit goes onto their open October bill', cr.status === 200 && inv.some(i => i.retainerId && i.status === 'unpaid'), inv.map(i => `${i.invoiceNumber} ${i.amount} ${i.status}`).join(' | '))
  const c2 = await client('Refunded'); const i2 = (await post('/invoices', { clientId: c2.id, amount: 149, status: 'paid' })).body
  const rf = await put(`/invoices/${i2.id}`, { amount: 99, excess: 'refund' })
  const d2 = await get(`/invoices/${i2.id}`)
  verdict('S22c', 'Or the £50 was given back: recorded as a refund', rf.status === 200 && (d2.refundedAmount ?? d2.invoice?.refundedAmount) === 50, JSON.stringify(rf.body).slice(0, 100))
}
// S23 move
{ const a = await client('WrongA'), b = await client('WrongB')
  const ia = (await post('/invoices', { clientId: a.id, amount: 100 })).body; const ib = (await post('/invoices', { clientId: b.id, amount: 100 })).body
  await post(`/clients/${a.id}/payments`, { amount: 100 })
  const al = (await get(`/invoices/${ia.id}`)).allocations[0]
  const mv = await post(`/allocations/${al.id}/move`, { clientId: b.id })
  const sa = (await get(`/invoices/${ia.id}`)), sb = (await get(`/invoices/${ib.id}`))
  verdict('S23', 'Bank payment moved to the right client', mv.status === 200 && (sa.status ?? sa.invoice?.status) === 'unpaid' && (sb.status ?? sb.invoice?.status) === 'paid', `${mv.status}`)
}
// S34 refund part of a bank payment
{ const c = await client('Refund'); const i = (await post('/invoices', { clientId: c.id, amount: 149, status: 'paid' })).body
  const al = (await get(`/invoices/${i.id}`)).allocations[0]
  const r = await post(`/allocations/${al.id}/refund`, { amount: 50 })
  const over = await post(`/allocations/${al.id}/refund`, { amount: 500 })
  verdict('S34', 'Give £50 of a bank payment back; more than paid is refused', r.status === 200 && over.status === 409, over.body.error)
}
// S9 duplicate
{ const c = await client('Dup'); await post('/invoices', { clientId: c.id, amount: 149 }); await post('/invoices', { clientId: c.id, amount: 149 })
  await post(`/clients/${c.id}/payments`, { amount: 149 })
  const pre = await post(`/clients/${c.id}/payments`, { amount: 149, dryRun: true })
  verdict('S9', 'Same bank payment entered twice is flagged', !!pre.body.duplicate, JSON.stringify(pre.body.duplicate))
}
// S41 hold
{ const c = await client('Hold'); const i = (await post('/invoices', { clientId: c.id, amount: 300, issueDate: '2026-09-01', dueDate: '2026-09-08' })).body
  const n1 = (await get('/needs')).some(r => r.invoiceId === i.id)
  await post(`/invoices/${i.id}/hold`, { until: '2026-11-30', reason: 'Disputing the scope' })
  const n2 = (await get('/needs')).some(r => r.invoiceId === i.id)
  const led = (await get('/invoices/ledger')).rows.find(r => r.id === i.id)
  verdict('S41', 'Disputed bill on hold: out of Chase until the date, still owed', n1 && !n2 && led.heldUntil === '2026-11-30' && led.owed === 300, `${n1} -> ${n2}`)
}
// S40 partner paid a cost
{ const owners = await get('/owners'); const before = (await get('/metrics')).ownerPay.safeToDraw
  const e = await (await fetch(F + '/expenses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'Meta ads on personal card', amount: 120, category: 'Business', date: '2026-10-20', paidByOwnerId: owners[0].id }) })).json()
  const m = (await get('/metrics')).ownerPay
  const need = (await get('/needs')).find(r => r.key === `repay-${e.id}`)
  verdict('S40', 'Partner paid a cost personally: shown as owed back, safe to draw allows for it', !!need && m.owedBackTotal === 120, `safe ${before} -> ${m.safeToDraw}`)
  await fetch(F + `/expenses/${e.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reimbursedAt: '2026-10-31' }) })
  verdict('S40b', 'Paid back: the reminder clears', !(await get('/needs')).some(r => r.key === `repay-${e.id}`), '')
}
// S37 export
for (const k of ['invoices', 'payments', 'costs']) {
  const r = await fetch(`${B}/export?kind=${k}&from=2026-04-01&to=2026-10-31`)
  const t = await r.text()
  verdict(`S37-${k}`, `Export ${k} as CSV`, r.ok && t.split('\n').length > 2, `${t.split('\n').length - 1} rows; ${t.split('\n')[0]}`)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
