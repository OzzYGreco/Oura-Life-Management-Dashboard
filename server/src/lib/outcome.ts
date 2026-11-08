/**
 * A trade's result, the same rule everywhere (the client's lib/tradeStats.ts
 * holds the twin): inside ±0.1R it is breakeven, decided by fees rather than
 * the setup. A trade with no R is judged by its dollars.
 */
export const BE_R = 0.1

export type Outcome = 'win' | 'loss' | 'be'

export function outcomeOf(r: number | null | undefined, pnl: number): Outcome {
  if (r != null) return r >= BE_R ? 'win' : r <= -BE_R ? 'loss' : 'be'
  return pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be'
}
