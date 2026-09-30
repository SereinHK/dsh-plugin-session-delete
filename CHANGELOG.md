# Changelog

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
host-route checks against the built bytes, 42 render and interaction checks (including
a refused removal, a partly failing cleanup run, and a target that went live mid-run),
and 18 install-shape checks in both registration modes.
