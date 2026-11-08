import { useNavigate } from 'react-router-dom'
import { useForecast, usePaymentStatus, useSyncPayments } from '../../../hooks/useBusiness'
import { useMilestones } from '../../../core/goals'
import type { FmtView } from '../../../hooks/useFmtView'
import { MiniBtn, fmtMonth } from './primitives'

const longDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/**
 * Three things worth one glance under the figures: what the rest of this month
 * should leave, how the MRR goal on the Roadmap is pacing, and when Stripe
 * payments last came in (with Sync now).
 */
export function AtAGlance({ fmtView }: { fmtView: FmtView }) {
  const navigate = useNavigate()
  const { data: f } = useForecast(3)
  const { data: goals } = useMilestones()
  const { data: stripe } = usePaymentStatus()
  const sync = useSyncPayments()

  // Next month at a glance: the first forecast month, usually what is left of this one.
  const m0 = f?.months[0]
  const thisMonth = new Date().toISOString().slice(0, 7)
  const monthLabel = m0 ? (m0.month === thisMonth ? `Rest of ${fmtMonth(m0.month)}` : fmtMonth(m0.month)) : 'Next month'
  const inflow = m0 ? m0.retainers + m0.owed + m0.stages : 0
  const outflow = m0 ? m0.costs + m0.ads : 0

  // The nearest open milestone measured by Business MRR.
  const goal = goals?.milestones
    .filter(g => g.status === 'open' && g.measure === 'business_mrr')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  const behind = goal && (goal.pace === 'behind' || goal.overdue)

  const facts = [
    {
      key: 'next',
      label: monthLabel,
      value: m0 ? fmtView(m0.net) : '–',
      color: m0 && m0.net < 0 ? 'var(--c-loss)' : 'var(--c-text-1)',
      sub: m0 ? <>{fmtView(inflow)} in, {fmtView(outflow)} out{f && f.lateOwed > 0 ? <>, {fmtView(f.lateOwed)} already late</> : null}</> : 'Loading the forecast',
      action: <button type="button" className="bz-lnk" onClick={() => navigate('/business/money')}>Full forecast</button>,
    },
    {
      key: 'goal',
      label: 'MRR goal',
      value: goal ? <>{fmtView(goal.targetValue ?? 0)} by {longDate(goal.dueDate)}</> : 'Not set',
      color: undefined,
      sub: goal
        ? <span style={{ color: behind ? 'var(--c-warn)' : 'var(--c-profit)' }}>
            {goal.met ? 'Reached' : behind ? 'Behind pace' : goal.pace === 'ahead' ? 'Ahead of pace' : 'On pace'}
            {!goal.met && goal.neededPerMonth != null && goal.neededPerMonth > 0 ? <>, needs +{fmtView(goal.neededPerMonth)} a month</> : null}
          </span>
        : 'Set an MRR milestone and this tracks it',
      action: <button type="button" className="bz-lnk" onClick={() => navigate('/goals?horizon=roadmap')}>{goal ? 'Open the roadmap' : 'Set one on the Roadmap'}</button>,
    },
    {
      key: 'stripe',
      label: 'Stripe payments',
      value: !stripe ? '–' : !stripe.connected ? 'Not connected' : stripe.latestDate ? <>Last in {longDate(stripe.latestDate)}</> : 'None yet',
      color: stripe && !stripe.connected ? 'var(--c-warn)' : undefined,
      sub: !stripe ? '' : !stripe.connected ? stripe.note
        : <>{stripe.payments} payments, {stripe.unmatched ? <span style={{ color: 'var(--c-warn)' }}>{stripe.unmatched} to assign</span> : 'all assigned'}</>,
      action: stripe?.connected
        ? <MiniBtn onClick={() => sync.mutate(45)} disabled={sync.isPending} title="Fetch the last 45 days of Stripe payments">{sync.isPending ? 'Syncing…' : 'Sync now'}</MiniBtn>
        : null,
    },
  ]

  return (
    <div className="bz-glance" aria-label="At a glance">
      {facts.map(x => (
        <div key={x.key}>
          <span className="l">{x.label}</span>
          <b className="v num" style={{ color: x.color }}>{x.value}</b>
          <span className="s">{x.sub}</span>
          {x.action && <span className="a">{x.action}</span>}
        </div>
      ))}
    </div>
  )
}
