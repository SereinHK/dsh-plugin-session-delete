#!/usr/bin/env node
/**
 * Probe whether the running DSH is still recomposing on profile patch edits.
 *
 * A profile patch edit normally applies through HMR (chokidar watches the patch
 * files). When it does not — a failed reload, a dead watcher — the previous
 * plugin tree stays in place and newly installed rows never appear, which looks
 * exactly like "the plugin is broken".
 *
 * This toggles one shipped client row off, watches the live boot graph (the
 * `GET /plugins/events` SSE channel), then restores the file and watches it come
 * back. Both directions are observed, so a "no" means the composition is frozen,
 * not that the edit was mis-spelled.
 *
 *   node tools/probe-reload.mjs [--row ui-jobs] [--package @deepseek-ai/dsh-client-ui-jobs] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

const probeRow = flag('--row', 'ui-jobs')
const probePackage = flag('--package', '@deepseek-ai/dsh-client-ui-jobs')
const baseUrl = flag('--url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387')
const dry = argv.includes('--dry')
const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')
const marker = '# ---- dsh-probe-reload '

const original = readFileSync(patchPath, 'utf8')
if (new RegExp(`^\\s*-\\s*id:\\s*${probeRow}\\s*$`, 'm').test(original)) {
  console.error(`the patch already targets row '${probeRow}'; pass --row with another one`)
  process.exit(2)
}
if (dry) {
  console.log(`would toggle row '${probeRow}' in ${patchPath} and watch for '${probePackage}'`)
  process.exit(0)
}

const restored = original.trimEnd() + '\n'
const toggled = `${restored}\n${marker}----------------------------------------\n- id: ${probeRow}\n  disabled: true\n`

/** Read the live boot graph's entry ids. */
async function entryIds() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${baseUrl}/plugins/events`, { signal: controller.signal, headers: { accept: 'text/event-stream' } })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const frame of buffer.split('\n\n')) {
        const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))
        if (line === undefined) continue
        const payload = JSON.parse(line.slice('data:'.length).trim())
        if (payload?.graph?.entries !== undefined) {
          await reader.cancel()
          return payload.graph.entries.map((entry) => entry.id)
        }
      }
    }
    throw new Error('no graph frame')
  } finally {
    clearTimeout(timer)
  }
}

/** Poll until the predicate holds, or give up. */
async function waitFor(label, predicate, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ids = await entryIds()
    if (predicate(ids)) return { ok: true, ids }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return { ok: false, ids: await entryIds() }
}

const before = await entryIds()
console.log(`entries before      : ${before.length} (probe row present: ${before.includes(probePackage)})`)

let restoredFile = false
try {
  writeFileSync(patchPath, toggled, 'utf8')
  console.log('patched the profile to disable the probe row; waiting for the graph to drop it...')
  const removed = await waitFor('drop', (ids) => !ids.includes(probePackage))
  console.log(`  ${removed.ok ? 'dropped' : 'never dropped'} (entries now ${removed.ids.length})`)

  writeFileSync(patchPath, restored, 'utf8')
  restoredFile = true
  console.log('restored the profile; waiting for the graph to bring it back...')
  const returned = await waitFor('return', (ids) => ids.includes(probePackage))
  console.log(`  ${returned.ok ? 'returned' : 'never returned'} (entries now ${returned.ids.length})`)

  console.log('')
  if (removed.ok && returned.ok) {
    console.log('The composition reloads live: patch edits apply without a restart.')
  } else if (!removed.ok && !returned.ok) {
    console.log('The composition is FROZEN: patch edits no longer apply. Restart DSH to load')
    console.log('any newly installed row.')
  } else {
    console.log('Inconclusive: the graph changed in one direction only. Re-run, or restart DSH.')
  }
} finally {
  if (!restoredFile) {
    writeFileSync(patchPath, restored, 'utf8')
    console.log('restored the profile patch')
  }
}
