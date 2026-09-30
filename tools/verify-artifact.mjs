#!/usr/bin/env node
/**
 * Artifact check: run the package's own host-route scenarios against the BUILT
 * `lib/index.js`, not the source.
 *
 * `pnpm test` in the package proves the source; this proves the bytes the host
 * actually loads — the same scenarios, the artifact as shipped. It runs before
 * installation so a stale `lib/` cannot reach a profile unnoticed.
 *
 *   node tools/verify-artifact.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScenarios } from '../tests/scenarios.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = repoRoot

const artifact = join(packageDir, 'lib', 'index.js')
const source = readFileSync(artifact, 'utf8')
if (/^\s*(?::\s*\w|<[A-Za-z_$][\w$]*>)/m.test(source) || source.includes('interface ')) {
  console.error(`${artifact} still looks like TypeScript; run node tools/build.mjs`)
  process.exit(1)
}

const host = await import(`${path(artifact)}?artifact=${String(Date.now())}`)
for (const name of ['apply', 'inject', 'SESSION_DELETE_PATH']) {
  if (host[name] === undefined) {
    console.error(`lib/index.js does not export ${name}; run node tools/build.mjs`)
    process.exit(1)
  }
}

const results = await runScenarios(host.apply)
let checks = 0
let failed = 0
for (const section of results) {
  checks += section.checks
  failed += section.failures.length
  const mark = section.failures.length === 0 ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${section.section} (${section.checks - section.failures.length}/${section.checks})`)
  for (const failure of section.failures) console.log(`       ${failure}`)
}
console.log('')
console.log(`lib/index.js — ${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)

/** File URL for a local path. */
function path(file) {
  return new URL(`file://${file.replace(/\\/g, '/')}`).href
}
