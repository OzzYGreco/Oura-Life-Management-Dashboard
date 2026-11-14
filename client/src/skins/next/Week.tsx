/**
 * Week, the one-layout redesign (approved 2026-11-08). The scorecard is the
 * hero; the record, slipping goals, the honesty check and next week sit around
 * it on the shared 3-column grid. Data and actions come from core/week.ts; the
 * composer, settings sheet, score segments and past list are shared with the
 * Whoop page.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SOURCES, fmtRange, horizonInfo, periodLabel, periodName, pts,
  useClosePeriod, useDeletePeriod, useGoalsSettings, useMigrateGoalsSettings,
  useReopenPeriod, useScoreTask, useTaskSource, useWeek, useWeekGoal,
  type Horizon, type HistoryItem,
} from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { copyScorecard, getSignature, type ScorecardTheme } from '../../core/scorecardImage'
import { Composer, PastList, SegScore, SettingsSheet, type Compose, type Ctx } from '../whoop/Week'
import { Roadmap } from './Roadmap'
import '../whoop/week.css'
import './next.css'
import './week.css'

const H_KEY = 'oura-week-horizon'
const VIEW_KEY = 'oura-week-view'
/** Weekly and monthly are points periods; yearly and 3-year goals live on the Roadmap as milestones. */
type Tab = 'weekly' | 'monthly' | 'roadmap'
const TABS: { value: Tab; label: string }[] = [{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'roadmap', label: 'Roadmap' }]
function readTab(): Tab {
  const q = new URLSearchParams(window.location.search).get('horizon')
  const pick = (v: string | null): Tab | null => v === 'roadmap' || v === 'yearly' || v === '3yr' ? 'roadmap' : v === 'weekly' || v === 'monthly' ? v : null
  const fromUrl = pick(q)
  if (fromUrl) return fromUrl
  try { const v = pick(localStorage.getItem(H_KEY)); if (v) return v } catch { /* private mode */ }
  return 'weekly'
}

/** A period counts as done once its dates have passed or it was closed by hand. */
const finished = (h: HistoryItem) => !h.current || !!h.closed
const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

const Check = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden><path d="M2.5 6.3l2.2 2.1 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

function Head({ children, aside, to }: { children: React.ReactNode; aside?: React.ReactNode; to?: string }) {
  const nav = useNavigate()
  return (
    <div className="nx-head">
      {to
        ? <button className="nx-h" onClick={() => nav(to)}>{children}
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        : <h2 className="nx-h">{children}</h2>}
      {aside && <div className="nx-aside">{aside}</div>}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function NextWeek() {
  const [tab, setTab] = useState<Tab>(readTab)
  const horizon: Horizon = tab === 'monthly' ? 'monthly' : 'weekly'
  const H = horizonInfo(horizon)
  const gs = useGoalsSettings()
  useMigrateGoalsSettings(gs)
  const rules = gs.settings[horizon]
  const { data, isPending } = useWeek(horizon)
  const [pick, setPick] = useState<number | null>(null)
  const [compose, setCompose] = useState<Compose | null>(() => new URLSearchParams(window.location.search).get('plan') === '1' ? { mode: 'next' } : null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<'bars' | 'list'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'bars' } catch { return 'bars' } })
  const chooseView = (v: 'bars' | 'list') => { setView(v); try { localStorage.setItem(VIEW_KEY, v === 'list' ? 'list' : 'tiles') } catch { /* private mode */ } }

  const switchTo = (v: Tab) => {
    setTab(v); setPick(null); setCompose(null)
    try { localStorage.setItem(H_KEY, v) } catch { /* private mode */ }
  }

  return (
    <div className="wh-page nx nw skin-enter">
      <div className="nx-wrap">
        <div className="nw-bar">
          <div className="nw-hz" role="tablist" aria-label="Horizon">
            {TABS.map(x => (
              <button key={x.value} role="tab" aria-selected={tab === x.value} className={tab === x.value ? 'on' : ''} onClick={() => switchTo(x.value)}>{x.label}</button>
            ))}
          </div>
          {tab !== 'roadmap' && <span className="nw-rule">A {H.unit} is beaten at <b className="num">{pts(rules.threshold)}</b> of <b className="num">{pts(rules.max)}</b></span>}
          <button className="nx-btn ghost sm nw-set" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>

        {tab === 'roadmap' ? <Roadmap /> : isPending || !data ? <PageLoader /> : (() => {
          const ctx: Ctx = { data, horizon, H, rules }
          const cur = data.current
          const known = (id: number) => data.history.some(h => h.id === id) || data.next?.id === id
          const selected = pick != null && known(pick) ? pick : cur?.id ?? data.history[data.history.length - 1]?.id ?? null
          const editCur = () => cur && setCompose({ mode: 'edit', goal: cur, name: periodName(horizon, cur.from, cur.to, data.history.findIndex(h => h.id === cur.id) + 1) })
          return <>
            <div className="nx-top">
              {selected != null
                ? <Scorecard key={selected} ctx={ctx} id={selected} onCompose={setCompose} onDeleted={() => setPick(null)} />
                : <NoCurrent ctx={ctx} onSet={() => setCompose({ mode: 'current' })} />}
              <Record ctx={ctx} selected={selected} onPick={setPick} view={view} onView={chooseView} />
            </div>
            {/* Next period, once set, gets the same card as this one: to read, change and copy for accountability. */}
            {data.next && selected !== data.next.id && (
              <div className="nx-top nw-nextrow">
                <Scorecard key={`next-${data.next.id}`} ctx={ctx} id={data.next.id} onCompose={setCompose} onDeleted={() => setPick(null)} />
                <Honesty ctx={ctx} onEdit={editCur} />
              </div>
            )}
            {selected != null && !cur && (
              <div className="nw-nocur"><NoCurrent ctx={ctx} onSet={() => setCompose({ mode: 'current' })} inline /></div>
            )}
            {view === 'list' && <section className="nx-sec"><Head>Every {H.unit}</Head><PastList ctx={ctx} selected={selected} onPick={id => { setPick(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }} /></section>}
            {!(data.next && selected !== data.next.id) && (
              <div className="nw-under">
                <NextPeriod ctx={ctx} onOpen={() => setCompose({ mode: 'next' })} />
                <Honesty ctx={ctx} onEdit={editCur} />
              </div>
            )}
            {compose && (compose.mode !== 'next' || data.nextStart) && (
              <Composer ctx={ctx} compose={compose} onClose={() => setCompose(null)} onSaved={id => id != null && setPick(id)} />
            )}
          </>
        })()}
      </div>
      {settingsOpen && <SettingsSheet settings={gs.settings} onSave={s => gs.save.mutate(s)} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

// ─── The scorecard: the hero ─────────────────────────────────────────────────

const THEME: ScorecardTheme = {
  bg: '#0B0E14', card: '#121722', line: 'rgba(255,255,255,.08)', ink: '#ECEFF4', ink2: '#B4BCC9', mute: '#7F8899',
  good: '#6FD3A0', warn: '#E9B65E', bad: '#EC7C6E', track: 'rgba(255,255,255,.07)', chip: 'rgba(111,211,160,.12)',
  font: 'system-ui, -apple-system, sans-serif', display: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif',
}

function Scorecard({ ctx, id, onCompose, onDeleted }: { ctx: Ctx; id: number; onCompose: (c: Compose) => void; onDeleted: () => void }) {
  const { data, H, rules, horizon } = ctx
  const isCurrent = data.current?.id === id
  const isNext = data.next?.id === id
  const live = isCurrent && !data.current!.closed
  const past = useWeekGoal(isCurrent ? null : id)
  const close = useClosePeriod()
  const reopen = useReopenPeriod()
  const del = useDeletePeriod()
  const score = useScoreTask()
  const setSource = useTaskSource()
  const [copied, setCopied] = useState<string | null>(null)
  const [typing, setTyping] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const idx = isNext ? data.history.length + 1 : data.history.findIndex(h => h.id === id) + 1
  const goal = isCurrent ? data.current! : past.data
  if (!goal) return <section className="nx-hero nw-hero"><PageLoader /></section>

  const name = periodName(horizon, goal.from, goal.to, idx)
  const coach = live ? data.current!.live.coach : null
  let rows = goal.tasks.map(t => {
    const lv = live ? data.current!.live.tasks.find(x => x.id === t.id) : undefined
    const auto = t.source !== 'manual'
    return { ...t, auto, score: auto && live ? (lv?.earned ?? t.earnedPoints) : t.earnedPoints, note: lv?.note ?? null }
  })
  // The task worth the most right now leads, with its caption, as on Today.
  const lever = coach ? rows.find(r => coach.includes(r.title)) ?? null : null
  if (lever) rows = [lever, ...rows.filter(r => r !== lever)]
  const total = rows.reduce((s, r) => s + (r.score ?? 0), 0)
  const max = rows.reduce((s, r) => s + r.maxPoints, 0)
  const pct = max ? total / max : 0
  const rewards = [...goal.rewards].sort((a, b) => a.minScore - b.minScore)
  const reached = [...rewards].reverse().find(r => total >= r.minScore)
  const next = rewards.find(r => total < r.minScore)
  const t = rules.threshold
  const beaten = total >= t
  const editable = !isNext
  const handRows = rows.map((r, i) => (editable && !r.auto ? i : -1)).filter(i => i >= 0)
  const typeNext = (i: number) => setTyping(handRows.find(j => j > i) ?? null)

  const [state, tone] = isNext ? [`${name}, starts ${longDay(goal.from)}`, '']
    : live ? (beaten ? [`${name}, beaten`, 'good'] : [`${name}, ${pts(t - total)} to beat it`, ''])
    : beaten ? [`${name}, beaten`, 'good'] : [`${name}, missed by ${pts(t - total)}`, '']

  const copy = async () => {
    const how = await copyScorecard({
      weekNo: idx, period: name, from: goal.from, to: goal.to, focus: goal.focus,
      tasks: rows.map(r => ({ title: r.title, max: r.maxPoints, score: r.score })),
      rewards, signature: getSignature(), plan: isNext,
    }, THEME)
    setCopied(how === 'copied' ? 'Copied. Paste it wherever you report.' : 'Saved as an image in Downloads.')
    setTimeout(() => setCopied(null), 3500)
  }
  const onError = (e: unknown) => setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'That did not save. Try again.')

  return (
    <section className="nx-hero nw-hero" aria-label={`${name} scorecard`}>
      <div className="nw-top">
        <div>
          <p className={`nx-state ${tone}`}>{state}</p>
          <h1 className="nw-focus">{goal.focus || `This ${H.unit}`}</h1>
          <p className="nw-dates num">{fmtRange(goal.from, goal.to)}</p>
        </div>
        <div className="nw-total">
          {isNext
            ? <div><span className="nw-big num">{pts(max)}</span><span className="nw-of"> pts on offer</span></div>
            : <div><span className={`nw-big num ${beaten ? 'good' : ''}`}>{pts(total)}</span><span className="nw-of num"> of {pts(max)}</span></div>}
          <p className="nw-cap">
            {reached && <span className="good">{reached.reward} earned</span>}
            {reached && next && ', '}
            {next && !isNext && <><span className="num">{pts(next.minScore - total)}</span> to go for {next.reward}</>}
          </p>
        </div>
      </div>

      <div className="nw-prog" aria-hidden>
        <div className="track"><b className={beaten && !isNext ? 'good' : ''} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
        {rewards.map(r => <i key={r.minScore} className={`rung ${total >= r.minScore ? 'got' : ''}`} style={{ left: `${Math.min(100, max ? (r.minScore / max) * 100 : 0)}%` }} />)}
        {max > 0 && t > 0 && t <= max && <i className="beat" style={{ left: `${(t / max) * 100}%` }} title={`${pts(t)} beats the ${H.unit}`} />}
      </div>
      {rewards.length > 0 && (
        <div className="nx-ladder nw-ladder">
          {rewards.map(r => (
            <span key={r.minScore} className={total >= r.minScore ? 'got' : next?.minScore === r.minScore ? 'next' : ''}>
              <span className="num">{pts(r.minScore)}</span> {r.reward}{total >= r.minScore && <Check size={9} />}
            </span>
          ))}
        </div>
      )}

      <div className="nw-rows" role="table" aria-label="Tasks and scores">
        {rows.map((r, i) => {
          const src = SOURCES.find(s => s.value === r.source)
          const full = r.score != null && r.score >= r.maxPoints
          return (
            <div key={r.id ?? r.title} className={`nw-row ${lever === r ? 'lever' : ''}`} role="row">
              <div className="nm">
                <span>{r.title}</span>
                {lever === r
                  ? <small className="lv">Biggest lever, <span className="num">+{pts(r.maxPoints - (r.score ?? 0))}</span> still open</small>
                  : r.auto && <small>auto, {src?.label.toLowerCase()}{r.note ? `, ${r.note}` : ''}
                      {editable && <button className="nw-link" onClick={() => r.id && setSource.mutate({ id: r.id, source: 'manual' })}>Score by hand</button>}</small>}
                {r.up && <small className="up">Serves {r.up}</small>}
              </div>
              {editable && !r.auto ? (
                <SegScore value={r.score} max={r.maxPoints} busy={score.isPending} title={r.title}
                  typing={typing === i} onTyping={on => setTyping(on ? i : null)} onNext={() => typeNext(i)}
                  onSet={v => r.id && score.mutate({ id: r.id, earnedPoints: v })} />
              ) : (
                <span className="nw-auto">
                  <span className="nx-mini"><b className={full ? 'full' : ''} style={{ width: `${r.maxPoints ? Math.min(100, ((r.score ?? 0) / r.maxPoints) * 100) : 0}%` }} /></span>
                  <b className={`num ${full ? 'good' : ''}`}>{r.score == null ? '–' : pts(r.score)}</b>
                </span>
              )}
              <span className="mx num">/ {pts(r.maxPoints)}</span>
            </div>
          )
        })}
      </div>

      {isCurrent && !live && !data.next && (
        <div className="nw-closed" role="status">
          <span>{name} is closed at <b className="num">{pts(total)}</b>.</span>
          <button className="nx-btn sm" onClick={() => onCompose({ mode: 'next' })}>Set up next {H.unit}</button>
        </div>
      )}

      <div className="nw-foot">
        <span className="nw-hint">
          {copied ?? err ?? (editable ? 'Tap a segment, or type in the box on the right. Enter moves to the next task.' : `Scoring opens when the ${H.unit} starts.`)}
        </span>
        <div className="nx-acts">
          <button className="nx-btn" onClick={copy}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="5" width="9" height="9" rx="2" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
            Copy as image
          </button>
          {isNext
            ? <button className="nx-btn ghost" onClick={() => onCompose({ mode: 'next' })}>Change</button>
            : <button className="nx-btn ghost" onClick={() => onCompose({ mode: 'edit', goal, name })}>Edit</button>}
          {live && <button className="nx-btn ghost" disabled={close.isPending} onClick={() => { setErr(null); close.mutate(goal.id, { onError }) }} title={`Close ${name} now and freeze its score`}>Mark complete</button>}
          {isCurrent && !live && <button className="nx-btn ghost" disabled={reopen.isPending} onClick={() => { setErr(null); reopen.mutate(goal.id, { onError }) }}>Reopen</button>}
          {!confirmDel
            ? <button className="nw-del" onClick={() => setConfirmDel(true)} aria-label={`Delete ${name}`}>Delete</button>
            : <span className="nw-confirm" role="group" aria-label="Confirm delete">
                <span>Delete {name} and its scores?</span>
                <button className="nw-del on" disabled={del.isPending} onClick={() => del.mutate(goal.id, { onSuccess: onDeleted, onError })}>Delete</button>
                <button className="nx-link" onClick={() => setConfirmDel(false)}>Keep</button>
              </span>}
        </div>
      </div>
    </section>
  )
}

function NoCurrent({ ctx, onSet, inline }: { ctx: Ctx; onSet: () => void; inline?: boolean }) {
  const { data, H, horizon } = ctx
  const p = data.period
  const body = (
    <>
      <div>
        <p className="nx-state">{p ? periodName(horizon, p.from, p.to, data.history.length + 1) : `This ${H.unit}`}{p ? `, ${fmtRange(p.from, p.to)}` : ''}</p>
        <h1 className="nw-focus">No goals for this {H.unit} yet</h1>
        <p className="nw-dates">{data.suggestions.tasks.length ? 'Pick from your recent goals or type new ones.' : 'Type the goals and give each its points.'}</p>
      </div>
      <div className="nx-acts"><button className="nx-btn" onClick={onSet}>Set this {H.unit}</button></div>
    </>
  )
  return inline ? <div className="nw-inline">{body}</div> : <section className="nx-hero nw-hero nw-empty">{body}</section>
}

// ─── Record: streak, win rate, best, and one bar per period ──────────────────

function Record({ ctx, selected, onPick, view, onView }: {
  ctx: Ctx; selected: number | null; onPick: (id: number) => void
  view: 'bars' | 'list'; onView: (v: 'bars' | 'list') => void
}) {
  const { data, H, rules, horizon } = ctx
  const t = rules.threshold
  const done = data.history.filter(finished)
  const beat = (h: HistoryItem) => h.score >= t
  let streak = 0
  for (let i = done.length - 1; i >= 0 && beat(done[i]); i--) streak++
  const won = done.filter(beat).length
  const best = done.reduce((m, h) => Math.max(m, h.score), 0)
  const recent = data.history.slice(-12)
  const offset = data.history.length - recent.length
  const maxAll = Math.max(rules.max, ...recent.map(h => h.max))

  return (
    <section className="nx-sec nw-record">
      <Head aside={<span className="num">{done.length} {done.length === 1 ? H.unit : H.units}</span>}>Record</Head>
      <div className="nw-stats">
        <div><span>Streak</span><b className="num">{done.length ? streak : '–'}</b></div>
        <div><span>Win rate</span><b className={`num ${done.length ? 'good' : ''}`}>{done.length ? `${Math.round((won / done.length) * 100)}%` : '–'}</b>{done.length > 0 && <em className="num">{won} of {done.length}</em>}</div>
        <div><span>Best</span><b className="num">{done.length ? pts(best) : '–'}</b></div>
      </div>

      {recent.length > 0 ? (
        <div className="nw-bars" role="listbox" aria-label={`Last ${recent.length} ${H.units}`}>
          <i className="beat" style={{ bottom: `${(t / maxAll) * 100}%` }} aria-hidden />
          {recent.map((h, i) => {
            const st = !finished(h) ? 'cur' : beat(h) ? 'won' : 'lost'
            const label = periodLabel(horizon, h.from, h.to, offset + i + 1)
            return (
              <button key={h.id} role="option" aria-selected={selected === h.id} onClick={() => onPick(h.id)}
                className={`${st} ${selected === h.id ? 'on' : ''}`}
                title={`${periodName(horizon, h.from, h.to, offset + i + 1)}, ${fmtRange(h.from, h.to)}: ${pts(h.score)} of ${pts(h.max)}${h.reward ? `, ${h.reward}` : ''}`}>
                <span className="col"><span className="fill" style={{ height: `${Math.max(3, (h.score / maxAll) * 100)}%` }} /></span>
                <span className="lb num">{label.replace(/^W/, '')}</span>
              </button>
            )
          })}
          {data.next && (
            <button role="option" aria-selected={selected === data.next.id} onClick={() => onPick(data.next!.id)} className={`nxt ${selected === data.next.id ? 'on' : ''}`} title={`Next ${H.unit}, ${fmtRange(data.next.from, data.next.to)}`}>
              <span className="col"><span className="fill" /></span>
              <span className="lb">Next</span>
            </button>
          )}
        </div>
      ) : <p className="nx-answer">No {H.units} recorded yet. Set this {H.unit}'s goals to start your record.</p>}
      {recent.length > 0 && <p className="nw-barcap">Last {recent.length} {H.units}. The line marks {pts(t)}, a beaten {H.unit}. Click a bar to open it.</p>}

      {done.length > 0 && <Slipping ctx={ctx} />}
      <Earned ctx={ctx} />
      {data.history.length > 0 && <div className="nw-lines">
        <div className="nx-line">
          <span className="k">Every {H.unit}</span>
          <span className="v">
            <span className="nw-seg" role="group" aria-label={`Show every ${H.unit}`}>
              <button className={view === 'bars' ? 'on' : ''} aria-pressed={view === 'bars'} onClick={() => onView('bars')}>Hide</button>
              <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => onView('list')}>As a list</button>
            </span>
          </span>
        </div>
      </div>}
    </section>
  )
}

// ─── The row under the hero ──────────────────────────────────────────────────

/** How often each reward was earned across every finished period: the record you can feel. */
function Earned({ ctx }: { ctx: Ctx }) {
  const { data, H } = ctx
  const counts = new Map<string, number>()
  for (const h of data.history) if (finished(h) && h.reward) counts.set(h.reward, (counts.get(h.reward) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (!top.length) return null
  return (
    <div className="nw-slip">
      <div className="nw-sub"><span>Rewards earned</span><em>all {H.units}</em></div>
      <div className="nw-chips">
        {top.map(([r, n]) => <span key={r} className="nx-chip">{r}<em className="faint num"> ×{n}</em></span>)}
      </div>
    </div>
  )
}

/** Goals whose average over the last 12 periods is under 90%, part of the record. */
function Slipping({ ctx }: { ctx: Ctx }) {
  const { data, H } = ctx
  const slip = data.trends.filter(t => t.avg < 90).slice(0, 3)
  return (
    <div className="nw-slip">
      <div className="nw-sub"><span>Keeps slipping</span><em>last 12 {H.units}</em></div>
      {slip.length === 0
        ? <p className="nx-answer" style={{ marginTop: 6 }}>Nothing is slipping. Every goal averages 90% or more.</p>
        : slip.map(t => (
            <div key={t.title} className="nx-line">
              <span className="k">{t.title}<em className="mute num">{t.weeks} {H.units}</em></span>
              <span className="v">
                <span className="dots" aria-label={`Recent: ${t.recent.join('%, ')}%`}>
                  {t.recent.slice(-8).map((p, i) => <i key={i} className={p >= 90 ? 'g' : p >= 50 ? 'w' : 'b'} />)}
                </span>
                <b className={`num ${t.avg >= 70 ? '' : 'warn'}`}>{t.avg}%</b>
              </span>
            </div>
          ))}
    </div>
  )
}

/** The hand score for "daily tasks" next to what the routine data said the same weeks. */
function Honesty({ ctx, onEdit }: { ctx: Ctx; onEdit: () => void }) {
  const { data, horizon } = ctx
  const both = data.history.filter(h => h.dailyPct != null && h.dayAvg != null)
  const hand = both.length ? Math.round(both.reduce((s, h) => s + h.dailyPct!, 0) / both.length) : 0
  const real = both.length ? Math.round(both.reduce((s, h) => s + h.dayAvg!, 0) / both.length) : 0
  const fromRoutine = data.current?.tasks.some(t => t.source === 'checklist')
  return (
    <section className="nx-sec">
      <Head>Hand score vs your data</Head>
      {horizon !== 'weekly' ? <p className="nx-answer">Compared on the weekly view, where daily tasks are scored.</p>
        : both.length < 3 ? <p className="nx-answer">Needs 3 weeks with both a hand score and routine days to compare.</p>
        : hand - real < 15 ? <p className="nx-answer">Your hand scores match your routine: <b className="num">{hand}%</b> by hand, routine <b className="num">{real}</b>.</p>
        : <>
            <div className="nx-figs two">
              <div><span>Daily tasks, by hand</span><b className="num">{hand}%</b><em>over {both.length} weeks</em></div>
              <div><span>Your routine said</span><b className="num warn">{real}</b><em>average day score</em></div>
            </div>
            <p className="nw-note">{fromRoutine
              ? 'From this week it scores itself from your routine, so both tell the same story.'
              : 'Let it score itself from your routine: Edit, then set the source to "From your routine".'}</p>
            {!fromRoutine && data.current && <div className="nx-acts" style={{ marginTop: 12 }}><button className="nx-btn ghost sm" onClick={onEdit}>Edit this week</button></div>}
          </>}
    </section>
  )
}

function NextPeriod({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  const { data, H } = ctx
  const start = data.nextStart ? new Date(data.nextStart + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : null
  const n = data.next
  return (
    <section className="nx-sec">
      <Head aside={start && <span>starts {start}</span>}>Next {H.unit}</Head>
      {!start ? <p className="nx-answer">Set this {H.unit} first; the next one is planned from it.</p>
        : n ? <>
            <p className="nw-nfocus">{n.focus || 'No focus yet'}<em className="mute num">, {n.tasks.length} goals, {pts(n.tasks.reduce((s, t) => s + t.maxPoints, 0))} points</em></p>
            <div className="nw-chips">{n.tasks.map(t => <span key={t.id ?? t.title} className="nx-chip" title={t.up ? `Serves ${t.up}` : 'Serves nothing above'}>{t.title}{!t.up && <em className="faint"> free</em>}</span>)}</div>
            <div className="nx-acts" style={{ marginTop: 12 }}><button className="nx-btn ghost sm" onClick={onOpen}>Change</button></div>
          </>
        : <>
            {data.suggestions.tasks.length > 0 && (
              <div className="nw-chips">{data.suggestions.tasks.slice(0, 5).map(s => {
                // What you scored on this goal the last time it ran.
                const key = s.title.trim().toLowerCase()
                const hit = [...data.history].reverse().flatMap(h => h.tasks ?? []).find(x => x.title.trim().toLowerCase() === key)
                return (
                  <span key={s.title} className="nx-chip">{s.title}
                    {hit && <em className="faint num"> last {hit.earned == null ? '–' : pts(hit.earned)}/{pts(hit.max)}</em>}
                  </span>
                )
              })}</div>
            )}
            <div className="nx-acts" style={{ marginTop: 12 }}><button className="nx-btn sm" onClick={onOpen}>Plan next {H.unit}</button></div>
          </>}
    </section>
  )
}
