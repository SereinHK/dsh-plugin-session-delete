/**
 * The one pending destructive request this package owns.
 *
 * A menu row, a sidebar action, and the overlay dialogs are separate slot
 * entries in separate scopes, so they cannot pass props to each other; this
 * module-scoped store is their only channel. It is deliberately tiny and
 * subscription-based rather than the slot `store` seat: the dialogs are
 * root-scoped overlays with no per-occurrence identity to key a store by.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/pending
 */
import * as React from 'react'

/** One conversation's removal request, opened from its row menu. */
export interface DeleteRequest {
  readonly kind: 'delete'
  readonly sessionId: string
  readonly displayTitle: string
}

/** A bulk blank-Session cleanup request, opened from the sidebar action. */
export interface CleanupRequest {
  readonly kind: 'cleanup'
}

/** Either pending request. */
export type PendingRequest = DeleteRequest | CleanupRequest

let pending: PendingRequest | null = null
const listeners = new Set<() => void>()

/** Notify every mounted subscriber. */
function publish(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Read the pending request inside a component.
 * @returns the current request, or null.
 */
export function usePendingRequest(): PendingRequest | null {
  const [value, setValue] = React.useState<PendingRequest | null>(pending)
  React.useEffect(() => {
    const listener = (): void => {
      setValue(pending)
    }
    listeners.add(listener)
    // Re-read once on mount: the request may have opened between render and effect.
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}

/** Open the confirmation for one conversation. */
export function requestDelete(sessionId: string, displayTitle: string): void {
  pending = { kind: 'delete', sessionId, displayTitle }
  publish()
}

/** Open the blank-Session cleanup confirmation. */
export function requestCleanup(): void {
  pending = { kind: 'cleanup' }
  publish()
}

/** Close the pending confirmation (accepted, cancelled, or dismissed). */
export function settleRequest(): void {
  pending = null
  publish()
}
