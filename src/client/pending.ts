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
import { listUnusedSessions } from './host'
import type { UnusedSessionRow } from './host'

/** One conversation's removal request, opened from its row menu. */
export interface DeleteRequest {
  readonly kind: 'delete'
  readonly sessionId: string
  readonly displayTitle: string
}

/**
 * A bulk blank-Session cleanup request, opened from the sidebar action.
 *
 * The durable facts come from the Host, so the request carries its own load state:
 * the dialog cannot decide anything until they arrive, and the page has no other
 * way to learn whether a stored Session is blank.
 */
export interface CleanupRequest {
  readonly kind: 'cleanup'
  /** True while the Host's durable facts are in flight. */
  readonly loading: boolean
  /** The Host's rows once they arrive. */
  readonly rows?: readonly UnusedSessionRow[] | undefined
  /** Why the load failed, worded for the operator by the dialog. */
  readonly loadError?: unknown
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

/**
 * Open the blank-Session cleanup confirmation.
 *
 * The Host is asked for the durable per-Session facts first, and the dialog shows
 * its loading state until they arrive. A failure is carried on the request so the
 * dialog can word it, rather than being swallowed into an empty plan — which would
 * read as "nothing to clean" when the truth is "we could not find out".
 */
export function requestCleanup(): void {
  pending = { kind: 'cleanup', loading: true }
  publish()
  void listUnusedSessions().then(
    (rows) => {
      // A newer request (or a dismissal) owns the store now; drop this answer.
      if (pending === null || pending.kind !== 'cleanup') return
      pending = { kind: 'cleanup', loading: false, rows }
      publish()
    },
    (error: unknown) => {
      if (pending === null || pending.kind !== 'cleanup') return
      pending = { kind: 'cleanup', loading: false, loadError: error }
      publish()
    }
  )
}

/** Close the pending confirmation (accepted, cancelled, or dismissed). */
export function settleRequest(): void {
  pending = null
  publish()
}
