/**
 * Live: a private WebSocket per account. Bybit pushes every fill, order and
 * position change the moment it happens; each push triggers a short sync, so a
 * trade is in the journal seconds after it is taken and filled in seconds after
 * it closes. The socket is only the trigger; the REST sync stays the source of
 * truth, so a dropped message costs nothing.
 *
 * While the server is off nothing arrives. On start it catches up from the last
 * stored fill, and a slow timer covers a socket that dies quietly.
 */
import { WS_PRIVATE, wsAuthArgs, credentialsFor } from './client'
import { syncAccount, syncedAccounts } from './sync'

const DEBOUNCE_MS = 1500
const FALLBACK_MS = 10 * 60 * 1000

export interface StreamState { connected: boolean; since: number | null; lastMessageAt: number | null }
const state = new Map<number, StreamState>()
export const streamState = (accountId: number): StreamState =>
  state.get(accountId) ?? { connected: false, since: null, lastMessageAt: null }

function log(name: string, msg: string) { console.log(`[bybit:${name}] ${msg}`) }

function connect(accountId: number, name: string, keyName: string, attempt = 0) {
  const creds = credentialsFor(keyName)
  if (!creds) return
  const ws = new WebSocket(WS_PRIVATE)
  let ping: NodeJS.Timeout | undefined
  let debounce: NodeJS.Timeout | undefined
  const st: StreamState = { connected: false, since: null, lastMessageAt: null }
  state.set(accountId, st)

  const trigger = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      syncAccount(accountId).then(r => {
        if (!r.ok || r.created || r.updated) log(name, r.message)
      })
    }, DEBOUNCE_MS)
  }

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ op: 'auth', args: wsAuthArgs(creds) }))
  })
  ws.addEventListener('message', ev => {
    let m: any
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.op === 'auth') {
      if (!m.success) { log(name, `live connection refused: ${m.ret_msg}`); ws.close(); return }
      ws.send(JSON.stringify({ op: 'subscribe', args: ['execution', 'order', 'position'] }))
      st.connected = true; st.since = Date.now(); attempt = 0
      ping = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ op: 'ping' })), 20_000)
      log(name, 'live')
      trigger()   // catch anything that happened while disconnected
      return
    }
    if (m.topic) { st.lastMessageAt = Date.now(); trigger() }
  })
  ws.addEventListener('close', () => {
    clearInterval(ping)
    st.connected = false
    const wait = Math.min(60_000, 2000 * 2 ** attempt)
    setTimeout(() => connect(accountId, name, keyName, attempt + 1), wait)
  })
  ws.addEventListener('error', () => { /* close follows; reconnect happens there */ })
}

let started = false
export function startBybitSync(): void {
  if (started) return
  const accounts = syncedAccounts()
  if (!accounts.length) return
  started = true
  for (const a of accounts) {
    syncAccount(a.id).then(r => log(a.name, r.message))
    connect(a.id, a.name, a.bybitKey!)
  }
  setInterval(() => { for (const a of syncedAccounts()) syncAccount(a.id) }, FALLBACK_MS)
  console.log(`[bybit] sync enabled for ${accounts.map(a => a.name).join(', ')}`)
}
