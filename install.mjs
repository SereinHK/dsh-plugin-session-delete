#!/usr/bin/env node
/**
 * Install (or remove) the delete-conversation plugin in a DSH profile.
 *
 *   node install.mjs                          # active profile (DSH_PROFILE_DIR / DSH_PROFILE / desktop)
 *   node install.mjs --profile web            # another profile under DSH_HOME/profiles
 *   node install.mjs --profile-dir <path>     # an explicit profile directory
 *   node install.mjs --no-checks              # skip the build/test gates
 *   node install.mjs --uninstall              # remove the package copy and the patch row
 *
 * What it does, in order:
 *   1. refuses a stale build (`tools/build.mjs --check`)
 *   2. runs `tools/verify-artifact.mjs` against the built node half
 *   3. copies the package into <profile>/node_modules/<package name>
 *   4. rewrites the profile's cordis.patch.yml to carry exactly one `- insert:`
 *      row for this plugin, backing the file up first and checking the result
 *      back, then reports whether the running app picked the row up
 *
 * It never runs a package manager: the node half imports Node built-ins only and
 * the browser half requires platform seed modules only, so a directory copy is a
 * complete installation.
 *
 * Two YAML facts this script exists to respect:
 *   - a scoped name is a plain scalar starting with `@`, which YAML reserves, so
 *     it MUST be quoted;
 *   - the file is rewritten line-wise, never by pattern-cutting around a row,
 *     because a half-removed block is a broken patch layer.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

/** Read one `--flag value` pair. */
function option(name) {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

const ROW_ID = 'session-delete'
/**
 * The installed name. The repository root IS the package, and the browser
 * bundle's module id must equal the name the row is mounted under, so this is
 * read from the manifest rather than repeated here.
 */
const PACKAGE_NAME = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).name
const BANNER = `# ---- ${PACKAGE_NAME} `
/** The name this plugin shipped under while the workspace mimicked the upstream
 * monorepo layout; retired so two copies can never both mount. */
const LEGACY = { name: '@deepseek-ai/dsh-client-ui-session-delete', banner: '# ---- @deepseek-ai/dsh-client-ui-session-delete ' }

const uninstall = argv.includes('--uninstall')
const skipChecks = argv.includes('--no-checks')
/** Register through the package's own bundle patch instead of a profile patch row. */
const bundleMode = argv.includes('--bundle')
/** Optional dependency spec to record alongside `--bundle` (e.g. https://github.com/you/repo.git). */
const installSpec = option('--spec')
/**
 * Rewrite only the registration, leaving every installed file alone.
 *
 * The Plugins page installs a package itself (pnpm fetches it, the bundle list is
 * updated), and re-copying the directory afterwards would replace a
 * package-manager-owned tree with a plain one. This mode exists for exactly that
 * case: fix which layer owns the row without touching what is installed.
 */
const registerOnly = argv.includes('--register-only')
const source = resolve(option('--source') ?? here)
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
// Precedence: an explicit flag beats the ambient environment. A shell running
// inside a DSH session always carries DSH_PROFILE_DIR, so `--profile web` would
// otherwise be silently ignored and the plugin installed into the wrong profile.
const explicitDir = option('--profile-dir')
const explicitProfile = option('--profile')
const profileDir = resolve(explicitDir
  ?? (explicitProfile === undefined ? undefined : join(dshHome, 'profiles', explicitProfile))
  ?? process.env.DSH_PROFILE_DIR
  ?? join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'desktop'))
if (explicitDir === undefined && explicitProfile !== undefined && process.env.DSH_PROFILE_DIR !== undefined
  && resolve(process.env.DSH_PROFILE_DIR) !== profileDir) {
  console.log(`note         : --profile ${explicitProfile} overrides the ambient DSH_PROFILE_DIR`)
}

if (!existsSync(join(source, 'package.json'))) throw new Error(`no plugin package at ${source}`)
if (!existsSync(profileDir)) throw new Error(`profile directory not found: ${profileDir}`)
const patchPath = join(profileDir, 'cordis.patch.yml')
if (!existsSync(patchPath)) throw new Error(`profile patch not found: ${patchPath}`)
const moduleDir = join(profileDir, 'node_modules', PACKAGE_NAME)
const legacyDir = join(profileDir, 'node_modules', LEGACY.name)

console.log(`profile      : ${profileDir}`)
console.log(`package      : ${source}`)
console.log(`package copy : ${moduleDir}`)
console.log(`patch file   : ${patchPath}`)
console.log('')

/**
 * Remove every trace of one plugin's row from a patch's lines.
 *
 * Handles the whole `- insert:` block (with its banner comments) and a dangling
 * `name:` line left by an interrupted edit — the latter is not a stylistic
 * concern: a lone `name:` at the root of a sequence document is a YAML error
 * that takes the entire patch layer with it.
 *
 * @param lines - the patch's lines.
 * @param packageName - the row's module name.
 * @param rowId - the row's id, when the whole block should go.
 * @returns the remaining lines, with surrounding blank runs collapsed.
 */
function stripPluginRows(lines, packageName, rowId) {
  const kept = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const isOurRow = rowId !== undefined && line.trim() === `- id: ${rowId}`
    const nextIsOurs = isOurRow && (lines[index + 1] ?? '').includes(packageName)
    if (nextIsOurs) {
      index++ // skip the name line too
      if (kept.length > 0 && kept[kept.length - 1].trim() === '- insert:') kept.pop()
      while (kept.length > 0 && kept[kept.length - 1].trim().startsWith('#')) kept.pop()
      while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
      continue
    }
    // A dangling `name: <this package>` anywhere is this plugin's litter.
    if (/^\s*name:\s*/.test(line) && line.includes(packageName)) continue
    kept.push(line)
  }
  return kept
}

/** Whether the lines already carry exactly this plugin's row. */
function hasPluginRow(lines, packageName, rowId) {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== `- id: ${rowId}`) continue
    const name = lines[index + 1] ?? ''
    if (/^\s*name:\s*$/.test(name)) continue
    if (name.includes(packageName)) return true
  }
  return false
}

/**
 * Assert the patch still reads as the shape this script writes: one top-level
 * sequence whose every row line is indented under a mapping, and no bare
 * `name:`/`id:` key at the document root.
 * @param text - the file's text.
 */
function assertPatchShape(text) {
  for (const [number, line] of text.split('\n').entries()) {
    if (/^\s*$/.test(line) || line.startsWith('#') || /^\s/.test(line) || line.startsWith('- ')) continue
    throw new Error(`${patchPath}:${String(number + 1)} is a root-level mapping key where the patch must be a sequence: ${JSON.stringify(line)}`)
  }
  for (const line of text.split('\n')) {
    const match = /^\s*name:\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    const value = match[1]
    if (value.startsWith("'") || value.startsWith('"')) continue
    if (value.startsWith('@') || value.includes(': ') || value.includes('#')) {
      throw new Error(`${patchPath}: the scalar ${JSON.stringify(value)} needs quoting in YAML`)
    }
  }
}

/** The whole patch file, rewritten for this plugin, plus what changed. */
function rewritePatch(text) {
  let lines = text.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  lines = stripPluginRows(lines, LEGACY.name, ROW_ID)
  lines = stripPluginRows(lines, PACKAGE_NAME, ROW_ID)
  const already = hasPluginRow(lines, PACKAGE_NAME, ROW_ID)
  if (!already) {
    lines = lines.filter((line) => line.trim() !== '[]')
    lines.push('', `${BANNER}--------------------------------------------------`)
    lines.push('# Delete-conversation: a "delete conversation" row in every Session\'s "..." menu,')
    lines.push('# a blank-Session cleanup action at the sidebar foot, and the authenticated')
    lines.push('# POST /api/session.delete route both go through. Remove this block (or run')
    lines.push('# install.mjs --uninstall) to uninstall.')
    lines.push('- insert:')
    lines.push(`    - id: ${ROW_ID}`)
    lines.push(`      name: '${PACKAGE_NAME}'`)
  }
  const next = `${lines.join('\n')}\n`
  assertPatchShape(next)
  return { text: next, added: !already }
}

if (uninstall) {
  for (const dir of [moduleDir, legacyDir]) {
    if (!existsSync(dir)) continue
    rmSync(dir, { recursive: true, force: true })
    console.log(`removed ${dir}`)
  }
  const lines = stripPluginRows(stripPluginRows(readFileSync(patchPath, 'utf8').split('\n'), LEGACY.name, ROW_ID), PACKAGE_NAME, ROW_ID)
  const next = `${lines.join('\n').trimEnd()}\n`
  assertPatchShape(next)
  writeFileSync(patchPath, next, 'utf8')
  console.log(`rewrote ${patchPath} without this plugin's row`)

  // Both registration forms go, whichever one is in use.
  const manifestPath = join(profileDir, 'package.json')
  const manifestBefore = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestBefore)
  let manifestChanged = false
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) {
    manifest.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME)
    manifestChanged = true
  }
  if (manifest.dependencies !== undefined && Object.hasOwn(manifest.dependencies, PACKAGE_NAME)) {
    delete manifest.dependencies[PACKAGE_NAME]
    manifestChanged = true
  }
  if (manifestChanged) {
    writeFileSync(`${manifestPath}.bak-${stamp}`, manifestBefore, 'utf8')
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
    console.log(`removed ${PACKAGE_NAME} from ${manifestPath}`)
  }

  console.log('')
  console.log('Restart DSH to drop the row from the composition.')
  process.exit(0)
}

// 1-2. the build must be current and must pass its own artifact checks ----------
if (!skipChecks && !registerOnly) {
  const { spawnSync } = await import('node:child_process')
  for (const [script, extra] of [['tools/build.mjs', ['--check']], ['tools/verify-artifact.mjs', []]]) {
    const run = spawnSync(process.execPath, [join(here, script), ...extra], { cwd: here, stdio: 'inherit' })
    if (run.status !== 0) throw new Error(`${script} failed; nothing was installed`)
  }
  console.log('')
}

// 3. package copy ---------------------------------------------------------------
// cordis.patch.yml ships with the package because `dsh.bundle.patch` points at
// it: a bundle install reads the row from the installed copy, not from this
// checkout. `--register-only` skips this so a package-manager-owned tree stays
// exactly as its manager left it.
if (registerOnly) {
  console.log(`left the installed files alone (--register-only): ${moduleDir}`)
} else {
  rmSync(moduleDir, { recursive: true, force: true })
  mkdirSync(moduleDir, { recursive: true })
  for (const item of ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    if (existsSync(join(source, item))) cpSync(join(source, item), join(moduleDir, item))
  }
  cpSync(join(source, 'lib'), join(moduleDir, 'lib'), { recursive: true })
  console.log(`installed ${PACKAGE_NAME} -> ${moduleDir}`)
}

// The earlier copy is NOT removed here, and that ordering is deliberate: while
// the running composition still carries its row, deleting its files leaves a
// graph entry pointing at nothing, and the module watch that stat-polls every
// entry then wedges the whole tree (no later structural change applies). The
// registration below drops the row first; step 5 prunes the files once the live
// graph confirms the row is gone.

// 4. registration ---------------------------------------------------------------
// Two supported ways to get the row into a profile, and exactly one of them may
// be active: a profile patch row (explicit, no package manager involved) or the
// package's own bundle patch (what `dsh plugin add` and the Plugins page use).
// `--bundle` selects the second, and each mode clears the other's registration so
// a switch back and forth cannot leave the row inserted twice.
const profileManifestPath = join(profileDir, 'package.json')
// A filesystem-safe stamp: ISO-8601 with every separator AND the fraction removed.
// Keeping the fraction's dot produced names ending in ".", which Windows accepts
// through the extended-length path but ordinary delete tools cannot remove.
const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)

if (bundleMode) {
  const before = readFileSync(profileManifestPath, 'utf8')
  const manifest = JSON.parse(before)
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  if (!bundles.includes(PACKAGE_NAME)) {
    bundles.push(PACKAGE_NAME)
    console.log(`added ${PACKAGE_NAME} to dsh.profile.bundles`)
  } else {
    console.log(`${PACKAGE_NAME} is already in dsh.profile.bundles; left as is`)
  }
  manifest.dsh.profile.bundles = bundles
  if (installSpec !== undefined) {
    manifest.dependencies ??= {}
    manifest.dependencies[PACKAGE_NAME] = installSpec
    console.log(`recorded dependency ${PACKAGE_NAME}: ${installSpec}`)
  }
  const next = `${JSON.stringify(manifest, undefined, 2)}\n`
  if (next !== before) {
    writeFileSync(`${profileManifestPath}.bak-${stamp}`, before, 'utf8')
    writeFileSync(profileManifestPath, next, 'utf8')
  }

  // The bundle patch carries the row now, so the profile patch must not.
  const patchBefore = readFileSync(patchPath, 'utf8')
  const lines = stripPluginRows(stripPluginRows(patchBefore.split('\n'), LEGACY.name, ROW_ID), PACKAGE_NAME, ROW_ID)
  const patchNext = `${lines.join('\n').trimEnd()}\n`
  assertPatchShape(patchNext)
  if (patchNext !== patchBefore) {
    writeFileSync(`${patchPath}.bak-${stamp}`, patchBefore, 'utf8')
    writeFileSync(patchPath, patchNext, 'utf8')
    console.log(`removed the profile patch row from ${patchPath} (the bundle patch owns it now)`)
  }
} else {
  const before = readFileSync(patchPath, 'utf8')
  const { text, added } = rewritePatch(before)
  if (text !== before) {
    const backup = `${patchPath}.bak-${stamp}`
    writeFileSync(backup, before, 'utf8')
    writeFileSync(patchPath, text, 'utf8')
    console.log(`${added ? 'added the row to' : 'repaired'} ${patchPath} (backup ${backup.split(/[\\/]/).pop()})`)
  } else {
    console.log(`the ${ROW_ID} row is already correct in ${patchPath}; left as is`)
  }

  // A leftover bundle selection would insert the same row a second time.
  const manifestBefore = readFileSync(profileManifestPath, 'utf8')
  const manifest = JSON.parse(manifestBefore)
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) {
    manifest.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME)
    writeFileSync(`${profileManifestPath}.bak-${stamp}`, manifestBefore, 'utf8')
    writeFileSync(profileManifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
    console.log(`removed ${PACKAGE_NAME} from dsh.profile.bundles (the profile patch owns the row now)`)
  }
}

const bundleBytes = statSync(join(moduleDir, 'lib', 'client.js')).size
console.log('')
console.log(`Done (client bundle ${bundleBytes} bytes).`)

// 5. which running instance already serves it? ----------------------------------
// A plugin is installed per profile, and a machine commonly runs more than one
// instance (the desktop app's window plus `dsh web` on the default 3080), so the
// verdict is reported per origin rather than for "the" running DSH. The origin
// this shell advertises is not necessarily the one the operator is looking at.
const origins = [...new Set([
  process.env.DSH_WEB_URL,
  'http://127.0.0.1:3080',
  'http://127.0.0.1:19387'
].filter((value) => typeof value === 'string' && value !== ''))]
const verdicts = []
for (const origin of origins) verdicts.push({ origin, mounted: await carriesRow(origin, PACKAGE_NAME) })

// 6. prune the earlier copy, but only once no live graph still points at it ------
if (existsSync(legacyDir)) {
  const legacyChecks = []
  for (const origin of origins) legacyChecks.push(await carriesRow(origin, LEGACY.name))
  const stillMounted = legacyChecks.includes(true)
  if (stillMounted && !argv.includes('--prune-legacy')) {
    console.log('')
    console.log(`kept the earlier ${LEGACY.name} files: a running instance still carries its`)
    console.log('row, and deleting a mounted package wedges that instance\'s plugin tree. Remove')
    console.log('them after it restarts (or force it with --prune-legacy).')
  } else {
    rmSync(legacyDir, { recursive: true, force: true })
    console.log('')
    console.log(`retired the earlier ${LEGACY.name} copy`)
  }
}

console.log('')
console.log('instances:')
for (const verdict of verdicts) {
  console.log(`  ${verdict.origin.padEnd(24)} ${verdict.mounted === undefined ? 'unreachable' : verdict.mounted ? 'serves this row — reload that window' : 'does not serve it — it uses another profile, or needs a restart'}`)
}
console.log('')
console.log('Every Session\'s "..." menu gains a red "delete conversation" row, and the')
console.log('sidebar foot gains "clean up empty conversations" beside Settings.')
console.log('`node tools/verify-boot.mjs --scan` reports every instance the same way.')

/**
 * Ask one running instance whether its browser plugin graph carries this row.
 * @param origin - the instance to ask.
 * @returns true when mounted, false when the graph answers without it, undefined
 *   when nothing is listening there.
 */
/**
 * Ask one running instance whether its browser plugin graph carries a given row.
 * @param origin - the instance to ask.
 * @param name - the row's module name.
 * @returns true when mounted, false when the graph answers without it, undefined
 *   when nothing is listening there.
 */
async function carriesRow(origin, name) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(`${origin}/plugins/events`, { signal: controller.signal, headers: { accept: 'text/event-stream' } })
    if (!response.ok) return undefined
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const frame of buffer.split('\n\n')) {
        const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'))
        if (line === undefined) continue
        const payload = JSON.parse(line.slice('data:'.length).trim())
        const entries = payload?.graph?.entries
        if (entries === undefined) continue
        controller.abort()
        return entries.some((entry) => entry.id === name)
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
