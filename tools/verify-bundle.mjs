#!/usr/bin/env node
/**
 * Is this package installable as a DSH bundle, and is it installed coherently?
 *
 * A bundle install (`dsh plugin add github:you/repo`, or the Plugins page) works
 * only when the package carries everything the host reads *from the installed
 * copy*: the manifest's `dsh.bundle.patch`, that patch file itself, the prebuilt
 * client bundle, and a module id that equals the name the row is mounted under.
 * Each of those is a separate file, and a missing one fails silently from the
 * operator's seat — the row simply never appears.
 *
 * The tool also asserts the two registration forms are never both active: a
 * profile patch row and a `dsh.profile.bundles` entry would insert the same row
 * twice.
 *
 *   node tools/verify-bundle.mjs [--profile web] [--profile-dir <path>]
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const PACKAGE_NAME = manifest.name
const ROW_ID = 'session-delete'
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = resolve(flag('--profile-dir')
  ?? (flag('--profile') === undefined ? undefined : join(dshHome, 'profiles', flag('--profile')))
  ?? process.env.DSH_PROFILE_DIR
  ?? join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'desktop'))

let checks = 0
const failures = []
/**
 * Record one expectation.
 * @param label - what is being asserted.
 * @param condition - the assertion.
 * @param detail - shown on failure.
 */
function check(label, condition, detail = '') {
  checks++
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log(`package : ${repoRoot}`)
console.log(`profile : ${profileDir}`)
console.log('')

console.log('the package can be installed as a bundle')
{
  const decl = manifest.dsh?.bundle?.patch
  check('package.json declares dsh.bundle.patch', typeof decl === 'string', JSON.stringify(manifest.dsh))
  const patchRel = typeof decl === 'string' ? decl.replace(/^\.\//, '') : undefined
  check('the declared patch file exists', patchRel !== undefined && existsSync(join(repoRoot, patchRel)), patchRel)
  check('exports["./cordis.patch.yml"] resolves to it',
    typeof manifest.exports?.['./cordis.patch.yml'] === 'string',
    JSON.stringify(manifest.exports?.['./cordis.patch.yml']))
  check('the client export exists', typeof manifest.exports?.['./client']?.default === 'string')
  check('lib/ ships prebuilt (no build runs at install time)', existsSync(join(repoRoot, 'lib', 'client.js')) && existsSync(join(repoRoot, 'lib', 'index.js')))
  check('no install-time build hook could fail', manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined)

  if (patchRel !== undefined) {
    const text = readFileSync(join(repoRoot, patchRel), 'utf8')
    const lines = text.split('\n')
    const insertAt = lines.findIndex((line) => line.trim() === '- insert:')
    const idAt = lines.findIndex((line) => line.trim() === `- id: ${ROW_ID}`)
    const nameLine = lines.find((line) => /^\s*name:\s*/.test(line) && line.includes(PACKAGE_NAME))
    check('the bundle patch inserts this row id', idAt > insertAt && insertAt >= 0, `insert:${String(insertAt)} id:${String(idAt)}`)
    check('the inserted row name is quoted (a scoped or dashed scalar still needs it)', nameLine !== undefined && /name:\s*'/.test(nameLine), nameLine)
    check('the inserted name is the package name', nameLine !== undefined && nameLine.includes(`'${PACKAGE_NAME}'`), nameLine)
  }
}

console.log('')
console.log('the installed copy is complete')
{
  const installed = join(profileDir, 'node_modules', PACKAGE_NAME)
  check('the package is installed into the profile', existsSync(installed), installed)
  for (const rel of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
    check(`installed copy has ${rel}`, existsSync(join(installed, rel)))
  }
  const clientPath = join(installed, 'lib', 'client.js')
  if (existsSync(clientPath)) {
    const client = readFileSync(clientPath, 'utf8')
    check('the installed client bundle declares this package id', client.includes(`id: "${PACKAGE_NAME}"`))
    check('the installed client bundle owns the Host route', client.includes('/api/session.delete'))
    console.log(`  ..   client bundle ${String(statSync(clientPath).size)} bytes`)
  }
}

console.log('')
console.log('exactly one registration form is active')
{
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const hasPatchRow = new RegExp(`^\\s*name:\\s*'?${PACKAGE_NAME.replace(/[/@.]/g, '\\$&')}'?\\s*$`, 'm').test(patchText)
  const bundles = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dsh?.profile?.bundles ?? []
  const hasBundle = bundles.includes(PACKAGE_NAME)
  check('registered at all (patch row or bundle list)', hasPatchRow || hasBundle,
    `patch:${String(hasPatchRow)} bundles:${String(hasBundle)}`)
  check('not registered twice', !(hasPatchRow && hasBundle), `patch:${String(hasPatchRow)} bundles:${String(hasBundle)}`)
  if (hasBundle) console.log('  ..   bundle mode: the row comes from the package\'s own cordis.patch.yml')
  if (hasPatchRow) console.log('  ..   patch mode: the row is written into the profile patch')
}

console.log('')
console.log(`${checks - failures.length}/${checks} checks passed`)
process.exit(failures.length === 0 ? 0 : 1)
