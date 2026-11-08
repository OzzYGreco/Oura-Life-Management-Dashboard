import { useState } from 'react'
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react'
import { Section } from '../../../components/ui/Section'
import { PageLoader } from '../../../components/ui/Spinner'
import { Th, Td, TablePanel, THead, Row, MiniBtn, StatusDot, Pill, EmptyRow, fmtHours } from '../components/primitives'
import { useClientSummary, useSaveProject, useRemoveMeetingNote, useReactivateClient, useLeftOnPreview, useChangeLeftOn, useClientEvents } from '../../../hooks/useBusiness'
import { RemindButton } from '../modals/GrowthModals'
import { Question, Fold } from '../components/MoneySections'
import { ClientWorth } from '../components/ClientWorth'
import { formatDate } from '../../../lib/utils'
import { STAGES } from '../lib/types'
import type { FmtView } from '../../../hooks/useFmtView'
import type { RetainerAction } from '../components/RetainerTable'

const STAGE_ORDER = ['discovery', 'design', 'build', 'review', 'launched']

/** An empty section is one quiet line, not a table of headers over nothing. */
function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs px-4 py-2.5 rounded-xl"
      style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-3)' }}>
      {children}
    </p>
  )
}

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
  onRetainerAction, onPay, onLogTime, onEditInvoice, onEditProject, onEditNote, onDrop, onComeback,
  onChangePlan, onRecordPayment,
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
  onRetainerAction: (retainer: any, action: RetainerAction) => void
  onPay: (invoice: { id: number; invoiceNumber: string; clientName: string }) => void
  onLogTime: (projectId: number) => void
  onEditInvoice: (invoiceId: number) => void
  onEditProject: (project: any) => void
  onEditNote: (note: any) => void
  onDrop: (client: { id: number; name: string }) => void
  onComeback: (client: { id: number; name: string }) => void
  /** Opens Change plan with this client's live retainers. */
  onChangePlan: (retainers: any[]) => void
  onRecordPayment: (client: { id: number; name: string }) => void
}) {
  const { data, isPending } = useClientSummary(clientId)
  const saveProject = useSaveProject()
  const removeNote = useRemoveMeetingNote()
  const stay = useReactivateClient()
  const [allInvoices, setAllInvoices] = useState(false)
  const [showVoid, setShowVoid] = useState(false)
  const [editLeft, setEditLeft] = useState(false)
  if (isPending || !data) return <PageLoader />

  const { client, economics: e, retainers: rawRetainers, projects, invoices: everyInvoice, costs, meetingNotes } = data
  // The shared retainer modals expect the client name on the row.
  const retainers = rawRetainers.map((r: any) => ({ ...r, clientName: client.name }))
  const churned = client.status === 'churned'
  const voidCount = everyInvoice.filter((i: any) => i.status === 'void').length
  const invoices = everyInvoice.filter((i: any) => showVoid || i.status !== 'void')
  // Bills voided only because the client left. Still real debts: if they pay,
  // the same invoice is marked paid, no new one raised.
  const leftDebts = everyInvoice.filter((i: any) =>
    i.status === 'void' && /client left|written off/i.test(i.voidReason ?? ''))
  const today = new Date().toISOString().slice(0, 10)

  // The plan in one line, so nobody has to read the retainer table to know it.
  const live = retainers.filter((r: any) => r.status === 'active' || r.status === 'paused')
  const per = (f: string) => (f === 'monthly' ? 'mo' : f.replace(/ly$/, ''))
  const since = (d: string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const planParts = live.map((r: any) =>
    r.status === 'paused' ? `${r.serviceName} paused${r.resumeOn ? ` until ${formatDate(r.resumeOn)}` : ''}`
      : r.endDate && r.endDate > today ? `${fmtView(r.amount)}/${per(r.frequency)} for ${r.serviceName} until ${formatDate(r.endDate)}`
      : r.startDate > today ? `${fmtView(r.amount)}/${per(r.frequency)} for ${r.serviceName} from ${formatDate(r.startDate)}`
      : `${fmtView(r.amount)}/${per(r.frequency)} for ${r.serviceName} since ${since(r.startDate)}`)
  const nextDue = live.filter((r: any) => r.status === 'active' && r.nextInvoiceDate)
    .map((r: any) => r.nextInvoiceDate).sort()[0]
  const owes = e.outstanding
  const openInvoices = everyInvoice.filter((i: any) => i.status === 'unpaid' || i.status === 'draft')
  const lateCount = openInvoices.filter((i: any) => i.status === 'unpaid' && i.dueDate < today).length
  const lastPaid = everyInvoice.map((i: any) => i.paidDate).filter(Boolean).sort().at(-1) ?? null

  return (
    <div className="space-y-7">
      <div>
        <div className="mb-3">
          <MiniBtn onClick={onBack}><span className="inline-flex items-center gap-1.5"><ArrowLeft size={12} /> All clients</span></MiniBtn>
        </div>

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
          <p className="text-[13px] mt-2.5" style={{ color: 'var(--c-text-2)' }}>
            {churned ? 'Left' : planParts.length ? <>Pays {planParts.join(' and ')}</> : 'No monthly plan'}
            {nextDue && !churned && <> · next invoice {formatDate(nextDue)}</>}
            {' · '}
            {owes > 0
              ? <span style={{ color: '#f59e0b' }}>owes <span className="num">{fmtView(owes)}</span></span>
              : <span style={{ color: 'var(--c-profit)' }}>owes nothing</span>}
          </p>
        </div>
      </div>

      {/* Everything you do to a client, in one place, always in reach. */}
      <div className="sticky -top-6 z-10 -mx-6 px-6 py-2.5 flex items-center gap-1.5 flex-wrap"
        style={{ background: 'var(--c-bg-primary)', borderBottom: '1px solid var(--c-border)' }}>
        {!churned && (live.length
          ? <MiniBtn tone="accent" onClick={() => onChangePlan(live)}>Change plan</MiniBtn>
          : <MiniBtn tone="accent" onClick={() => onAddRetainer(clientId)}>Add a plan</MiniBtn>)}
        <MiniBtn tone="good" onClick={() => onRecordPayment({ id: client.id, name: client.name })}
          title="Record money they paid, against what they owe or as a new paid invoice">
          Record payment
        </MiniBtn>
        <MiniBtn onClick={() => onAddInvoice(clientId)}>New invoice</MiniBtn>
        <MiniBtn onClick={() => onAddProject(clientId)}>New website</MiniBtn>
        <MiniBtn onClick={() => onAddNote(clientId)}>Add note</MiniBtn>
        <span className="flex-1" />
        <MiniBtn onClick={() => onEdit(client)}>Edit details</MiniBtn>
        {churned
          ? <MiniBtn tone="good" onClick={() => onComeback({ id: client.id, name: client.name })}>They are back...</MiniBtn>
          : <MiniBtn tone="danger" onClick={() => onDrop({ id: client.id, name: client.name })}>Client left...</MiniBtn>}
      </div>

      {!churned && client.leavingOn && (
        <div className="px-4 py-2.5 rounded-xl text-xs flex items-center gap-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--c-text-2)' }}>
          <span className="flex-1">
            Leaving on <b className="num">{formatDate(client.leavingOn)}</b>{client.churnReason ? <>: {client.churnReason}</> : null}.
            They are billed as normal until then, and ended on the day by themselves.
          </span>
          <MiniBtn tone="good" disabled={stay.isPending}
            onClick={() => window.confirm(`Take ${client.name}'s notice back? Their plan carries on with no end date.`) && stay.mutate({ id: client.id })}>
            They are staying
          </MiniBtn>
        </div>
      )}

      {churned && (
        <div className="px-4 py-2.5 rounded-xl text-xs"
          style={{ background: 'var(--c-bg-input)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}>
          Left on <b className="num">{client.churnedAt ? formatDate(client.churnedAt) : 'an unknown date'}</b>
          {client.churnReason ? <>: {client.churnReason}</> : null}.{' '}
          Their retainers are ended and nothing new is billed.
          Anything still owed stays in Outstanding. If they settle a voided bill, mark it paid below: the same invoice is paid, no new one raised.
          <span className="ml-2 inline-block align-middle">
            <MiniBtn onClick={() => setEditLeft(v => !v)}>{editLeft ? 'Keep this date' : 'Change the date'}</MiniBtn>
          </span>
          {editLeft && (
            <LeftOnEditor clientId={client.id} current={client.churnedAt} fmtView={fmtView} onDone={() => setEditLeft(false)} />
          )}
        </div>
      )}

      {e.unbilled > 0 && (
        <div className="px-4 py-2.5 rounded-xl text-xs"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)', color: '#fcd34d' }}>
          <b className="num">{fmtView(e.unbilled)}</b> of agreed work on this client has never been invoiced.
        </div>
      )}

      {/* ── What do they pay? ─────────────────────────────────────────────── */}
      <Question q="What do they pay?"
        answer={churned ? 'Nothing now: they left.' : planParts.length ? <>{planParts.join(' and ')}{nextDue ? <>, next invoice {formatDate(nextDue)}</> : null}.</> : 'No monthly plan.'}
        action={<MiniBtn tone="accent" onClick={() => onAddRetainer(clientId)}><Plus size={13} aria-hidden />Add retainer</MiniBtn>}>
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
                  <Td align="right" mono color="var(--c-accent)">
                    {fmtView(r.amount)}/{r.frequency === 'monthly' ? 'mo' : r.frequency.slice(0, 2)}
                  </Td>
                  <Td align="right" mono color="var(--c-text-3)">{formatDate(r.startDate)}</Td>
                  <Td align="right" mono color="var(--c-text-2)">
                    {r.status === 'active' && r.nextInvoiceDate
                      ? `${formatDate(r.nextInvoiceDate)}${r.endDate ? `, ends ${formatDate(r.endDate)}` : ''}`
                      : r.endDate ? `ended ${formatDate(r.endDate)}`
                      : r.status === 'paused' ? `paused${r.resumeOn ? `, restarts ${formatDate(r.resumeOn)}` : r.pausedAt ? ` ${formatDate(r.pausedAt)}` : ''}` : '--'}
                  </Td>
                  <Td><StatusDot status={r.status} /></Td>
                  <Td align="right">
                    <div className="flex gap-1.5 justify-end">
                      {(() => {
                        // This plan's bills still open, oldest first: paying the plan
                        // from its own row, not hunting for the invoice further down.
                        const due = openInvoices
                          .filter((i: any) => i.retainerId === r.id)
                          .sort((a: any, b: any) => (a.periodStart ?? a.issueDate).localeCompare(b.periodStart ?? b.issueDate))
                        const first = due[0]
                        return first ? (
                          <MiniBtn tone="good"
                            title={`Mark ${first.invoiceNumber} (${fmtView(first.owed)}) paid${due.length > 1 ? `, the oldest of ${due.length} open` : ''}`}
                            onClick={() => onPay({ id: first.id, invoiceNumber: first.invoiceNumber, clientName: client.name })}>
                            Mark {first.invoiceNumber} paid
                          </MiniBtn>
                        ) : null
                      })()}
                      <MiniBtn onClick={() => onRetainerAction(r, 'edit')}>Edit</MiniBtn>
                      {r.status === 'active' && <MiniBtn tone="warn" onClick={() => onRetainerAction(r, 'pause')}>Pause</MiniBtn>}
                      {r.status === 'paused' && <MiniBtn tone="good" onClick={() => onRetainerAction(r, 'resume')}>Resume</MiniBtn>}
                      {r.status !== 'cancelled' && <MiniBtn tone="danger" onClick={() => onRetainerAction(r, 'cancel')}>Cancel</MiniBtn>}
                      {r.status === 'cancelled' && <MiniBtn tone="good" onClick={() => onRetainerAction(r, 'reinstate')}>Reinstate</MiniBtn>}
                    </div>
                  </Td>
                </Row>
              ))}
            </tbody>
          </table>
        </TablePanel>
      </Question>

      {/* ── Are they paid up? ─────────────────────────────────────────────── */}
      <Question q="Are they paid up?"
        answer={owes > 0
          ? <>No: they owe <b className="num" style={{ color: '#f59e0b' }}>{fmtView(owes)}</b> across {openInvoices.length} invoice{openInvoices.length === 1 ? '' : 's'}{lateCount ? <>, <span style={{ color: 'var(--c-loss)' }}>{lateCount} overdue</span></> : null}.</>
          : <>Yes, nothing owed.{lastPaid ? <> Last paid {formatDate(lastPaid)}.</> : null}</>}
        action={<MiniBtn tone="accent" onClick={() => onAddInvoice(clientId)}><Plus size={13} aria-hidden />New invoice</MiniBtn>}>
        {openInvoices.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
            {openInvoices.map((i: any, idx: number) => {
              const late = i.dueDate < today && i.status === 'unpaid'
              return (
                <div key={i.id} className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-white/[0.03]"
                  style={{ borderTop: idx ? '1px solid var(--c-border)' : 'none' }}>
                  <span className="num text-[11px] w-16" style={{ color: 'var(--c-text-3)' }}>{i.invoiceNumber}</span>
                  <span className="flex-1 text-xs truncate" style={{ color: 'var(--c-text-2)' }}>
                    {i.milestoneLabel ? `${i.serviceName ?? 'Website'} - ${i.milestoneLabel.toLowerCase()}` : i.serviceName ?? i.notes ?? '--'}
                  </span>
                  <span className="text-[11px] num" style={{ color: late ? 'var(--c-loss)' : 'var(--c-text-3)' }}>
                    {i.status === 'draft' ? 'not sent' : `${late ? 'was due' : 'due'} ${formatDate(i.dueDate)}`}
                  </span>
                  <span className="text-[13px] font-semibold num w-24 text-right" style={{ color: 'var(--c-text-1)' }}>{fmtView(i.owed)}</span>
                  <span className="flex gap-1.5">
                    {i.status !== 'draft' && <RemindButton invoice={{ id: i.id, invoiceNumber: i.invoiceNumber }} />}
                    <MiniBtn tone="good" onClick={() => onPay({ id: i.id, invoiceNumber: i.invoiceNumber, clientName: client.name })}>Mark paid</MiniBtn>
                    <MiniBtn onClick={() => onEditInvoice(i.id)}>Edit</MiniBtn>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      {/* ── Debts voided when they left ──────────────────────────────────── */}
      {leftDebts.length > 0 && (
        <Section label="Unpaid when they left" count={fmtView(leftDebts.reduce((s: number, i: any) => s + i.amount, 0))}>
          <TablePanel>
            <table className="w-full">
              <THead>
                <Th>#</Th><Th>What</Th><Th align="right">Amount</Th><Th align="right">Issued</Th><Th>Why voided</Th><Th />
              </THead>
              <tbody>
                {leftDebts.map((i: any) => (
                  <Row key={i.id}>
                    <Td mono color="var(--c-text-3)">{i.invoiceNumber}</Td>
                    <Td color="var(--c-text-2)">{i.serviceName ?? i.notes ?? '--'}</Td>
                    <Td align="right" mono className="font-semibold">{fmtView(i.amount)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{formatDate(i.issueDate)}</Td>
                    <Td color="var(--c-text-3)">{i.voidReason}</Td>
                    <Td align="right">
                      <div className="flex gap-1.5 justify-end">
                        <MiniBtn tone="good" onClick={() => onPay({ id: i.id, invoiceNumber: i.invoiceNumber, clientName: client.name })}>
                          Mark paid
                        </MiniBtn>
                        <MiniBtn onClick={() => onEditInvoice(i.id)}>Open</MiniBtn>
                      </div>
                    </Td>
                  </Row>
                ))}
              </tbody>
            </table>
          </TablePanel>
          <p className="text-[11px] mt-2" style={{ color: 'var(--c-text-3)' }}>
            Not counted as owed while they are gone. If they settle up, Mark paid brings the same invoice back as paid.
          </p>
        </Section>
      )}
      </Question>

      {/* ── Are they worth it? ────────────────────────────────────────────── */}
      <Question q="Are they worth it?"
        answer={e.revenue > 0
          ? <><b className="num">{fmtView(e.revenue)}</b> collected{e.since ? <> since {new Date(e.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</> : null}, {fmtView(e.costs)} in costs, so <b className="num" style={{ color: e.marginPct >= 50 ? 'var(--c-profit)' : 'var(--c-loss)' }}>{e.marginPct.toFixed(0)}%</b> is kept.</>
          : 'Nothing collected from them yet.'}>
        <ClientWorth e={e} fmtView={fmtView} />
      </Question>

      {/* ── Everything else, folded ───────────────────────────────────────── */}
      <div className="space-y-2.5">
        <Fold id="client-invoices" title="Every invoice"
          summary={`${everyInvoice.filter((i: any) => i.status !== 'void').length} invoices${voidCount ? ` · ${voidCount} void` : ''}`}
          action={voidCount > 0 ? <MiniBtn onClick={() => setShowVoid(v => !v)}>{showVoid ? 'Hide void' : `Show ${voidCount} void`}</MiniBtn> : undefined}>
        <TablePanel>
          <table className="w-full">
            <THead>
              <Th>#</Th><Th>What</Th><Th align="right">Amount</Th><Th align="right">Issued</Th>
              <Th align="right">Due</Th><Th align="right">Paid</Th><Th>Status</Th><Th />
            </THead>
            <tbody>
              {invoices.length === 0 ? (
                <EmptyRow colSpan={8}>Nothing invoiced yet.</EmptyRow>
              ) : (allInvoices ? invoices : invoices.slice(0, 8)).map((i: any) => {
                const overdue = i.status === 'unpaid' && i.dueDate < today
                const part = i.status === 'unpaid' && i.applied > 0
                const isVoid = i.status === 'void'
                return (
                  <Row key={i.id} dim={isVoid}>
                    <Td mono color="var(--c-text-3)">{i.invoiceNumber}</Td>
                    <Td color="var(--c-text-2)">
                      {i.milestoneLabel ? `${i.serviceName ?? 'Website'} - ${i.milestoneLabel.toLowerCase()}` : i.serviceName ?? i.notes ?? '--'}
                    </Td>
                    <Td align="right" mono className="font-semibold" style={isVoid ? { textDecoration: 'line-through' } : undefined}>
                      {fmtView(i.amount)}
                      {part && <span className="block text-[10px] font-normal" style={{ color: '#38bdf8' }}>{fmtView(i.owed)} left</span>}
                    </Td>
                    <Td align="right" mono color="var(--c-text-3)">{formatDate(i.issueDate)}</Td>
                    <Td align="right" mono color={overdue ? 'var(--c-loss)' : 'var(--c-text-3)'}>{formatDate(i.dueDate)}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{i.paidDate ? formatDate(i.paidDate) : '--'}</Td>
                    <Td><StatusDot status={overdue ? 'overdue' : part ? 'part-paid' : i.status} /></Td>
                    <Td align="right">
                      <div className="flex gap-1.5 justify-end">
                        {i.status !== 'paid' && !isVoid && (
                          <MiniBtn tone="good" onClick={() => onPay({ id: i.id, invoiceNumber: i.invoiceNumber, clientName: client.name })}>
                            {part ? 'Add payment' : 'Mark paid'}
                          </MiniBtn>
                        )}
                        <MiniBtn onClick={() => onEditInvoice(i.id)}>{isVoid ? 'Open' : 'Edit'}</MiniBtn>
                      </div>
                    </Td>
                  </Row>
                )
              })}
              {invoices.length > 8 && (
                <tr>
                  <td colSpan={8} className="px-4 py-2.5 text-center">
                    <MiniBtn onClick={() => setAllInvoices(v => !v)}>
                      {allInvoices ? 'Show the latest 8' : `Show ${invoices.length - 8} older`}
                    </MiniBtn>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TablePanel>
        </Fold>
        <Fold id="client-websites" title="Websites"
          summary={projects.length ? projects.map((p: any) => p.name).join(', ') : 'none'}
          action={<MiniBtn tone="accent" onClick={() => onAddProject(clientId)}><Plus size={13} aria-hidden />Add website</MiniBtn>}>
        {projects.length === 0 ? (
          <EmptyLine>No website for this client.</EmptyLine>
        ) : (
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
                const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(p.stage) + 1]
                const live = p.status === 'active' || p.status === 'paused'
                return (
                  <Row key={p.id} dim={p.status === 'cancelled'}>
                    <Td><span className="font-medium">{p.name}</span></Td>
                    <Td>
                      <Pill color={p.status === 'paused' ? '#f59e0b' : p.status === 'cancelled' ? 'var(--c-text-3)' : stage?.color ?? 'var(--c-text-3)'}>
                        {p.status === 'paused' || p.status === 'cancelled' ? p.status : stage?.label ?? p.stage}
                      </Pill>
                    </Td>
                    <Td align="right" mono>{p.value ? fmtView(p.value) : '--'}</Td>
                    <Td align="right" mono color={p.collected ? 'var(--c-profit)' : 'var(--c-text-3)'}>
                      {p.collected ? fmtView(p.collected) : '--'}
                    </Td>
                    <Td align="right" mono color="var(--c-text-3)">{fmtHours(p.hours)}</Td>
                    <Td align="right" mono color="var(--c-text-2)">{rate ? `${fmtView(rate)}/h` : '--'}</Td>
                    <Td align="right" mono color="var(--c-text-3)">{p.dueDate ? formatDate(p.dueDate) : '--'}</Td>
                    <Td align="right">
                      <div className="flex gap-1.5 justify-end">
                        {live && nextStage && (
                          <MiniBtn tone="accent" disabled={saveProject.isPending}
                            title={`Move to ${nextStage}`}
                            onClick={() => saveProject.mutate({
                              id: p.id, stage: nextStage,
                              ...(nextStage === 'launched' ? { launchedDate: today, status: 'completed' } : {}),
                            })}>
                            {nextStage === 'launched' ? 'Launched' : `To ${nextStage}`}
                          </MiniBtn>
                        )}
                        {live && <MiniBtn onClick={() => onLogTime(p.id)}>Log hours</MiniBtn>}
                        <MiniBtn onClick={() => onEditProject(p)}>Edit</MiniBtn>
                      </div>
                    </Td>
                  </Row>
                )
              })}
            </tbody>
          </table>
        </TablePanel>
        )}
        </Fold>
        <Fold id="client-costs" title="What they cost you"
          summary={costs.length ? `${fmtView(e.costs)} across ${costs.length} cost${costs.length === 1 ? '' : 's'}` : 'nothing attributed'}
          action={<MiniBtn tone="accent" onClick={() => onAddCost(clientId)}><Plus size={13} aria-hidden />Add cost</MiniBtn>}>
        {costs.length === 0 ? (
          <EmptyLine>No costs attributed, so their margin reads as pure profit.</EmptyLine>
        ) : (
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
        )}
        </Fold>
        <Fold id="client-notes" title="Notes"
          summary={meetingNotes.length ? `${meetingNotes.length} note${meetingNotes.length === 1 ? '' : 's'}` : client.notes ? 'what was agreed' : 'nothing written down'}
          action={<MiniBtn tone="accent" onClick={() => onAddNote(clientId)}><Plus size={13} aria-hidden />Add note</MiniBtn>}>
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
                <span className="flex items-baseline gap-2">
                  <span className="text-[10px] num" style={{ color: 'var(--c-text-3)' }}>
                    {n.meetingDate ? formatDate(n.meetingDate) : ''}
                  </span>
                  <MiniBtn onClick={() => onEditNote(n)}>Edit</MiniBtn>
                  <MiniBtn tone="danger" onClick={() => { if (window.confirm(`Delete the note "${n.title}"?`)) removeNote.mutate(n.id) }}>Delete</MiniBtn>
                </span>
              </div>
              <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--c-text-2)' }}>{n.content}</p>
            </div>
          ))}
          {!client.notes && meetingNotes.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Nothing written down yet.</p>
          )}
        </div>
        </Fold>
        <ClientHistory clientId={clientId} />
      </div>
    </div>
  )
}

/**
 * What changed for this client and when, newest first: plan and price
 * changes, pauses, leaving and coming back, payments moved or given back,
 * bills voided or settled. Recorded from the day this was added.
 */
function ClientHistory({ clientId }: { clientId: number }) {
  const { data: events = [] } = useClientEvents(clientId)
  const [all, setAll] = useState(false)
  const shown = all ? events : events.slice(0, 12)
  return (
    <Fold id="client-history" title="History"
      summary={events.length ? `${events.length} change${events.length === 1 ? '' : 's'}, last on ${formatDate(events[0].at.slice(0, 10))}` : 'nothing changed since history began'}>
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border)' }}>
        {events.length === 0 ? (
          <p className="px-4 py-5 text-xs" style={{ color: 'var(--c-text-3)' }}>
            Changes made from now on (price, plan, pauses, leaving, payments moved) are listed here.
          </p>
        ) : shown.map((e, i) => (
          <div key={e.id} className="flex gap-4 px-4 py-2 text-[12px]" style={{ borderTop: i ? '1px solid rgba(255,255,255,0.045)' : 'none' }}>
            <span className="num w-24 shrink-0" style={{ color: 'var(--c-text-3)' }}>{formatDate(e.at.slice(0, 10))}</span>
            <span style={{ color: 'var(--c-text-2)' }}>{e.summary}</span>
          </div>
        ))}
        {events.length > 12 && (
          <div className="px-4 py-2" style={{ borderTop: '1px solid var(--c-border)' }}>
            <MiniBtn onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${events.length}`}</MiniBtn>
          </div>
        )}
      </div>
    </Fold>
  )
}

/**
 * Move the day a client left. The preview says what follows from it before
 * anything is saved: their retainers move with it, bills for after the new day
 * are voided, and ones voided only for falling after the old day come back.
 */
function LeftOnEditor({ clientId, current, fmtView, onDone }: {
  clientId: number; current: string | null; fmtView: FmtView; onDone: () => void
}) {
  const [date, setDate] = useState(current ?? '')
  const changed = !!date && date !== current
  const { data: plan, error } = useLeftOnPreview(clientId, changed ? date : null)
  const save = useChangeLeftOn()
  const [saveError, setSaveError] = useState<string | null>(null)
  const list = (xs: { invoiceNumber: string; amount: number }[]) => xs.map(i => `${i.invoiceNumber} (${fmtView(i.amount)})`).join(', ')

  return (
    <div className="mt-2.5 pt-2.5 flex flex-wrap items-end gap-3" style={{ borderTop: '1px solid var(--c-border)' }}>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--c-text-3)' }}>Last day as a client</span>
        <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)}
          className="rounded-md px-2 py-1.5 text-xs num outline-none"
          style={{ background: 'var(--c-bg-card)', border: '1px solid var(--c-border-mid)', color: 'var(--c-text-1)' }} />
      </label>
      <p className="flex-1 min-w-[16rem] text-[11.5px]" style={{ color: 'var(--c-text-2)' }}>
        {!changed ? 'Pick the day they really left.'
          : error ? <span style={{ color: 'var(--c-loss)' }}>{(error as any)?.response?.data?.error ?? 'That date does not work'}</span>
          : !plan ? 'Working out what this changes...'
          : <>
              Churn moves to {formatDate(plan.to)}
              {plan.retainers.length ? <>, and {plan.retainers.map(r => r.name).join(', ')} end{plan.retainers.length === 1 ? 's' : ''} that day too</> : null}.
              {plan.voided.length ? <> Voids {list(plan.voided)}, billed for after it.</> : null}
              {plan.restored.length ? <> {list(plan.restored)} {plan.restored.length === 1 ? 'is' : 'are'} owed again, since {plan.restored.length === 1 ? 'it falls' : 'they fall'} before it.</> : null}
            </>}
        {saveError && <span className="block" style={{ color: 'var(--c-loss)' }}>{saveError}</span>}
      </p>
      <MiniBtn tone="accent" disabled={!plan || !changed || save.isPending}
        onClick={async () => {
          setSaveError(null)
          try { await save.mutateAsync({ id: clientId, date }); onDone() }
          catch (e: any) { setSaveError(e?.response?.data?.error ?? 'Could not save that') }
        }}>
        {save.isPending ? 'Saving...' : 'Save'}
      </MiniBtn>
    </div>
  )
}
