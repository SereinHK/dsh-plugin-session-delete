# Proposal: let a plugin find one stored Session

**Status:** draft for upstream discussion · **Scope:** `SessionPersistence` public surface · **Size:** ~20 lines

## The gap

`@deepseek-ai/dsh-session-persistence` publishes exactly five operations:

```ts
abstract create(header, options?): Promise<SessionHandle>
abstract open(id, access, options?): Promise<SessionHandle>
abstract flush(): Promise<void>
abstract stat(id, options?): Promise<SessionPersistenceSnapshot | undefined>
abstract list(options?): Promise<readonly SessionPersistenceSnapshot[]>
```

Everything else about a stored Session is backend-private. The JSONL backend decides
where a log lives with two unexported helpers — `projectKey(cwd)` and
`encodeSegment(id)` — and the layout

```
<root>/<projectKey(header.cwd)>/<encodeSegment(sessionId)>/session[.vN].jsonl[.zstd]
```

No caller outside the backend can name one Session's artifacts. That is fine for
append-only reads, and it is the reason deletion is impossible today: any out-of-band
maintenance — pruning a deleted Session's directory, moving a Session between roots,
inspecting an artifact's size, exporting raw bytes — must re-implement both helpers and
guess the generation suffix, and it silently breaks the day a backend other than the
JSONL one is mounted.

## The proposal

Publish the *address*, not the *policy*:

```ts
/** Where one stored Session's artifacts live, as the mounted backend sees them. */
export interface SessionLocation {
  /** Absolute path of the session's own directory (created on materialization). */
  readonly directory: string
  /** Absolute paths of the log generations present, newest format first. */
  readonly logs: readonly string[]
  /** Mounted backend's own identity for this location, for diagnostics. */
  readonly backend: string
}

abstract locate(id: SessionId, options?: SessionPersistenceLocateOptions): Promise<SessionLocation | undefined>
```

`undefined` means "this backend has no such Session" — the same definite miss `stat`
already reports, so nothing new is promised about freshness or existence.

Two weaker alternatives that would also close the gap:

1. **Export the helpers.** `export { projectKey, encodeSegment, sessionDir }` from the JSONL
   backend. Enough for a plugin that is willing to depend on *that* backend, useless the
   day another backend mounts.
2. **Add `remove(id)` to the persistence contract.** Closes the immediate need, but it
   moves a policy decision ("may a Session be destroyed?") into the storage layer, where
   it cannot see whether the Session is live, has children, or is still being written.

Option (1) is a one-line-per-symbol change and (2) is the shortcut with the wrong owner;
the proposal above is the shape that lets a *feature* own the policy while the backend
owns the layout.

## Why not `remove` in the persistence layer

A correct delete needs facts the persistence contract does not have:

- **Liveness.** `SessionStore.enter()` hands its detach disposer to the entering fiber
  (the agent loop), so only that owner can release a live Session; a storage backend
  deleting under an open write handle either resurrects the log on the next append or
  corrupts it. The plugin that needs deletion is exactly the one that cannot reach the
  disposer.
- **Lineage.** Child Sessions keep their own logs; deleting a parent orphans them and
  `sessionQuery.traceSession` degrades to "first unresolvable parent".
- **Attachments.** `<DSH_HOME>/attachments/v1/objects/**` is content-addressed, shared
  across Sessions, and has no refcount or GC. A storage-layer delete must either leak
  orphans forever or grow a new subsystem.
- **Two derived read models.** The projection cache and the SQLite session index both
  tolerate a vanished Session, but only if someone decides *when* to tell them.

Those are feature-level decisions with feature-level owners. The persistence layer
should answer one question well — "where does this Session live?" — and leave the rest.

## Impact

- **Additive:** one new abstract method. Every existing backend fails closed until it
  implements `locate`, which is the honest signal for a backend that cannot name its
  artifacts.
- **The JSONL backend** implements it from helpers it already has
  (`sessionDir`, `resolveGenerationInDirectory`, `oppositeCompression`): about a dozen
  lines, no behavior change.
- **Consumers:** a deletion plugin (see this workspace's
  `packages/client/ui-session-delete`) stops re-implementing path encoding and stops
  depending on the layout; an export or migration tool gains the same footing.
- **Tests:** a backend conformance case — `locate(unknown) === undefined` and
  `locate(known).logs` names the generations `list()` counted.

## Implementation sketch, as of 0.2.0-rc.2

*Backend.* `@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js` already owns every
piece `locate` needs; this is wiring, not new logic:

| Existing helper | What it gives `locate` |
|---|---|
| `encodeSegment(id)` | the session directory's name |
| `projectKey(cwd)` / `projectDir(root, cwd)` | the project directory (`_no-cwd` when the header carries no cwd) |
| `sessionDir(root, cwd, id)` | `directory` |
| `resolveGenerationInDirectory` / `oppositeCompression` | which generations are present, including the other compression's leftovers |
| `findLog(id, signal)` | the generation actually in force |

```ts
async locate(id: SessionId, options?: SessionPersistenceLocateOptions): Promise<SessionLocation | undefined> {
  signal?.throwIfAborted()
  const snapshot = await this.stat(id, options)          // reuses the existing existence check
  if (snapshot === undefined) return undefined
  const directory = sessionDir(this.root, snapshot.header.cwd, id)
  const names = (await this.readdir(directory)).filter((name) => parseGenerationLogFilename(name) !== undefined)
  return { directory, logs: names.sort(newestFormatFirst).map((name) => join(directory, name)), backend: this.name }
}
```

*Conformance case.* One backend test: `locate(unknown) === undefined`, and for a seeded
Session `locate(id).logs.length` equals the number of generations `list()` counted —
which is also the assertion that would catch the multi-generation trap below.

*Consumer diff.* A deletion plugin stops carrying a copy of the layout. This workspace's
`packages/client/ui-session-delete` would drop `encodeSegment` (28 lines), `projectKey`
(28 lines), `projectDirectory`, and the directory scan that backs them up, replacing
`locateSessionDirectory()` with one `locate()` call and keeping only the policy checks
(liveness, containment, cache purge) that a storage backend has no business deciding.

*Why this matters even if core never deletes anything:* the multi-generation trap is real
and easy to walk into. On the machine this proposal was written from, six Session
directories hold **two** generations at once (`session.v3.jsonl.zstd` beside
`session.v4.jsonl.zstd`), so "delete the log file" is not one file, and the current
generation is not knowable from `stat` alone. Anyone writing out-of-band maintenance today
has to rediscover that first.

## What a core `remove` would additionally need

Not an argument against `locate` — an argument against putting deletion in the storage
layer before these have owners:

- **A release path for a live Session.** `SessionStore.enter()` hands its detach disposer to
  the entering fiber; in the shipped composition that fiber is the agent loop
  (`dsh-agent-loop` calls `ctx.sessions.enter(session)` and keeps the disposer). Nothing
  else can stop and release a live Session, so a `session/delete` endpoint belongs beside
  the Session controller, which already listens to `session/disposed` and emits
  `api-session/removed` for the browser.
- **An attachment story.** `<DSH_HOME>/attachments/v1/{objects,file-objects}/**` is
  content-addressed, shared across Sessions, and has no refcount or GC, so a delete must
  either leak orphans forever or grow a new subsystem. That is a product call, not a
  storage call.
- **Lineage.** Child Sessions keep their own logs, and `sessionQuery.traceSession` degrades
  to the first unresolvable parent; whether deleting a parent should be refused, warned
  about, or allowed silently is a feature decision.

## Open questions for maintainers

1. Is "no deletion capability" a deliberate product stance we should keep? If so, this
   proposal is still useful for export, migration, and diagnostics, and third-party
   deletion plugins become the deployment's own business rather than a layout guess.
2. Should `locate` be part of the persistence contract, or a separate optional service
   (`sessionLocations`) that a backend may provide — keeping `SessionPersistence` as
   small as it is today?
3. If deletion is eventually wanted in core, the natural home is
   `@deepseek-ai/dsh-api-session-controller` (a `session/delete` Remote that stops the
   Agent, releases the Session, then calls the storage layer), with `locate` as its only
   new storage dependency.
