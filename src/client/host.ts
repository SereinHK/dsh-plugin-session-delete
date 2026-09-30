/**
 * The browser half's Host call: one authenticated `POST /api/session.delete`
 * per conversation, plus the wording for the failures the operator can act on.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/host
 */
import type { Translate } from './contract'

/** The Host route this package's node half registers inside Connection's `/api` fence. */
export const DELETE_PATH = '/api/session.delete'

/** The Host's success report for one removal. */
export interface DeleteReport {
  readonly sessionId: string
  readonly directory: string
  readonly files: readonly string[]
  readonly cacheRemoved: boolean
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
