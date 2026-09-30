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
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeSegment, projectKey, SESSION_DELETE_PATH } from '../src/index.ts'

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
  readonly events: readonly (readonly [string, unknown])[]
  readonly root: string
  readonly cacheDir: string
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
  const mount = (headers: Record<string, { cwd: string } | 'live'>): HostStub => {
    const routes: HostStub['route'][] = []
    const events: [string, unknown][] = []
    const live = new Set(Object.keys(headers).filter((id) => headers[id] === 'live'))
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
      emit: (event: string, ...args: unknown[]) => {
        events.push([event, args[0]])
      }
    })
    return { route: routes[0]!, events, root, cacheDir }
  }

  /** Issue one request against the registered route. */
  const call = async (stub: HostStub, body: unknown): Promise<{ status: number; payload: any }> => {
    const request = new Request(`http://127.0.0.1:19387${SESSION_DELETE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
    const response = await stub.route.fetch(request)
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
    section.check('registers exactly one route', stub.route !== undefined)
    section.check('owns the documented path', stub.route?.path === SESSION_DELETE_PATH, stub.route?.path)
    section.check('accepts POST only', stub.route?.methods.length === 1 && stub.route.methods[0] === 'POST', JSON.stringify(stub.route?.methods))
    section.check('buffers the request body', stub.route?.requestBody === 'buffered', stub.route?.requestBody)
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
