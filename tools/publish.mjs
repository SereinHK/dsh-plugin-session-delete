#!/usr/bin/env node
/**
 * Publish this plugin to GitHub and print the command others install it with.
 *
 * The one step a tool cannot do is create the remote repository — that needs the
 * account owner and a browser. This checks whether it exists yet, and if it does,
 * wires the remote and pushes (the machine's Git credential helper already holds
 * a token for the account in `git config user.name`, so no password is prompted).
 *
 *   node tools/publish.mjs                 # owner defaults to git config user.name
 *   node tools/publish.mjs --owner someone --repo other-name
 *   node tools/publish.mjs --dry           # only report
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

/** Run a git command in the repository, returning its stdout. */
function git(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', ...options }).trim()
}

const packageName = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).name
const owner = flag('--owner') ?? git(['config', 'user.name'])
const repoName = flag('--repo') ?? packageName
const remote = `https://github.com/${owner}/${repoName}.git`
const dry = argv.includes('--dry')
const branch = git(['branch', '--show-current']) || 'main'

console.log(`package : ${packageName}`)
console.log(`remote  : ${remote}`)
console.log(`branch  : ${branch}`)
console.log(`commits : ${git(['rev-list', '--count', 'HEAD'])} (working tree ${git(['status', '--porcelain']) === '' ? 'clean' : 'DIRTY'})`)
console.log('')

// Does the remote repository exist yet? Probed with `git ls-remote` rather than
// an HTTPS request from Node: git carries its own TLS stack and proxy settings
// (this machine's Node cannot verify the leaf certificate, while git reaches
// GitHub fine), and it is the same pre-check the plugin manager performs on a
// GitHub spec.
let exists = false
let detail = 'reachable'
try {
  git(['ls-remote', '--exit-code', remote, 'HEAD'], { stdio: ['ignore', 'pipe', 'pipe'] })
  exists = true
} catch (error) {
  const stderr = String(error.stderr ?? '')
  const status = error.status
  // `--exit-code` answers 2 for "no matching refs", which is exactly what a
  // freshly created, still empty repository looks like — not a miss.
  if (status === 2) {
    exists = true
    detail = 'reachable, empty (no refs yet)'
  } else if (/Repository not found|not found/i.test(stderr)) {
    detail = 'not created yet'
  } else {
    detail = `could not confirm: ${stderr.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? `git exited ${String(status)}`}`
  }
}
console.log(`remote exists: ${exists ? detail : detail}`)

if (!exists) {
  console.log('')
  console.log('Create it first — this is the one step that needs your account:')
  console.log('')
  console.log('  1. open https://github.com/new')
  console.log(`  2. Repository name: ${repoName}`)
  console.log('  3. Public, and leave "Add a README / .gitignore / license" UNCHECKED')
  console.log('     (the repository must be empty, or the first push is rejected)')
  console.log('  4. Create repository, then run this again')
  console.log('')
  console.log('No `gh` CLI is installed, so nothing here can create it for you.')
  process.exit(1)
}

const remotes = git(['remote']).split('\n').filter(Boolean)
if (remotes.includes('origin')) {
  git(['remote', 'set-url', 'origin', remote])
  console.log('origin remote updated')
} else {
  git(['remote', 'add', 'origin', remote])
  console.log('origin remote added')
}

if (dry) {
  console.log('')
  console.log(`--dry: would push ${branch} to ${remote}`)
  process.exit(0)
}

console.log('')
console.log(`pushing ${branch}...`)
execFileSync('git', ['push', '-u', 'origin', branch], { cwd: repoRoot, stdio: 'inherit' })

console.log('')
console.log('Published. Others install it with:')
console.log('')
console.log(`  dsh plugin --profile <profile> add github:${owner}/${repoName}`)
console.log('')
console.log('or the same spec in the sidebar\'s Plugins page.')
