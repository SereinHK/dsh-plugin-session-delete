/**
 * Host-route suite: every scenario in `scenarios.ts`, run against the node
 * half's source.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/tests/session-delete
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../src/index.ts'
import { runScenarios } from './scenarios.ts'

for (const section of await runScenarios(apply as (ctx: unknown) => void)) {
  test(`host route: ${section.section}`, () => {
    assert.equal(
      section.failures.length,
      0,
      `${section.failures.length}/${section.checks} checks failed:\n${section.failures.join('\n')}`
    )
    assert.ok(section.checks > 0, 'the section made no checks')
  })
}
