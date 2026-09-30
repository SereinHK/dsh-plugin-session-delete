#!/usr/bin/env node
/**
 * Force a structural reload of the running profile and report what the boot graph did.
 *
 * Toggling an existing row's `disabled` compares configuration in place, which
 * proves nothing about whether the Loader can build a NEW tree. An `insert` (or
 * its removal) needs a real rebuild, and a rebuild that throws leaves the
 * previous tree exactly where it was — which looks like "the plugin is ignored".
 *
 * This removes the named plugin's `- insert:` block, waits for the graph to lose
 * its entry, then puts the block back and waits for the entry to return. Every
 * observation is reported, including "nothing changed at all".
 *
 *   node tools/force-reload.mjs [--row session-delete] [--list] [--keep-removed]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

const rowId = flag('--row', 'session-delete')
const baseUrl = flag('--url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387')
const list = argv.includes('--list')
const keepRemoved = argv.includes('--keep-removed')
const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')
const original = readFileSync(patchPath, 'utf8')

/** The whole `- insert:` entry that carries the row, from its comment banner down. */
function extractBlock(text, id) {
  const rowIndex = new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, 'm').exec(text)?.index
  if (rowIndex === undefined) return undefined
  const insertIndex = text.lastIndexOf('- insert:', rowIndex)
  if (insertIndex < 0) return undefined
  let start = insertIndex
  const banner = text.lastIndexOf('# ----', insertIndex)
  if (banner >= 0 && text.slice(banner, insertIndex).split('\n').every((line) => line.trim() === '' || line.startsWith('#'))) start = banner
  // The entry runs through its `name:` line — cutting before it leaves a dangling
  // root-level mapping key, which is a YAML error, not a tidy partial edit.
  const nameMatch = /^[ \t]+name:[^\n]*$/m.exec(text.slice(rowIndex))
  const lastLine = nameMatch === undefined ? rowIndex : rowIndex + nameMatch.index + nameMatch[0].length
  const newline = text.indexOf('\n', lastLine)
  const end = newline < 0 ? text.length : newline + 1
  return { start, end, block: text.slice(start, end) }
}

const found = extractBlock(original, rowId)
if (found === undefined) {
  console.error(`no '- insert:' block with id '${rowId}' in ${patchPath}`)
  process.exit(2)
}

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
async function waitFor(predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let ids = await entryIds()
  while (Date.now() < deadline) {
    if (predicate(ids)) return { ok: true, ids }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    ids = await entryIds()
  }
  return { ok: false, ids }
}

const before = await entryIds()
if (list) {
  for (const id of before) console.log(`  ${id}`)
  process.exit(0)
}
console.log(`entries before            : ${before.length}`)
console.log(`plugin row present before : ${before.some((id) => id.includes('session-delete'))}`)

// The patch is restored on every exit path except an explicit --keep-removed:
// leaving a half-removed block behind would break the whole patch layer.
let keepRemovedFile = false
let status = 0
try {
  const removed = original.slice(0, found.start).trimEnd() + '\n' + original.slice(found.end).replace(/^\s+/, '')
  writeFileSync(patchPath, removed, 'utf8')
  console.log('')
  console.log('removed the insert block; waiting for the tree to be rebuilt...')
  const gone = await waitFor((ids) => !ids.some((id) => id.includes('session-delete')))
  console.log(`  deletion applied: ${gone.ok ? 'yes' : 'NO'} (entries now ${gone.ids.length})`)

  if (!gone.ok) {
    console.log('')
    console.log('The Loader is NOT rebuilding the profile tree: removing a row changed nothing,')
    console.log('so no newly inserted row can ever appear until DSH restarts.')
    status = 1
  } else if (keepRemoved) {
    keepRemovedFile = true
    console.log('left the block removed (--keep-removed)')
  } else {
    writeFileSync(patchPath, original.trimEnd() + '\n', 'utf8')
    console.log('restored the block; waiting for the tree to be rebuilt again...')
    const back = await waitFor((ids) => ids.some((id) => id.includes('session-delete')))
    console.log(`  insertion applied: ${back.ok ? 'yes' : 'NO'} (entries now ${back.ids.length})`)
    if (back.ok) console.log(`  mounted as: ${back.ids.filter((id) => id.includes('session-delete')).join(', ')}`)
    console.log('')
    console.log(back.ok
      ? 'The Loader rebuilds the tree, and this row mounts.'
      : 'The row was removed but did not come back: its own load is failing.')
    status = back.ok ? 0 : 1
  }
} finally {
  if (!keepRemovedFile) writeFileSync(patchPath, original.trimEnd() + '\n', 'utf8')
}
process.exit(status)
