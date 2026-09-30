#!/usr/bin/env node
/**
 * Boot-graph check: is this plugin in the browser plugin graph a running DSH is
 * serving right now?
 *
 * `dsh-client-hmr` answers `GET /plugins/events` with an SSE channel whose first
 * frame carries the complete graph (`ctx.clientModules.graph()`). That endpoint
 * sits outside the `/api` trust fence, so a non-browser process can read the live
 * composition directly — no cookie, no guessing from bundle URLs.
 *
 * An entry present means the Loader mounted the row, the `dsh.client` scan
 * accepted the package, and the browser is being told to load it. An entry absent
 * means that instance has not recomposed (a failed reload freezes the tree; an
 * unwatched one never rebuilds) — restart that instance and run this again.
 *
 * `--scan` matters more than it looks. Two DSH instances commonly run side by
 * side — the desktop app serves its own window, and `dsh web` serves another on
 * the default 3080 — with different profiles and different package builds. A
 * plugin is installed per profile, so checking the wrong instance reports it
 * absent while the window the operator is looking at belongs to another
 * application entirely. Confirm the origin the window is actually on
 * (`location.href`), not the one this shell advertises.
 *
 *   node tools/verify-boot.mjs [--id <package>] [--url <origin>] [--list] [--scan]
 */
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}


/** The module id the browser registers: the installed package name. */
function packageName() {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).name
}

const baseUrl = flag('--url', process.env.DSH_WEB_URL ?? 'http://127.0.0.1:19387')
const id = flag('--id', packageName())
const list = argv.includes('--list')
const scan = argv.includes('--scan')

/** Origins worth asking: this shell's runtime, and the `dsh web` default. */
const CANDIDATE_ORIGINS = [
  process.env.DSH_WEB_URL,
  baseUrl,
  'http://127.0.0.1:3080',
  'http://127.0.0.1:19387'
].filter((value, index, all) => typeof value === 'string' && value !== '' && all.indexOf(value) === index)

/**
 * Read the first `data:` frame from an SSE response.
 *
 * A raw http request rather than `fetch`, because the body is destroyed the
 * moment the frame arrives: cancelling a fetch stream instead leaves a socket
 * teardown that trips a libuv assertion on Windows, which would turn a clean
 * exit into a crash report.
 *
 * @param origin - the instance to ask.
 * @returns the browser plugin graph.
 */
function readGraph(origin) {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}/plugins/events`, { headers: { accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`${origin} answered ${String(res.statusCode)}`))
        return
      }
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        for (const frame of buffer.split('\n\n')) {
          const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))
          if (line === undefined) continue
          let payload
          try {
            payload = JSON.parse(line.slice('data:'.length).trim())
          } catch {
            continue
          }
          if (payload?.graph?.entries === undefined) continue
          res.destroy()
          req.destroy()
          resolve(payload.graph)
          return
        }
      })
      res.on('error', () => {})
      res.on('end', () => {
        reject(new Error(`${origin} sent no graph frame`))
      })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => {
      req.destroy()
      reject(new Error(`${origin} timed out`))
    })
    req.end()
  })
}

if (scan) {
  console.log('Every DSH surface answering here. Instances differ by PROFILE and by the')
  console.log('launcher overlay a surface adds, not necessarily by package version — so the')
  console.log('row set and the entry count can differ between two 0.2 builds. A plugin is')
  console.log('installed per profile, which is why one instance carries it and another does not:')
  console.log('')
  for (const origin of CANDIDATE_ORIGINS) {
    console.log(`  ${origin}`)
    try {
      const graph = await readGraph(origin)
      const ids = (graph.entries ?? []).map((entry) => entry.id)
      // Naming a row the desktop overlay adds says "different composition", never
      // "older build": the published 0.2 line ships this package too.
      const overlay = ids.includes('@deepseek-ai/dsh-client-ui-sidebar-browser')
      console.log(`    entries ${String(ids.length).padStart(4)}   ${id} ${ids.includes(id) ? 'MOUNTED' : 'absent'}`)
      console.log(`    rows    desktop-overlay rows ${overlay ? 'present' : 'absent'}`)
    } catch (error) {
      console.log(`    unreachable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log('')
  console.log('Check the origin your window reports as location.href, not the one this shell')
  console.log('advertises: on a machine running both, they are different instances.')
  process.exit(0)
}

const graph = await readGraph(baseUrl)
const entries = graph.entries ?? []
const batches = graph.batches ?? []

console.log(`origin     : ${baseUrl}`)
console.log(`graph rev  : ${graph.rev}`)
console.log(`entries    : ${entries.length}`)
console.log(`batches    : ${batches.map((batch) => `${batch.phase}:${String((batch.entries ?? []).length)}`).join('  ')}`)

if (list) {
  for (const entry of entries) console.log(`  ${entry.id}`)
  process.exit(0)
}

const entry = entries.find((candidate) => candidate.id === id)
if (entry === undefined) {
  console.log(`result     : '${id}' is NOT in this instance's boot graph`)
  const similar = entries.filter((candidate) => candidate.id.includes('session-delete'))
  if (similar.length > 0) console.log(`             but these are: ${similar.map((candidate) => candidate.id).join(', ')}`)
  console.log('')
  console.log('Either the composition has not been rebuilt since the row was written (restart')
  console.log('this instance), or this instance runs a different profile from the one the')
  console.log('plugin was installed into. `--scan` lists every instance and what it carries.')
  process.exit(1)
}

console.log(`result     : '${id}' is mounted`)
console.log(`bundle rev : ${entry.rev}`)
console.log(`bundle url : ${entry.url}`)
console.log(`external   : ${entry.external === undefined ? '(seed modules only)' : entry.external.join(', ')}`)

// A row can sit in `entries` and still never reach the page: the shell preloads
// the batches, and it is the batch list that becomes the browser's plugin
// manifest. Which batch carries it separates "mounted" from "delivered".
const carrying = batches.filter((batch) => (batch.entries ?? []).includes(id))
if (carrying.length === 0) {
  console.log('delivered  : NO — no batch carries it, so the page is never told to load it')
  process.exit(1)
}
for (const batch of carrying) {
  console.log(`delivered  : ${batch.phase} batch, ${String((batch.entries ?? []).length)} entries`)
}
process.exit(0)
