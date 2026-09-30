/**
 * Read a GitHub profile and its public repositories, for a review of what a
 * visitor sees. Read-only: GET requests, no writes.
 *
 *   node --use-system-ca tools/profile-audit.mjs [login]
 */
import { execFileSync } from 'node:child_process'

const login = process.argv[2] ?? 'SereinHK'

/** Ask the configured credential helper for a GitHub token. Prints nothing. */
function githubToken() {
  const answer = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const line = answer.split('\n').find((entry) => entry.startsWith('password='))
  return line?.slice('password='.length).trim()
}

const headers = {
  authorization: `Bearer ${githubToken()}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'dsh-profile-audit'
}

/** One GET that reports its status instead of throwing. */
async function get(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const profile = await get(`/users/${login}`)
if (profile.status !== 200) {
  console.log(`profile: HTTP ${String(profile.status)}`)
  process.exit(1)
}
const user = profile.body
console.log(`== ${user.login} ==`)
for (const key of ['name', 'bio', 'company', 'blog', 'location', 'twitter_username', 'email', 'hireable']) {
  const value = user[key]
  console.log(`  ${key.padEnd(18)} ${value === null || value === '' ? '— (未设置)' : String(value)}`)
}
console.log(`  ${'public_repos'.padEnd(18)} ${String(user.public_repos)}   followers ${String(user.followers)}   following ${String(user.following)}`)
console.log(`  ${'created_at'.padEnd(18)} ${String(user.created_at).slice(0, 10)}   last profile update ${String(user.updated_at).slice(0, 10)}`)

const readme = await get(`/repos/${login}/${login}`)
console.log('')
console.log(`== profile README (${login}/${login}) ==`)
console.log(readme.status === 200
  ? `  存在，${String(readme.body.size)} KB，最后推送 ${String(readme.body.pushed_at).slice(0, 10)}`
  : `  不存在 (HTTP ${String(readme.status)}) —— 主页上没有任何自我介绍的版面`)

const repos = await get(`/users/${login}/repos?per_page=100&sort=pushed`)
console.log('')
console.log(`== 公开仓库 ${String(repos.body?.length ?? 0)} 个 ==`)
console.log('  名称 / 描述 / topics / 许可 / 星标 / 最后推送')
for (const repo of repos.body ?? []) {
  const flags = [repo.fork ? 'fork' : '', repo.archived ? 'archived' : '', repo.license?.spdx_id ?? 'no-license'].filter(Boolean).join(',')
  console.log(`  ${repo.name}`)
  console.log(`      描述   : ${repo.description === null ? '— (未设置)' : repo.description}`)
  console.log(`      topics : ${(repo.topics ?? []).length === 0 ? '— (无)' : (repo.topics ?? []).join(' ')}`)
  console.log(`      其它   : ${flags} | ★${String(repo.stargazers_count)} | homepage ${repo.homepage === null || repo.homepage === '' ? '—' : repo.homepage} | 推送 ${String(repo.pushed_at).slice(0, 10)}`)
}
