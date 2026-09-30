# PR: delete a conversation (plugin, dual-face package)

**Title:** `feat(client): add ui-session-delete — delete a conversation, and clean up blank Sessions`

**Depends on:** the Web bundle's patch layer gaining one row (diff: [`upstream/web-app-cordis.patch.yml.diff`](upstream/web-app-cordis.patch.yml.diff)).

---

## What this adds

One dual-face package, `packages/client/ui-session-delete`, contributing three
additive surfaces and no takeover:

| Surface | Slot | What it does |
|---|---|---|
| Session row menu | `sidebar.workspaces.session.menu.item` (order 900) | Red **“Delete conversation”**, after pin/rename/fork/archive |
| Sidebar foot | `sidebar.footer.action` (order 500) | **“Clean up empty conversations”**: bulk-removes blank Sessions |
| Frame overlay | `shell.overlay` (two entries) | The two confirmations, each listing exactly what will be removed |

The node half registers one authenticated route, `POST /api/session.delete`, through
`ctx.connection.fetch.register` — inside Connection's Host/Origin + browser-token
fence — and both surfaces call it.

Deletion removes the whole Session directory under the sessions root (every format
generation) plus its projection-cache record. Attachments, exported files and
workspace files are untouched.

```
packages/client/ui-session-delete/
├── package.json            # dsh.client (platform web) + exports "./client"
├── src/index.ts            # node half: the route, the containment guard, the removal
├── src/client/             # browser half: slots, dictionaries, plan, two dialogs
├── tests/                  # 21 node:test cases (host route, cleanup plan, dictionaries)
├── README.md / README.zh.md
└── lib/                    # build output (not part of this PR; see "Not verified")
```

## Why a plugin and not core

DSH ships no Session deletion on purpose, and the stance is documented: the
projection cache README says pruning is out-of-band maintenance, “same stance as
session persistence itself”, and `SessionPersistence` offers no removal. A core
delete would have to decide policy the storage layer cannot see: a live Session's
write handle (its detach disposer belongs to the agent loop), orphaned children,
and content-addressed attachments with no refcount or GC.

So this PR keeps the mechanism additive and puts the one *mechanism* it needs from
core on the table separately: [`docs/upstream-issue-session-persistence-location.md`](docs/upstream-issue-session-persistence-location.md)
proposes `SessionPersistence.locate(id)` so a plugin can name a Session's artifacts
without re-implementing the backend's path encoding. Reviewers who would rather see
deletion in core should treat this package as the reference behaviour for a
`session/delete` Remote: same skips, same guards, same user-visible contract.

## Behaviour worth reviewing

- **A live Session is refused** (`409 session-live`). Its open write handle would
  recreate or corrupt the log, and no public API can release it from outside the
  agent loop. Switch away, then delete.
- **Blank-Session cleanup has a one-hour idle grace period.** “New Session” is blank
  too, and a second window can be sitting in one; the plan excludes the open Session,
  anything running, and anything active inside the grace window. The dialog names the
  grace period before the confirm.
- **Every id is validated before any path work** (`[A-Za-z0-9._-]{1,200}`, not `.`/`..`)
  and the resolved target must be exactly `<root>/<one project directory>/<encoded id>`
  before a recursive removal runs; anything else is `unsafe-target` instead.
- **Attachments are never touched**: they are content-addressed and shared across
  Sessions with no refcount, so removing one for a deleted Session would break others.
- **Nothing else needs cleanup**: `workspaceRegistry.sessionKnown()` re-queries live +
  a fresh persistence listing (a stale id simply drops out), and the SQLite index is a
  derived read model that reconciles vanished ids on its own.

The full table lives in the package README.

## Verification

Run on the machine this was written on, against the **installed runtime**
(`@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2, cordis 4.0.4; the APIs were read out
of `resources/app.asar` rather than assumed):

| Check | Result |
|---|---|
| `node --test "tests/*.test.ts"` (host route × 10 sections, cleanup plan, dictionaries) | **21/21** |
| `node tools/verify-artifact.mjs` — the same host scenarios against the **built** `lib/index.js` | **39/39** |
| Real-layout assertions: 68 real Session directories on disk are all `encodeSegment(id)`-named; `projectKey(cwd)` reproduces the real project directory | pass |
| `tools/build.mjs` self-check: the browser bundle parses as a classic script, the node half imports and exports `apply`/`inject`/`SESSION_PATH`/helpers | pass |
| `tools/verify-browser.mjs`: the built bundle loaded for real, every slot entry rendered, and the destructive paths driven through their rendered handlers — a refused removal, a partly failing cleanup run, and a target that went live mid-run included | **42/42** |
| Live: `tools/verify-boot.mjs` reads a running instance's browser plugin graph over `GET /plugins/events` | mounted, and carried by a preloaded batch |
| Patch layer: `git apply --check` of the bundle diff against the shipped `web-app/cordis.patch.yml` | clean |

Two caveats, stated plainly:

1. **Establish which instance the window under test belongs to before believing a "missing
   UI" report.** A plugin is installed per *profile*, and this machine ran two instances at
   once: the desktop app's window (`desktop` profile) and `npx dsh web` on the default `:3080`
   (`web` profile). Both were the same 0.2.0-rc.2 line, so the instance that lacked the row was
   not an older build — it simply had a different profile, whose composition also differs by the
   launcher overlay (the entry counts were 68 and 66 for that reason alone). Installing into the
   second profile made it appear there too, live, because that profile reloads its patch layer.
   `tools/verify-boot.mjs --scan` now enumerates every instance with its entry count and whether
   it carries this row, and says explicitly that row-set differences come from the profile and
   overlay rather than the version; the reviewer analogue is to compare the window's
   `location.href` with the origin the tools report. Two patch-layer lessons from the same
   session are worth a checklist entry: a scoped row name **must** be quoted in YAML, and a
   reload that throws on a bad patch leaves the running tree frozen (structural changes stop
   applying) until that instance restarts.
2. **`lib/` in this workspace is not the tsdown output.** This checkout has no
   toolchain, so the artifacts were produced by `tools/build.mjs` — Node's
   `module.stripTypeScriptTypes` plus a small, declared-subset assembly of the
   `src/client/*` graph into the `window.__ModuleLoader__.load({ id, factory })` script.
   Upstream should run `pnpm run bundle` and let tsdown emit `lib/`; the source is
   written to their conventions (ESM, TSDoc, no JSX-only constructs) and the build's
   self-check plus the artifact and render suites are what back it in the meantime.

## Not done here (reviewer checklist)

- `README.i18n.yaml` is **absent on purpose**: those per-section hashes come from
  `pnpm run verify-translation-pairing --write`, and a hand-written file would be a lie.
- No `@deepseek-ai/dsh-*` peers are declared. `app-boot` checks those against the
  runtime version, so `^0.2.0` would refuse to mount on a running `0.2.0-rc.2`; the
  package deliberately declares only `@deepseek-ai/cordis` (which the check skips).
  Maintainers who want gating should pick the range with that in mind.
- The browser half uses `React.createElement` rather than JSX so the same source
  builds with Node's type stripping; converting to JSX is mechanical if the repo
  prefers it.
- Structural local types (`src/client/contract.ts`) stand in for `SlotMap`,
  `ISessions` and the locale face, so the package carries no type dependency on the
  renderer or the controller. Swapping them for the real types is mechanical once the
  exports to import are confirmed.
- A screenshot is not attached, but the surface was confirmed in a real browser window on the
  machine this was written on: the row appears in a Session's `...` menu and the cleanup action
  appears at the sidebar foot. That was also the one check no tool here could stand in for —
  `tools/verify-browser.mjs` covers this package's own logic and wiring against stubbed
  primitives, not the shipped components.

## Test plan for a reviewer

1. `pnpm install && pnpm run bundle && pnpm test` in `packages/client/ui-session-delete`.
2. Apply the bundle diff, run the Web profile, open a Session's `...` menu.
3. Delete a *closed* conversation: the row disappears and
   `<DSH_HOME>/sessions/<project>/<id>/` is gone.
4. Delete the *open* conversation: the dialog reports that it is in use, nothing is
   removed.
5. Clean up empty conversations, then check that a brand-new Session opened in another
   window survived the run.
