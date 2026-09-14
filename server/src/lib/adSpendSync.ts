/**
 * Daily ad spend, pulled from the ad platforms.
 *
 * The problem this solves: ad spend leaves the bank every day, and the only way
 * to record it was to open each campaign and overwrite one lifetime number by
 * hand. Miss a few days and every profit figure in the app is wrong until you
 * catch up.
 *
 * Credentials live in `server/.env` and never in the database or the repo. With
 * none set, every function here is inert and the manual entry path is the only
 * one, which is exactly the intended fallback.
 *
 * Getting a Meta token (one-off, about ten minutes):
 *   1. business.facebook.com -> Business settings -> Users -> System users
 *   2. Add a system user, give it the ad account with "View performance"
 *   3. Generate a token with the `ads_read` scope. System user tokens do not
 *      expire, unlike the 60-day user tokens.
 *   4. The ad account id is the number after `act_` in Ads Manager's URL.
 *
 * Then in `server/.env`:
 *   META_ACCESS_TOKEN=...
 *   META_AD_ACCOUNT_ID=1234567890
 */
import { db } from '../db'
import { marketingCampaigns, marketingSpendDaily } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import { localToday } from './date'

const META_API_VERSION = 'v21.0'

export interface SyncResult {
  platform: string
  ok: boolean
  /** Days written or updated. */
  days: number
  campaignsTouched: number
  message: string
}

export interface DailySpendRow {
  externalId: string
  externalName: string
  date: string
  spend: number
  impressions?: number
  clicks?: number
  leads?: number
}

export function metaConfigured(): boolean {
  return !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID)
}

export function configuredPlatforms(): string[] {
  return metaConfigured() ? ['meta'] : []
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * One row per campaign per day from the Meta Marketing API.
 *
 * `time_increment=1` is the whole trick: without it Meta returns one aggregate
 * for the range, which is the same lifetime-total problem in a new wrapper.
 */
export async function fetchMetaSpend(since: string, until: string): Promise<DailySpendRow[]> {
  const token = process.env.META_ACCESS_TOKEN
  const account = process.env.META_AD_ACCOUNT_ID
  if (!token || !account) throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are not set')

  const act = account.startsWith('act_') ? account : `act_${account}`
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,date_start',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
    access_token: token,
  })

  const rows: DailySpendRow[] = []
  let url = `https://graph.facebook.com/${META_API_VERSION}/${act}/insights?${params}`

  // Meta pages results, and a busy account easily exceeds one page.
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url)
    const body: any = await res.json()

    if (!res.ok || body.error) {
      const e = body?.error
      throw new Error(e?.message ? `Meta: ${e.message}` : `Meta returned ${res.status}`)
    }

    for (const d of body.data ?? []) {
      const spend = Number(d.spend)
      if (!Number.isFinite(spend)) continue
      rows.push({
        externalId:   String(d.campaign_id),
        externalName: String(d.campaign_name ?? ''),
        date:         String(d.date_start),
        spend,
        impressions:  d.impressions != null ? Number(d.impressions) : undefined,
        clicks:       d.clicks != null ? Number(d.clicks) : undefined,
      })
    }
    url = body.paging?.next ?? ''
  }

  return rows
}

/**
 * Write fetched rows against local campaigns.
 *
 * Matching is by `external_id` first, then by name, so a campaign linked once
 * stays linked even if it is renamed on the platform. Rows for a campaign this
 * app has never heard of are reported rather than invented, because guessing
 * would put spend against the wrong client's numbers.
 */
export async function applySpendRows(rows: DailySpendRow[], platform: string): Promise<SyncResult> {
  const campaigns = await db.select().from(marketingCampaigns)
  const now = new Date().toISOString()

  const byExternal = new Map(campaigns.filter(c => c.externalId).map(c => [c.externalId!, c]))
  const byName = new Map(campaigns.map(c => [c.name.trim().toLowerCase(), c]))

  let days = 0
  const touched = new Set<number>()
  const unmatched = new Set<string>()

  for (const r of rows) {
    const campaign = byExternal.get(r.externalId)
      ?? byName.get(r.externalName.trim().toLowerCase())
    if (!campaign) {
      unmatched.add(r.externalName || r.externalId)
      continue
    }

    // Link on first sight so a later rename cannot break the match.
    if (!campaign.externalId) {
      await db.update(marketingCampaigns)
        .set({ externalId: r.externalId, externalSource: platform })
        .where(eq(marketingCampaigns.id, campaign.id))
      campaign.externalId = r.externalId
    }

    await db.insert(marketingSpendDaily)
      .values({
        campaignId: campaign.id,
        date: r.date,
        spend: r.spend,
        impressions: r.impressions ?? null,
        clicks: r.clicks ?? null,
        source: platform,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: [marketingSpendDaily.campaignId, marketingSpendDaily.date],
        set: {
          spend: r.spend,
          impressions: r.impressions ?? null,
          clicks: r.clicks ?? null,
          source: platform,
          syncedAt: now,
        },
      })

    days++
    touched.add(campaign.id)
  }

  for (const id of touched) await recomputeCampaignSpend(id)

  const note = unmatched.size
    ? ` ${unmatched.size} campaign(s) on ${platform} have no match here: ${[...unmatched].slice(0, 3).join(', ')}.`
    : ''

  return {
    platform,
    ok: true,
    days,
    campaignsTouched: touched.size,
    message: `${days} day(s) across ${touched.size} campaign(s).${note}`,
  }
}

/**
 * Note when a campaign was last synced. Deliberately does NOT rewrite the
 * campaign's lifetime `spent`.
 *
 * A first attempt did, and it was wrong in a way worth recording: recording
 * three days against a campaign that had been running for four months replaced
 * its £1,668 lifetime total with £58. Daily rows are almost always a partial
 * view, and the lifetime figure is what the estimate for the days before
 * recording began is derived from. Overwriting it destroys the fallback.
 */
export async function recomputeCampaignSpend(campaignId: number): Promise<void> {
  const [any] = await db
    .select({ n: sql<number>`count(*)` })
    .from(marketingSpendDaily)
    .where(eq(marketingSpendDaily.campaignId, campaignId))
  if (!any?.n) return

  await db.update(marketingCampaigns)
    .set({ lastSyncedAt: new Date().toISOString() })
    .where(eq(marketingCampaigns.id, campaignId))
}

/** Pull the trailing window from every configured platform. */
export async function syncAdSpend(lookbackDays = 14): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  if (metaConfigured()) {
    try {
      // Meta restates recent days as conversions settle, so a trailing window is
      // re-pulled every time rather than only yesterday.
      const rows = await fetchMetaSpend(daysAgo(lookbackDays), localToday())
      results.push(await applySpendRows(rows, 'meta'))
    } catch (e: any) {
      results.push({
        platform: 'meta', ok: false, days: 0, campaignsTouched: 0,
        message: e?.message ?? 'Meta sync failed',
      })
    }
  }

  return results
}

// ─── Daily schedule ───────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null

/**
 * Runs once at boot and then once a day. This is a local-first app on a machine
 * that sleeps, so the interval is deliberately naive: the trailing window means
 * a missed run costs nothing, the next one picks the days back up.
 */
export function startAdSpendSchedule(): void {
  if (timer || !configuredPlatforms().length) return

  const run = async () => {
    try {
      const results = await syncAdSpend()
      for (const r of results) {
        console.log(`[adspend] ${r.platform}: ${r.ok ? r.message : 'FAILED ' + r.message}`)
      }
    } catch (e: any) {
      console.error('[adspend] sync failed:', e?.message ?? e)
    }
  }

  setTimeout(run, 10_000)
  timer = setInterval(run, 24 * 60 * 60 * 1000)
  console.log(`[adspend] daily sync enabled for: ${configuredPlatforms().join(', ')}`)
}
