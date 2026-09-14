/**
 * One-time backfill for the Business v2 data model.
 *
 * Converts the legacy "recurring invoice template" retainers into first-class
 * `business_retainers` rows, seeds the service catalog, splits gross/net on
 * invoices, and attributes existing Business expenses to the client they were
 * incurred for.
 *
 * Idempotent - every write is guarded, so it is safe to re-run.
 *
 *   npx tsx server/scripts/backfill-business-v2.ts [--dry]
 */
import Database from 'better-sqlite3'
import path from 'path'

const DRY = process.argv.includes('--dry')
const dbPath = path.join(__dirname, '../data/dashboard.db')
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const log = (...a: any[]) => console.log(...a)
const warn = (...a: any[]) => console.log('  ⚠ ', ...a)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ty = y + Math.floor((m - 1 + n) / 12)
  const tm = ((m - 1 + n) % 12 + 12) % 12 + 1
  const maxDay = new Date(ty, tm, 0).getDate()
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, maxDay)).padStart(2, '0')}`
}

function advance(dateStr: string, frequency: string): string {
  switch (frequency) {
    case 'weekly': {
      const [y, m, d] = dateStr.split('-').map(Number)
      const dt = new Date(y, m - 1, d + 7)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    case 'quarterly': return addMonths(dateStr, 3)
    case 'yearly':    return addMonths(dateStr, 12)
    default:          return addMonths(dateStr, 1)
  }
}

/** Normalise for fuzzy name matching: lowercase, drop possessives, punctuation and filler words. */
const STOPWORDS = new Set([
  'the', 'and', 'ltd', 'limited', 'inc', 'uk', 'website', 'for', 'of',
  'subscription', 'domain', 'workspace', 'google', 'squarespace', 'logo',
  'outsourcing', 'citations', 'payment', 'sussex',
])

function norm(s: string): string {
  return s.toLowerCase()
    .replace(/['\u2019]s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return norm(s).split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/** Levenshtein distance, capped - used so "Mooreside" still matches "Moorside". */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/**
 * `desc` is a token from the expense description, `cand` from a client/project name.
 * Prefix matching is deliberately one-directional - the candidate may be the longer,
 * fuller form ("ben" → "benjamin"), but never the other way round, or "Uber sales
 * call" matches the client "Chris Sale".
 */
function tokenMatches(desc: string, cand: string): boolean {
  if (desc === cand) return true
  if (desc.length >= 3 && cand.length > desc.length && cand.startsWith(desc)) return true
  // tolerate one typo on longer words ("mooreside" ↔ "moorside")
  return desc.length >= 6 && cand.length >= 6 && editDistance(desc, cand) <= 1
}

/** Initials of a multi-word name - catches "YLGTS", "HP Building Services". */
function acronym(s: string): string {
  const w = tokens(s)
  return w.length >= 2 ? w.map(x => x[0]).join('') : ''
}

// ─── 1. Service catalog ───────────────────────────────────────────────────────

const SERVICES = [
  {
    name: 'Website Build', kind: 'one_off', defaultAmount: 299.98, defaultFrequency: null,
    milestones: [
      { label: 'Deposit',      pct: 50, offsetDays: 0 },
      { label: 'Presentation', pct: 25, offsetDays: 10 },
      { label: 'Launch',       pct: 25, offsetDays: 14 },
    ],
    defaultTermDays: 7, color: '#818cf8', sortOrder: 0,
  },
  { name: 'Local SEO',    kind: 'recurring', defaultAmount: 149.00, defaultFrequency: 'monthly', milestones: null, defaultTermDays: 0, color: '#34d399', sortOrder: 1 },
  { name: 'Hosting',      kind: 'recurring', defaultAmount: 19.50,  defaultFrequency: 'monthly', milestones: null, defaultTermDays: 0, color: '#22d3ee', sortOrder: 2 },
  { name: 'Email/Domain', kind: 'recurring', defaultAmount: 10.00,  defaultFrequency: 'monthly', milestones: null, defaultTermDays: 0, color: '#fbbf24', sortOrder: 3 },
]

function seedServices(): Record<string, number> {
  const ids: Record<string, number> = {}
  for (const svc of SERVICES) {
    const existing = db.prepare('SELECT id FROM business_services WHERE name = ?').get(svc.name) as any
    if (existing) { ids[svc.name] = existing.id; continue }
    if (DRY) { log(`  would insert service ${svc.name}`); ids[svc.name] = -1; continue }
    const r = db.prepare(`
      INSERT INTO business_services (name, kind, default_amount, default_frequency, milestones, default_term_days, color, sort_order)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(svc.name, svc.kind, svc.defaultAmount, svc.defaultFrequency,
           svc.milestones ? JSON.stringify(svc.milestones) : null,
           svc.defaultTermDays, svc.color, svc.sortOrder)
    ids[svc.name] = Number(r.lastInsertRowid)
    log(`  + service ${svc.name} (#${ids[svc.name]})`)
  }
  return ids
}

/** Guess which service a retainer sells from its invoice notes. */
function serviceForNotes(notes: string | null, svc: Record<string, number>): number | null {
  const n = (notes ?? '').toLowerCase()
  if (/email|domain/.test(n))        return svc['Email/Domain'] ?? null
  if (/hosting/.test(n))             return svc['Hosting'] ?? null
  if (/seo/.test(n))                 return svc['Local SEO'] ?? null
  return null
}

// ─── 2. Retainers from legacy recurring templates ────────────────────────────

function migrateRetainers(svc: Record<string, number>) {
  const templates = db.prepare(`
    SELECT * FROM business_invoices
    WHERE is_recurring = 1 AND recurring_parent_id IS NULL
    ORDER BY id
  `).all() as any[]

  log(`\n── Retainers ── ${templates.length} legacy templates`)

  for (const t of templates) {
    if (t.retainer_id) { log(`  = INV ${t.invoice_number} already linked to retainer #${t.retainer_id}`); continue }

    const freq      = t.frequency || 'monthly'
    const serviceId = serviceForNotes(t.notes, svc)
    // Name is the service where we could identify it - the full note text is kept
    // verbatim in `notes` so nothing is lost ("Local SEO for 3 months, then £99/mo").
    const svcName   = Object.keys(svc).find(k => svc[k] === serviceId)
    const name      = svcName || (t.notes || '').trim().slice(0, 40) || `${freq} retainer`
    const netDays   = Math.max(Math.round((Date.parse(t.due_date) - Date.parse(t.issue_date)) / 86_400_000), 0)

    // High-water mark: the latest occurrence actually issued for this template.
    const lastIssued = db.prepare(`
      SELECT MAX(issue_date) d FROM business_invoices
      WHERE id = ? OR recurring_parent_id = ?
    `).get(t.id, t.id) as any
    const lastGenerated = lastIssued?.d ?? t.issue_date
    const nextInvoice   = advance(lastGenerated, freq)

    if (DRY) {
      log(`  would create retainer for client ${t.client_id}: "${name}" £${t.amount}/${freq}, next ${nextInvoice}`)
      continue
    }

    const r = db.prepare(`
      INSERT INTO business_retainers
        (client_id, service_id, name, amount, currency, frequency, start_date, status,
         net_term_days, auto_invoice, last_generated_date, next_invoice_date, notes)
      VALUES (?,?,?,?,'GBP',?,?, 'active', ?, 1, ?, ?, ?)
    `).run(t.client_id, serviceId, name, t.amount, freq, t.issue_date, netDays, lastGenerated, nextInvoice, t.notes)
    const retainerId = Number(r.lastInsertRowid)

    // Link the template and every occurrence back to the retainer.
    const linked = db.prepare(`
      UPDATE business_invoices
      SET retainer_id = ?, service_id = COALESCE(service_id, ?)
      WHERE id = ? OR recurring_parent_id = ?
    `).run(retainerId, serviceId, t.id, t.id)

    log(`  + retainer #${retainerId} "${name}" £${t.amount}/${freq} → ${linked.changes} invoices linked, next ${nextInvoice}`)
  }
}

// ─── 3. Invoice gross/net + milestone labels ─────────────────────────────────

const MILESTONE_PATTERNS: [RegExp, string][] = [
  [/deposit/i,                       'Deposit'],
  [/presentation/i,                  'Presentation'],
  [/launch|final/i,                  'Launch'],
]

function backfillInvoices(svc: Record<string, number>) {
  const rows = db.prepare('SELECT * FROM business_invoices').all() as any[]
  let touched = 0, labelled = 0
  for (const i of rows) {
    const sets: string[] = []
    const vals: any[] = []

    if (i.subtotal == null) { sets.push('subtotal = ?'); vals.push(i.amount) }

    // One-off invoices tied to a project are Website Build milestones.
    if (!i.retainer_id && i.project_id && !i.service_id) {
      sets.push('service_id = ?'); vals.push(svc['Website Build'])
    }
    if (!i.milestone_label && !i.retainer_id) {
      for (const [re, label] of MILESTONE_PATTERNS) {
        if (re.test(i.notes ?? '')) { sets.push('milestone_label = ?'); vals.push(label); labelled++; break }
      }
    }
    // Retainer occurrences: fill the billing period they cover.
    if (i.retainer_id && !i.period_start) {
      const r = db.prepare('SELECT frequency FROM business_retainers WHERE id = ?').get(i.retainer_id) as any
      const end = advance(i.issue_date, r?.frequency ?? 'monthly')
      sets.push('period_start = ?', 'period_end = ?'); vals.push(i.issue_date, end)
    }

    if (!sets.length) continue
    touched++
    if (DRY) continue
    vals.push(i.id)
    db.prepare(`UPDATE business_invoices SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }
  log(`\n── Invoices ── ${touched}/${rows.length} updated (${labelled} milestone labels detected)`)
}

// ─── 4. Projects ─────────────────────────────────────────────────────────────

function backfillProjects(svc: Record<string, number>) {
  const rows = db.prepare('SELECT * FROM business_projects').all() as any[]
  let n = 0
  for (const p of rows) {
    const stage = p.status === 'completed' ? 'launched'
                : p.status === 'paused'    ? 'build'
                : 'build'
    const launched = p.status === 'completed' ? (p.due_date ?? null) : null
    if (p.service_id && p.stage !== 'discovery') continue
    n++
    if (DRY) continue
    db.prepare(`
      UPDATE business_projects
      SET service_id = COALESCE(service_id, ?), stage = ?, launched_date = COALESCE(launched_date, ?)
      WHERE id = ?
    `).run(svc['Website Build'], stage, launched, p.id)
  }
  log(`\n── Projects ── ${n}/${rows.length} updated`)
}

// ─── 5. Client won-date ──────────────────────────────────────────────────────

function backfillClients() {
  const rows = db.prepare(`
    SELECT c.id, c.name, MIN(i.issue_date) first_invoice
    FROM business_clients c
    LEFT JOIN business_invoices i ON i.client_id = c.id AND i.status = 'paid'
    GROUP BY c.id
  `).all() as any[]
  let n = 0
  for (const c of rows) {
    if (!c.first_invoice) continue
    n++
    if (DRY) continue
    db.prepare('UPDATE business_clients SET won_date = COALESCE(won_date, ?) WHERE id = ?')
      .run(c.first_invoice, c.id)
  }
  log(`\n── Clients ── ${n}/${rows.length} given a won_date`)
}

// ─── 6. Expense → client attribution ─────────────────────────────────────────

function attributeExpenses() {
  const clients  = db.prepare('SELECT id, name, company FROM business_clients').all() as any[]
  const projects = db.prepare('SELECT id, client_id, name FROM business_projects').all() as any[]
  const expenses = db.prepare("SELECT * FROM finance_expenses WHERE category = 'Business'").all() as any[]

  /** One candidate label per client/project alias, pre-tokenised. */
  type Cand = { clientId: number; projectId: number | null; label: string; toks: string[]; acr: string }
  const cands: Cand[] = []
  const add = (clientId: number, projectId: number | null, label: string | null) => {
    if (!label) return
    const toks = tokens(label)
    if (!toks.length) return
    cands.push({ clientId, projectId, label, toks, acr: acronym(label) })
  }

  for (const c of clients) {
    add(c.id, null, c.name)
    add(c.id, null, c.company)
    // Single-name aliases - "Ken's Google Workspace", "Toby's Squarespace Domain".
    // These score lower than the full name, so a full-name match always wins.
    for (const part of String(c.name).split(' ')) {
      if (part.length >= 3) add(c.id, null, part)
    }
  }
  for (const p of projects) {
    if (p.client_id) add(p.client_id, p.id, p.name)
  }

  /**
   * Score = how much of a candidate's name the description covers.
   * Requires every candidate token to be present, so "Ken" doesn't win a row
   * that is really about "Ken Lofthouse Gallery Page Redesign" for someone else.
   * Longer candidate names score higher, so the company beats a bare first name.
   */
  function score(descToks: string[], c: Cand): number {
    if (!c.toks.length) return 0
    let hits = 0
    for (const ct of c.toks) {
      if (descToks.some(dt => tokenMatches(dt, ct))) hits++
    }
    if (hits !== c.toks.length) return 0
    // Weight by how specific the match is: more tokens + more characters = better.
    return c.toks.length * 100 + c.toks.join('').length
  }

  let matched = 0, already = 0
  const unmatched: string[] = []

  for (const e of expenses) {
    if (e.client_id) { already++; continue }
    const descToks = tokens(e.description)
    if (!descToks.length) { unmatched.push(`${e.date}  £${e.amount}  ${e.description}`); continue }

    let best: Cand | null = null
    let bestScore = 0
    for (const c of cands) {
      const sc = score(descToks, c)
      if (sc > bestScore) { bestScore = sc; best = c }
    }

    // Acronym fallback: "YLGTS logo outsourcing" → Your Local Garden & Tree Service
    if (!best) {
      for (const c of cands) {
        if (c.acr.length < 3) continue
        if (descToks.some(t => t === c.acr || (t.length <= c.acr.length + 2 && t.endsWith(c.acr)))) { best = c; break }
      }
    }

    if (!best) { unmatched.push(`${e.date}  £${e.amount}  ${e.description}`); continue }
    matched++
    if (DRY) {
      log(`  "${e.description}"  →  ${best.label}${best.projectId ? ` [project ${best.projectId}]` : ''}`)
      continue
    }
    db.prepare('UPDATE finance_expenses SET client_id = ?, project_id = ? WHERE id = ?')
      .run(best.clientId, best.projectId, e.id)
  }

  log(`\n── Business expenses ── ${matched} newly attributed, ${already} already attributed, of ${expenses.length}`)
  if (unmatched.length) {
    log(`  ${unmatched.length} left unattributed - these read as overheads, not client costs.`)
    log(`  Assign any that are client-specific from the Money tab:`)
    unmatched.forEach(u => warn(u))
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

log(DRY ? '=== DRY RUN - no writes ===' : '=== Business v2 backfill ===')
log(`db: ${dbPath}`)

const run = db.transaction(() => {
  log('\n── Services ──')
  const svc = seedServices()
  migrateRetainers(svc)
  backfillInvoices(svc)
  backfillProjects(svc)
  backfillClients()
  attributeExpenses()
})
run()

// ─── Report ──────────────────────────────────────────────────────────────────

const mrr = db.prepare(`
  SELECT ROUND(SUM(CASE frequency
    WHEN 'weekly'    THEN amount * 4.333
    WHEN 'quarterly' THEN amount / 3.0
    WHEN 'yearly'    THEN amount / 12.0
    ELSE amount END), 2) mrr,
    COUNT(*) n
  FROM business_retainers WHERE status = 'active'
`).get() as any

log(`\n=== Done ===`)
log(`Retainers: ${mrr.n} active · MRR £${mrr.mrr ?? 0}`)
log(`Invoices linked to a retainer: ${(db.prepare('SELECT COUNT(*) n FROM business_invoices WHERE retainer_id IS NOT NULL').get() as any).n}/51`)
db.close()
