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
import { listTrash, listUnusedSessions } from './host'
import type { TrashEntry, UnusedSessionRow } from './host'

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

/**
 * A trash request, opened from the sidebar foot.
 *
 * Like the cleanup, it reads the Host first: what is restorable is the Host's
 * answer, and the dialog shows what it is waiting for until it arrives.
 */
export interface TrashRequest {
  readonly kind: 'trash'
  /** True while the Host's listing is in flight. */
  readonly loading: boolean
  /** The entries once they arrive. */
  readonly entries?: readonly TrashEntry[] | undefined
  /** The Host's retention window, for the dialog's copy. */
  readonly retentionDays?: number | undefined
  /** Why the load failed, worded for the operator by the dialog. */
  readonly loadError?: unknown
}

/** Either pending request. */
export type PendingRequest = DeleteRequest | CleanupRequest | TrashRequest

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

/**
 * Open the trash.
 *
 * The listing comes from the Host (it expires what has aged out before answering),
 * so the dialog waits for it the same way the cleanup does, and a failure is carried
 * rather than shown as an empty trash — "nothing to restore" and "we could not ask"
 * are very different things to tell someone who just deleted a conversation.
 */
export function requestTrash(): void {
  pending = { kind: 'trash', loading: true }
  publish()
  void listTrash().then(
    (listing) => {
      if (pending === null || pending.kind !== 'trash') return
      pending = { kind: 'trash', loading: false, entries: listing.entries, retentionDays: listing.retentionDays }
      publish()
    },
    (error: unknown) => {
      if (pending === null || pending.kind !== 'trash') return
      pending = { kind: 'trash', loading: false, loadError: error }
      publish()
    }
  )
}

/**
 * Re-read the trash into an open request, after a restore or a purge changed it.
 * @param current - the request the dialog is showing.
 */
export function refreshTrash(current: TrashRequest): void {
  if (pending === null || pending.kind !== 'trash') return
  pending = { kind: 'trash', loading: true, entries: current.entries, retentionDays: current.retentionDays }
  publish()
  void listTrash().then(
    (listing) => {
      if (pending === null || pending.kind !== 'trash') return
      pending = { kind: 'trash', loading: false, entries: listing.entries, retentionDays: listing.retentionDays }
      publish()
    },
    (error: unknown) => {
      if (pending === null || pending.kind !== 'trash') return
      pending = { kind: 'trash', loading: false, loadError: error }
      publish()
    }
  )
}

/** Close the pending confirmation (accepted, cancelled, or dismissed). */
export function settleRequest(): void {
  pending = null
  publish()
}
