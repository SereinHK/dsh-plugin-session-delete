/**
 * Delete-conversation plugin, node half.
 *
 * Registers one authenticated Fetch route inside Connection's `/api` fence —
 * `POST /api/session.delete` — which permanently removes one stored Session
 * from this Host's session root, and tells the browser the row is gone.
 *
 * DSH deliberately ships no session-deletion surface: `SessionPersistence`
 * exposes `create`/`open`/`flush`/`stat`/`list` and nothing else, `/clear` and
 * archive only hide rows, and the projection cache documents pruning as
 * out-of-band maintenance. This plugin is that out-of-band step, so it owns the
 * removal itself against the layout the shipped JSONL backend writes:
 *
 *     <root>/<projectKey(header.cwd)>/<encodeSegment(sessionId)>/session[.vN].jsonl[.zstd]
 *
 * Both path builders are re-implemented below because the backend does not
 * export them; a directory scan under the session root backs them up if either
 * drifts, so a layout change degrades to "cannot find the session" instead of
 * "deleted the wrong directory". A target that is live in this process is
 * refused, because its open write handle would resurrect or corrupt the log.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete
 */
import { readdir, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

/** The exact Fetch route this plugin owns; inside Connection's authenticated `/api` prefix. */
export const SESSION_DELETE_PATH = '/api/session.delete'

/**
 * The second route: durable per-Session facts the browser cannot see for itself.
 *
 * A stored Session's blankness lives in the Host's projection of its log. The
 * browser's Session-list row does NOT carry it for a Session that is not resident
 * (its `blank` flag describes a live Session's first turn), and its projection
 * block is loaded only for the Session being viewed — so a cleanup decided in the
 * page would see nothing to clean. This route answers from the same projection
 * cache the Session list itself uses.
 */
export const SESSION_UNUSED_PATH = '/api/session.unused'

/** Longest accepted session id, bounded before any filesystem or lookup work. */
const MAX_SESSION_ID_LENGTH = 200

/** Rows this route will report; a profile with more stored Sessions than this is out of scope. */
const MAX_UNUSED_ROWS = 5000

/** Session ids are filesystem segments: letters, digits, `.`, `_`, `-` only. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * Required Host services.
 *
 * `connection` owns the route registry and its Host/Origin + browser-token
 * fence; `sessionPersistence` resolves a stored Session's header (its `cwd`
 * picks the project directory) and the session root; `sessions` is the live
 * in-memory registry this plugin refuses to delete from under; `sessionQuery`
 * is the Host's own enumeration of stored Sessions, which is where the durable
 * per-Session facts come from.
 */
export const inject = ['connection', 'sessionPersistence', 'sessions', 'sessionQuery']

/** The slice of Connection this plugin uses. */
interface FetchRouteRegistry {
  register(route: {
    readonly path: string
    readonly methods: readonly string[]
    readonly requestBody: 'buffered'
    readonly fetch: (request: Request) => Promise<Response>
  }): () => void
}

/** The slice of Session persistence this plugin uses. */
interface SessionPersistenceLike {
  readonly config?: { readonly root?: unknown } | undefined
  readonly root?: unknown
  stat(sessionId: string): Promise<{ readonly header: { readonly cwd?: string | undefined } } | undefined>
}

/** The slice of the live Session registry this plugin uses. */
interface SessionStoreLike {
  get(sessionId: string): unknown
}

/** One stored Session as the Host's query service reports it. */
interface SessionRecordLike {
  readonly header: {
    readonly id: string
    readonly cwd?: string | undefined
    readonly createdAt?: number | undefined
  }
}

/** The slice of Session query this plugin uses. */
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<readonly SessionRecordLike[]>
}

/**
 * The slice of the projection cache this plugin uses.
 *
 * Read through `ctx.get` rather than `inject`: the cache is an optional service,
 * exactly as the Session controller itself treats it, and a profile without one
 * should serve "unproven" rows rather than refuse to compose.
 */
interface SessionProjectionCacheLike {
  cachedSnapshot(meta: unknown, keys?: readonly string[]): { readonly values: Readonly<Record<string, unknown>> } | undefined
}

/** Durable facts about one stored Session, as this plugin reports them. */
export interface UnusedSessionRow {
  readonly sessionId: string
  readonly cwd: string
  /** The Session's title from the same projection cache, when it has one. */
  readonly title?: string | undefined
  /** Bytes this Session occupies on disk, when they could be measured. */
  readonly bytes?: number | undefined
  /** Header creation time, or null when the log does not carry one. */
  readonly createdAt: number | null
  /** Last activity: the header's creation time, floored by the last accepted prompt. */
  readonly updatedAt: number
  /** True only when the durable projection says the log holds no accepted prompt. */
  readonly blank: boolean
  /** False when the projection cache had no record, so `blank` proves nothing. */
  readonly proven: boolean
  readonly lastPromptAt: number | null
}

/** Host context this plugin applies to. */
interface HostContext {
  readonly connection: { readonly fetch: FetchRouteRegistry }
  readonly sessionPersistence: SessionPersistenceLike
  readonly sessions: SessionStoreLike
  readonly sessionQuery: SessionQueryLike
  get(name: string): unknown
  effect(callback: () => unknown, label?: string): unknown
  emit(event: string, ...args: unknown[]): unknown
}

/** One failure envelope's shape. */
interface DeleteFailure {
  readonly code: string
  readonly message: string
}

/** One successful deletion's report. */
interface DeleteReport {
  readonly sessionId: string
  readonly directory: string
  readonly files: readonly string[]
  readonly cacheRemoved: boolean
}

/**
 * Register this plugin's authenticated routes for its lifetime.
 * @param ctx - Host context carrying Connection, persistence, query, and live Sessions.
 */
export function apply(ctx: HostContext): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleSessionDelete(ctx, request)
  }), `session-delete: POST ${SESSION_DELETE_PATH}`)
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_UNUSED_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleSessionUnused(ctx, request)
  }), `session-delete: POST ${SESSION_UNUSED_PATH}`)
}

/**
 * Serve one request for the durable per-Session facts.
 *
 * The body is ignored: this route reports every stored Session and lets the caller
 * apply its own policy, so it stays useful to more than the cleanup dialog.
 *
 * @param ctx - Host context.
 * @param request - the authenticated Fetch request.
 * @returns a JSON envelope whose value is `{ sessions: UnusedSessionRow[] }`.
 */
async function handleSessionUnused(ctx: HostContext, request: Request): Promise<Response> {
  // A body is optional here; an unparsable one is still refused so a caller
  // cannot believe arguments were honoured when they were not.
  const text = await request.text()
  if (text.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return failure('invalid-request', 'the request body must be a JSON object or empty', 400)
      }
    } catch {
      return failure('invalid-request', 'the request body must be a JSON object or empty', 400)
    }
  }

  let records: readonly SessionRecordLike[]
  try {
    records = await ctx.sessionQuery.listSessions()
  } catch (error) {
    return failure('storage-unreadable', `cannot list stored sessions: ${messageOf(error)}`, 500)
  }

  const cache = ctx.get('sessionProjectionCache') as SessionProjectionCacheLike | undefined
  const root = sessionRoot(ctx)
  const sessions: UnusedSessionRow[] = []
  for (const record of records.slice(0, MAX_UNUSED_ROWS)) {
    const header = record.header
    if (header.cwd === undefined || header.cwd.length === 0) continue
    // Both rows come from the same cache block the Session list itself reads: the
    // title is what the operator recognises the conversation by, and the size is
    // what the cleanup is actually reclaiming.
    let values: Readonly<Record<string, unknown>> | undefined
    try {
      values = cache?.cachedSnapshot(header, ['sessionListMetadata', 'title'])?.values
    } catch {
      // A cache that cannot answer is "unproven", never an error: the caller's
      // policy must not be talked into a deletion by a failure.
      values = undefined
    }
    const metadata = values?.sessionListMetadata as { readonly blank?: unknown; readonly lastPromptAt?: unknown } | undefined
    const title = typeof values?.title === 'string' && values.title.trim() !== '' ? values.title : undefined
    const bytes = await sessionBytes(root, header.cwd, header.id)
    const lastPromptAt = typeof metadata?.lastPromptAt === 'number' ? metadata.lastPromptAt : null
    const createdAt = typeof header.createdAt === 'number' ? header.createdAt : null
    sessions.push({
      sessionId: header.id,
      cwd: header.cwd,
      ...title === undefined ? {} : { title },
      ...bytes === undefined ? {} : { bytes },
      createdAt,
      updatedAt: Math.max(createdAt ?? 0, lastPromptAt ?? 0),
      blank: metadata?.blank === true,
      proven: metadata !== undefined,
      lastPromptAt
    })
  }

  return Response.json({ ok: true, value: { sessions } }, { headers: { 'cache-control': 'no-store' } })
}

/**
 * Measure one stored Session's directory, so the cleanup can say what it reclaims.
 *
 * Best-effort by design: a Session that cannot be measured is still reported, just
 * without a size. Nothing here decides anything — the policy never reads this.
 *
 * @param root - the configured session root.
 * @param cwd - the Session's workspace path, which picks its project directory.
 * @param sessionId - the Session id.
 * @returns the total bytes of its artifacts, or `undefined` when unreadable.
 */
async function sessionBytes(root: string, cwd: string, sessionId: string): Promise<number | undefined> {
  try {
    const directory = resolve(root, projectKey(cwd), encodeSegment(sessionId))
    if (containmentRefusal(root, directory, encodeSegment(sessionId)) !== undefined) return undefined
    const entries = await readdir(directory, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      total += (await stat(join(directory, entry.name))).size
    }
    return total
  } catch {
    return undefined
  }
}

/**
 * Serve one delete request.
 * @param ctx - Host context.
 * @param request - the authenticated Fetch request.
 * @returns a JSON envelope: `{ ok: true, value }` or `{ ok: false, error }`.
 */
async function handleSessionDelete(ctx: HostContext, request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return failure('invalid-request', 'the request body must be a JSON object', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return failure('invalid-request', 'the request body must be a JSON object', 400)
  }
  const sessionId = (body as { sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH
    || !SESSION_ID_PATTERN.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return failure('invalid-session-id', 'sessionId must be a session-id-shaped string', 400)
  }

  if (ctx.sessions.get(sessionId) !== undefined) {
    return failure(
      'session-live',
      `session "${sessionId}" is live in this process: its open write handle would recreate the log. `
      + 'Switch to another conversation (or restart DSH) and delete it then.',
      409
    )
  }

  const root = sessionRoot(ctx)
  let directory: string | undefined
  try {
    directory = await locateSessionDirectory(ctx, root, sessionId)
  } catch (error) {
    return failure('storage-unreadable', `cannot read the session root "${root}": ${messageOf(error)}`, 500)
  }
  if (directory === undefined) {
    return failure('session-not-found', `no stored session log for "${sessionId}" under "${root}"`, 404)
  }

  // Last line of defence before an irreversible recursive removal: the target
  // must be exactly <root>/<project>/<encoded session id>. A layout drift, a
  // crafted id, or a symlinked project directory can then only ever produce a
  // refusal, never a deletion somewhere else.
  const refusal = containmentRefusal(root, directory, encodeSegment(sessionId))
  if (refusal !== undefined) return failure('unsafe-target', refusal, 500)
  const realRefusal = await realContainmentRefusal(root, directory)
  if (realRefusal !== undefined) return failure('unsafe-target', realRefusal, 500)

  let files: readonly string[]
  try {
    files = (await readdir(directory, { withFileTypes: true })).map((entry) => entry.name)
    await rm(directory, { recursive: true, force: true })
  } catch (error) {
    return failure('delete-failed', `cannot remove "${directory}": ${messageOf(error)}`, 500)
  }

  const cacheRemoved = await purgeProjectionRecord(ctx, sessionId)

  // The shipped Session Controller emits this when a Session leaves the live
  // registry; api-remotes forwards it to every browser, where the session-list
  // store drops the row. A disk deletion emits nothing on its own, so the
  // plugin says it here.
  ctx.emit('api-session/removed', sessionId)

  const report: DeleteReport = { sessionId, directory, files, cacheRemoved }
  return Response.json({ ok: true, value: report }, { headers: { 'cache-control': 'no-store' } })
}

/**
 * Resolve one stored Session's directory beneath the session root.
 *
 * The header's `cwd` picks the project directory when persistence still knows
 * the Session; a scan of the project directories backs that up, so a Session
 * whose generation moved (or whose header is no longer listed) is still found
 * by its own directory name.
 *
 * @param ctx - Host context carrying Session persistence.
 * @param root - the configured session root.
 * @param sessionId - the validated Session id.
 * @returns the absolute session directory, or `undefined` when none exists.
 */
async function locateSessionDirectory(ctx: HostContext, root: string, sessionId: string): Promise<string | undefined> {
  const encoded = encodeSegment(sessionId)
  const snapshot = await ctx.sessionPersistence.stat(sessionId)
  const cwd = snapshot?.header.cwd
  // A header with no usable cwd (`undefined`, or the empty string the backend
  // itself refuses to encode) simply falls through to the scan.
  if (cwd === undefined || cwd.length > 0) {
    const candidate = join(projectDirectory(root, cwd), encoded)
    if (await isDirectory(candidate)) return candidate
  }
  const projects = await readdir(root, { withFileTypes: true })
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = join(root, project.name, encoded)
    if (await isDirectory(candidate)) return candidate
  }
  return undefined
}

/**
 * Read the session root the mounted persistence backend writes to.
 *
 * `config.root` is the documented config field and the JSONL backend keeps the
 * resolved path on the instance, which is the only place a plugin can see it.
 * `DSH_HOME/sessions` is the profile's own value and the fallback.
 *
 * @param ctx - Host context carrying Session persistence.
 * @returns the absolute session root, unverified.
 */
function sessionRoot(ctx: HostContext): string {
  const persistence = ctx.sessionPersistence
  const configured = typeof persistence.config?.root === 'string' ? persistence.config.root : persistence.root
  if (typeof configured === 'string' && configured.length > 0) return resolve(configured)
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return resolve(join(home, 'sessions'))
}

/**
 * Remove one Session's projection-cache record.
 *
 * The record is a derived checkpoint keyed by Session id, and its identity
 * guard rejects a stale document anyway, so this is tidiness rather than
 * correctness: a failure is reported, never fatal.
 *
 * @param ctx - Host context carrying Session persistence (for the sibling root).
 * @param sessionId - the deleted Session id.
 * @returns whether a record was removed.
 */
async function purgeProjectionRecord(ctx: HostContext, sessionId: string): Promise<boolean> {
  try {
    const storageRoot = resolve(join(sessionRoot(ctx), '..', 'storages', 'session_projcache', 'sessions'))
    await rm(join(storageRoot, `${encodeSegment(sessionId)}.json`), { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * The project directory one Session's header belongs to.
 * @param root - the session root.
 * @param cwd - the Session header's project directory, if it carries one.
 * @returns the project directory path under the root.
 */
function projectDirectory(root: string, cwd: string | undefined): string {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * Decide whether a located directory is safe to remove recursively.
 * @param root - the configured session root.
 * @param directory - the located session directory.
 * @param encoded - the encoded Session id the directory must be named after.
 * @returns a refusal message, or `undefined` when the target is contained.
 */
function containmentRefusal(root: string, directory: string, encoded: string): string | undefined {
  const rootPath = resolve(root)
  const target = resolve(directory)
  if (basename(target) !== encoded) return `refusing to remove "${target}": it is not named after this session`
  if (!target.startsWith(`${rootPath}${sep}`)) return `refusing to remove "${target}": it is outside the session root`
  const relative = target.slice(rootPath.length + 1)
  if (relative.split(sep).length !== 2) return `refusing to remove "${target}": it is not one project directory below the session root`
  return undefined
}

/**
 * Decide the same question again, on resolved paths.
 *
 * {@link containmentRefusal} compares strings, so a project directory that is a
 * link — a junction into another drive, or something a user created — passes it
 * while the recursive removal would actually happen wherever the link points. The
 * blast radius is already bounded (the directory must be named exactly after the
 * Session id), so this is hardening rather than a fix; resolving both sides costs
 * one syscall each and removes the doubt. A root that is itself a link is fine:
 * both sides resolve through it.
 *
 * @param root - the configured session root.
 * @param directory - the located session directory.
 * @returns a refusal message, or `undefined` when the real target is contained.
 */
async function realContainmentRefusal(root: string, directory: string): Promise<string | undefined> {
  let realRoot: string
  let realDirectory: string
  try {
    realRoot = await realpath(root)
    realDirectory = await realpath(directory)
  } catch (error) {
    return `refusing to remove "${directory}": its real path could not be resolved (${messageOf(error)})`
  }
  if (!realDirectory.startsWith(`${realRoot}${sep}`)) {
    return `refusing to remove "${directory}": it resolves outside the session root, to "${realDirectory}"`
  }
  return undefined
}

/**
 * Encode one path segment exactly as the JSONL backend does, so a session
 * directory is addressed instead of guessed.
 *
 * Exported for tools and tests: this and {@link projectKey} are the two facts
 * that let a plugin find a stored Session without the backend's own path
 * helpers, and a drift between them and the backend is the one failure this
 * plugin must not have silently.
 *
 * @param raw - the unpadded value.
 * @returns a filesystem-safe single segment.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * Build the human-navigable project directory key for one cwd, exactly as the
 * JSONL backend does: separators collapse to `-`, unsafe code units escape to
 * `~XXXX`, and the whole key is wrapped in `--` and bounded.
 *
 * Exported for tools and tests; see {@link encodeSegment}.
 *
 * @param cwd - the Session header's project directory.
 * @returns one filesystem-safe directory name.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** Whether one path is an existing directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Normalize an unknown thrown value to a message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compose one failure envelope.
 * @param code - stable machine code the browser switches on.
 * @param message - human diagnostic.
 * @param status - HTTP status.
 * @returns the JSON response.
 */
function failure(code: string, message: string, status: number): Response {
  const error: DeleteFailure = { code, message }
  return Response.json({ ok: false, error }, {
    status,
    headers: { 'cache-control': 'no-store' }
  })
}
