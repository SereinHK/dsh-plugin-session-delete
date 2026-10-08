/**
 * Put one throwaway Session in the trash, so the dialog can be looked at.
 *
 * Nothing of the operator's is touched: a fresh blank Session is written under a demo
 * folder, then moved into the plugin's trash exactly as `moveToTrash` does — the paths
 * and the encoding come from the plugin's own exports, so the fixture cannot drift from
 * the format the routes read. `restore` and `purge` in the dialog both work on it.
 *
 *   node tools/seed-trash.mjs [--remove]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { encodeSegment, projectKey } from '../src/index.ts'

const remove = process.argv.includes('--remove')
const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')
const trashEntries = join(home, 'plugin-session-delete', 'trash', 'entries')

/** The demo workspace the fixture Session claims to belong to. */
const cwd = join(homedir(), 'dsh-trash-demo')
/** A fixed id, so re-running replaces the same fixture instead of piling up. */
const sessionId = 'session-0000d3m0-0000-4000-8000-000000000001'
const encoded = encodeSegment(sessionId)
const projectDir = join(sessionsRoot, projectKey(cwd))
const sessionDir = join(projectDir, encoded)
const trashDir = join(trashEntries, encoded)
const recordPath = join(trashEntries, `${encoded}.json`)

if (remove) {
  for (const path of [trashDir, recordPath]) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true })
      console.log(`removed ${path}`)
    }
  }
  const inSessions = existsSync(sessionDir)
  if (inSessions) {
    rmSync(sessionDir, { recursive: true, force: true })
    console.log(`removed ${sessionDir}`)
  }
  rmSync(cwd, { recursive: true, force: true })
  console.log('demo folder removed')
  process.exit(0)
}

// 1. a fresh blank Session under the demo folder — the shape a stored one has
//    (one zstd frame holding the header line; this install is configured for zstd).
mkdirSync(cwd, { recursive: true })
mkdirSync(sessionDir, { recursive: true })
const header = {
  type: 'session',
  version: 0,
  id: sessionId,
  createdAt: Date.now(),
  cwd,
  delegationDepth: 0,
  agentPreset: 'standard'
}
const line = `${JSON.stringify(header)}\n`
const logPath = join(sessionDir, 'session.jsonl.zstd')
writeFileSync(logPath, zstdCompressSync(Buffer.from(line, 'utf8')))

// 2. move it into the trash, with the record the routes read
mkdirSync(trashEntries, { recursive: true })
rmSync(trashDir, { recursive: true, force: true })
rmSync(recordPath, { force: true })
const files = readdirSync(sessionDir)
renameSync(sessionDir, trashDir)
const record = {
  sessionId,
  cwd,
  projectDirectory: projectDir,
  title: '演示：这条对话可以恢复（也可以彻底删除）',
  bytes: statSync(join(trashDir, files[0])).size,
  deletedAt: Date.now(),
  files
}
writeFileSync(recordPath, `${JSON.stringify(record, undefined, 2)}\n`, 'utf8')

// 3. read it back the way the route does, so the fixture is proven before anyone looks
const readBack = JSON.parse(readFileSync(recordPath, 'utf8'))
console.log('seeded one trash entry')
console.log(`  session : ${readBack.sessionId}`)
console.log(`  title   : ${readBack.title}`)
console.log(`  cwd     : ${readBack.cwd}`)
console.log(`  files   : ${readBack.files.join(', ')}`)
console.log(`  trash   : ${trashDir}`)
console.log(`  record  : ${recordPath}`)
console.log('')
console.log('the dialog lists it as soon as it asks the Host; restore and purge both work on it')
console.log('to take it back out: node tools/seed-trash.mjs --remove')
