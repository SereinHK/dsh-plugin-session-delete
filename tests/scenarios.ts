/**
 * Host-route scenarios for the delete-conversation node half.
 *
 * One shared scenario set drives two targets: `tests/session-delete.test.ts`
 * runs it against `src/index.ts` (the source of truth), and
 * `tools/verify-artifact.mjs` runs it against the built `lib/index.js` (the bytes
 * the running host actually loads). Neither target imports the other.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/tests/scenarios
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  encodeSegment,
  projectKey,
  SESSION_DELETE_PATH,
  SESSION_PURGE_PATH,
  SESSION_RESTORE_PATH,
  SESSION_TRASH_PATH,
  SESSION_UNUSED_PATH
} from '../src/index.ts'

/** One section of the run: a label, how many checks it made, and what failed. */
export interface SectionResult {
  readonly section: string
  readonly checks: number
  readonly failures: readonly string[]
}

/** The Host context shape the plugin applies to, as the scenarios stub it. */
export interface HostStub {
  readonly route: {
    readonly path: string
    readonly methods: readonly string[]
    readonly requestBody: string
    readonly fetch: (request: Request) => Promise<Response>
  }
  /** The second route: durable per-Session facts. */
  readonly unused: {
    readonly path: string
    readonly methods: readonly string[]
    readonly requestBody: string
    readonly fetch: (request: Request) => Promise<Response>
  }
  /** Every registered route, by path — the trash routes included. */
  readonly byPath: Readonly<Record<string, HostStub['route']>>
  readonly events: readonly (readonly [string, unknown])[]
  readonly root: string
  readonly cacheDir: string
}

/** Knobs for the durable-facts route, defaulted so existing sections stay short. */
export interface MountOptions {
  /** Ids the projection cache holds a record for; `'none'` models a cold cache. */
  readonly projected?: readonly string[] | 'none'
  /** Durable blankness per id; anything unlisted is blank. */
  readonly blank?: Readonly<Record<string, boolean>>
  /** A cache whose reads throw, to prove a failure can never become a deletion. */
  readonly cacheThrows?: boolean
  /** Titles the projection carries, per id. */
  readonly titles?: Readonly<Record<string, string>>
  /** Plugin config: how long the trash keeps things. */
  readonly retentionDays?: number
}

/** Collects checks for one section without aborting on the first failure. */
class Section {
  readonly failures: string[] = []
  checks = 0
  readonly section: string

  constructor(section: string) {
    this.section = section
  }

  /** Record one expectation. */
  check(label: string, condition: boolean, detail = ''): void {
    this.checks++
    if (!condition) this.failures.push(detail === '' ? label : `${label} — ${detail}`)
  }

  /** The section's result. */
  result(): SectionResult {
    return { section: this.section, checks: this.checks, failures: this.failures }
  }
}

/** Whether one path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Run every host-route scenario against one `apply` implementation.
 * @param apply - the node half's apply, from source or from the built artifact.
 * @returns one result per section.
 */
export async function runScenarios(apply: (ctx: unknown) => void): Promise<SectionResult[]> {
  const home = await mkdtemp(join(tmpdir(), 'ui-session-delete-'))
  const root = join(home, 'sessions')
  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  const cwd = 'C:\\Users\\Administrator\\Downloads\\dsh'
  const results: SectionResult[] = []

  /** Create one stored Session fixture. */
  const seed = async (
    sessionId: string,
    options: { project?: string; log?: string } = {}
  ): Promise<string> => {
    const directory = join(root, options.project ?? projectKey(cwd), sessionId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, options.log ?? 'session.v4.jsonl.zstd'), 'session log fixture')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, `${sessionId}.json`), '{"checkpoint":true}')
    return directory
  }

  /** Mount the plugin against a stub context. */
  const mount = (headers: Record<string, { cwd: string } | 'live'>, options: MountOptions = {}): HostStub => {
    const routes: HostStub['route'][] = []
    const events: [string, unknown][] = []
    const live = new Set(Object.keys(headers).filter((id) => headers[id] === 'live'))
    const createdAt = 1_700_000_000_000
    apply({
      effect: (callback: () => unknown) => {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      connection: { fetch: { register: (route: HostStub['route']) => {
        routes.push(route)
        return () => {}
      } } },
      sessions: { get: (id: string) => (live.has(id) ? { id } : undefined) },
      sessionPersistence: {
        config: { root },
        stat: async (id: string) => {
          const header = headers[id]
          return header === undefined || header === 'live' ? undefined : { header: { id, cwd: header.cwd } }
        }
      },
      // The Host's own enumeration of stored Sessions, and the projection cache it
      // reads them through. Both are stubs here; the real shapes are what the
      // running app was verified against.
      sessionQuery: {
        listSessions: async () => Object.entries(headers)
          .filter(([, value]) => value !== 'live')
          .map(([id, value]) => ({ header: { id, cwd: (value as { cwd: string }).cwd, createdAt } }))
      },
      get: (name: string) => {
        if (name !== 'sessionProjectionCache') return undefined
        if (options.cacheThrows === true) {
          return { cachedSnapshot: () => { throw new Error('projection cache offline') } }
        }
        return {
          cachedSnapshot: (header: { id: string }) => {
            const projected = options.projected ?? 'all'
            if (projected === 'none' || (projected !== 'all' && !projected.includes(header.id))) return undefined
            return {
              values: {
                sessionListMetadata: { blank: options.blank?.[header.id] ?? true, lastPromptAt: null },
                // The same block carries the title the cleanup now shows.
                title: options.titles?.[header.id] ?? null
              }
            }
          }
        }
      },
      emit: (event: string, ...args: unknown[]) => {
        events.push([event, args[0]])
      }
    }, options.retentionDays === undefined ? undefined : { retentionDays: options.retentionDays })
    return {
      route: routes[0]!,
      unused: routes[1]!,
      byPath: Object.fromEntries(routes.map((route) => [route.path, route])),
      events,
      root,
      cacheDir
    }
  }

  /** Issue one request against a registered route. */
  const call = async (stub: HostStub, body: unknown, path: string = SESSION_DELETE_PATH): Promise<{ status: number; payload: any }> => {
    const route = stub.byPath[path]
    if (route === undefined) throw new Error(`no route registered at ${path}; registered: ${Object.keys(stub.byPath).join(', ')}`)
    const request = new Request(`http://127.0.0.1:19387${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
    const response = await route.fetch(request)
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    return { status: response.status, payload }
  }

  // ── route shape ──────────────────────────────────────────────────────────────
  {
    const section = new Section('route registration')
    const stub = mount({})
    section.check('registers the delete route', stub.route !== undefined)
    section.check('owns the documented path', stub.route?.path === SESSION_DELETE_PATH, stub.route?.path)
    section.check('accepts POST only', stub.route?.methods.length === 1 && stub.route.methods[0] === 'POST', JSON.stringify(stub.route?.methods))
    section.check('buffers the request body', stub.route?.requestBody === 'buffered', stub.route?.requestBody)
    section.check('registers the durable-facts route', stub.unused !== undefined)
    section.check('under its own path', stub.unused?.path === SESSION_UNUSED_PATH, stub.unused?.path)
    section.check('also POST-only and buffered', stub.unused?.methods[0] === 'POST' && stub.unused?.requestBody === 'buffered')
    results.push(section.result())
  }

  // ── durable facts ────────────────────────────────────────────────────────────
  {
    const section = new Section('durable per-Session facts')
    const stored = 'session-aaaaaaaa-1111-2222-3333-444444444444'
    const second = 'session-bbbbbbbb-1111-2222-3333-444444444444'
    const stub = mount({ [stored]: { cwd }, [second]: { cwd } })
    const { status, payload } = await call(stub, {}, SESSION_UNUSED_PATH)
    section.check('answers 200', status === 200, String(status))
    const rows = payload?.value?.sessions
    section.check('reports every stored Session', Array.isArray(rows) && rows.length === 2, JSON.stringify(rows))
    const row = rows?.find((entry: { sessionId: string }) => entry.sessionId === stored)
    section.check('carries the workspace path', row?.cwd === cwd, JSON.stringify(row))
    section.check('carries a durable blank flag', row?.blank === true, JSON.stringify(row))
    section.check('marks it proven when the cache answered', row?.proven === true, JSON.stringify(row))
    section.check('reports no last prompt for an unused Session', row?.lastPromptAt === null, JSON.stringify(row))
    section.check('keeps updatedAt at the creation time', row?.updatedAt === row?.createdAt, JSON.stringify(row))
    // An empty body is legal; anything else must be refused rather than ignored.
    section.check('accepts an empty body', (await call(stub, '', SESSION_UNUSED_PATH)).status === 200)
    const invalid = await call(stub, 'not json', SESSION_UNUSED_PATH)
    section.check('refuses an unparsable body', invalid.status === 400 && invalid.payload?.error?.code === 'invalid-request', JSON.stringify(invalid.payload))
    const array = await call(stub, '[]', SESSION_UNUSED_PATH)
    section.check('refuses a non-object body', array.status === 400, JSON.stringify(array.payload))
    results.push(section.result())
  }

  // ── durable facts: what cannot be proven stays unproven ──────────────────────
  {
    const section = new Section('unprovable facts')
    const known = 'session-cccccccc-1111-2222-3333-444444444444'
    const unknown = 'session-dddddddd-1111-2222-3333-444444444444'
    const used = 'session-eeeeeeee-1111-2222-3333-444444444444'
    const cold = mount({ [known]: { cwd }, [unknown]: { cwd } }, { projected: [known] })
    const coldRows = (await call(cold, {}, SESSION_UNUSED_PATH)).payload?.value?.sessions
    section.check('a cached Session is proven', coldRows?.find((r: { sessionId: string }) => r.sessionId === known)?.proven === true)
    const unprovenRow = coldRows?.find((r: { sessionId: string }) => r.sessionId === unknown)
    section.check('a Session with no cache record is not proven', unprovenRow?.proven === false, JSON.stringify(unprovenRow))
    section.check('and claims no blankness', unprovenRow?.blank === false, JSON.stringify(unprovenRow))

    const blank = mount({ [used]: { cwd } }, { blank: { [used]: false } })
    const usedRow = (await call(blank, {}, SESSION_UNUSED_PATH)).payload?.value?.sessions?.[0]
    section.check('a Session with a turn is proven and not blank', usedRow?.proven === true && usedRow?.blank === false, JSON.stringify(usedRow))

    // A cache that throws must degrade to "unproven", never to an error or a guess.
    const broken = mount({ [known]: { cwd } }, { cacheThrows: true })
    const brokenAnswer = await call(broken, {}, SESSION_UNUSED_PATH)
    section.check('an unreadable cache still answers 200', brokenAnswer.status === 200, String(brokenAnswer.status))
    section.check('and reports the row as unproven', brokenAnswer.payload?.value?.sessions?.[0]?.proven === false, JSON.stringify(brokenAnswer.payload))

    const empty = mount({})
    section.check('a Host with no stored Sessions answers an empty list', (await call(empty, {}, SESSION_UNUSED_PATH)).payload?.value?.sessions?.length === 0)
    results.push(section.result())
  }

  // ── what the cleanup shows about each candidate ──────────────────────────────
  {
    const section = new Section('title and size')
    const id = 'session-ffffffff-1111-2222-3333-444444444444'
    const directory = await seed(id)
    const unknown = 'session-ffffffff-1111-2222-3333-555555555555'
    const titled = mount({ [id]: { cwd } }, { titles: { [id]: '演示对话' } })
    const row = (await call(titled, {}, SESSION_UNUSED_PATH)).payload?.value?.sessions?.[0]
    section.check('reports the projected title', row?.title === '演示对话', JSON.stringify(row))
    const written = (await stat(join(directory, 'session.v4.jsonl.zstd'))).size
    section.check('reports what the Session occupies', row?.bytes === written, `${String(row?.bytes)} vs ${String(written)}`)
    section.check('omits the title when the projection has none',
      (await call(mount({ [unknown]: { cwd } }), {}, SESSION_UNUSED_PATH)).payload?.value?.sessions?.[0]?.title === undefined)
    const unmeasurable = mount({ 'session-ffffffff-1111-2222-3333-666666666666': { cwd } })
    section.check('omits the size when nothing is on disk',
      (await call(unmeasurable, {}, SESSION_UNUSED_PATH)).payload?.value?.sessions?.[0]?.bytes === undefined)
    results.push(section.result())
  }

  // ── a linked project directory is refused ────────────────────────────────────
  {
    const section = new Section('linked project directory')
    const outside = join(home, 'outside')
    const id = 'session-99999999-1111-2222-3333-444444444444'
    await mkdir(join(outside, id), { recursive: true })
    await writeFile(join(outside, id, 'session.v4.jsonl.zstd'), 'session log fixture')
    const linked = join(root, projectKey('C:\\linked'))
    let madeLink = false
    try {
      // A junction needs no elevation on Windows, unlike a symbolic link.
      await symlink(outside, linked, 'junction')
      madeLink = true
    } catch {
      madeLink = false
    }
    if (!madeLink) {
      section.check('junction fixture could not be created on this platform; check skipped', true)
    } else {
      const stub = mount({ [id]: { cwd: 'C:\\linked' } })
      const { status, payload } = await call(stub, { sessionId: id })
      section.check('refuses a directory that resolves outside the root', status === 500 && payload?.error?.code === 'unsafe-target', JSON.stringify(payload))
      section.check('and leaves the files alone', await exists(join(outside, id, 'session.v4.jsonl.zstd')))
      section.check('naming the real path it refused', String(payload?.error?.message).includes('outside the session root'), String(payload?.error?.message))
    }
    results.push(section.result())
  }

  // ── the trash ────────────────────────────────────────────────────────────────
  // The trash lives beside the sessions root (so a move is a rename on one volume),
  // and the fixture derives it the same way the plugin does: if that layout changes,
  // these checks fail, which is the point — it is this plugin's own contract.
  const trashBase = join(dirname(root), 'plugin-session-delete', 'trash', 'entries')
  {
    const section = new Section('trash: move, list, restore, purge')
    const id = 'session-77777777-1111-2222-3333-444444444444'
    const directory = await seed(id)
    const stub = mount({ [id]: { cwd } })

    const deleted = await call(stub, { sessionId: id })
    section.check('a delete answers 200', deleted.status === 200, JSON.stringify(deleted.payload))
    section.check('the Session left the sessions root', !(await exists(directory)))
    section.check('the response says where it went', deleted.payload?.value?.trashEntry?.sessionId === id, JSON.stringify(deleted.payload?.value?.trashEntry))
    const moved = join(trashBase, encodeSegment(id))
    section.check('its files are in the trash, not destroyed', await exists(join(moved, 'session.v4.jsonl.zstd')))
    section.check('the response lists the files it moved', deleted.payload?.value?.files?.includes('session.v4.jsonl.zstd') === true)

    const listed = await call(stub, {}, SESSION_TRASH_PATH)
    const entry = listed.payload?.value?.entries?.[0]
    section.check('the trash lists the entry', listed.payload?.value?.entries?.length === 1, JSON.stringify(listed.payload))
    section.check('with its workspace', entry?.cwd === cwd, JSON.stringify(entry))
    section.check('with its size', typeof entry?.bytes === 'number' && entry.bytes > 0, JSON.stringify(entry))
    section.check('and with the default window', listed.payload?.value?.retentionDays === 7, String(listed.payload?.value?.retentionDays))

    const restored = await call(stub, { sessionId: id }, SESSION_RESTORE_PATH)
    section.check('a restore answers 200', restored.status === 200, JSON.stringify(restored.payload))
    section.check('the Session is back where it was', await exists(join(directory, 'session.v4.jsonl.zstd')))
    section.check('and the trash is empty again', (await call(stub, {}, SESSION_TRASH_PATH)).payload?.value?.entries?.length === 0)

    await call(stub, { sessionId: id })
    const purged = await call(stub, { sessionId: id }, SESSION_PURGE_PATH)
    section.check('a purge answers 200', purged.status === 200, JSON.stringify(purged.payload))
    section.check('and the trashed files are gone for good', !(await exists(moved)))
    const gone = await call(stub, { sessionId: id }, SESSION_PURGE_PATH)
    section.check('purging it again is a 404', gone.status === 404 && gone.payload?.error?.code === 'trash-entry-not-found', JSON.stringify(gone.payload))
    section.check('an invalid id is refused before any lookup',
      (await call(stub, { sessionId: '../etc' }, SESSION_PURGE_PATH)).status === 400)
    results.push(section.result())
  }

  // ── the trash: window and emptying ───────────────────────────────────────────
  {
    const section = new Section('trash: expiry and emptying')
    const id = 'session-88888888-1111-2222-3333-444444444444'
    await seed(id)
    const stub = mount({ [id]: { cwd } })
    await call(stub, { sessionId: id })

    // Age the record past the window rather than waiting a week for it.
    const recordPath = join(trashBase, `${encodeSegment(id)}.json`)
    const record = JSON.parse(await readFile(recordPath, 'utf8'))
    record.deletedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    await writeFile(recordPath, JSON.stringify(record), 'utf8')
    const listed = await call(stub, {}, SESSION_TRASH_PATH)
    section.check('an entry past its window is gone by the time it is listed', listed.payload?.value?.entries?.length === 0, JSON.stringify(listed.payload))
    section.check('and its files were destroyed, not just hidden', !(await exists(join(trashBase, encodeSegment(id)))))

    const shortId = 'session-88888888-1111-2222-3333-555555555555'
    await seed(shortId)
    const oneDay = mount({ [shortId]: { cwd } }, { retentionDays: 1 })
    await call(oneDay, { sessionId: shortId })
    section.check('a configured window is reported', (await call(oneDay, {}, SESSION_TRASH_PATH)).payload?.value?.retentionDays === 1)

    const otherId = 'session-88888888-1111-2222-3333-666666666666'
    await seed(otherId)
    await call(oneDay, { sessionId: otherId })
    const emptied = await call(oneDay, { all: true }, SESSION_PURGE_PATH)
    section.check('emptying the trash reports what it destroyed', (emptied.payload?.value?.purged?.length ?? 0) >= 2, JSON.stringify(emptied.payload))
    section.check('and leaves nothing behind', (await call(oneDay, {}, SESSION_TRASH_PATH)).payload?.value?.entries?.length === 0)
    results.push(section.result())
  }

  // ── happy path ───────────────────────────────────────────────────────────────
  {
    const section = new Section('one conversation')
    const id = 'session-11111111-2222-3333-4444-555555555555'
    const directory = await seed(id)
    const stub = mount({ [id]: { cwd } })
    const { status, payload } = await call(stub, { sessionId: id })
    section.check('answers 200', status === 200, String(status))
    section.check('reports ok', payload?.ok === true, JSON.stringify(payload))
    section.check('lists the removed file', payload?.value?.files?.includes('session.v4.jsonl.zstd') === true, JSON.stringify(payload?.value?.files))
    section.check('removed the session directory', !(await exists(directory)))
    section.check('removed the projection record', !(await exists(join(cacheDir, `${id}.json`))))
    section.check('flagged the cache removal', payload?.value?.cacheRemoved === true)
    section.check('emitted api-session/removed', stub.events.some(([event, target]) => event === 'api-session/removed' && target === id))
    results.push(section.result())
  }

  // ── every generation goes with the directory ─────────────────────────────────
  {
    const section = new Section('mixed generation directory')
    const id = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const directory = await seed(id, { log: 'session.v3.jsonl.zstd' })
    await writeFile(join(directory, 'session.v4.jsonl.zstd'), 'newer fixture')
    const stub = mount({ [id]: { cwd } })
    await call(stub, { sessionId: id })
    section.check('removes every generation with the directory', !(await exists(directory)))
    results.push(section.result())
  }

  // ── fallback scan ────────────────────────────────────────────────────────────
  {
    const section = new Section('directory scan fallback')
    const id = 'session-99999999-8888-7777-6666-555555555555'
    const directory = await seed(id, { project: projectKey('D:\\other\\project') })
    const stub = mount({ [id]: { cwd } })
    const { status } = await call(stub, { sessionId: id })
    section.check('answers 200', status === 200, String(status))
    section.check('deleted through the scan', !(await exists(directory)))
    results.push(section.result())
  }

  // ── live session refusal ─────────────────────────────────────────────────────
  {
    const section = new Section('live session')
    const id = 'session-live-0000-0000-0000-000000000000'
    const directory = await seed(id)
    const stub = mount({ [id]: 'live' })
    const { status, payload } = await call(stub, { sessionId: id })
    section.check('answers 409', status === 409, String(status))
    section.check('reports session-live', payload?.error?.code === 'session-live', JSON.stringify(payload?.error))
    section.check('kept the session directory', await exists(directory))
    section.check('emitted nothing', stub.events.length === 0)
    results.push(section.result())
  }

  // ── unknown session ──────────────────────────────────────────────────────────
  {
    const section = new Section('unknown session')
    const stub = mount({})
    const { status, payload } = await call(stub, { sessionId: 'session-nope' })
    section.check('answers 404', status === 404, String(status))
    section.check('reports session-not-found', payload?.error?.code === 'session-not-found', JSON.stringify(payload?.error))
    section.check('emitted nothing', stub.events.length === 0)
    results.push(section.result())
  }

  // ── rejected ids ─────────────────────────────────────────────────────────────
  {
    const section = new Section('rejected ids')
    const stub = mount({})
    for (const sessionId of ['', '..', '.', '../../../etc/passwd', 'a/b', 'a\\b', 'session with spaces', 'x'.repeat(201), 42, null]) {
      const { status, payload } = await call(stub, { sessionId })
      section.check(`rejects ${JSON.stringify(sessionId)}`, status === 400 && payload?.error?.code === 'invalid-session-id', `${status} ${JSON.stringify(payload?.error?.code)}`)
    }
    results.push(section.result())
  }

  // ── rejected bodies ──────────────────────────────────────────────────────────
  {
    const section = new Section('rejected bodies')
    const stub = mount({})
    for (const body of ['not json', '[]', 'null', '"x"']) {
      const { status, payload } = await call(stub, body)
      section.check(`rejects ${body}`, status === 400 && payload?.error?.code === 'invalid-request', `${status} ${JSON.stringify(payload?.error?.code)}`)
    }
    results.push(section.result())
  }

  // ── both id shapes seen on disk ──────────────────────────────────────────────
  {
    const section = new Section('accepted id shapes')
    for (const id of ['session-12345678-90ab-cdef-1234-567890abcdef', '0f5f502b-a77c-4ce7-aae0-45b5757d2b8b']) {
      const directory = await seed(id)
      const stub = mount({ [id]: { cwd } })
      const { status } = await call(stub, { sessionId: id })
      section.check(`deletes ${id}`, status === 200 && !(await exists(directory)), String(status))
    }
    results.push(section.result())
  }

  // ── the real session layout on this machine ──────────────────────────────────
  {
    const section = new Section('real session root')
    const realRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
    let projects: string[] = []
    try {
      projects = (await readdir(realRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      projects = []
    }
    if (projects.length === 0) {
      section.check(`no readable session root at ${realRoot}`, true)
    } else {
      section.check('projectKey reproduces this workspace\'s real project directory', projects.includes(projectKey(cwd)), projectKey(cwd))
      let checkedIds = 0
      let mismatched = 0
      for (const project of projects) {
        for (const entry of await readdir(join(realRoot, project), { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          checkedIds++
          if (encodeSegment(entry.name) !== entry.name) mismatched++
        }
      }
      section.check(`every real session directory is id-encoded (${checkedIds} checked)`, checkedIds > 0 && mismatched === 0, `${mismatched} mismatched`)
    }
    results.push(section.result())
  }

  await rm(home, { recursive: true, force: true })
  return results
}
