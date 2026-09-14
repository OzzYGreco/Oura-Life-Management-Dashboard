import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import { KpiCard } from '../../../components/ui/KpiCard'
import { PageLoader } from '../../../components/ui/Spinner'
import { Sparkline } from '../../../components/ui/Sparkline'
import { Th, Td, TablePanel, THead, Row, MiniBtn, StatusDot, Pill, EmptyRow, fmtHours } from '../components/primitives'
import { useClientSummary } from '../../../hooks/useBusiness'
import { formatDate } from '../../../lib/utils'
import { STAGES } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'

/**
 * One client, everything about them, nothing about anyone else.
 *
 * This replaces the table in place rather than opening a modal, the same way
 * Trading Analytics drills into a system. The old client modal was capped at
 * max-w-2xl and had no way to add a project or an invoice from inside it, which
 * is what made onboarding a website a three-tab round trip.
 */
export function ClientDetail({
  clientId, fmtView, onBack, onEdit, onAddRetainer, onAddProject, onAddInvoice, onAddCost, onAddNote,
  onRetainerAction, onPay, onLogTime,
}: {
  clientId: number
  fmtView: FmtView
  onBack: () => void
  onEdit: (client: any) => void
  onAddRetainer: (clientId: number) => void
  onAddProject: (clientId: number) => void
  onAddInvoice: (clientId: number) => void
  onAddCost: (clientId: number) => void
  onAddNote: (clientId: number) => void
  onRetainerAction: (retainer: any, action: 'price' | 'pause' | 'resume' | 'cancel') => void
  onPay: (invoiceId: number) => void
  onLogTime: (projectId: number) => void
}) {
  const { data, isPending } = useClientSummary(clientId)
  if (isPending || !data) return <PageLoader />

  const { client, economics: e, retainers, projects, invoices, costs, meetingNotes } = data
  const activeRetainers = retainers.filter((r: any) => r.status !== 'cancelled')

  return (
    <div className="space-y-7">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold mb-3 hover:underline"
          style={{ color: 'var(--c-text-3)' }}
        >
          <ArrowLeft size={12} /> All clients
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight" style={{ color: 'var(--c-text-1)' }}>{client.name}</h2>
            <p className="text-xs mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--c-text-3)' }}>
              {client.company && <span>{client.company}</span>}
              {client.website && (
                <a href={client.website.startsWith('http') ? client.website : `https://${client.website}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--c-accent)' }}>
                  {client.website.replace(/^https?:\/\//, '')} <ExternalLink size={10} />
                </a>
              )}
              {client.email && <span>{client.email}</span>}
              {client.phone && <span className="num">{client.phone}</span>}
            </p>
          </div>
          <MiniBtn onClick={() => onEdit(client)}>Edit client</MiniBtn>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard label="MRR" value={e.mrr ? `${fmtView(e.mrr)}/mo` : '--'} color={e.mrr ? 'var(--c-accent)' : 'var(--c-text-2)'}
          sub={e.retainerCount ? `${e.retainerCount} retainer${e.retainerCount === 1 ? '' : 's'}` : 'no retainer'} />
        <KpiCard label="Lifetime" value={fmtView(e.revenue)} sub={`${e.invoiceCount} invoice${e.invoiceCount === 1 ? '' : 's'}`} />
        <KpiCard label="Costs" value={fmtView(e.costs)} color="var(--c-text-2)"
          sub={costs.length ? `${costs.length} attributed` : 'none attributed'} />
        <KpiCard label="Margin" value={e.revenue ? `${e.marginPct.toFixed(0)}%` : '--'}
          color={e.marginPct >= 50 ? 'var(--c-profit)' : e.revenue ? 'var(--c-loss)' : 'var(--c-text-2)'}
          sub={e.revenue ? `${fmtView(e.margin)} kept` : 'nothing billed yet'} />
        <KpiCard label="Client since"
          value={e.since ? new Date(e.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '--'}
          sub={e.since ? `${Math.round(e.tenureMonths)} month${Math.round(e.tenureMonths) === 1 ? '' : 's'}` : 'never invoiced'} />
      </div>

      {e.spark.some((v: number) => v > 0) && (
        <div className="rounded-xl px-4 py-3" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-3)' }}>
            Collected, last 12 months
          </div>
          <Sparkline points={e.spark} color="#818cf8" height={44} />
        </div>
      )}

      {e.unbilled > 0 && (
        <div className="px-4 py-2.5 rounded-xl text-xs"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
          <b className="num">{fmtView(e.unbilled)}</b> of agreed work on this client has never been invoiced.
        </div>
      )}

      {/* ── Pays monthly ─────────────────────────────────────────────────── */}
      <Section label="Pays monthly" count={activeRetainers.length || undefined}
        action={<MiniBtn tone="accent" onClick={() => onAddRetainer(clientId)}>+ Add retainer</MiniBtn>}>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Service</Th><Th align="right">Amount</Th><Th align="right">Started</Th>
              <Th align="right">Next invoice</Th><Th>Status</Th><Th />
            </THead>
            <tbody>
              {retainers.length === 0 ? (
                <EmptyRow colSpan={6}>
                  Nothing recurring yet. Add a retainer and it invoices itself every month.
                </EmptyRow>
              ) : retainers.map((r: any) => (
                <Row key={r.id} dim={r.status === 'cancelled'}>
                  <Td><span className="font-medium">{r.serviceName}</span></Td>
                  <Td align="right" mono color="var(--c-accent)">{fmtView(r.amount)}/mo</Td>
                  <Td align="right" mono color="var(--c-text-3)">{formatDate(r.startDate)}</Td>
                  <Td align="right" mono color="var(--c-text-2)">
                    {r.status === 'active' && r.nextInvoiceDate ? formatDate(r.nextInvoiceDate)
                      : r.endDate ? `ended ${formatDate(r.endDate)}` : '--'}
                  </Td>
                  <Td><StatusDot status={r.status === 'active' ? 'paid' : r.status === 'paused' ? 'unpaid' : 'draft'} /></Td>
                  <Td align="right">
                    <div className="flex gap-1.5 justify-end">
                      {r.status !== 'cancelled' && <MiniBtn onClick={() => onRetainerAction(r, 'price')}>Change price</MiniBtn>}
                      {r.status === 'active' && <MiniBtn onClick={() => onRetainerAction(r, 'pause')}>Pause</MiniBtn>}
                      {r.status === 'paused' && <MiniBtn tone="good" onClick={() => onRetainerAction(r, 'resume')}>Resume</MiniBtn>}
                      {r.status !== 'cancelled' && <MiniBtn tone="danger" onClick={() => onRetainerAction(r, 'cancel')}>Cancel</MiniBtn>}
                    </div>
                  </Td>
                </Row>
              ))}
            </tbody>
          </table>
        </TablePanel>
      </Section>

      {/* ── Websites ─────────────────────────────────────────────────────── */}
      <Section label="Websites" count={projects.length || undefined}
        action={<MiniBtn tone="accent" onClick={() => onAddProject(clientId)}>+ Add website</MiniBtn>}>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Project</Th><Th>Stage</Th><Th align="right">Value</Th><Th align="right">Collected</Th>
              <Th align="right">Hours</Th><Th align="right">Rate</Th><Th align="right">Due</Th><Th />
            </THead>
            <tbody>
              {projects.length === 0 ? (
                <EmptyRow colSpan={8}>No website for this client yet.</EmptyRow>
              ) : projects.map((p: any) => {
                const stage = STAGES.find(s => s.key === p.stage)
                const rate = p.hours > 0 ? p.collected / p.hours : null
                return (
                  <Row key={p.id}>
                    <Td><span className="font-medium">{p.name}</span></Td>
                    <Td>
                      <Pill color={p.status === 'paused' ? '#f59e0b' : stage?.color ?? 'var(--c-text-3)'}>
                        {p.status === 'paused' ? 'paused' : stage?.label ?? p.stage}
                      </Pill>
                    </Td>
                    <Td align="right" mono>{p.value ? fmtView(p.value) : '--'}</Td>
                    <Td align="right" mono color={p.collected ? 'var(--c-profit)' : 'var(--c-text-3)'}>
                      {p.collected ? fmtView(p.collected) : '--'}
                    </Td>
                    <Td align="right" mono color="var(--c-text-3)">{fmtHours(p.hours)}</Td>
                    <Td align="right" mono color="var(--c-text-2)">{rate ? `${fmtView(rate)}/h` : '--'}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{p.dueDate ? formatDate(p.dueDate) : '--'}</Td>
                    <Td align="right"><MiniBtn onClick={() => onLogTime(p.id)}>Log hours</MiniBtn></Td>
                  </Row>
                )
              })}
            </tbody>
          </table>
        </TablePanel>
      </Section>

      {/* ── Invoices ─────────────────────────────────────────────────────── */}
      <Section label="Invoices" count={invoices.length || undefined}
        action={<MiniBtn tone="accent" onClick={() => onAddInvoice(clientId)}>+ New invoice</MiniBtn>}>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>#</Th><Th>What</Th><Th align="right">Amount</Th><Th align="right">Issued</Th>
              <Th align="right">Due</Th><Th align="right">Paid</Th><Th>Status</Th><Th />
            </THead>
            <tbody>
              {invoices.length === 0 ? (
                <EmptyRow colSpan={8}>Nothing invoiced yet.</EmptyRow>
              ) : invoices.slice(0, 15).map((i: any) => {
                const overdue = i.status === 'unpaid' && i.dueDate < new Date().toISOString().slice(0, 10)
                return (
                  <Row key={i.id}>
                    <Td mono color="var(--c-text-3)">{i.invoiceNumber}</Td>
                    <Td color="var(--c-text-2)">{i.serviceName ?? i.notes ?? '--'}</Td>
                    <Td align="right" mono className="font-semibold">{fmtView(i.amount)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{formatDate(i.issueDate)}</Td>
                    <Td align="right" mono color={overdue ? 'var(--c-loss)' : 'var(--c-text-3)'}>{formatDate(i.dueDate)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{i.paidDate ? formatDate(i.paidDate) : '--'}</Td>
                    <Td><StatusDot status={overdue ? 'overdue' : i.status} /></Td>
                    <Td align="right">
                      {i.status !== 'paid' && <MiniBtn tone="good" onClick={() => onPay(i.id)}>Mark paid</MiniBtn>}
                    </Td>
                  </Row>
                )
              })}
              {invoices.length > 15 && (
                <EmptyRow colSpan={8}>{invoices.length - 15} older invoices, in the Invoices tab.</EmptyRow>
              )}
            </tbody>
          </table>
        </TablePanel>
      </Section>

      {/* ── Costs ────────────────────────────────────────────────────────── */}
      <Section label="What they cost you" count={costs.length || undefined}
        action={<MiniBtn tone="accent" onClick={() => onAddCost(clientId)}>+ Add cost</MiniBtn>}>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>Description</Th><Th>Vendor</Th><Th align="right">Amount</Th><Th align="right">Date</Th><Th>Type</Th>
            </THead>
            <tbody>
              {costs.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No costs attributed to this client, so their margin reads as pure profit.
                </EmptyRow>
              ) : costs.map((c: any) => (
                <Row key={c.id}>
                  <Td>{c.description}</Td>
                  <Td color="var(--c-text-3)">{c.vendor ?? '--'}</Td>
                  <Td align="right" mono color="var(--c-loss)">{fmtView(c.amount)}</Td>
                  <Td align="right" mono color="var(--c-text-3)">{formatDate(c.date)}</Td>
                  <Td color="var(--c-text-3)">{c.isRecurring ? (c.frequency ?? 'recurring') : 'one-off'}</Td>
                </Row>
              ))}
            </tbody>
          </table>
        </TablePanel>
      </Section>

      {/* ── Notes ────────────────────────────────────────────────────────── */}
      <Section label="Notes" count={meetingNotes.length || undefined}
        action={<MiniBtn tone="accent" onClick={() => onAddNote(clientId)}>+ Add note</MiniBtn>}>
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
          {client.notes && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--c-text-3)' }}>
                What was agreed
              </div>
              <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--c-text-2)' }}>{client.notes}</p>
            </div>
          )}
          {meetingNotes.map((n: any) => (
            <div key={n.id} style={{ borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold" style={{ color: 'var(--c-text-1)' }}>{n.title}</span>
                <span className="text-[10px] num" style={{ color: 'var(--c-text-3)' }}>
                  {n.meetingDate ? formatDate(n.meetingDate) : ''}
                </span>
              </div>
              <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--c-text-2)' }}>{n.content}</p>
            </div>
          ))}
          {!client.notes && meetingNotes.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--c-text-3)' }}>
              Nothing written down for this client yet.
            </p>
          )}
        </div>
      </Section>
    </div>
  )
}
