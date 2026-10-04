/**
 * Blank-Session cleanup planning: which unused Sessions a cleanup run may
 * remove, decided from the client list snapshot alone.
 *
 * Pure and React-free on purpose — it is the half of the cleanup surface that
 * can be reasoned about and tested without a browser (see
 * `tests/cleanup-plan.test.ts`).
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/cleanup-plan
 */
import type { SessionListLike, Translate } from './contract'
import type { UnusedSessionRow } from './host'

/**
 * How long a blank Session must have been idle before cleanup may remove it.
 *
 * A blank Session is one that never started a turn, so it holds no work — but
 * the window between "New Session" and the first message is also blank, and a
 * second window can be sitting in that window. The grace period turns that
 * narrow race into "leave it alone for an hour".
 */
export const BLANK_IDLE_GRACE_MS = 60 * 60 * 1000

/** Rows the cleanup dialog lists before collapsing the rest into a count. */
export const CLEANUP_LIST_LIMIT = 8

/** One Session the plan selected for removal. */
export interface CleanupTarget {
  readonly sessionId: string
  readonly updatedAt: number
  readonly cwd?: string | undefined
  /** The Session's title, when the Host's projection had one. */
  readonly title?: string | undefined
  /** What it occupies on disk, when the Host could measure it. */
  readonly bytes?: number | undefined
}

/** What one cleanup run would do, and why each blank Session was passed over. */
export interface CleanupPlan {
  /** Sessions that will be removed, oldest activity first. */
  readonly targets: readonly CleanupTarget[]
  /** Blank Sessions considered before the skip rules ran. */
  readonly considered: number
  /** Skipped: it is the Session the window has open. */
  readonly currentSkipped: number
  /** Skipped: an Agent is running on it, so it is not an abandoned draft. */
  readonly runningSkipped: number
  /** Skipped: its activity is inside the grace period. */
  readonly freshSkipped: number
  /** Skipped: no durable projection proving it never started a turn. */
  readonly unprovenSkipped: number
}

/** What the plan is decided from. */
export interface CleanupInput {
  /** Durable per-Session facts, as the Host reports them. */
  readonly facts: readonly UnusedSessionRow[]
  /** The client's Session list, consulted only for the live facts (open, running). */
  readonly live?: SessionListLike | undefined
}

/**
 * Decide which blank Sessions a cleanup run may remove.
 *
 * Blankness is taken from the **Host's durable projection** and from nothing else.
 * Two earlier attempts to derive it in the page failed for the same underlying
 * reason: a stored Session's list row carries a live first-turn flag that says
 * nothing about its log, and its projection block is loaded only for the Session
 * being viewed. A row the Host could not prove is skipped rather than guessed at —
 * this runs before an irreversible removal, so "unknown" must never mean "yes".
 *
 * @param input - the Host's facts plus the client's live list.
 * @param now - the clock to measure the grace period against.
 * @param graceMs - the idle grace period.
 * @returns the plan, with each skip rule counted for the dialog's copy.
 */
export function planBlankCleanup(
  input: CleanupInput,
  now: number = Date.now(),
  graceMs: number = BLANK_IDLE_GRACE_MS
): CleanupPlan {
  const targets: CleanupTarget[] = []
  let considered = 0
  let currentSkipped = 0
  let runningSkipped = 0
  let freshSkipped = 0
  let unprovenSkipped = 0

  for (const fact of input.facts) {
    if (!fact.proven) {
      unprovenSkipped++
      continue
    }
    // Proven to have started a turn: not a candidate, and nothing to explain.
    if (!fact.blank) continue
    considered++
    if (fact.sessionId === input.live?.current) {
      currentSkipped++
      continue
    }
    if (input.live?.byId[fact.sessionId]?.running === true) {
      runningSkipped++
      continue
    }
    const updatedAt = Math.max(fact.updatedAt, fact.lastPromptAt ?? 0)
    if (now - updatedAt < graceMs) {
      freshSkipped++
      continue
    }
    targets.push({
      sessionId: fact.sessionId,
      updatedAt,
      ...fact.cwd === undefined ? {} : { cwd: fact.cwd },
      ...fact.title === undefined ? {} : { title: fact.title },
      ...fact.bytes === undefined ? {} : { bytes: fact.bytes }
    })
  }

  targets.sort((left, right) => left.updatedAt - right.updatedAt)
  return { targets, considered, currentSkipped, runningSkipped, freshSkipped, unprovenSkipped }
}

/**
 * Word one timestamp as an age, through the locale seat.
 * @param updatedAt - durable activity timestamp.
 * @param now - the clock to measure against.
 * @param t - the locale seat.
 * @returns display text such as `3 小时前`.
 */
export function describeAge(updatedAt: number, now: number, t: Translate): string {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000)
  if (minutes < 1) return t('age.justNow')
  if (minutes < 60) return t('age.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('age.hours', { n: hours })
  return t('age.days', { n: Math.floor(hours / 24) })
}

/** The grace period as whole minutes, for the dialog's copy. */
export function graceMinutes(graceMs: number = BLANK_IDLE_GRACE_MS): number {
  return Math.round(graceMs / 60_000)
}
