/**
 * Draws a week's scorecard as a PNG and copies it to the clipboard (or
 * downloads it when the clipboard refuses), so the week can be reported with
 * one click. Drawn on a canvas so the picture is identical every time.
 */
import { loadAvatarImage } from './profile'

export interface ScorecardData {
  weekNo: number
  /** The period's name for the heading, e.g. "Week 110", "November 2026", "2026". Defaults to the week. */
  period?: string
  from: string
  to: string
  focus: string
  tasks: { title: string; max: number; score: number | null }[]
  rewards: { minScore: number; reward: string }[]
  /** Your name or handle, drawn as a quiet watermark at the bottom. Empty draws none. */
  signature?: string
  /** A period that has not started: drawn as a plan (points on offer), not a 0 score. */
  plan?: boolean
}

const SIG_KEY = 'oura-scorecard-signature'
const SIG_DEFAULT = 'OzzY'
/** The signature on copied scorecards, remembered in this browser. */
export function getSignature(): string {
  try { const v = localStorage.getItem(SIG_KEY); return v == null ? SIG_DEFAULT : v } catch { return SIG_DEFAULT }
}
export function setSignature(v: string) {
  try { localStorage.setItem(SIG_KEY, v.trim()) } catch { /* private mode */ }
}

export interface ScorecardTheme {
  bg: string; card: string; line: string; ink: string; ink2: string; mute: string
  good: string; warn: string; bad: string; track: string; chip: string
  font: string; display: string
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)
const range = (from: string, to: string) => {
  const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00')
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${f.toLocaleDateString('en-GB', o)} to ${t.toLocaleDateString('en-GB', { ...o, year: 'numeric' })}`
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

export function drawScorecard(d: ScorecardData, th: ScorecardTheme, avatar?: HTMLImageElement | null): HTMLCanvasElement {
  const W = 920, pad = 44, S = 2
  const rowH = 52
  const sig = (d.signature ?? '').trim()
  const H = 250 + d.tasks.length * rowH + 64 + (d.rewards.length ? 86 : 0) + 24 + (sig ? 30 : 0)
  const c = document.createElement('canvas')
  c.width = W * S; c.height = H * S
  const ctx = c.getContext('2d')!
  ctx.scale(S, S)

  const total = d.tasks.reduce((s, t) => s + (t.score ?? 0), 0)
  const max = d.tasks.reduce((s, t) => s + t.max, 0)
  const reached = [...d.rewards].sort((a, b) => b.minScore - a.minScore).find(r => total >= r.minScore)
  const pct = max ? total / max : 0
  const plan = !!d.plan
  const color = plan ? th.ink : pct >= 0.7 ? th.good : pct >= 0.4 ? th.warn : th.bad

  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H)
  rounded(ctx, 16, 16, W - 32, H - 32, 26); ctx.fillStyle = th.card; ctx.fill()
  ctx.strokeStyle = th.line; ctx.lineWidth = 1; ctx.stroke()

  // Header
  let y = 16 + pad
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = th.mute; ctx.font = `600 13px ${th.font}`
  ctx.fillText(`GOAL CRUSHERS  ·  ${(d.period ?? `Week ${d.weekNo}`).toUpperCase()}`, 16 + pad, y + 4)
  ctx.fillStyle = th.ink; ctx.font = `500 26px ${th.display}`
  ctx.fillText(fit(ctx, d.focus || 'This week', W - 2 * pad - 320), 16 + pad, y + 42)
  ctx.fillStyle = th.ink2; ctx.font = `400 15px ${th.font}`
  ctx.fillText(range(d.from, d.to), 16 + pad, y + 68)

  // Big total, right
  ctx.textAlign = 'right'
  const big = plan ? fmt(max) : fmt(total)
  const tail = plan ? ' pts' : ` / ${fmt(max)}`
  ctx.font = `400 24px ${th.font}`
  const mW = ctx.measureText(tail).width
  ctx.fillStyle = th.mute; ctx.fillText(tail, W - 16 - pad, y + 50)
  ctx.font = `300 64px ${th.font}`; ctx.fillStyle = color
  ctx.fillText(big, W - 16 - pad - mW, y + 50)
  if (plan) {
    const f = new Date(d.from + 'T12:00:00')
    const label = `Starts ${f.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
    ctx.font = `600 13px ${th.font}`
    const lw = ctx.measureText(label).width + 24
    const x = W - 16 - pad - lw
    rounded(ctx, x, y + 64, lw, 26, 13); ctx.fillStyle = th.track; ctx.fill()
    ctx.fillStyle = th.ink2; ctx.textAlign = 'center'; ctx.fillText(label, x + lw / 2, y + 82)
  } else if (reached) {
    ctx.font = `600 13px ${th.font}`
    const label = `Earned: ${reached.reward}`
    const lw = ctx.measureText(label).width + 24
    const x = W - 16 - pad - lw
    rounded(ctx, x, y + 64, lw, 26, 13); ctx.fillStyle = th.chip; ctx.fill()
    ctx.fillStyle = th.good; ctx.textAlign = 'center'; ctx.fillText(label, x + lw / 2, y + 82)
  }
  ctx.textAlign = 'left'

  // Progress bar with reward marks
  y += 110
  const bx = 16 + pad, bw = W - 32 - 2 * pad
  rounded(ctx, bx, y, bw, 8, 4); ctx.fillStyle = th.track; ctx.fill()
  if (pct > 0) { rounded(ctx, bx, y, Math.max(8, bw * Math.min(1, pct)), 8, 4); ctx.fillStyle = color; ctx.fill() }
  for (const r of d.rewards) {
    const x = bx + bw * Math.min(1, max ? r.minScore / max : 0)
    ctx.fillStyle = th.card; ctx.fillRect(x - 1.5, y - 3, 3, 14)
  }

  // Table
  y += 40
  ctx.font = `600 12px ${th.font}`; ctx.fillStyle = th.mute
  ctx.fillText('TASK', bx, y)
  ctx.textAlign = 'right'; ctx.fillText('MAX', bx + bw - 120, y); ctx.fillText('SCORE', bx + bw, y); ctx.textAlign = 'left'
  y += 14
  for (const t of d.tasks) {
    ctx.fillStyle = th.line; ctx.fillRect(bx, y, bw, 1)
    const cy = y + rowH / 2 + 6
    ctx.font = `400 16px ${th.display}`; ctx.fillStyle = th.ink
    ctx.fillText(fit(ctx, t.title, bw - 220), bx, cy)
    ctx.font = `400 16px ${th.font}`; ctx.textAlign = 'right'
    ctx.fillStyle = th.mute; ctx.fillText(`${fmt(t.max)} ${t.max === 1 ? "pt" : "pts"}`, bx + bw - 120, cy)
    const full = t.score != null && t.score >= t.max
    ctx.fillStyle = t.score == null ? th.mute : full ? th.good : t.score === 0 ? th.bad : th.ink
    ctx.font = `600 17px ${th.font}`; ctx.fillText(t.score == null ? '–' : fmt(t.score), bx + bw, cy)
    ctx.textAlign = 'left'
    y += rowH
  }
  ctx.fillStyle = th.line; ctx.fillRect(bx, y, bw, 1)
  // Total row
  y += 40
  ctx.font = `700 15px ${th.font}`; ctx.fillStyle = th.ink; ctx.fillText('TOTAL', bx, y)
  ctx.textAlign = 'right'; ctx.fillStyle = th.mute; ctx.font = `500 16px ${th.font}`
  ctx.fillText(`${fmt(max)} pts`, bx + bw - 120, y)
  ctx.fillStyle = plan ? th.mute : color; ctx.font = `700 19px ${th.font}`; ctx.fillText(plan ? '–' : fmt(total), bx + bw, y)
  ctx.textAlign = 'left'

  // Rewards
  if (d.rewards.length) {
    y += 34
    let x = bx
    ctx.font = `500 14px ${th.font}`
    for (const r of [...d.rewards].sort((a, b) => a.minScore - b.minScore)) {
      const got = !plan && total >= r.minScore
      const label = `${fmt(r.minScore)}+  ${r.reward}`
      const w = ctx.measureText(label).width + 26
      if (x + w > bx + bw) break
      rounded(ctx, x, y, w, 32, 16)
      ctx.fillStyle = got ? th.chip : 'transparent'; ctx.fill()
      ctx.strokeStyle = got ? th.good : th.line; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = got ? th.good : th.mute; ctx.fillText(label, x + 13, y + 21)
      x += w + 10
    }
  }

  // Signature: a monogram and the name, quiet, at the foot of the card.
  if (sig) {
    const fy = H - 16 - 58
    ctx.fillStyle = th.line; ctx.fillRect(bx, fy, bw, 1)
    const cy = fy + 30
    ctx.beginPath(); ctx.arc(bx + 13, cy, 13, 0, Math.PI * 2); ctx.fillStyle = th.track; ctx.fill()
    if (avatar) {
      // The owner's picture in the circle, in place of the initial.
      ctx.save(); ctx.clip(); ctx.drawImage(avatar, bx, cy - 13, 26, 26); ctx.restore()
    } else {
      const initial = sig.replace(/^@/, '').charAt(0).toUpperCase()
      ctx.fillStyle = th.ink2; ctx.font = `600 13px ${th.display}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(initial, bx + 13, cy + 0.5)
    }
    ctx.beginPath(); ctx.arc(bx + 13, cy, 13, 0, Math.PI * 2); ctx.strokeStyle = th.line; ctx.lineWidth = 1; ctx.stroke()
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'; ctx.fillStyle = th.ink2; ctx.font = `500 14px ${th.font}`
    ctx.fillText(sig, bx + 36, cy + 0.5)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  return c
}

/** Copies the scorecard image; falls back to a download. Returns what happened. */
export async function copyScorecard(d: ScorecardData, th: ScorecardTheme): Promise<'copied' | 'downloaded'> {
  await document.fonts?.ready
  const canvas = drawScorecard(d, th, (d.signature ?? '').trim() ? await loadAvatarImage() : null)
  const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'))
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'copied'
  } catch {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `goal-crushers-${(d.period ?? `week ${d.weekNo}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    return 'downloaded'
  }
}
