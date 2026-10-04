#!/usr/bin/env node
/**
 * Check this plugin's assumptions against the runtime that is actually installed.
 *
 * The plugin reads a layout it does not own: the JSONL backend's directory naming
 * (`<root>/<projectKey>/<encodeSegment(id)>`), its compression mode, and the
 * projection record the Host writes for each stored Session. None of that is a
 * public contract, so a DSH upgrade can move it — and the failure would be quiet
 * (the cleanup would call every Session "unproven", or a deletion would aim at a
 * directory that no longer exists).
 *
 * Run this after upgrading DSH. It reads real artifacts and reports, per
 * assumption, whether it still holds.
 *
 *   node tools/verify-runtime-contract.mjs [--home <DSH_HOME>] [--url <origin>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { encodeSegment, projectKey } from '../src/index.ts'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

const home = flag('--home', process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const url = flag('--url', process.env.DSH_WEB_URL)
const sessionsRoot = join(home, 'sessions')
const cacheRoot = join(home, 'storages', 'session_projcache', 'sessions')

let checks = 0
const failures = []
/** Record one expectation. */
function check(label, condition, detail = '') {
  checks++
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log(`runtime contract check`)
console.log(`  home: ${home}`)
console.log('')

// ── 1. directory naming ────────────────────────────────────────────────────────
console.log('session layout')
{
  let projectDirs = []
  try {
    projectDirs = readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    check('the sessions root is readable', false, error instanceof Error ? error.message : String(error))
  }
  if (projectDirs.length > 0) {
    check('project directories are delimited with --', projectDirs.every((name) => name.startsWith('--') && name.endsWith('--')),
      projectDirs.filter((name) => !(name.startsWith('--') && name.endsWith('--'))).slice(0, 3).join(', '))

    // The strongest available check: decode a real log's header and confirm that the
    // plugin's projectKey reproduces the directory the backend actually used.
    let compared = 0
    let mismatched = []
    let idsChecked = 0
    let idMismatch = []
    for (const project of projectDirs.slice(0, 25)) {
      let sessions = []
      try {
        sessions = readdirSync(join(sessionsRoot, project), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      } catch {
        continue
      }
      for (const session of sessions.slice(0, 3)) {
        const directory = join(sessionsRoot, project, session)
        const files = readdirSync(directory).filter((name) => name.startsWith('session'))
        if (files.length === 0) continue
        if (encodeSegment(session) !== session) idMismatch.push(session)
        idsChecked++
        const newest = files.sort().at(-1)
        try {
          const raw = readFileSync(join(directory, newest))
          const text = (newest.endsWith('.zstd') ? zstdDecompressSync(raw) : raw).toString('utf8')
          const header = JSON.parse(text.split('\n').find((line) => line.trim() !== ''))
          if (typeof header.cwd === 'string' && header.cwd !== '') {
            compared++
            if (projectKey(header.cwd) !== project) mismatched.push(`${header.cwd} -> ${projectKey(header.cwd)} (dir ${project})`)
          }
        } catch {
          // A log this check cannot read is not a contract failure; it is out of scope.
        }
      }
    }
    check('session directory names are fixed points of encodeSegment', idMismatch.length === 0,
      `${String(idMismatch.length)}/${String(idsChecked)} differ, e.g. ${idMismatch[0] ?? ''}`)
    check('projectKey reproduces the backend\'s project directory', mismatched.length === 0,
      `${String(mismatched.length)}/${String(compared)} differ, e.g. ${mismatched[0] ?? ''}`)
    console.log(`  ..   compared ${String(compared)} headers over ${String(idsChecked)} sessions`)
  }
}

// ── 2. the projection record the durable-facts route reads ─────────────────────
console.log('')
console.log('projection record')
{
  let records = []
  try {
    records = readdirSync(cacheRoot).filter((name) => name.endsWith('.json'))
  } catch (error) {
    check('the projection cache is readable', false, error instanceof Error ? error.message : String(error))
  }
  if (records.length > 0) {
    let sampled = 0
    let missing = 0
    let wrongType = 0
    for (const name of records.slice(0, 40)) {
      let parsed
      try {
        parsed = JSON.parse(readFileSync(join(cacheRoot, name), 'utf8'))
      } catch {
        continue
      }
      const value = parsed?.record?.rows?.sessionListMetadata?.val
      sampled++
      if (value === undefined) {
        missing++
        continue
      }
      const blankOk = typeof value.blank === 'boolean'
      const promptOk = value.lastPromptAt === null || typeof value.lastPromptAt === 'number'
      if (!blankOk || !promptOk) wrongType++
    }
    check('every record carries rows.sessionListMetadata.val', missing === 0, `${String(missing)}/${String(sampled)} lack it`)
    check('blank is a boolean and lastPromptAt is a number or null', wrongType === 0, `${String(wrongType)}/${String(sampled)} differ`)
    console.log(`  ..   sampled ${String(sampled)} of ${String(records.length)} records`)
    // The title row is what the cleanup now shows, so it is part of the contract too.
    let titleSeen = 0
    for (const name of records.slice(0, 40)) {
      try {
        const parsed = JSON.parse(readFileSync(join(cacheRoot, name), 'utf8'))
        if (parsed?.record?.rows?.title !== undefined) titleSeen++
      } catch {}
    }
    check('records still carry a title row', titleSeen > 0, 'no sampled record had rows.title')
  }
}

// ── 3. the routes themselves, when an instance is answering ────────────────────
if (url !== undefined && url !== '') {
  console.log('')
  console.log(`routes on ${url}`)
  for (const path of ['/api/session.delete', '/api/session.unused']) {
    let status = 0
    try {
      const response = await fetch(`${url}${path}`, { method: 'POST' })
      status = response.status
    } catch (error) {
      check(`${path} answers`, false, error instanceof Error ? error.message : String(error))
      continue
    }
    // 401 means the route exists behind the browser-trust fence; 404 means this
    // build of the plugin is not loaded, which is a different problem entirely.
    check(`${path} is registered (401 from the fence, not 404)`, status === 401, `HTTP ${String(status)}`)
  }
}

console.log('')
console.log(`${String(checks - failures.length)}/${String(checks)} assumptions still hold`)
if (failures.length > 0) {
  console.log('')
  console.log('The runtime moved. The plugin reads these artifacts directly, so it needs')
  console.log('updating before the cleanup can be trusted on this DSH version.')
}
process.exit(failures.length === 0 ? 0 : 1)
