#!/usr/bin/env node
/**
 * Polish the GitHub profile: the README the visitor reads, the pinned repositories
 * they see first, and the fields that appear beside them.
 *
 * Every action is idempotent and guarded — it reads the current value first and
 * skips anything already correct, so re-running is safe. The credential comes from
 * the machine's Git credential helper (the one `git push` uses); it is used only in
 * an Authorization header, never written to disk and never printed. Run Node with
 * `--use-system-ca` where the TLS chain lives in the system store.
 *
 *   node --use-system-ca tools/profile-polish.mjs [--dry]
 */
import { execFileSync } from 'node:child_process'

const LOGIN = 'SereinHK'
const PLUGIN_REPO = 'dsh-plugin-session-delete'
const UPSTREAM = 'https://github.com/deepseek-ai/deepseek-harness'
const BIO = 'Android dev · offline-first & P2P networking · occasional DSH plugin author'
const PROFILE_REPO_DESCRIPTION = '个人主页 / profile README'
const dry = process.argv.includes('--dry')

/** The block to append to the profile README, in the voice already there. */
const README_ADDITION = `
**[dsh-plugin-session-delete](https://github.com/${LOGIN}/${PLUGIN_REPO})** · DSH 插件

给 DeepSeek Harness 补上它刻意不做的那个动作：真正从磁盘删除一个对话，外加批量清理空会话。
`

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
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'content-type': 'application/json',
  'user-agent': 'dsh-profile-polish'
}

/** One REST call, reporting status rather than throwing. */
async function rest(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    ...body === undefined ? {} : { body: JSON.stringify(body) }
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/** One GraphQL call. */
async function graphql(query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  })
  const payload = await response.json().catch(() => null)
  return { status: response.status, body: payload }
}

console.log(`profile polish for ${LOGIN}${dry ? ' (dry run)' : ''}`)
console.log('')

// ── 1. the profile README ──────────────────────────────────────────────────────
{
  const quoted = await rest('GET', `/repos/${LOGIN}/${LOGIN}/readme`)
  if (quoted.status !== 200) {
    console.log(`readme        : cannot read it (HTTP ${String(quoted.status)})`)
  } else {
    const current = Buffer.from(quoted.body.content, 'base64').toString('utf8')
    if (current.includes(PLUGIN_REPO)) {
      console.log('readme        : already mentions the plugin; left as is')
    } else if (dry) {
      console.log(`readme        : would append ${String(README_ADDITION.trim().length)} bytes and commit`)
    } else {
      const next = `${current.trimEnd()}\n${README_ADDITION}`
      const written = await rest('PUT', `/repos/${LOGIN}/${LOGIN}/contents/README.md`, {
        message: 'Add the DSH plugin alongside NekoChat',
        content: Buffer.from(next, 'utf8').toString('base64'),
        sha: quoted.body.sha,
        branch: quoted.body.default_branch ?? 'main',
        committer: { name: LOGIN, email: `${LOGIN}@users.noreply.github.com` }
      })
      console.log(written.status === 200 || written.status === 201
        ? `readme        : updated — ${String(written.body.commit?.html_url)}`
        : `readme        : FAILED (HTTP ${String(written.status)}) ${String(written.body?.message)}`)
    }
  }
}

// ── 2. the plugin repository's Website field ───────────────────────────────────
{
  const repo = await rest('GET', `/repos/${LOGIN}/${PLUGIN_REPO}`)
  if (repo.status !== 200) {
    console.log(`plugin website: cannot read the repo (HTTP ${String(repo.status)})`)
  } else if (repo.body.homepage === UPSTREAM) {
    console.log('plugin website: already points at the upstream project; left as is')
  } else if (dry) {
    console.log(`plugin website: would set homepage to ${UPSTREAM}`)
  } else {
    const patched = await rest('PATCH', `/repos/${LOGIN}/${PLUGIN_REPO}`, { homepage: UPSTREAM })
    console.log(patched.status === 200
      ? `plugin website: set to ${String(patched.body.homepage)}`
      : `plugin website: FAILED (HTTP ${String(patched.status)}) ${String(patched.body?.message)}`)
  }
}

// ── 3. the profile repository's own description ────────────────────────────────
{
  const repo = await rest('GET', `/repos/${LOGIN}/${LOGIN}`)
  if (repo.body?.description === PROFILE_REPO_DESCRIPTION) {
    console.log('profile desc  : already set; left as is')
  } else if (dry) {
    console.log(`profile desc  : would set "${PROFILE_REPO_DESCRIPTION}"`)
  } else {
    const patched = await rest('PATCH', `/repos/${LOGIN}/${LOGIN}`, { description: PROFILE_REPO_DESCRIPTION })
    console.log(patched.status === 200
      ? `profile desc  : set to "${String(patched.body.description)}"`
      : `profile desc  : FAILED (HTTP ${String(patched.status)}) ${String(patched.body?.message)}`)
  }
}

// ── 4. pinned repositories (GraphQL — REST has no endpoint for these) ──────────
{
  const state = await graphql(`query { viewer { pinnedItems(first: 6) { nodes { ... on Repository { nameWithOwner } } } } }`)
  if (state.status !== 200 || state.body?.data === undefined) {
    console.log(`pins          : not available (HTTP ${String(state.status)}) ${String(state.body?.message ?? state.body?.errors?.[0]?.message)}`)
  } else {
    const pinned = state.body.data.viewer.pinnedItems.nodes.map((node) => node.nameWithOwner)
    const wanted = [`${LOGIN}/nekocat`, `${LOGIN}/${PLUGIN_REPO}`]
    const missing = wanted.filter((name) => !pinned.includes(name))
    if (missing.length === 0) {
      console.log(`pins          : already ${pinned.join(', ')}; left as is`)
    } else if (dry) {
      console.log(`pins          : would pin ${missing.join(', ')} (currently ${pinned.length === 0 ? 'none' : pinned.join(', ')})`)
    } else {
      for (const nameWithOwner of missing) {
        const [owner, name] = nameWithOwner.split('/')
        const found = await graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }`, { owner, name })
        const id = found.body?.data?.repository?.id
        if (typeof id !== 'string') {
          console.log(`pins          : ${nameWithOwner}: cannot resolve its id (${String(found.body?.errors?.[0]?.message)})`)
          continue
        }
        const pinnedResult = await graphql(`mutation($item: ID!) { pinItem(input: { itemId: $item }) { item { ... on Repository { nameWithOwner } } } }`, { item: id })
        const done = pinnedResult.body?.data?.pinItem?.item?.nameWithOwner
        console.log(done === nameWithOwner
          ? `pins          : pinned ${nameWithOwner}`
          : `pins          : ${nameWithOwner}: FAILED (${String(pinnedResult.body?.errors?.[0]?.message ?? pinnedResult.body?.message)})`)
      }
    }
  }
}

// ── 5. the bio line ────────────────────────────────────────────────────────────
{
  const me = await rest('GET', '/user')
  if (me.status !== 200) {
    console.log(`bio           : cannot read the profile (HTTP ${String(me.status)})`)
  } else if (me.body.bio === BIO) {
    console.log('bio           : already current; left as is')
  } else if (dry) {
    console.log(`bio           : would set "${BIO}" (now "${String(me.body.bio)}")`)
  } else {
    const patched = await rest('PATCH', '/user', { bio: BIO })
    console.log(patched.status === 200
      ? `bio           : set to "${String(patched.body.bio)}"`
      : `bio           : FAILED (HTTP ${String(patched.status)}) ${String(patched.body?.message)} — the token may lack the "user" scope; set it in the UI instead`)
  }
}
