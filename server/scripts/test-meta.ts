/**
 * Check a Meta ad account connection before trusting it.
 *
 * Meta's errors are famously unhelpful ("Unsupported get request" covers at
 * least four different mistakes), so this checks one thing at a time and says
 * which step failed and what to do about it.
 *
 * Run with:  npm run test:meta --prefix server
 */
import { localToday } from '../src/lib/date'

const TOKEN = process.env.META_ACCESS_TOKEN
const ACCOUNT = process.env.META_AD_ACCOUNT_ID
const V = 'v21.0'

const ok = (m: string) => console.log(`  PASS  ${m}`)
const bad = (m: string, fix?: string) => {
  console.log(`  FAIL  ${m}`)
  if (fix) console.log(`        ${fix}`)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function get(path: string): Promise<any> {
  const res = await fetch(`https://graph.facebook.com/${V}/${path}`)
  const body: any = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function main() {
  console.log('\nChecking the Meta connection\n')

  // ── 1. Are the two values even present ────────────────────────────────────
  if (!TOKEN || !ACCOUNT) {
    bad('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are not both set',
      'Put them in server/.env, then run this again. See server/.env.example.')
    process.exit(1)
  }
  ok(`Both values are set. Ad account ${ACCOUNT}, token ends ...${TOKEN.slice(-6)}`)

  // ── 2. Is the token valid at all ──────────────────────────────────────────
  const me = await get(`me?fields=id,name&access_token=${TOKEN}`)
  if (me.body?.error) {
    bad(`The token was rejected: ${me.body.error.message}`,
      'Generate a new one under Business settings > Users > System users > Generate new token.')
    process.exit(1)
  }
  ok(`The token works. It belongs to "${me.body.name ?? me.body.id}"`)

  // ── 3. Does the token carry ads_read ──────────────────────────────────────
  const perms = await get(`debug_token?input_token=${TOKEN}&access_token=${TOKEN}`)
  const scopes: string[] = perms.body?.data?.scopes ?? []
  const expires = perms.body?.data?.expires_at
  if (scopes.length) {
    if (scopes.includes('ads_read')) ok(`Scopes include ads_read (${scopes.join(', ')})`)
    else bad(`ads_read is missing. Scopes are: ${scopes.join(', ') || 'none'}`,
      'Regenerate the token and tick ads_read.')
  }
  if (expires === 0 || expires == null) {
    ok('The token does not expire, which is what a system user token should do')
  } else {
    const when = new Date(expires * 1000).toISOString().slice(0, 10)
    bad(`This token expires on ${when}`,
      'That is a user token, not a system user token. It will stop working. Generate one under Business settings > Users > System users instead.')
  }

  // ── 4. Can it see the ad account ──────────────────────────────────────────
  const act = ACCOUNT.startsWith('act_') ? ACCOUNT : `act_${ACCOUNT}`
  const account = await get(`${act}?fields=name,currency,account_status&access_token=${TOKEN}`)
  if (account.body?.error) {
    bad(`Cannot read ad account ${act}: ${account.body.error.message}`,
      'Assign the ad account to the system user with "View performance": Business settings > Users > System users > your user > Add assets > Ad accounts.')
    process.exit(1)
  }
  ok(`Ad account reachable: "${account.body.name}" in ${account.body.currency}`)
  if (account.body.currency !== 'GBP') {
    console.log(`        Note: the account reports ${account.body.currency}, and the app records spend as GBP.`)
  }

  // ── 5. Does daily spend actually come back ────────────────────────────────
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,date_start',
    time_increment: '1',
    time_range: JSON.stringify({ since: daysAgo(7), until: localToday() }),
    limit: '200',
    access_token: TOKEN,
  })
  const insights = await get(`${act}/insights?${params}`)
  if (insights.body?.error) {
    bad(`Insights failed: ${insights.body.error.message}`)
    process.exit(1)
  }

  const rows: any[] = insights.body?.data ?? []
  if (!rows.length) {
    ok('The insights call works, but returned no days for the last week')
    console.log('        Either nothing has been spent recently, or the campaigns sit under a different ad account.')
  } else {
    const byCampaign = new Map<string, number>()
    for (const r of rows) byCampaign.set(r.campaign_name, (byCampaign.get(r.campaign_name) ?? 0) + Number(r.spend || 0))
    ok(`${rows.length} day-rows came back across ${byCampaign.size} campaign(s) in the last 7 days`)
    console.log()
    for (const [name, total] of [...byCampaign].sort((a, b) => b[1] - a[1])) {
      console.log(`        ${total.toFixed(2).padStart(9)}   ${name}`)
    }
    console.log()
    console.log('        Campaign names must match what you have in the Business tab, or be linked')
    console.log('        on the first sync. Anything unmatched is reported, never guessed at.')
  }

  console.log('\nReady. Restart the server and the daily sync will run on its own.\n')
}

main().catch(e => {
  console.error('\nUnexpected failure:', e?.message ?? e, '\n')
  process.exit(1)
})
