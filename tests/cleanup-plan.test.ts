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
import { en, zh } from '../src/client/locales.ts'

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

/** Build one list snapshot out of compact row declarations. */
function list(
  rows: readonly (readonly [string, Partial<SessionSummaryLike>])[],
  current?: string
): SessionListLike {
  const byId: Record<string, SessionSummaryLike> = {}
  const ids: string[] = []
  for (const [sessionId, overrides] of rows) {
    ids.push(sessionId)
    byId[sessionId] = {
      sessionId,
      blank: true,
      running: false,
      updatedAt: NOW - 2 * HOUR,
      ...overrides
    }
  }
  return { ids, byId, current }
}

test('an idle blank Session is a target', () => {
  const plan = planBlankCleanup(list([['a', {}], ['b', { blank: false }]]), NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['a'])
  assert.equal(plan.considered, 1)
})

test('the open Session is skipped, never deleted', () => {
  const plan = planBlankCleanup(list([['a', {}], ['b', {}]], 'a'), NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['b'])
  assert.equal(plan.currentSkipped, 1)
})

test('a running Session is skipped even while blank', () => {
  const plan = planBlankCleanup(list([['a', { running: true }], ['b', {}]]), NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['b'])
  assert.equal(plan.runningSkipped, 1)
})

test('activity inside the grace period is skipped', () => {
  const plan = planBlankCleanup(list([['fresh', { updatedAt: NOW - 1000 }], ['old', { updatedAt: NOW - BLANK_IDLE_GRACE_MS - 1 }]]), NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['old'])
  assert.equal(plan.freshSkipped, 1)
})

test('targets read oldest activity first', () => {
  const plan = planBlankCleanup(list([
    ['younger', { updatedAt: NOW - 3 * HOUR }],
    ['older', { updatedAt: NOW - 9 * HOUR }],
    ['middle', { updatedAt: NOW - 5 * HOUR }]
  ]), NOW)
  assert.deepEqual(plan.targets.map((target) => target.sessionId), ['older', 'middle', 'younger'])
})

test('an id with no row is ignored rather than targeted', () => {
  const snapshot: SessionListLike = { ids: ['ghost'], byId: {}, current: undefined }
  const plan = planBlankCleanup(snapshot, NOW)
  assert.deepEqual(plan.targets, [])
  assert.equal(plan.considered, 0)
})

test('a target carries its workspace path when the summary has one', () => {
  const plan = planBlankCleanup(list([['a', { cwd: 'C:\\work' }]]), NOW)
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
