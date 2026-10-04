/**
 * The browser half's Host calls: `POST /api/session.delete` for one conversation
 * (a move into the trash), `POST /api/session.unused` for the durable per-Session
 * facts, and the trash routes that list, restore and destroy what is in there —
 * plus the wording for the failures the operator can act on.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/host
 */
import type { Translate } from './contract'

/** The Host route this package's node half registers inside Connection's `/api` fence. */
export const DELETE_PATH = '/api/session.delete'

/** The Host route reporting durable per-Session facts (blankness among them). */
export const UNUSED_PATH = '/api/session.unused'

/** The Host route listing the trash. */
export const TRASH_PATH = '/api/session.trash'

/** The Host route restoring one trashed Session. */
export const RESTORE_PATH = '/api/session.restore'

/** The Host route destroying trashed Sessions. */
export const PURGE_PATH = '/api/session.purge'

/** One trashed Session, as the Host reports it. */
export interface TrashEntry {
  readonly sessionId: string
  readonly cwd: string
  readonly title?: string | undefined
  readonly bytes?: number | undefined
  readonly deletedAt: number
  readonly expiresAt: number
  readonly files: readonly string[]
}

/** What the trash listing answers. */
export interface TrashListing {
  readonly entries: readonly TrashEntry[]
  /** Days a trashed Session stays restorable, as the Host is configured. */
  readonly retentionDays: number
}

/** The Host's success report for one removal. */
export interface DeleteReport {
  readonly sessionId: string
  readonly directory: string
  readonly files: readonly string[]
  readonly cacheRemoved: boolean
  readonly trashEntry: TrashEntry
}

/** Durable facts about one stored Session, as the Host reports them. */
export interface UnusedSessionRow {
  readonly sessionId: string
  readonly cwd: string
  /** The Session's title from the Host's projection, when it has one. */
  readonly title?: string | undefined
  /** Bytes this Session occupies, when the Host could measure them. */
  readonly bytes?: number | undefined
  readonly createdAt: number | null
  readonly updatedAt: number
  /** True only when the Host's durable projection says the log holds no accepted prompt. */
  readonly blank: boolean
  /** False when the Host had no projection record, so `blank` proves nothing. */
  readonly proven: boolean
  readonly lastPromptAt: number | null
}

/** A refusal carrying the Host's stable machine code. */
export interface SessionDeleteFailure extends Error {
  readonly code: string
}

/** Host failure codes this package words for itself; anything else keeps the Host diagnostic. */
const WORDED_FAILURES: Readonly<Record<string, string>> = {
  'session-live': 'dialog.live',
  'session-not-found': 'dialog.notFound',
  'unsafe-target': 'dialog.unsafe'
}

/**
 * Ask the Host to remove one conversation.
 * @param sessionId - the Session to delete.
 * @returns the Host's report.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
export async function deleteSession(sessionId: string): Promise<DeleteReport> {
  const response = await fetch(DELETE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId })
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const envelope = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  if (envelope?.ok === true) return envelope.value as DeleteReport

  const error = envelope?.error !== null && typeof envelope?.error === 'object'
    ? envelope.error as Record<string, unknown>
    : undefined
  const failure = new Error(
    typeof error?.message === 'string' ? error.message : `HTTP ${String(response.status)}`
  ) as SessionDeleteFailure & { code: string }
  failure.code = typeof error?.code === 'string' ? error.code : 'transport'
  throw failure
}

/** The reply the trash routes give; kept beside the calls that read it. */

/**
 * Read the Host's durable per-Session facts.
 *
 * The page cannot derive these: a stored Session's list row carries a live
 * first-turn flag that says nothing about its log, and its projection block is
 * loaded only for the Session being viewed. The Host projects every stored log, so
 * it is asked instead of guessed at.
 *
 * @returns one row per stored Session, unsorted; the caller applies its policy.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
export async function listUnusedSessions(): Promise<readonly UnusedSessionRow[]> {
  const response = await fetch(UNUSED_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const envelope = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  if (envelope?.ok === true) {
    const value = envelope.value as { readonly sessions?: unknown } | undefined
    return Array.isArray(value?.sessions) ? value.sessions as readonly UnusedSessionRow[] : []
  }

  const error = envelope?.error !== null && typeof envelope?.error === 'object'
    ? envelope.error as Record<string, unknown>
    : undefined
  const failure = new Error(
    typeof error?.message === 'string' ? error.message : `HTTP ${String(response.status)}`
  ) as SessionDeleteFailure & { code: string }
  failure.code = typeof error?.code === 'string' ? error.code : 'transport'
  throw failure
}

/**
 * Wording for the trash failures the operator can act on.
 */
const WORDED_TRASH_FAILURES: Readonly<Record<string, string>> = {
  'trash-entry-not-found': 'trash.missing',
  'session-exists': 'trash.taken',
  'unsafe-target': 'dialog.unsafe'
}

/**
 * One POST that unwraps the Host's envelope, or throws carrying its code.
 * @param path - the route.
 * @param body - the JSON body.
 * @returns the envelope's value.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const envelope = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
  if (envelope?.ok === true) return envelope.value as T
  const error = envelope?.error !== null && typeof envelope?.error === 'object'
    ? envelope.error as Record<string, unknown>
    : undefined
  const failure = new Error(
    typeof error?.message === 'string' ? error.message : `HTTP ${String(response.status)}`
  ) as SessionDeleteFailure & { code: string }
  failure.code = typeof error?.code === 'string' ? error.code : 'transport'
  throw failure
}

/**
 * List the trash, newest first.
 *
 * The Host purges anything past its retention window before answering, so an entry
 * in this list is one that can actually still be restored.
 *
 * @returns the entries and the configured window.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
export async function listTrash(): Promise<TrashListing> {
  return post<TrashListing>(TRASH_PATH, {})
}

/**
 * Put one trashed Session back where it came from.
 * @param sessionId - the Session to restore.
 * @returns where it landed.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
export async function restoreSession(sessionId: string): Promise<{ readonly sessionId: string; readonly directory: string }> {
  return post<{ readonly sessionId: string; readonly directory: string }>(RESTORE_PATH, { sessionId })
}

/**
 * Destroy trashed Sessions for good.
 * @param options - one Session, or everything.
 * @returns the ids that were destroyed.
 * @throws {SessionDeleteFailure} carrying the Host's code and message.
 */
export async function purgeTrash(options: { readonly sessionId?: string | undefined; readonly all?: boolean | undefined }): Promise<{ readonly purged: readonly string[] }> {
  return post<{ readonly purged: readonly string[] }>(PURGE_PATH, options.all === true ? { all: true } : { sessionId: options.sessionId })
}

/**
 * Word a trash failure for the operator.
 * @param reason - the thrown value.
 * @param t - the locale seat.
 * @returns display text.
 */
export function describeTrashFailure(reason: unknown, t: Translate): string {
  const failure = reason instanceof Error ? reason : new Error(String(reason))
  const key = WORDED_TRASH_FAILURES[(failure as SessionDeleteFailure).code]
  if (key !== undefined) return `${t(key)}\n${failure.message}`
  return t('trash.failed', { reason: failure.message })
}

/**
 * Word one failure for the operator: the codes this package owns have their own
 * copy, everything else keeps the Host's diagnostic.
 * @param reason - the thrown value.
 * @param t - the locale seat.
 * @returns display text.
 */
export function describeFailure(reason: unknown, t: Translate): string {
  const failure = reason instanceof Error ? reason : new Error(String(reason))
  const key = WORDED_FAILURES[(failure as SessionDeleteFailure).code]
  if (key !== undefined) return `${t(key)}\n${failure.message}`
  return t('dialog.failed', { reason: failure.message })
}

/**
 * Word a bulk-cleanup failure, which reports a different sentence than one
 * conversation's removal.
 * @param reason - the thrown value.
 * @param t - the locale seat.
 * @returns display text.
 */
export function describeCleanupFailure(reason: unknown, t: Translate): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return t('cleanup.failed', { reason: message })
}
