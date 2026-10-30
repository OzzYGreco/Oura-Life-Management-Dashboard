/**
 * A client's history: what changed and when, in a sentence each. Written by the
 * routes that make the change, inside the same transaction, so a change that
 * rolls back leaves no line behind.
 */
import { businessEvents } from '../db/schema'
import type { Tx } from './payments'

export type EventKind =
  | 'plan' | 'price' | 'pause' | 'resume' | 'cancel' | 'reinstate'
  | 'left' | 'notice' | 'back' | 'left-date'
  | 'payment' | 'refund' | 'moved' | 'settled' | 'hold' | 'void' | 'restore'

export function logEvent(tx: Tx, clientId: number | null, kind: EventKind, summary: string, data?: unknown): void {
  tx.insert(businessEvents).values({ clientId, kind, summary, data: data ?? null }).run()
}
