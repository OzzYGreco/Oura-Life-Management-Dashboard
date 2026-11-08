/**
 * Native macOS notifications, sent by the server so they work with the
 * browser closed. The first choice is Arete.app (native/notifier): its own
 * entry in System Settings, the Arete icon, alerts that stay on screen, a
 * sound, and a click opens the page. Falls back to terminal-notifier, then to
 * AppleScript (which macOS files under Script Editor and often delivers
 * quietly). Every notification has a key and is sent at most once, ever.
 */
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { notificationsSent } from '../db/schema'

const APP = [
  path.join(__dirname, '../../../native/notifier/build/Arete.app'),
  path.join(os.homedir(), 'Applications/Arete.app'),
].find(p => existsSync(path.join(p, 'Contents/MacOS/arete-notify')))
const NOTIFIER = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier'].find(p => existsSync(p))
/** The sound every reminder plays: a macOS system sound by name. */
const SOUND = 'Glass'

export interface Note { key: string; title: string; body: string; subtitle?: string; url?: string }

function run(cmd: string, args: string[]) {
  return new Promise<{ ok: boolean; out: string }>((resolve) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      if (err) console.error('[notify] failed:', err.message)
      resolve({ ok: !err, out: String(stdout ?? '').trim() })
    })
  })
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Sends one notification now, by whichever route is available. */
export async function send(n: Note): Promise<boolean> {
  if (APP) {
    const args = ['-g', '-n', '-a', APP, '--args', '--title', n.title, '--body', n.body, '--id', n.key, '--sound', SOUND]
    if (n.subtitle) args.push('--subtitle', n.subtitle)
    if (n.url) args.push('--url', n.url)
    return (await run('open', args)).ok
  }
  if (NOTIFIER) {
    const args = ['-title', 'Arete', '-subtitle', n.title, '-message', n.body, '-group', n.key, '-sound', SOUND]
    if (n.url) args.push('-open', n.url)
    return (await run(NOTIFIER, args)).ok
  }
  return (await run('osascript', ['-e', `display notification "${esc(n.body)}" with title "Arete" subtitle "${esc(n.title)}" sound name "${SOUND}"`])).ok
}

/** Sends a notification unless one with this key was already sent. Returns whether it was sent. */
export async function notifyOnce(n: Note): Promise<boolean> {
  const [seen] = await db.select().from(notificationsSent).where(eq(notificationsSent.key, n.key))
  if (seen) return false
  // Record first, so a crash mid-send never causes a repeat.
  await db.insert(notificationsSent).values({ key: n.key })
  return send(n)
}

export const notifierInstalled = () => !!APP || !!NOTIFIER

export interface NotifierStatus {
  via: 'arete' | 'terminal-notifier' | 'applescript'
  /** What macOS allows Arete.app to do; null on the fallback routes, which can't be asked. */
  permission: 'authorized' | 'denied' | 'not-determined' | 'provisional' | 'unknown' | null
  style: 'alerts' | 'banners' | 'none' | null
  sound: boolean | null
}

/** How reminders will arrive, read from macOS (Arete.app answers `--check`). */
export async function notifierStatus(): Promise<NotifierStatus> {
  if (!APP) return { via: NOTIFIER ? 'terminal-notifier' : 'applescript', permission: null, style: null, sound: null }
  const { out } = await run(path.join(APP, 'Contents/MacOS/arete-notify'), ['--check'])
  const [perm, style, snd] = out.split(' ')
  return {
    via: 'arete',
    permission: (['authorized', 'denied', 'not-determined', 'provisional'].includes(perm) ? perm : 'unknown') as NotifierStatus['permission'],
    style: (['alerts', 'banners', 'none'].includes(style) ? style : null) as NotifierStatus['style'],
    sound: snd ? snd === 'sound:on' : null,
  }
}
