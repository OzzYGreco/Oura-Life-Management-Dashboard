/** R:R, deviation and gross P&L, shared by the trade form and the Bybit sync. */
export function computeTradeFields(data: {
  entryPrice?: number | null
  exitPrice?: number | null
  size?: number | null
  direction?: string | null
  riskDollars?: number | null
  netPnl?: number | null   // actual broker P&L (after fees/slippage); used for R:R and deviation
}) {
  const { entryPrice, exitPrice, size, direction, riskDollars, netPnl: incomingNetPnl } = data
  let realizedPnl: number | null = null
  let deviationPct: number | null = null
  let rrRatio: number | null = null

  if (entryPrice != null && exitPrice != null && size != null && direction) {
    const mult = direction === 'Long' ? 1 : -1
    realizedPnl = (exitPrice - entryPrice) * size * mult
  }

  // Prefer netPnl (broker actual) for ratio calculations; fall back to gross realizedPnl
  const pnlForRatios = incomingNetPnl ?? realizedPnl

  if (pnlForRatios != null && riskDollars != null && riskDollars > 0) {
    rrRatio = pnlForRatios / riskDollars
    // Deviation, as the trader's sheet measures it: how much of the loss
    // went past the planned risk, as a share of the loss. 0 on wins and on
    // losses within plan. The trader's rule: at most 10%.
    const absPnl = Math.abs(pnlForRatios)
    deviationPct = pnlForRatios >= 0 || absPnl <= riskDollars
      ? 0
      : (absPnl - riskDollars) / absPnl * 100
  }

  return { realizedPnl, deviationPct, rrRatio }
}
