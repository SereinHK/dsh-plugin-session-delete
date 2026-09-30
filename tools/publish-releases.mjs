#!/usr/bin/env node
/**
 * Create GitHub Releases from `docs/releases/<tag>.md`.
 *
 * The one step no repository operation can do: a Release is not a git object. The
 * credential comes from the machine's configured Git credential helper (the same
 * one `git push` uses) and is used only in an Authorization header — it is never
 * written to disk and never printed. Node must run with `--use-system-ca` on a
 * machine whose TLS chain is only in the system store.
 *
 *   node --use-system-ca tools/publish-releases.mjs [--dry] [--tag v0.1.2]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index < 0 ? fallback : argv[index + 1]
}

const owner = flag('--owner', 'SereinHK')
const repo = flag('--repo', JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).name)
const dry = argv.includes('--dry')
const only = flag('--tag')

/** Ask the configured credential helper for a GitHub token. Prints nothing. */
function githubToken() {
  const answer = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const line = answer.split('\n').find((entry) => entry.startsWith('password='))
  if (line === undefined) throw new Error('the credential helper returned no password')
  return line.slice('password='.length).trim()
}

const token = githubToken()
const api = `https://api.github.com/repos/${owner}/${repo}`
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
  'user-agent': `${repo}-release-script`
}

const releasesDir = join(repoRoot, 'docs', 'releases')
const files = existsSync(releasesDir)
  ? readdirSync(releasesDir).filter((name) => name.endsWith('.md')).sort()
  : []
if (files.length === 0) throw new Error(`no release notes in ${releasesDir}`)

for (const file of files) {
  const tag = file.replace(/\.md$/, '')
  if (only !== undefined && only !== tag) continue
  const body = readFileSync(join(releasesDir, file), 'utf8')

  const existing = await fetch(`${api}/releases/tags/${tag}`, { headers })
  if (existing.status === 200) {
    const current = await existing.json()
    console.log(`${tag}: a release already exists (${current.html_url}); left as is`)
    continue
  }
  if (existing.status !== 404) {
    console.log(`${tag}: cannot check (HTTP ${String(existing.status)})`)
    continue
  }
  if (dry) {
    console.log(`${tag}: would create a release (${String(body.length)} bytes of notes)`)
    continue
  }

  const created = await fetch(`${api}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false })
  })
  const payload = await created.json()
  if (created.status !== 201) {
    console.log(`${tag}: FAILED (HTTP ${String(created.status)}) ${String(payload.message)}`)
    process.exitCode = 1
    continue
  }
  console.log(`${tag}: created — ${payload.html_url}`)
}
