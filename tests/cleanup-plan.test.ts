/**
 * Cleanup-plan suite: which blank Sessions a cleanup run may remove, and how its
 * copy reads. Pure logic, no browser.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/tests/cleanup-plan
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BLANK_IDLE_GRACE_MS, describeAge, graceMinutes, planBlankCleanup } from '../src/client/cleanup-plan.ts'
import type { SessionListLike, SessionSummaryLike } from '../src/client/contract.ts'
import type { UnusedSessionRow } from '../src/client/host.ts'
import { en, zh } from '../src/client/locales.ts'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

/**
 * One durable row as the Host reports it.
 *
 * Proven and blank by default: that is the shape the Host's projection cache
 * produces for a stored Session that never started a turn.
 */
function fact(sessionId: string, overrides: Partial<UnusedSessionRow> = {}): UnusedSessionRow {
  return {
    sessionId,
    cwd: `C:\\work\\${sessionId}`,
    createdAt: NOW - 2 * HOUR,
    updatedAt: NOW - 2 * HOUR,
    blank: true,
    proven: true,
    lastPromptAt: null,
    ...overrides
  }
}

/** The client list, consulted only for the live facts (running, open). */
function live(
  rows: readonly (readonly [string, Partial<SessionSummaryLike>])[] = [],
  current?: string
): SessionListLike {
  const byId: Record<string, SessionSummaryLike> = {}
  const ids: string[] = []
  for (const [sessionId, overrides] of rows) {
    ids.push(sessionId)
    byId[sessionId] = { id: sessionId, running: false, ...overrides }
  }
  return { ids, byId, current }
}

test('an idle blank Session is a target', () => {
  const plan = planBlankCleanup({ facts: [fact('a'), fact('b', { blank: false, proven: true })] }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['a'])
  assert.equal(plan.considered, 1)
})

test('a row the Host could not prove is skipped, never targeted', () => {
  // The regression this feature shipped with twice: the page cannot tell whether a
  // stored Session is blank, so an unproven row must not be treated as empty.
  const plan = planBlankCleanup({ facts: [fact('a', { proven: false, blank: false })] }, NOW)
  assert.deepEqual(plan.targets, [])
  assert.equal(plan.unprovenSkipped, 1)
  assert.equal(plan.considered, 0)
})

test('a Session that started a turn is simply not a candidate', () => {
  const plan = planBlankCleanup({ facts: [fact('used', { blank: false, lastPromptAt: NOW - 5 * HOUR })] }, NOW)
  assert.deepEqual(plan.targets, [])
  assert.equal(plan.considered, 0)
  assert.equal(plan.unprovenSkipped, 0)
})

test('a durable last prompt keeps an otherwise stale row inside the grace period', () => {
  const plan = planBlankCleanup({
    facts: [
      fact('a', { lastPromptAt: NOW - 1000, updatedAt: NOW - 9 * HOUR }),
      fact('b', { updatedAt: NOW - 9 * HOUR })
    ]
  }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['b'])
  assert.equal(plan.freshSkipped, 1)
})

test('the open Session is skipped, never deleted', () => {
  const plan = planBlankCleanup({ facts: [fact('a'), fact('b')], live: live([], 'a') }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['b'])
  assert.equal(plan.currentSkipped, 1)
})

test('a running Session is skipped even while blank', () => {
  const plan = planBlankCleanup({
    facts: [fact('a'), fact('b')],
    live: live([['a', { running: true }]])
  }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['b'])
  assert.equal(plan.runningSkipped, 1)
})

test('activity inside the grace period is skipped', () => {
  const plan = planBlankCleanup({
    facts: [fact('fresh', { updatedAt: NOW - 1000 }), fact('old', { updatedAt: NOW - BLANK_IDLE_GRACE_MS - 1 })]
  }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['old'])
  assert.equal(plan.freshSkipped, 1)
})

test('targets read oldest activity first', () => {
  const plan = planBlankCleanup({
    facts: [
      fact('younger', { updatedAt: NOW - 3 * HOUR }),
      fact('older', { updatedAt: NOW - 9 * HOUR }),
      fact('middle', { updatedAt: NOW - 5 * HOUR })
    ]
  }, NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['older', 'middle', 'younger'])
})

test('an empty Host answer plans nothing and claims nothing', () => {
  const plan = planBlankCleanup({ facts: [] }, NOW)
  assert.deepEqual(plan.targets, [])
  assert.equal(plan.considered, 0)
  assert.equal(plan.unprovenSkipped, 0)
})

test('a target carries the workspace path the Host reported', () => {
  const plan = planBlankCleanup({ facts: [fact('a', { cwd: 'C:\\work' })] }, NOW)
  assert.equal(plan.targets[0]?.cwd, 'C:\\work')
})

test('age wording crosses the minute, hour, and day boundaries', () => {
  const t = (key: string, params?: Record<string, string | number>): string => `${key}:${String(params?.n ?? '')}`
  assert.equal(describeAge(NOW - 10_000, NOW, t), 'age.justNow:')
  assert.equal(describeAge(NOW - 5 * 60_000, NOW, t), 'age.minutes:5')
  assert.equal(describeAge(NOW - 5 * HOUR, NOW, t), 'age.hours:5')
  assert.equal(describeAge(NOW - 5 * 24 * HOUR, NOW, t), 'age.days:5')
})

test('the grace period reads in whole minutes', () => {
  assert.equal(graceMinutes(), 60)
  assert.equal(graceMinutes(90_000), 2)
})

test('both dictionaries cover the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const value of Object.values(zh)) assert.notEqual(value.trim(), '')
  for (const value of Object.values(en)) assert.notEqual(value.trim(), '')
})

test('every interpolation placeholder appears in both dictionaries', () => {
  const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(en[key]!), placeholders(zh[key]!), `placeholder drift at ${key}`)
  }
})
