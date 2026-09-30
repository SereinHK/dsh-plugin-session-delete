#!/usr/bin/env node
/**
 * Regenerate the upstream patch-layer diff.
 *
 * The one edit this plugin needs outside its own package is a row in the Web
 * bundle's patch layer. That file is not in this workspace — it lives inside the
 * installed runtime — so the diff is produced from the real shipped file:
 * extract it from `app.asar`, insert the row, and let `git diff` write the
 * unified patch, with the canonical `packages/bundle/web-app/cordis.patch.yml`
 * paths so `git apply -p1` works in the monorepo root.
 *
 *   node tools/make-upstream-diff.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const asar = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar')
const relativePath = join('packages', 'bundle', 'web-app', 'cordis.patch.yml')
const scratch = join(repoRoot, '.upstream-diff')
const shipped = join(scratch, 'a', relativePath)
const patched = join(scratch, 'b', relativePath)
const outFile = join(repoRoot, 'upstream', 'web-app-cordis.patch.yml.diff')

/** The row this plugin contributes to the browser plugin roster. */
const ROW = [
  '',
  '    # Delete-conversation: a "delete conversation" row in every Session\'s',
  '    # "..." menu and a blank-Session cleanup action at the sidebar foot, over',
  '    # the authenticated POST /api/session.delete route its node half registers.',
  '    - id: session-delete',
  `      name: '${JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).name}'`
]
/** The roster neighbour the row is inserted after, so a reorder stays reviewable. */
const ANCHOR_NAME = "      name: '@deepseek-ai/dsh-client-ui-workspace'"

// 1. the shipped file, straight out of the running runtime ----------------------
mkdirSync(dirname(shipped), { recursive: true })
execFileSync(process.execPath, [join(repoRoot, 'tools', 'asar.mjs'), 'get', asar, `dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml`, shipped], { stdio: 'inherit' })

const text = readFileSync(shipped, 'utf8')
const lines = text.split('\n')
// Insert after the whole anchor ENTRY: a roster row is `- id:` plus `name:`, and
// splitting those two lines would produce a row with the wrong name.
const anchor = lines.findIndex((line) => line.trim() === ANCHOR_NAME.trim())
if (anchor < 0) throw new Error(`anchor '${ANCHOR_NAME.trim()}' not found in the shipped patch; upstream reordered the roster`)

mkdirSync(dirname(patched), { recursive: true })
const next = [...lines.slice(0, anchor + 1), ...ROW, ...lines.slice(anchor + 1)]
writeFileSync(patched, next.join('\n'), 'utf8')

// 2. the unified diff, with monorepo-relative paths -----------------------------
let diff
try {
  diff = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--unified=3', 'a', 'b'], { cwd: scratch, encoding: 'utf8' })
} catch (error) {
  // git diff exits 1 when the files differ, which is the expected case.
  diff = error.stdout
}
if (typeof diff !== 'string' || diff.trim() === '') throw new Error('git diff produced nothing; the insertion did not change the file')

// `git diff --no-index a b` prefixes each side with the directory it walked, so
// the headers read `a/a/<path>`; retarget them at the monorepo path it will be
// applied to.
const canonical = relativePath.split('\\').join('/')
diff = diff
  .split(`a/a/${canonical}`).join(`a/${canonical}`)
  .split(`b/b/${canonical}`).join(`b/${canonical}`)

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, diff, 'utf8')
rmSync(scratch, { recursive: true, force: true })

const added = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
console.log(`${outFile}`)
console.log(`  ${added} added lines, anchored after '${ANCHOR.trim()}'`)
