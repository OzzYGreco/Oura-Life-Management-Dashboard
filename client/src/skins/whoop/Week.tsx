import { useEffect, useRef, useState } from 'react'
import {
  HORIZONS, SOURCES, fmtRange, horizonInfo, periodEnd, periodLabel, periodName, pts,
  useClosePeriod, useCreateCurrent, useDeletePeriod, useGoalsSettings, useMigrateGoalsSettings,
  usePlanNextWeek, useReopenPeriod, useSaveWeek, useScoreTask, useTaskSource, useWeek, useWeekGoal,
  type GoalsSettings, type Horizon, type HorizonInfo, type HorizonRules, type HistoryItem,
  type Source, type WeekGoal, type WeekTask, type WeekView,
} from '../../core/week'
import { PageLoader } from '../../components/ui/Spinner'
import { copyScorecard, getSignature, setSignature, type ScorecardTheme } from '../../core/scorecardImage'
import { FREE_POINTS, useUpChain, type UpChain } from '../../core/goals'
import { useIsNext } from '../isNext'
import './week.css'

// ─── Page ────────────────────────────────────────────────────────────────────

const H_KEY = 'oura-week-horizon'
const VIEW_KEY = 'oura-week-view'
const isHorizon = (v: unknown): v is Horizon => HORIZONS.some(h => h.value === v)
function readHorizon(): Horizon {
  const q = new URLSearchParams(window.location.search).get('horizon')
  if (isHorizon(q)) return q
  try { const v = localStorage.getItem(H_KEY); if (isHorizon(v)) return v } catch { /* ignore */ }
  return 'weekly'
}

export type Compose = { mode: 'next' } | { mode: 'current' } | { mode: 'edit'; goal: WeekGoal; name: string }

/** What the page needs to know about the horizon being shown. */
export interface Ctx { data: WeekView; horizon: Horizon; H: HorizonInfo; rules: HorizonRules }

export function WhoopWeek() {
  const [horizon, setHorizon] = useState<Horizon>(readHorizon)
  const H = horizonInfo(horizon)
  const gs = useGoalsSettings()
  useMigrateGoalsSettings(gs)
  const rules = gs.settings[horizon]
  const { data, isPending } = useWeek(horizon)
  const [pick, setPick] = useState<number | null>(null)
  const [compose, setCompose] = useState<Compose | null>(() => new URLSearchParams(window.location.search).get('plan') === '1' ? { mode: 'next' } : null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const switchTo = (h: Horizon) => {
    setHorizon(h); setPick(null); setCompose(null)
    try { localStorage.setItem(H_KEY, h) } catch { /* ignore */ }
  }

  return (
    <div className="wh-page wh-week-page wk-page skin-enter">
      <div className="wk-bar">
        <div className="wk-hz" role="tablist" aria-label="Horizon">
          {HORIZONS.map(x => (
            <button key={x.value} role="tab" aria-selected={horizon === x.value} className={horizon === x.value ? 'on' : ''} onClick={() => switchTo(x.value)}>{x.label}</button>
          ))}
        </div>
        <span className="wk-rule">A {H.unit} is beaten at <b className="num">{pts(rules.threshold)}</b> points · max <b className="num">{pts(rules.max)}</b></span>
        <button className="wk-gear" onClick={() => setSettingsOpen(true)} aria-label="Goal settings" title="Goal settings">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" /></svg>
        </button>
      </div>

      {isPending || !data ? <PageLoader /> : (() => {
        const ctx: Ctx = { data, horizon, H, rules }
        const cur = data.current
        const known = (id: number) => data.history.some(h => h.id === id) || data.next?.id === id
        const selected = pick != null && known(pick) ? pick : cur?.id ?? data.history[data.history.length - 1]?.id ?? null
        return <>
          <Record ctx={ctx} selected={selected} onPick={setPick} />
          <div className="wh-grid" style={{ marginTop: 18 }}>
            <div className="wh-left">
              {!cur && <NoCurrent ctx={ctx} onSet={() => setCompose({ mode: 'current' })} />}
              {selected != null && <Scorecard key={selected} ctx={ctx} id={selected} onCompose={setCompose} onDeleted={() => setPick(null)} />}
            </div>
            <div className="wh-right">
              <NextPeriod ctx={ctx} onOpen={() => setCompose({ mode: 'next' })} />
              <Slipping ctx={ctx} />
              {horizon === 'weekly' && <Honesty data={data} />}
            </div>
          </div>
          {compose && (compose.mode !== 'next' || data.nextStart) && (
            <Composer ctx={ctx} compose={compose} onClose={() => setCompose(null)} onSaved={id => id != null && setPick(id)} />
          )}
        </>
      })()}

      {settingsOpen && <SettingsSheet settings={gs.settings} onSave={s => gs.save.mutate(s)} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
}

// ─── Your record: the numbers across the top and a tile per period ───────────

/** A period counts as done once its dates have passed or it was closed by hand. */
const finished = (h: HistoryItem) => !h.current || !!h.closed

function statusOf(h: HistoryItem, threshold: number): { text: string; tone: 'good' | 'bad' | 'open' } {
  if (!finished(h)) return { text: h.score >= threshold ? 'Beaten already' : `In progress · ${pts(threshold)} to beat`, tone: h.score >= threshold ? 'good' : 'open' }
  return h.score >= threshold ? { text: 'Beaten', tone: 'good' } : { text: `Missed · needed ${pts(threshold)}`, tone: 'bad' }
}

function Record({ ctx, selected, onPick }: { ctx: Ctx; selected: number | null; onPick: (id: number) => void }) {
  const { data, H, rules, horizon } = ctx
  const t = rules.threshold
  const done = data.history.filter(finished)
  const beat = (h: HistoryItem) => h.score >= t
  let streak = 0
  for (let i = done.length - 1; i >= 0 && beat(done[i]); i--) streak++
  const won = done.filter(beat).length
  const best = done.reduce((m, h) => Math.max(m, h.score), 0)
  const [view, setView] = useState<'tiles' | 'list'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tiles' } catch { return 'tiles' } })
  const choose = (v: 'tiles' | 'list') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }
  const strip = useRef<HTMLDivElement>(null)
  // Keep the newest periods (and the Next tile) in view, also after fonts load and the strip reflows.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const end = () => { el.scrollLeft = el.scrollWidth }
    end()
    document.fonts?.ready.then(end)
    const ro = new ResizeObserver(end)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data.history.length, !!data.next, view, horizon])

  return (
    <section className={`wh-card wh-record wk-record ${view}`}>
      <div className="stats">
        <div><span>Streak</span><b className="num">{streak}</b><small>{H.units} beaten in a row</small></div>
        <div><span>Win rate</span><b className="num" style={{ color: 'var(--k-good)' }}>{done.length ? Math.round((won / done.length) * 100) : 0}%</b><small>{H.units} at {pts(t)}+ points</small></div>
        <div><span>Beaten</span><b className="num">{won}<i>/{done.length}</i></b><small>{H.units}</small></div>
        <div><span>Best</span><b className="num">{pts(best)}</b><small>points</small></div>
      </div>

      {view === 'tiles' ? (
        <div ref={strip} className="tiles" role="listbox" aria-label={H.units}>
          {!data.history.length && !data.next && <span className="wk-none">No {H.units} recorded yet. Set this {H.unit}'s goals below to start your record.</span>}
          {data.history.map((h, i) => {
            const pct = h.max ? h.score / h.max : 0
            const th = h.max ? t / h.max : 0
            const st = statusOf(h, t)
            return (
              <button key={h.id} role="option" aria-selected={selected === h.id} onClick={() => onPick(h.id)}
                className={`tile ${!finished(h) ? 'cur' : beat(h) ? 'won' : 'lost'} ${selected === h.id ? 'on' : ''}`}
                title={`${periodName(horizon, h.from, h.to, i + 1)} · ${fmtRange(h.from, h.to)} · ${pts(h.score)} of ${pts(h.max)} (${Math.round(pct * 100)}%) · ${st.text}${h.reward ? ` · ${h.reward}` : ''}`}>
                <span className="sc num">
                  <i className="lvl" style={{ height: `${Math.min(100, pct * 100)}%` }} />
                  {th > 0 && th < 1 && <i className="th" style={{ bottom: `${th * 100}%` }} />}
                  <em>{pts(h.score)}</em>
                </span>
                <span className="wk num">{periodLabel(horizon, h.from, h.to, i + 1)}</span>
              </button>
            )
          })}
          {data.next && (
            <button role="option" aria-selected={selected === data.next.id} onClick={() => onPick(data.next!.id)}
              className={`tile nxt ${selected === data.next.id ? 'on' : ''}`} title={`Next ${H.unit} · ${fmtRange(data.next.from, data.next.to)} · starts ${new Date(data.next.from + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}`}>
              <span className="sc">Next</span>
              <span className="wk num">{periodLabel(horizon, data.next.from, data.next.to, data.history.length + 1)}</span>
            </button>
          )}
        </div>
      ) : <span />}

      <div className="wk-view" role="group" aria-label={`Show past ${H.units} as`}>
        <button className={view === 'tiles' ? 'on' : ''} aria-pressed={view === 'tiles'} onClick={() => choose('tiles')} aria-label="Show as tiles" title="Tiles">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden><rect x="1" y="1" width="5" height="5" rx="1.2" /><rect x="8" y="1" width="5" height="5" rx="1.2" /><rect x="1" y="8" width="5" height="5" rx="1.2" /><rect x="8" y="8" width="5" height="5" rx="1.2" /></svg>
        </button>
        <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => choose('list')} aria-label="Show as a list" title="List">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2 3.5h10M2 7h10M2 10.5h10" /></svg>
        </button>
      </div>

      {view === 'list' && <PastList ctx={ctx} selected={selected} onPick={onPick} />}
    </section>
  )
}

/** Every period as a row, newest first; expand one or all to see the tasks. */
export function PastList({ ctx, selected, onPick }: { ctx: Ctx; selected: number | null; onPick: (id: number) => void }) {
  const { data, H, rules, horizon } = ctx
  const rows = [...data.history].reverse()
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const allOpen = rows.length > 0 && rows.every(r => open.has(r.id))
  const flip = (id: number) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  if (!rows.length) return <div className="wk-list"><span className="wk-none">No {H.units} recorded yet.</span></div>
  return (
    <div className="wk-list">
      <div className="wk-list-hd">
        <span className="wh-sub">{rows.length} {rows.length === 1 ? H.unit : H.units}, newest first</span>
        <button className="wh-chase" onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map(r => r.id)))} aria-expanded={allOpen}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
      </div>
      <div className="wk-rows">
        {rows.map(h => {
          const idx = data.history.indexOf(h) + 1
          const st = statusOf(h, rules.threshold)
          const isOpen = open.has(h.id)
          return (
            <div key={h.id} className={`wk-row ${isOpen ? 'open' : ''} ${selected === h.id ? 'on' : ''}`}>
              <button className="hd" aria-expanded={isOpen} onClick={() => flip(h.id)} aria-label={`${periodName(horizon, h.from, h.to, idx)}, ${pts(h.score)} of ${pts(h.max)}, ${st.text}`}>
                <svg className="chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
                <span className="lb num">{periodLabel(horizon, h.from, h.to, idx)}</span>
                <span className="rg">{fmtRange(h.from, h.to)}</span>
                <span className="fc">{h.focus || 'No focus'}</span>
                <span className="sc num" style={{ color: st.tone === 'good' ? 'var(--k-good)' : st.tone === 'bad' ? 'var(--k-bad)' : 'var(--k-ink)' }}>{pts(h.score)}<i> / {pts(h.max)}</i></span>
                <span className={`st ${st.tone}`}>{st.text}</span>
              </button>
              {isOpen && (
                <div className="bd">
                  {(h.tasks ?? []).map((t, i) => (
                    <div key={i} className="tk">
                      <span>{t.title}</span>
                      <b className="num" style={{ color: t.earned == null ? 'var(--k-faint)' : t.earned >= t.max ? 'var(--k-good)' : t.earned === 0 ? 'var(--k-bad)' : 'var(--k-ink)' }}>
                        {t.earned == null ? '–' : pts(t.earned)}<i> / {pts(t.max)}</i>
                      </b>
                    </div>
                  ))}
                  {h.reward && <div className="rw">Earned: {h.reward}</div>}
                  <button className="wh-chase" onClick={() => onPick(h.id)}>Open the scorecard</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── The scorecard: one period, made to be shared ────────────────────────────

const THEME: ScorecardTheme = {
  bg: '#0B0E14', card: '#121722', line: 'rgba(255,255,255,.08)', ink: '#ECEFF4', ink2: '#B4BCC9', mute: '#7F8899',
  good: '#6FD3A0', warn: '#E9B65E', bad: '#EC7C6E', track: 'rgba(255,255,255,.07)', chip: 'rgba(111,211,160,.12)',
  font: 'Inter, system-ui, sans-serif', display: '"Inter Tight", Inter, sans-serif',
}

const longDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })

function Scorecard({ ctx, id, onCompose, onDeleted }: { ctx: Ctx; id: number; onCompose: (c: Compose) => void; onDeleted: () => void }) {
  const { data, H, rules, horizon } = ctx
  const isCurrent = data.current?.id === id
  const isNext = data.next?.id === id
  const live = isCurrent && !data.current!.closed
  const past = useWeekGoal(isCurrent ? null : id)
  const close = useClosePeriod()
  const reopen = useReopenPeriod()
  const del = useDeletePeriod()
  const [copied, setCopied] = useState<string | null>(null)
  const [typing, setTyping] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const idx = isNext ? data.history.length + 1 : data.history.findIndex(h => h.id === id) + 1
  const goal = isCurrent ? data.current! : past.data
  if (!goal) return <section className="wh-card wh-sc"><PageLoader /></section>

  const name = periodName(horizon, goal.from, goal.to, idx)
  // A running period: auto tasks show their live score; everything else its stored one.
  const rows = goal.tasks.map(t => {
    const lv = live ? data.current!.live.tasks.find(x => x.id === t.id) : undefined
    const auto = t.source !== 'manual'
    return { ...t, auto, score: auto && live ? (lv?.earned ?? t.earnedPoints) : t.earnedPoints, note: lv?.note ?? null }
  })
  const total = rows.reduce((s, r) => s + (r.score ?? 0), 0)
  const max = rows.reduce((s, r) => s + r.maxPoints, 0)
  const pct = max ? total / max : 0
  const color = pct >= 0.7 ? 'var(--k-good)' : pct >= 0.4 ? 'var(--k-warn)' : 'var(--k-bad)'
  const rewards = [...goal.rewards].sort((a, b) => a.minScore - b.minScore)
  const reached = [...rewards].reverse().find(r => total >= r.minScore)
  const next = rewards.find(r => total < r.minScore)
  const t = rules.threshold
  const beaten = total >= t
  const editable = !isNext
  const handRows = rows.map((r, i) => (editable && !r.auto ? i : -1)).filter(i => i >= 0)
  const typeNext = (i: number) => setTyping(handRows.find(j => j > i) ?? null)

  // The plain answer, first.
  const answer = isNext
    ? { text: `Starts ${longDay(goal.from)}. Scoring opens when the ${H.unit} starts.`, tone: 'var(--k-ink2)' }
    : live
      ? beaten
        ? { text: `Beaten: ${pts(total)} points, ${pts(t)} needed.`, tone: 'var(--k-good)' }
        : { text: `${pts(t - total)} more point${t - total === 1 ? '' : 's'} to beat this ${H.unit}. ${pts(t)} needed.`, tone: 'var(--k-ink2)' }
      : beaten
        ? { text: `Beaten with ${pts(total)} points. ${pts(t)} needed.`, tone: 'var(--k-good)' }
        : { text: `Missed: ${pts(total)} points, ${pts(t)} needed.`, tone: 'var(--k-bad)' }

  const copy = async () => {
    const how = await copyScorecard({
      weekNo: idx, period: periodName(ctx.horizon, goal.from, goal.to, idx), from: goal.from, to: goal.to, focus: goal.focus,
      tasks: rows.map(r => ({ title: r.title, max: r.maxPoints, score: r.score })),
      rewards, signature: getSignature(),
    }, THEME)
    setCopied(how === 'copied' ? 'Copied. Paste it wherever you report.' : 'Saved as an image in Downloads.')
    setTimeout(() => setCopied(null), 3500)
  }
  const onError = (e: any) => setErr(e?.response?.data?.error ?? 'That did not save. Try again.')

  return (
    <section className="wh-card wh-sc">
      <div className="top">
        <div>
          <div className="eyebrow">Goal crushers · {name}{isCurrent ? (live ? ` · this ${H.unit}` : ' · closed') : isNext ? ` · starts ${longDay(goal.from)}` : ''}</div>
          <h2>{goal.focus || `This ${H.unit}`}</h2>
          <div className="wh-sub">{fmtRange(goal.from, goal.to)}</div>
        </div>
        <div className="tot">
          <div className="n num"><b style={{ color }}>{pts(total)}</b><span> / {pts(max)}</span></div>
          {reached ? <div className="earned">Earned: {reached.reward}</div>
            : next ? <div className="wh-sub">{pts(next.minScore - total)} more for {next.reward}</div> : null}
        </div>
      </div>

      <div className="wk-prog">
        <div className="prog" aria-hidden>
          <b style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
          {rewards.map(r => <i key={r.minScore} style={{ left: `${Math.min(100, max ? (r.minScore / max) * 100 : 0)}%` }} />)}
        </div>
        {max > 0 && t > 0 && t <= max && (
          <span className={`wk-th ${beaten ? 'hit' : ''}`} style={{ left: `${(t / max) * 100}%` }} title={`${pts(t)} points beats the ${H.unit}`} />
        )}
      </div>
      <p className="wk-answer" style={{ color: answer.tone }}>{answer.text}</p>

      <div className="tbl" role="table" aria-label="Tasks and scores">
        <div className="tr th" role="row"><span>Task</span><span>Max</span><span>Score</span></div>
        {rows.map((r, i) => (
          <ScoreRow key={r.id} row={r} editable={editable} typing={typing === i}
            onTyping={on => setTyping(on ? i : null)} onNext={() => typeNext(i)} />
        ))}
        <div className="tr total" role="row"><span>Total</span><span className="num">{pts(max)} pts</span><span className="num" style={{ color }}>{pts(total)}</span></div>
      </div>

      <div className="chips">
        {rewards.map(r => <span key={r.minScore} className={total >= r.minScore ? 'got' : ''}><b className="num">{pts(r.minScore)}+</b> {r.reward}</span>)}
      </div>

      {isCurrent && !live && !data.next && (
        <div className="wk-closed" role="status">
          <span>{name} is closed at <b className="num">{pts(total)}</b> points.</span>
          <button className="wh-btn" onClick={() => onCompose({ mode: 'next' })}>Set up next {H.unit}</button>
        </div>
      )}

      <div className="acts">
        <button className="wh-btn" onClick={copy}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="5" width="9" height="9" rx="2" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
          Copy as image
        </button>
        {isNext
          ? <button className="wh-chase" onClick={() => onCompose({ mode: 'next' })}>Change next {H.unit}</button>
          : <button className="wh-chase" onClick={() => onCompose({ mode: 'edit', goal, name })}>Edit {isCurrent ? `this ${H.unit}` : H.unit}</button>}
        {live && <button className="wh-chase" disabled={close.isPending} onClick={() => { setErr(null); close.mutate(goal.id, { onError }) }} title={`Close ${name} now and freeze its score`}>Mark complete</button>}
        {isCurrent && !live && <button className="wh-chase" disabled={reopen.isPending} onClick={() => { setErr(null); reopen.mutate(goal.id, { onError }) }}>Reopen</button>}
        {copied && <span className="wh-sub" role="status">{copied}</span>}
        {err && <span className="wk-err" role="alert">{err}</span>}
        <span className="wk-sp" />
        {!confirmDel
          ? <button className="wk-del" onClick={() => setConfirmDel(true)} aria-label={`Delete ${name}`}>Delete</button>
          : (
            <span className="wk-confirm" role="group" aria-label="Confirm delete">
              <span>Delete {name} and its scores?</span>
              <button className="wk-del on" disabled={del.isPending} onClick={() => del.mutate(goal.id, { onSuccess: onDeleted, onError })}>Delete</button>
              <button className="wh-chase" onClick={() => setConfirmDel(false)}>Keep</button>
            </span>
          )}
      </div>
    </section>
  )
}

type Row = { id?: number; title: string; maxPoints: number; score: number | null; auto: boolean; source: Source; note: string | null }

function ScoreRow({ row, editable, typing, onTyping, onNext }: { row: Row; editable: boolean; typing: boolean; onTyping: (on: boolean) => void; onNext: () => void }) {
  const score = useScoreTask()
  const setSource = useTaskSource()
  const full = row.score != null && row.score >= row.maxPoints
  const src = SOURCES.find(s => s.value === row.source)
  return (
    <div className="tr" role="row">
      <span className="t">
        {row.title}
        {row.auto && editable && (
          <small><b className="auto">auto</b> {src?.label.toLowerCase()}{row.note ? ` · ${row.note}` : ''}
            <button className="sw" onClick={() => row.id && setSource.mutate({ id: row.id, source: 'manual' })}>Score by hand</button></small>
        )}
      </span>
      <span className="num m">{pts(row.maxPoints)} pts</span>
      {editable && !row.auto ? (
        <SegScore value={row.score} max={row.maxPoints} busy={score.isPending} title={row.title}
          typing={typing} onTyping={onTyping} onNext={onNext}
          onSet={v => row.id && score.mutate({ id: row.id, earnedPoints: v })} />
      ) : (
        <b className="num v" style={{ color: row.score == null ? 'var(--k-faint)' : full ? 'var(--k-good)' : row.score === 0 ? 'var(--k-bad)' : 'var(--k-ink)' }}>{row.score == null ? '–' : pts(row.score)}</b>
      )}
    </div>
  )
}

/** Segment size: quarter points up to 10, then a round step so the bar stays clickable. */
function segStep(max: number): number {
  if (max <= 10) return 0.25
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 25, 50, 100]) if (max / s <= 40) return s
  return Math.ceil(max / 40)
}

/** Click where the score is: one click per task. Or click the number to type it; Enter moves to the next task. */
export function SegScore({ value, max, onSet, busy, title, typing, onTyping, onNext }: {
  value: number | null; max: number; onSet: (v: number | null) => void; busy: boolean; title: string
  typing: boolean; onTyping: (on: boolean) => void; onNext: () => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const step = segStep(max)
  const n = Math.max(1, Math.ceil(max / step - 1e-9))
  const shown = hover ?? value ?? 0
  const full = value != null && value >= max
  const handled = useRef(false)
  useEffect(() => { if (typing) handled.current = false }, [typing])

  const commit = (raw: string) => {
    const s = raw.trim().replace(',', '.')
    const v = s === '' ? null : Number(s)
    if (v != null && !Number.isFinite(v)) return
    const clamped = v == null ? null : Math.round(Math.min(max, Math.max(0, v)) * 100) / 100
    if (clamped !== value) onSet(clamped)
  }

  return (
    <span className="seg" role="group" aria-label={`Score ${title}`} onMouseLeave={() => setHover(null)}>
      <button className={`zero ${value === 0 ? 'on' : ''}`} disabled={busy} onClick={() => onSet(0)} aria-label="Score 0">0</button>
      <span className="bar">
        {Array.from({ length: n }, (_, i) => {
          const v = Math.min(max, Math.round((i + 1) * step * 100) / 100)
          return (
            <button key={i} disabled={busy} onMouseEnter={() => setHover(v)} onFocus={() => setHover(v)} onBlur={() => setHover(null)} onClick={() => onSet(v)}
              className={v <= shown ? 'fill' : ''} aria-label={`Score ${pts(v)}`} title={pts(v)}
              style={{ background: v <= shown ? (hover != null ? 'rgba(236,239,244,.55)' : full ? 'var(--k-good)' : 'var(--k-ink2)') : undefined }} />
          )
        })}
      </span>
      {typing ? (
        <input className="wk-typed num" autoFocus type="number" inputMode="decimal" min={0} max={max} step="any"
          defaultValue={value ?? ''} aria-label={`Type the score for ${title}, out of ${pts(max)}`}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); handled.current = true; commit(e.currentTarget.value); onNext() }
            else if (e.key === 'Escape') { e.stopPropagation(); handled.current = true; onTyping(false) }
          }}
          onBlur={e => { if (handled.current) return; handled.current = true; commit(e.currentTarget.value); onTyping(false) }} />
      ) : (
        <button className="wk-val num" onClick={() => onTyping(true)} aria-label={`Type the score for ${title}`} title="Click to type a score"
          style={{ color: hover != null ? 'var(--k-ink)' : value == null ? 'var(--k-faint)' : full ? 'var(--k-good)' : 'var(--k-ink)' }}>
          {hover != null ? pts(hover) : value == null ? '–' : pts(value)}
        </button>
      )}
    </span>
  )
}

// ─── No goal for this period yet ─────────────────────────────────────────────

function NoCurrent({ ctx, onSet }: { ctx: Ctx; onSet: () => void }) {
  const { data, H, horizon } = ctx
  const p = data.period ?? { from: data.today, to: periodEnd(horizon, data.today) }
  return (
    <section className="wh-card wh-wk wh-next">
      <div>
        <div className="wh-h">No goals for this {H.unit} yet</div>
        <p className="wh-sub" style={{ marginTop: 4 }}>
          {periodName(horizon, p.from, p.to, data.history.length + 1)} runs {fmtRange(p.from, p.to)}. {data.suggestions.tasks.length ? 'Pick from your recent goals or type new ones.' : 'Type the goals and give each its points.'}
        </p>
      </div>
      <button className="wh-btn" onClick={onSet}>Set this {H.unit}</button>
    </section>
  )
}

// ─── Next period: one composer, nothing assumed ──────────────────────────────

function NextPeriod({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  const { data, H } = ctx
  if (!data.nextStart) return null
  const start = new Date(data.nextStart + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <section className="wh-card wh-wk wh-next">
      <div>
        <div className="wh-h">{data.next ? `Next ${H.unit} is set` : `Plan next ${H.unit}`}</div>
        <p className="wh-sub" style={{ marginTop: 4 }}>
          {data.next
            ? <>{data.next.focus || 'No focus'} · {data.next.tasks.length} tasks · {pts(data.next.tasks.reduce((s, t) => s + t.maxPoints, 0))} points. Starts {start}.</>
            : <>Starts {start}. Pick its goals from your recent ones or type new ones.</>}
        </p>
      </div>
      <button className={data.next ? 'wh-chase' : 'wh-btn'} onClick={onOpen}>{data.next ? 'Change' : `Plan next ${H.unit}`}</button>
    </section>
  )
}

type Draft = Omit<WeekTask, 'earnedPoints'> & { key: string }
let dseq = 0
const dk = () => `d${++dseq}`
const r2 = (n: number) => Math.round(n * 100) / 100

/** Points typed straight in, kept as text while typing so "1." or "0.2" are not cut short. */
function PointsInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [s, setS] = useState(String(value))
  useEffect(() => { if (Number(s) !== value) setS(String(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input className="num" value={s} inputMode="decimal" aria-label={label}
      onFocus={e => e.currentTarget.select()}
      onChange={e => { setS(e.target.value); const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n > 0) onChange(r2(n)) }}
      onBlur={() => setS(String(value))} />
  )
}

export function Composer({ ctx, compose, onClose, onSaved }: { ctx: Ctx; compose: Compose; onClose: () => void; onSaved: (id: number | null) => void }) {
  const { data, H, rules, horizon } = ctx
  const plan = usePlanNextWeek()
  const create = useCreateCurrent()
  const save = useSaveWeek()
  const mode = compose.mode
  const base: WeekGoal | null = mode === 'edit' ? compose.goal : mode === 'next' ? data.next : null
  const isCur = mode === 'edit' && compose.goal.id === data.current?.id
  const natural = mode === 'next'
    ? (data.nextPeriod ?? (data.nextStart ? { from: data.nextStart, to: periodEnd(horizon, data.nextStart) } : null))
    : (data.period ?? { from: data.today, to: periodEnd(horizon, data.today) })
  const [from, setFrom] = useState(base?.from ?? natural?.from ?? data.today)
  const [to, setTo] = useState(base?.to ?? natural?.to ?? periodEnd(horizon, data.today))
  const [focus, setFocus] = useState(base?.focus ?? '')
  const [tasks, setTasks] = useState<Draft[]>(() => (base?.tasks ?? []).map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, source: t.source, target: t.target, parentTaskId: t.parentTaskId ?? null, milestoneId: t.milestoneId ?? null, up: t.up ?? null, key: dk() })))
  const [rewards, setRewards] = useState(() => (base?.rewards.length ? base.rewards : data.current?.rewards ?? []).map(r => ({ minScore: r.minScore, reward: r.reward })))
  const [editRewards, setEditRewards] = useState(false)
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEscape(onClose)
  const isNext = useIsNext()
  const chain = useUpChain(horizon, from)
  /** What a suggestion served last time, if that's still on offer. */
  const lastLink = (sg: WeekView['suggestions']['tasks'][number]): Partial<Draft> => {
    if (!chain) return {}
    if (chain.field === 'milestoneId') return sg.milestoneId != null && chain.options.some(o => o.id === sg.milestoneId) ? { milestoneId: sg.milestoneId } : {}
    const hit = sg.parentTitle ? chain.options.find(o => o.title.trim().toLowerCase() === sg.parentTitle!.trim().toLowerCase()) : undefined
    return hit ? { parentTaskId: hit.id } : {}
  }
  const setUp = (key: string, id: number | null) => chain && setTasks(ts => ts.map(x => x.key === key ? { ...x, [chain.field]: id, up: chain.options.find(o => o.id === id)?.title ?? null } : x))

  // Moving the start moves the end with it, while the end is still the natural one.
  const setStart = (f: string) => {
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f) && to === periodEnd(horizon, from)) setTo(periodEnd(horizon, f))
    setFrom(f)
  }

  const has = (title: string) => tasks.some(t => t.title.trim().toLowerCase() === title.trim().toLowerCase())
  const toggle = (sg: WeekView['suggestions']['tasks'][number]) => has(sg.title)
    ? setTasks(tasks.filter(t => t.title.trim().toLowerCase() !== sg.title.trim().toLowerCase()))
    : setTasks([...tasks, { title: sg.title, maxPoints: sg.maxPoints, source: sg.source, target: sg.target, ...lastLink(sg), key: dk() }])
  const addTyped = () => {
    const t = typed.trim()
    if (!t || has(t)) { setTyped(''); return }
    setTasks([...tasks, { title: t, maxPoints: rules.defaultPoints, source: 'manual', target: null, key: dk() }]); setTyped('')
  }
  const setPts = (key: string, v: number) => setTasks(ts => ts.map(x => x.key === key ? { ...x, maxPoints: Math.max(0.25, r2(v)) } : x))
  const total = r2(tasks.reduce((s, t) => s + t.maxPoints, 0))
  const lastDone = data.history.filter(h => !h.current).slice(-1)[0]
  const [usual, usualWhen] = mode === 'next' && data.current
    ? [r2(data.current.tasks.reduce((s, t) => s + t.maxPoints, 0)), `this ${H.unit}`]
    : lastDone ? [lastDone.max, `last ${H.unit}`] : [rules.max, 'your max']
  const title = mode === 'next' ? `Next ${H.unit}` : mode === 'current' ? `This ${H.unit}` : isCur ? `This ${H.unit}` : compose.name
  const busy = plan.isPending || create.isPending || save.isPending

  const submit = () => {
    setErr(null)
    if (!from || !to) { setErr('Pick a start and an end date.'); return }
    if (from > to) { setErr('The period has to end after it starts.'); return }
    const onError = (e: any) => setErr(e?.response?.data?.error ?? `Could not save the ${H.unit}.`)
    const clean = tasks.map(t => ({ id: t.id, title: t.title, maxPoints: t.maxPoints, source: t.source, target: t.target, parentTaskId: t.parentTaskId ?? null, milestoneId: t.milestoneId ?? null }))
    if (base && mode === 'edit') {
      // Keeps each task's id, so scores already entered stay.
      save.mutate({ id: base.id, focus, from, to, tasks: clean.map(t => ({ ...t, earnedPoints: null })), rewards }, { onSuccess: onClose, onError })
    } else if (mode === 'next') {
      plan.mutate({ horizon, focus, from, to, tasks: clean, rewards }, { onSuccess: () => onClose(), onError })
    } else {
      create.mutate({ horizon, focus, from, to, tasks: clean, rewards }, { onSuccess: r => { onSaved(r.id); onClose() }, onError })
    }
  }

  return (
    <div className={`wh-sheet-bg ${isNext ? 'nx-sheet-bg' : ''}`} onMouseDown={onClose}>
      <div className={`wh wh-sheet wk-sheet ${isNext ? 'nx-compose' : ''}`} role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>{title}</div>
            <div className="wh-sub">{from && to && from <= to ? fmtRange(from, to) : 'Pick the dates'}{mode === 'edit' ? ' · scores you\'ve entered stay' : ''}</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>

        <div className="lbl">Period <span>{natural && from === natural.from && to === natural.to ? `the natural ${H.unit}` : 'custom dates'}</span></div>
        <div className="wk-dates">
          <label><span>Starts</span><input className="in num" type="date" value={from} onChange={e => setStart(e.target.value)} aria-label="Period start" /></label>
          <label><span>Ends</span><input className="in num" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="Period end" /></label>
          {natural && (from !== natural.from || to !== natural.to) && mode !== 'edit' && (
            <button className="lnk" onClick={() => { setFrom(natural.from); setTo(natural.to) }}>Back to {fmtRange(natural.from, natural.to)}</button>
          )}
        </div>

        <div className="lbl">Focus</div>
        <input className="in" value={focus} onChange={e => setFocus(e.target.value)} placeholder={`What's this ${H.unit} about?`} aria-label="Focus" />
        {data.suggestions.focuses.length > 0 && (
          <div className="chips">
            {data.suggestions.focuses.map(f => (
              <button key={f} className={focus === f ? 'on' : ''} onClick={() => setFocus(f)}>{f}</button>
            ))}
          </div>
        )}

        <div className="lbl">Goals {data.suggestions.tasks.length > 0 && <span>tap to add, tap again to remove</span>}</div>
        {data.suggestions.tasks.length > 0 && (
          <div className="chips">
            {data.suggestions.tasks.map(sg => (
              <button key={sg.title} className={has(sg.title) ? 'on' : ''} onClick={() => toggle(sg)} aria-pressed={has(sg.title)}>
                {has(sg.title) ? '✓ ' : '+ '}{sg.title}<small>{sg.weeks}{H.unit[0]}</small>
              </button>
            ))}
          </div>
        )}
        <form className="type" onSubmit={e => { e.preventDefault(); addTyped() }}>
          <input className="in" value={typed} onChange={e => setTyped(e.target.value)} placeholder={`${data.suggestions.tasks.length ? 'Or type' : 'Type'} a new goal and press Enter (${pts(rules.defaultPoints)} pt${rules.defaultPoints === 1 ? '' : 's'})`} aria-label="New goal" />
        </form>

        {tasks.length > 0 && (
          <div className="picked">
            {tasks.map(t => (
              <div key={t.key} className="p">
                <span className="t">{t.title}</span>
                <select value={t.source} onChange={e => setTasks(tasks.map(x => x.key === t.key ? { ...x, source: e.target.value as Source, target: e.target.value === 'workouts' ? (x.target ?? 4) : null } : x))} aria-label="How it's scored">
                  {SOURCES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="pts">
                  <button onClick={() => setPts(t.key, t.maxPoints - 0.5)} aria-label={`Fewer points for ${t.title}`}>−</button>
                  <PointsInput value={t.maxPoints} onChange={v => setPts(t.key, v)} label={`Points for ${t.title}`} />
                  <button onClick={() => setPts(t.key, t.maxPoints + 0.5)} aria-label={`More points for ${t.title}`}>+</button>
                </span>
                <button className="x" onClick={() => setTasks(tasks.filter(x => x.key !== t.key))} aria-label={`Remove ${t.title}`}>×</button>
                {chain && <UpPick chain={chain} task={t} onPick={id => setUp(t.key, id)} />}
              </div>
            ))}
            {chain && <Alignment chain={chain} tasks={tasks} total={total} unit={H.unit} onFix={onClose} />}
            <div className="sum">
              <span>Total</span>
              <b className="num" style={{ color: total === usual ? 'var(--k-good)' : 'var(--k-warn)' }}>{pts(total)} points</b>
              <span className="wh-sub">{total === usual ? `same as ${usualWhen}` : `${usualWhen} was ${pts(usual)}`} · beaten at {pts(rules.threshold)}</span>
            </div>
          </div>
        )}

        <div className="lbl">Rewards {!editRewards && <button className="lnk" onClick={() => setEditRewards(true)}>change</button>}</div>
        {!editRewards ? (
          <div className="chips static">
            {rewards.length ? rewards.map(r => <span key={r.minScore + r.reward}><b className="num">{pts(r.minScore)}+</b> {r.reward}</span>) : <span>No rewards yet</span>}
          </div>
        ) : (
          <div className="rew">
            {rewards.map((r, i) => (
              <div key={i} className="r">
                <input className="in num" type="number" step={0.25} value={r.minScore} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, minScore: Number(e.target.value) } : x))} aria-label="Score needed" />
                <input className="in" value={r.reward} onChange={e => setRewards(rewards.map((x, j) => j === i ? { ...x, reward: e.target.value } : x))} aria-label="Reward" />
                <button className="x" onClick={() => setRewards(rewards.filter((_, j) => j !== i))} aria-label="Remove reward">×</button>
              </div>
            ))}
            <button className="lnk" onClick={() => setRewards([...rewards, { minScore: (rewards[rewards.length - 1]?.minScore ?? 6) + 1, reward: '' }])}>+ reward</button>
          </div>
        )}

        <div className="foot">
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }} role="alert">{err}</span>}
          <button className="wh-btn" disabled={!tasks.length || busy} onClick={submit}>
            {mode === 'next' ? (base ? `Save next ${H.unit}` : `Set next ${H.unit}`) : mode === 'current' ? `Set this ${H.unit}` : isCur ? `Save this ${H.unit}` : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Up the chain: what each goal serves, and how much of the plan does ──────

const upId = (chain: UpChain, t: Draft) => (chain.field === 'parentTaskId' ? t.parentTaskId : t.milestoneId) ?? null

function UpPick({ chain, task, onPick }: { chain: UpChain; task: Draft; onPick: (id: number | null) => void }) {
  const v = upId(chain, task)
  const groups = [...new Set(chain.options.map(o => o.group))]
  const known = v == null || chain.options.some(o => o.id === v)
  if (!chain.options.length && v == null) return null
  return (
    <label className={`up ${v == null ? 'free' : ''}`}>
      <span>Serves</span>
      <select value={v ?? ''} onChange={e => onPick(e.target.value ? Number(e.target.value) : null)} aria-label={`What ${task.title} serves`}>
        <option value="">Nothing above (life admin)</option>
        {!known && <option value={v!}>{task.up ?? 'Linked earlier'}</option>}
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {chain.options.filter(o => o.group === g).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/** The alignment meter: how many of the plan's points move something bigger. */
function Alignment({ chain, tasks, total, unit, onFix }: { chain: UpChain; tasks: Draft[]; total: number; unit: string; onFix: () => void }) {
  if (chain.empty) return (
    <div className="align empty">
      <span>{chain.empty}</span>
      {chain.fix && <a className="lnk" href={chain.fix.href} onClick={onFix}>{chain.fix.label}</a>}
    </div>
  )
  if (!chain.options.length) return null
  const linked = r2(tasks.filter(t => upId(chain, t) != null).reduce((s, t) => s + t.maxPoints, 0))
  const free = r2(total - linked)
  const over = free > FREE_POINTS
  const pct = total ? (linked / total) * 100 : 0
  return (
    <div className={`align ${over ? 'over' : ''}`}>
      <div className="row">
        <span><b className="num">{pts(linked)}</b> of <span className="num">{pts(total)}</span> points serve {chain.target}</span>
        <span className="note">{over
          ? <><span className="num">{pts(free)}</span> serve nothing above; keep it to <span className="num">{FREE_POINTS}</span> or link them</>
          : free > 0 ? <><span className="num">{pts(free)}</span> free for life admin</> : `the whole ${unit} moves something bigger`}</span>
      </div>
      <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Points that serve the level above">
        <b style={{ width: `${pct}%` }} />
        {total > FREE_POINTS && <i style={{ left: `${Math.max(0, ((total - FREE_POINTS) / total) * 100)}%` }} title={`${FREE_POINTS} points may stay free`} />}
      </div>
    </div>
  )
}

// ─── Settings: what counts as beaten, per horizon ────────────────────────────

export function SettingsSheet({ settings, onSave, onClose }: { settings: GoalsSettings; onSave: (s: GoalsSettings) => void; onClose: () => void }) {
  type Field = keyof HorizonRules
  const [draft, setDraft] = useState(() => Object.fromEntries(HORIZONS.map(h => [h.value, {
    max: String(settings[h.value].max), threshold: String(settings[h.value].threshold), defaultPoints: String(settings[h.value].defaultPoints),
  }])) as Record<Horizon, Record<Field, string>>)
  const [err, setErr] = useState<string | null>(null)
  const [sig, setSig] = useState(getSignature)
  useEscape(onClose)
  const set = (h: Horizon, f: Field, v: string) => setDraft(d => ({ ...d, [h]: { ...d[h], [f]: v } }))

  const submit = () => {
    const out = {} as GoalsSettings
    for (const h of HORIZONS) {
      const d = draft[h.value]
      const max = Number(d.max), threshold = Number(d.threshold), defaultPoints = Number(d.defaultPoints)
      if (!(max > 0) || !(threshold >= 0) || !(defaultPoints > 0)) { setErr(`Check the ${h.label.toLowerCase()} numbers: each must be a positive number.`); return }
      if (threshold > max) { setErr(`${h.label}: "beaten at" can't be above the max score.`); return }
      out[h.value] = { max, threshold, defaultPoints }
    }
    setSignature(sig)
    onSave(out); onClose()
  }

  return (
    <div className="wh-sheet-bg" onMouseDown={onClose}>
      <div className="wh wh-sheet wk-sheet wk-settings" role="dialog" aria-label="Goal settings" onMouseDown={e => e.stopPropagation()}>
        <div className="hd">
          <div>
            <div className="wh-h" style={{ fontSize: 19 }}>Goal settings</div>
            <div className="wh-sub">What a period is scored out of, and the score that beats it. Saved for every browser.</div>
          </div>
          <button className="wh-chase" onClick={onClose}>Close</button>
        </div>
        <div className="wk-set" role="table" aria-label="Settings per horizon">
          <div className="r th" role="row"><span /><span>Max score</span><span>Beaten at</span><span>Default points</span></div>
          {HORIZONS.map(h => (
            <div key={h.value} className="r" role="row">
              <span className="h">{h.label}</span>
              {(['max', 'threshold', 'defaultPoints'] as Field[]).map(f => (
                <input key={f} className="in num" type="number" min={0} step={f === 'max' ? 1 : 0.25} value={draft[h.value][f]}
                  onChange={e => set(h.value, f, e.target.value)} aria-label={`${h.label} ${f === 'max' ? 'max score' : f === 'threshold' ? 'beaten at' : 'points per new goal'}`} />
              ))}
            </div>
          ))}
        </div>
        <p className="wh-sub" style={{ marginTop: 12 }}>"Beaten at" sets the streak, the win rate, the tile colours and the marker on each progress bar.</p>
        <div className="lbl" style={{ marginTop: 18 }}>Signature on copied scorecards <span>leave empty for none</span></div>
        <input className="in" value={sig} onChange={e => setSig(e.target.value)} placeholder="Your name or @handle" aria-label="Signature on copied scorecards" />
        <div className="foot">
          {err && <span style={{ color: 'var(--k-bad)', fontSize: 13 }} role="alert">{err}</span>}
          <button className="wh-btn" onClick={submit}>Save settings</button>
        </div>
      </div>
    </div>
  )
}

// ─── Side cards ──────────────────────────────────────────────────────────────

/** The hand score for "daily tasks" next to what the routine data said the same week. */
function Honesty({ data }: { data: WeekView }) {
  const both = data.history.filter(h => h.dailyPct != null && h.dayAvg != null)
  if (both.length < 3) return null
  const hand = Math.round(both.reduce((s, h) => s + h.dailyPct!, 0) / both.length)
  const real = Math.round(both.reduce((s, h) => s + h.dayAvg!, 0) / both.length)
  if (hand - real < 15) return null
  return (
    <section className="wh-card wh-stakes">
      <div className="t">Hand score vs your data</div>
      <p>Over {both.length} weeks you scored your daily tasks <b>{hand}%</b> by hand. Your routine averaged <b>{real}</b> those same weeks.</p>
      <div className="lever">{data.current?.tasks.some(t => t.source === 'checklist')
        ? 'From this week it scores itself from your routine, so it tells the same story as your days.'
        : 'A task that scores itself from your routine can\'t drift like that. Set it to “From your routine” in Edit this week.'}</div>
    </section>
  )
}

function Slipping({ ctx }: { ctx: Ctx }) {
  const { data, H } = ctx
  const slip = data.trends.filter(t => t.avg < 90).slice(0, 4)
  if (!slip.length) return null
  return (
    <section className="wh-card wh-why">
      <div className="wh-h">Keeps slipping</div>
      <div className="wh-sub" style={{ marginTop: 2 }}>average of the last 12 finished {H.units}</div>
      {slip.map(t => (
        <div key={t.title} className="wh-tk">
          <div className="nm">{t.title}<small>{t.weeks} {H.units}</small></div>
          <div className="wh-bar"><b style={{ width: `${t.avg}%`, background: t.avg >= 70 ? 'var(--k-warn)' : 'var(--k-bad)' }} /></div>
          <div className="v num">{t.avg}%</div>
        </div>
      ))}
    </section>
  )
}
