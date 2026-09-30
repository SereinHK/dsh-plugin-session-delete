/**
 * Attach the npm-shaped tarball to the GitHub Release, so the plugin can be
 * installed from a plain https URL as well as from the repository.
 *
 * Why it is worth a second distribution form: a git install needs `git` on the
 * *user's* machine (the plugin manager resolves a git spec with `git ls-remote`
 * and pnpm fetches over git), while a tarball URL needs only the fetch the package
 * manager already does. No npm account is involved — the tarball is built locally
 * by `npm pack` and uploaded as a release asset.
 *
 *   node --use-system-ca tools/attach-tarball.mjs <tag> <tarball>
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const LOGIN = 'SereinHK'
const REPO = 'dsh-plugin-session-delete'
const [tag, tarball] = process.argv.slice(2)
if (tag === undefined || tarball === undefined) throw new Error('usage: attach-tarball.mjs <tag> <tarball>')

/** Ask the configured credential helper for a GitHub token. Prints nothing. */
function githubToken() {
  const answer = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const line = answer.split('\n').find((entry) => entry.startsWith('password='))
  return line.slice('password='.length).trim()
}

const headers = {
  authorization: `Bearer ${githubToken()}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': `${REPO}-attach`
}
const api = `https://api.github.com/repos/${LOGIN}/${REPO}`
const name = tarball.split(/[\\/]/).pop()

const release = await (await fetch(`${api}/releases/tags/${tag}`, { headers })).json()
if (release.id === undefined) throw new Error(`no release for ${tag}: ${JSON.stringify(release.message)}`)

for (const asset of release.assets ?? []) {
  if (asset.name !== name) continue
  const removed = await fetch(`${api}/releases/assets/${String(asset.id)}`, { method: 'DELETE', headers })
  console.log(`replaced existing asset ${name} (delete HTTP ${String(removed.status)})`)
}

const bytes = readFileSync(tarball)
const uploaded = await fetch(`https://uploads.github.com/repos/${LOGIN}/${REPO}/releases/${String(release.id)}/assets?name=${encodeURIComponent(name)}`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/octet-stream' },
  body: bytes
})
const payload = await uploaded.json()
if (uploaded.status !== 201) throw new Error(`upload failed (HTTP ${String(uploaded.status)}): ${String(payload.message)}`)
console.log(`uploaded ${name} (${String(Math.round(statSync(tarball).size / 1024))} KB)`)
console.log(`url: ${String(payload.browser_download_url)}`)
