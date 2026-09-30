/**
 * Live check: is the plugin's client bundle being served by the running DSH?
 *
 * The bundle route is keyed by an exact revisioned combo URL, where the revision
 * is a hash of the bundle file's (mtimeMs, ctimeMs, size) — so the URL can be
 * computed from the installed copy and then requested. A 200 whose body is the
 * plugin's own bundle proves the Loader mounted the row, the client-modules scan
 * accepted `dsh.client` + `exports["./client"]`, and the bytes are served.
 *
 *   node tools/verify-live.mjs [--url http://127.0.0.1:19387] [--id dsh-plugin-session-delete]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

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
// An explicit flag beats the ambient environment: a shell inside a DSH session
// always carries DSH_PROFILE_DIR, so `--profile web` would otherwise be ignored —
// and with more than one profile installed, silently checking the wrong copy is
// exactly the mistake this tool exists to prevent.
const explicitDir = flag('--profile-dir')
const explicitProfile = flag('--profile')
const profileDir = explicitDir
  ?? (explicitProfile === undefined
    ? undefined
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', explicitProfile))
  ?? process.env.DSH_PROFILE_DIR
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const bundle = join(profileDir, 'node_modules', id, 'lib', 'client.js')

if (!existsSync(bundle)) {
  console.error(`no installed bundle at ${bundle}`)
  console.error('pass --profile <name> (or --profile-dir <path>) when the plugin is installed')
  console.error('into a profile other than the ambient one: install.mjs installs per profile.')
  process.exit(2)
}

/** Mirror client-modules' `framedHash`. */
function framedHash(domain, parts) {
  const hash = createHash('sha1').update(domain).update('\0')
  for (const part of parts) hash.update(`${String(Buffer.byteLength(part))}:`).update(part)
  return hash.digest('hex').slice(0, 12)
}

const baseline = statSync(bundle)
const rev = framedHash('plugin-artifact', [String(baseline.mtimeMs), String(baseline.ctimeMs), String(baseline.size)])
const url = `${baseUrl}/plugins/??${id}/client.js&rev=${rev}`

console.log(`bundle : ${bundle}`)
console.log(`baseline: mtimeMs=${baseline.mtimeMs} ctimeMs=${baseline.ctimeMs} size=${baseline.size}`)
console.log(`rev    : ${rev}`)
console.log(`url    : ${url}`)
console.log('')

const response = await fetch(url)
const body = await response.text()
console.log(`status : ${response.status} ${response.statusText}`)
console.log(`length : ${body.length}`)
if (response.status === 200) {
  const first = body.split('\n').slice(0, 3).join('\n')
  console.log(`head   :\n${first}`)
  const mounted = body.includes(`id: "${id}"`)
  const current = body.includes('api/session.delete')
  console.log('')
  console.log(`${mounted ? 'ok  ' : 'FAIL'} served bundle declares this plugin id`)
  // Only the package's own id must carry the client: a tombstone left behind by a
  // rename is served on purpose and registers nothing.
  if (id === packageName()) {
    console.log(`${current ? 'ok  ' : 'FAIL'} served bundle carries the delete-conversation client`)
    process.exit(mounted && current ? 0 : 1)
  }
  console.log(`${current ? 'ok  ' : '..  '} carries the delete-conversation client${current ? '' : ' (expected for a tombstone or a foreign id)'}`)
  process.exit(mounted ? 0 : 1)
}
console.log('The row is not in the running composition yet: the Loader mounts rows at')
console.log('startup (and on a live profile reload). Restart DSH and run this again.')
process.exit(1)
