/**
 * Privacy mode: hides money amounts so a screen can be screenshotted or shared.
 * App-wide and remembered; any page reads it with usePrivacy().
 */
import { useSyncExternalStore } from 'react'

const KEY = 'oura-private'
const EVENT = 'oura-private-change'

const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', fn)   // another tab toggled it
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn) }
}

export function setPrivate(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private browsing: stays for this session only */ }
  window.dispatchEvent(new Event(EVENT))
}

export function usePrivacy() {
  const hidden = useSyncExternalStore(subscribe, read, () => false)
  return { hidden, toggle: () => setPrivate(!read()) }
}

/** The mask shown in place of an amount, keeping the currency symbol. */
export const MASK = '•••••'

/** Masks every money amount inside a piece of text, e.g. "£2,112.99/mo" becomes "£•••••/mo". */
export function maskMoney(text: string): string {
  return text.replace(/([£$€])\s?-?[\d,]+(?:\.\d+)?(k|m)?/gi, `$1${MASK}`)
}

/**
 * Masks money anywhere on screen while privacy is on, including pages that
 * don't read usePrivacy() themselves (Trading, Business, sheets). It rewrites
 * text nodes holding an amount with a currency sign, keeps each original, and
 * puts them back when privacy goes off. Inputs are left alone so editing works.
 */
export function startMoneyMask(root: Node = document.body): () => void {
  const orig = new WeakMap<Text, { was: string; now: string }>()
  const masked = new Set<Text>()
  const skip = (t: Text) => !!t.parentElement?.closest('input, textarea, [contenteditable="true"], script, style')
  const mask = (t: Text) => {
    if (skip(t)) return
    const v = t.nodeValue ?? ''
    // A chart's value axis gives the scale away even without a currency sign.
    // React often renders "$" and the number as neighbouring text nodes: a number right after a currency sign is money too.
    const prev = t.previousSibling?.nodeType === Node.TEXT_NODE ? t.previousSibling.nodeValue ?? '' : ''
    const m = t.parentElement?.closest('.recharts-yAxis') && /\d/.test(v) ? MASK
      : /[£$€]\s?-?$/.test(prev) ? maskMoney(v).replace(/^\s?-?[\d,]+(?:\.\d+)?(k|m)?/i, MASK)
      : maskMoney(v)
    if (m !== v) { orig.set(t, { was: v, now: m }); masked.add(t); t.nodeValue = m }
  }
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { mask(n as Text); return }
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT)
    for (let t = w.nextNode(); t; t = w.nextNode()) mask(t as Text)
  }
  walk(root)
  const obs = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') mask(r.target as Text)
      else r.addedNodes.forEach(walk)
    }
  })
  obs.observe(root, { subtree: true, childList: true, characterData: true })
  return () => {
    obs.disconnect()
    // Put back only what is still showing the mask; anything React has rewritten since is already real.
    for (const t of masked) { const o = orig.get(t); if (o && t.isConnected && t.nodeValue === o.now) t.nodeValue = o.was }
    masked.clear()
  }
}
