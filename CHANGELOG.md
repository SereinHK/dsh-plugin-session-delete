# Changelog

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
