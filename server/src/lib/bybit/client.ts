/**
 * Bybit V5, read-only.
 *
 * Each trading account names a key pair in `server/.env`:
 *   BYBIT_<key>_KEY / BYBIT_<key>_SECRET     (e.g. BYBIT_TRADING_KEY)
 * The keys only need Read-Only "Contract -> Orders, Positions". They never
 * touch the database or the repo.
 */
import crypto from 'crypto'

const BASE = 'https://api.bybit.com'
export const WS_PRIVATE = 'wss://stream.bybit.com/v5/private'
const RECV_WINDOW = '10000'

export interface Credentials { key: string; secret: string }

export function credentialsFor(keyName: string | null | undefined): Credentials | null {
  if (!keyName) return null
  const key = process.env[`BYBIT_${keyName}_KEY`]?.trim()
  const secret = process.env[`BYBIT_${keyName}_SECRET`]?.trim()
  return key && secret ? { key, secret } : null
}

export class BybitError extends Error {
  constructor(message: string, public code?: number) { super(message) }
}

/** What a failure means for the person reading it, not Bybit's error code. */
function explain(http: number, retCode: number | undefined, retMsg: string | undefined): string {
  if (http === 403 || retCode === 10024 || /country|region|restricted/i.test(retMsg ?? '')) {
    return 'Bybit refused the connection from this location. If a VPN is on, switch to a server in another country (not the US or UK) and it will pick up again.'
  }
  if (retCode === 10003 || retCode === 10004) return 'Bybit rejected the API key or secret. Check them in server/.env.'
  if (retCode === 33004) return 'The Bybit API key has expired. Make a new read-only key and put it in server/.env.'
  if (retCode === 10010) return 'This IP is not allowed for the Bybit key. Remove the IP restriction on the key.'
  if (retCode === 10005) return 'The Bybit key is missing a permission: it needs Read-Only Contract -> Orders and Positions.'
  if (retCode === 10002) return 'This computer\'s clock is off from Bybit\'s. Turn on automatic date and time.'
  return `Bybit error ${retCode ?? http}: ${retMsg ?? 'no message'}`
}

function sign(creds: Credentials, payload: string): string {
  return crypto.createHmac('sha256', creds.secret).update(payload).digest('hex')
}

async function getOnce(creds: Credentials, path: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString()
  const ts = Date.now().toString()
  const res = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'X-BAPI-API-KEY': creds.key,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': sign(creds, ts + creds.key + RECV_WINDOW + qs),
    },
  })
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { throw new BybitError(explain(res.status, undefined, text.slice(0, 120))) }
  if (res.status !== 200 || body.retCode !== 0) throw new BybitError(explain(res.status, body.retCode, body.retMsg), body.retCode)
  return body.result
}

/** Signed GET with retries on network trouble (VPNs drop connections). */
export async function bybitGet(creds: Credentials, path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getOnce(creds, path, params)
    } catch (e) {
      // A Bybit answer is final; only retry when the request never got one.
      if (e instanceof BybitError || attempt >= 4) {
        if (e instanceof BybitError) throw e
        throw new BybitError(`Could not reach Bybit (${(e as Error).message}). Check the internet or VPN connection.`)
      }
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
}

const WEEK = 7 * 24 * 3600 * 1000

/**
 * Pages through an endpoint that only answers 7 days at a time, from `since`
 * to now. Bybit keeps two years; anything older is not served.
 */
export async function bybitWindowed(creds: Credentials, path: string, base: Record<string, string>, since: number): Promise<any[]> {
  const out: any[] = []
  const earliest = Date.now() - 729 * 24 * 3600 * 1000
  const until = Date.now()
  for (let start = Math.max(since, earliest); start < until; start += WEEK) {
    const end = Math.min(start + WEEK - 1, until)
    let cursor: string | undefined
    do {
      const r = await bybitGet(creds, path, { ...base, startTime: start, endTime: end, limit: 100, cursor })
      out.push(...(r.list ?? []))
      cursor = r.nextPageCursor || undefined
    } while (cursor)
  }
  return out
}

/** The auth message for the private WebSocket. */
export function wsAuthArgs(creds: Credentials): [string, number, string] {
  const expires = Date.now() + 10_000
  return [creds.key, expires, sign(creds, `GET/realtime${expires}`)]
}

export async function keyInfo(creds: Credentials): Promise<{ expiresAt: string | null; readOnly: boolean }> {
  const r = await bybitGet(creds, '/v5/user/query-api')
  return { expiresAt: r.expiredAt || null, readOnly: r.readOnly === 1 }
}
