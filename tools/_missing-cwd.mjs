/**
 * Which stored Sessions point at a workspace that no longer exists?
 *
 * A Session's log header carries the workspace path it was created in. Rename that
 * folder and the header keeps the old path — which is what the sidebar groups by, so
 * those Sessions stop matching a workspace. This reads the real logs (first zstd
 * frame = the header) and reports per path.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const root = join(process.env.USERPROFILE ?? '', '.dsh', 'sessions')
const byCwd = new Map()

for (const project of readdirSync(root, { withFileTypes: true })) {
  if (!project.isDirectory()) continue
  for (const session of readdirSync(join(root, project.name), { withFileTypes: true })) {
    if (!session.isDirectory()) continue
    const directory = join(root, project.name, session.name)
    const files = readdirSync(directory).filter((name) => name.startsWith('session')).sort()
    if (files.length === 0) continue
    const newest = files.at(-1)
    let cwd
    try {
      const raw = readFileSync(join(directory, newest))
      const text = (newest.endsWith('.zstd') ? zstdDecompressSync(raw) : raw).toString('utf8')
      const header = JSON.parse(text.split('\n').find((line) => line.trim() !== ''))
      cwd = typeof header.cwd === 'string' ? header.cwd : '(no cwd)'
    } catch {
      cwd = '(unreadable)'
    }
    const entry = byCwd.get(cwd) ?? { sessions: 0, directories: new Set() }
    entry.sessions++
    entry.directories.add(project.name)
    byCwd.set(cwd, entry)
  }
}

const rows = [...byCwd].map(([cwd, entry]) => ({ cwd, ...entry, exists: cwd.startsWith('(') ? false : existsSync(cwd) }))
rows.sort((left, right) => right.sessions - left.sessions)
console.log('Sessions grouped by the workspace path in their header:')
for (const row of rows) {
  console.log(`  ${row.exists ? 'exists ' : 'MISSING'}  ${String(row.sessions).padStart(3)} session(s)  ${row.cwd}`)
}
const missing = rows.filter((row) => !row.exists)
console.log('')
console.log(`paths that no longer exist: ${String(missing.length)}, holding ${String(missing.reduce((sum, row) => sum + row.sessions, 0))} session(s)`)
