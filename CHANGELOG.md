# Changelog

## 0.3.0

Stored Sessions that fell under "ungrouped" are put back where they belong.

- **New: `POST /api/session.adopt`**, and the same repair once at startup. A workspace owns
  Sessions through an *ownership account* (`sessionIds`), and the runtime attaches a Session
  only as it is *created* — so when a folder is added as a workspace, or renamed and added
  again, its older Sessions keep rendering under "ungrouped" and nothing in the UI can fix
  them. The plugin attaches every stored Session whose header path resolves to a registered
  workspace, and leaves the rest alone.
- It never creates, moves or deletes anything: an attached Session is skipped before
  `attachSession` is called (the method is idempotent anyway), a folder that no longer exists
  is skipped, and a Session whose header disagrees with the workspace path is left for the
  operator rather than papered over.
- Suites: 31 package tests, 95 host-route checks against the built bytes (adoption among
  them: mounting, idempotence, a vanished folder, a folder that is not a workspace), 64
  render and interaction checks.

## 0.2.0

Removal is a move now: a deleted conversation goes into a trash beside the sessions
root, where it can be put back until the retention window closes.

- **The trash.** `POST /api/session.delete` renames the Session directory into
  `<DSH_HOME>/plugin-session-delete/trash/` — beside the sessions root, so the move is a
  rename on one volume and therefore atomic — and records its workspace, title, size and
  when it was moved. Nothing is destroyed at that point.
- **Restore and destroy.** `POST /api/session.trash` lists what is in there (purging
  anything past its window before it answers, so the list is exactly what can still come
  back), `POST /api/session.restore` puts one back where it came from — refusing rather
  than overwriting if that name is taken — and `POST /api/session.purge` destroys one
  entry or empties the trash.
- **A window, not a countdown.** Seven days by default, configurable per profile
  (`config: { retentionDays: n }` on this plugin's row). Expiry is lazy plus one sweep at
  startup: nothing runs on a timer.
- **Surfaces.** A "Trash" entry beside the cleanup action in the sidebar foot, and a
  dialog listing each entry by title with its size and remaining days, with `Restore` and
  `Delete for good` (which asks first).
- The delete confirmation no longer promises permanence — it says what actually happens —
  and its button reads "Move to trash".
- Hardening found while testing this: a purge with no record behind it used to report
  success (`rm` with `force` succeeds on a missing path); it is a 404 now.
- Suites: 30 package tests, 87 host-route checks against the built bytes (moving,
  listing, restoring, refusing a taken name, purging, expiry, a configured window,
  emptying), 64 render and interaction checks.

## 0.1.3

The cleanup shows what it is about to remove, and the plugin can now check its own
assumptions against the runtime that is installed.

- The durable-facts route reports each Session's **title** (from the same projection
  cache the Session list reads) and the **bytes** it occupies, so the dialog names
  conversations the way the operator recognises them and says what the run reclaims,
  instead of listing bare workspace paths.
- **New: `tools/verify-runtime-contract.mjs`.** The plugin reads a layout it does not
  own — the JSONL backend's directory naming and the Host's projection record. Run this
  after upgrading DSH: it decodes real logs and real records and reports, per
  assumption, whether it still holds. On this machine: 8/8, including `projectKey`
  reproducing the backend's own project directories across 16 real Sessions.
- The delete path resolves both the session root and its target and refuses a target
  that resolves outside the root, so a linked project directory cannot redirect a
  recursive removal (string containment alone cannot see through a link).
- Suites: 28 package tests, 66 host-route checks against the built bytes (a linked
  directory refused, title/size reporting, and the earlier proven/unproven cases),
  48 render and interaction checks.

## 0.1.2

The blank-Session cleanup works, by asking the Host instead of guessing.

0.1.1 changed *which* page-side flag the cleanup trusted. That was still the wrong
question: for a Session loaded from disk, the page has no durable answer at all — a
list row's `blank` describes a Session resident in *this process*, and its projection
block is loaded only for the Session being viewed. A run therefore reported "nothing to
clean" over a workspace full of empty conversations.

- **New Host route `POST /api/session.unused`** reports the durable per-Session facts
  from the same projection cache the Session list itself uses: whether the stored log
  holds an accepted prompt, when the last one was, and whether the cache could answer
  at all. The plugin applies its policy (grace window, live Session, open Session) to
  those facts rather than to a display row.
- **Unprovable rows are never deleted**: a Session whose projection the Host cannot
  read is reported as unproven and skipped, and the dialog says so instead of implying
  the workspace is clean. A Host failure is worded as a failure, never as "nothing to
  clean".
- The cleanup dialog loads those facts on open and shows what it is waiting for.
- Suites: 26 package tests, 59 host-route checks against the built bytes (the new route
  included, proven/unproven/cache-failure cases among them), 47 render and interaction
  checks.

## 0.1.1

Fixes the blank-Session cleanup, which never found anything to remove.

- **The cleanup read the wrong blankness flag.** It trusted `blank` on the client list
  row, which describes a Session **resident in this process** — for a Session loaded
  from disk it carries no information, so every stored Session looked non-blank and a
  cleanup run always reported "nothing to clean". It now requires the **durable**
  projection (`projectionValues.sessionListMetadata.blank === true`, derived from the
  stored events), and treats a row whose metadata has not arrived as unproven rather
  than assuming anything. A run that finds nothing for that reason now says so.
- The activity timestamp is floored by the durable `lastPromptAt`, so a row cannot look
  idler than it is.
- The cleanup's explanatory copy no longer claims empty conversations are hidden from
  the sidebar: they are listed, they simply hold nothing.
- New cases cover the durable flag, the unproven row, and the `lastPromptAt` floor
  (24 package tests, 43 render and interaction checks).

## 0.1.0

First release.

- **Delete a conversation** from every Session's `...` menu
  (`sidebar.workspaces.session.menu.item`), after the shipped pin/rename/fork/archive
  rows, with a confirmation that names the conversation and the scope.
- **Clean up empty conversations** at the sidebar foot: blank Sessions only, skipping
  the open one, anything running, and anything active inside a one-hour grace window.
- The node half registers `POST /api/session.delete` inside Connection's authenticated
  `/api` fence. Removal covers the whole Session directory (every format generation of
  its log) plus its projection-cache record; a Session that is live in the process is
  refused with `session-live`. Attachments, exported files and workspace files are
  never touched.
- Ships as a bundle (`dsh.bundle.patch`), so installing it inserts the plugin row
  without hand-editing a profile's `cordis.patch.yml`.

Verified on `@deepseek-ai/dsh-desktop-runtime` 0.2.0-rc.2: 21 package tests, 39
host-route checks against the built bytes, 43 render and interaction checks (including
a refused removal, a partly failing cleanup run, and a target that went live mid-run),
and 18 install-shape checks in both registration modes.
