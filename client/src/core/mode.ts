/**
 * Light or dark, for the new layout. "system" follows macOS. Remembered in
 * this browser; applied as data-mode on <html>, which skins.css reads.
 */
import { useEffect, useSyncExternalStore } from 'react'

export type ModePref = 'dark' | 'light' | 'system'
const KEY = 'oura-mode'
const EVENT = 'oura-mode-change'
const mq = () => window.matchMedia('(prefers-color-scheme: light)')

const readPref = (): ModePref => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'system' ? v : 'dark' } catch { return 'dark' } }
const resolve = (p: ModePref): 'dark' | 'light' => (p === 'system' ? (mq().matches ? 'light' : 'dark') : p)

const subscribe = (fn: () => void) => {
  const m = mq()
  window.addEventListener(EVENT, fn); window.addEventListener('storage', fn); m.addEventListener('change', fn)
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); m.removeEventListener('change', fn) }
}

export function setModePref(p: ModePref) {
  try { localStorage.setItem(KEY, p) } catch { /* private mode: this session only */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Applied before React renders, so a light page never flashes dark. */
export function applyModeEarly() { document.documentElement.dataset.mode = resolve(readPref()) }

export function useMode() {
  const pref = useSyncExternalStore(subscribe, readPref, () => 'dark' as ModePref)
  const mode = useSyncExternalStore(subscribe, () => resolve(readPref()), () => 'dark' as const)
  useEffect(() => { document.documentElement.dataset.mode = mode }, [mode])
  return { pref, mode, setPref: setModePref, toggle: () => setModePref(mode === 'dark' ? 'light' : 'dark') }
}
