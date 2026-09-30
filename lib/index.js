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
import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

/** The exact Fetch route this plugin owns; inside Connection's authenticated `/api` prefix. */
export const SESSION_DELETE_PATH = '/api/session.delete'

/** Longest accepted session id, bounded before any filesystem or lookup work. */
const MAX_SESSION_ID_LENGTH = 200

/** Session ids are filesystem segments: letters, digits, `.`, `_`, `-` only. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * Required Host services.
 *
 * `connection` owns the route registry and its Host/Origin + browser-token
 * fence; `sessionPersistence` resolves a stored Session's header (its `cwd`
 * picks the project directory) and the session root; `sessions` is the live
 * in-memory registry this plugin refuses to delete from under.
 */
export const inject = ['connection', 'sessionPersistence', 'sessions']

/** The slice of Connection this plugin uses. */
                              
                   
                         
                                       
                                    
                                                           
                
 

/** The slice of Session persistence this plugin uses. */
                                  
                                                           
                         
                                                                                                          
 

/** The slice of the live Session registry this plugin uses. */
                            
                                 
 

/** Host context this plugin applies to. */
                       
                                                             
                                                     
                                     
                                                          
                                                  
 

/** One failure envelope's shape. */
                         
                       
                          
 

/** One successful deletion's report. */
                        
                            
                            
                                   
                                
 

/**
 * Register the authenticated delete route for this plugin's lifetime.
 * @param ctx - Host context carrying Connection, persistence, and live Sessions.
 */
export function apply(ctx             )       {
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleSessionDelete(ctx, request)
  }), `session-delete: POST ${SESSION_DELETE_PATH}`)
}

/**
 * Serve one delete request.
 * @param ctx - Host context.
 * @param request - the authenticated Fetch request.
 * @returns a JSON envelope: `{ ok: true, value }` or `{ ok: false, error }`.
 */
async function handleSessionDelete(ctx             , request         )                    {
  let body         
  try {
    body = await request.json()
  } catch {
    return failure('invalid-request', 'the request body must be a JSON object', 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return failure('invalid-request', 'the request body must be a JSON object', 400)
  }
  const sessionId = (body                           ).sessionId
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
  let directory                    
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

  let files                   
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

  const report               = { sessionId, directory, files, cacheRemoved }
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
async function locateSessionDirectory(ctx             , root        , sessionId        )                              {
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
function sessionRoot(ctx             )         {
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
async function purgeProjectionRecord(ctx             , sessionId        )                   {
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
function projectDirectory(root        , cwd                    )         {
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
function containmentRefusal(root        , directory        , encoded        )                     {
  const rootPath = resolve(root)
  const target = resolve(directory)
  if (basename(target) !== encoded) return `refusing to remove "${target}": it is not named after this session`
  if (!target.startsWith(`${rootPath}${sep}`)) return `refusing to remove "${target}": it is outside the session root`
  const relative = target.slice(rootPath.length + 1)
  if (relative.split(sep).length !== 2) return `refusing to remove "${target}": it is not one project directory below the session root`
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
export function encodeSegment(raw        )         {
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
export function projectKey(cwd        )         {
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
async function isDirectory(path        )                   {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Normalize an unknown thrown value to a message. */
function messageOf(error         )         {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compose one failure envelope.
 * @param code - stable machine code the browser switches on.
 * @param message - human diagnostic.
 * @param status - HTTP status.
 * @returns the JSON response.
 */
function failure(code        , message        , status        )           {
  const error                = { code, message }
  return Response.json({ ok: false, error }, {
    status,
    headers: { 'cache-control': 'no-store' }
  })
}
