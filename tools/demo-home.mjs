/**
 * Build an isolated demo home for screenshots.
 *
 * Two things this must guarantee:
 *
 *  1. Nothing the demo instance does can touch the operator's real profile or
 *     sessions. The profile is therefore COPIED (junctions to the shared runtime
 *     cache are copied as links, so the demo cannot rewrite them) and the sessions
 *     root lives under the demo home.
 *  2. The fixtures are valid by construction: every seeded log is a header-only
 *     Session, the exact one-line shape a real blank Session has on this machine
 *     (verified against `~/.dsh/sessions/**`), so no event schema is guessed.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
// The plugin's own exported helpers, not a copy of them: the backend validates
// that a log's path agrees with its header ("header id ... and cwd identify ..."),
// so a hand-written approximation of the directory name makes every fixture
// "corrupt".
import { encodeSegment, projectKey } from '../src/index.ts'

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const realProfile = join(dshHome, 'profiles', process.env.SOURCE_PROFILE ?? 'web')
const demoHome = resolve(process.argv[2] ?? join(homedir(), 'dsh-demo'))
const demoProfile = join(demoHome, 'profiles', 'demo')

if (!existsSync(join(realProfile, 'package.json'))) throw new Error(`no source profile at ${realProfile}`)
if (existsSync(demoProfile)) {
  rmSync(demoProfile, { recursive: true, force: true })
  console.log(`cleared ${demoProfile}`)
}

// 1. a copy of the working profile, links included, so the demo is self-contained
cpSync(realProfile, demoProfile, { recursive: true, dereference: false, force: true })
rmSync(join(demoProfile, '.plugin-manager'), { recursive: true, force: true })
console.log(`copied ${realProfile} -> ${demoProfile}`)
console.log(`  entries: ${readdirSync(demoProfile).join(', ')}`)

// 2. demo sessions: one workspace, five blank Sessions, ages chosen so the cleanup
//    grace window is visible (one is too recent to be eligible)
const workspace = join(demoHome, 'workspace')
mkdirSync(workspace, { recursive: true })
const now = Date.now()
const ages = [10 * 60 * 1000, 3 * 60 * 60 * 1000, 5 * 60 * 60 * 1000, 26 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000]
const sessionsRoot = join(demoHome, 'sessions')
// Clear first: a plain .jsonl left behind by an earlier run makes the session
// backend refuse the whole root ("uses .jsonl, but this backend is configured for
// compression zstd"), which takes the workspace registry down with it.
rmSync(sessionsRoot, { recursive: true, force: true })
const projectDir = join(sessionsRoot, projectKey(workspace))
mkdirSync(projectDir, { recursive: true })

const seeded = []
for (const [index, age] of ages.entries()) {
  const id = `session-00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  const directory = join(projectDir, encodeSegment(id))
  mkdirSync(directory, { recursive: true })
  const header = {
    type: 'session',
    version: 0,
    id,
    createdAt: now - age,
    cwd: workspace,
    delegationDepth: 0,
    agentPreset: 'standard'
  }
  // Compression matters: the backend on this machine is configured for zstd and
  // rejects a plain .jsonl artifact at the root, so the fixture must match what a
  // real blank Session looks like here — one zstd frame holding the header line.
  const line = `${JSON.stringify(header)}\n`
  const path = join(directory, 'session.jsonl.zstd')
  writeFileSync(path, zstdCompressSync(Buffer.from(line, 'utf8')))
  const roundTrip = zstdDecompressSync(readFileSync(path)).toString('utf8')
  if (roundTrip !== line) throw new Error(`fixture did not round-trip: ${path}`)
  seeded.push({ id, ageMinutes: Math.round(age / 60000), bytes: statSync(path).size })
}
console.log('')
console.log(`workspace: ${workspace}`)
console.log(`seeded ${String(seeded.length)} blank Sessions under ${projectDir}`)
for (const row of seeded) console.log(`  ${row.id}  idle ${String(row.ageMinutes)}m  ${String(row.bytes)}B`)
console.log('')
console.log(`demo home: ${demoHome}`)
