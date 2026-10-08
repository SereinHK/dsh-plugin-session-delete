#!/usr/bin/env node
/**
 * Render-level check of the built browser half.
 *
 * The host side can be verified from outside (the boot graph, the served bytes);
 * the browser half cannot, because the only window onto it is a page nobody here
 * can look at. So this harness loads `lib/client.js` exactly as the module table
 * would — `window.__ModuleLoader__.load({ id, factory })`, then `factory(require)`
 * with the platform seed modules stubbed — and drives it for real:
 *
 *   - `apply(ctx)` must register every slot entry without throwing;
 *   - each entry must render, with the copy resolved through the real
 *     dictionaries (a missing key shows up as `!key!`);
 *   - the destructive paths must be driven by *invoking the rendered handlers*:
 *     menu row -> confirm dialog -> `POST /api/session.delete` with the right body;
 *     cleanup button -> plan -> one sequential request per planned Session.
 *
 * A miniature hook runtime stands in for React (no React is installed on this
 * machine) and the ui-primitives are stubbed to plain elements, so what is under
 * test is this package's own logic and wiring — not the shipped components.
 *
 *   node tools/verify-browser.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDir = repoRoot
const bundlePath = join(packageDir, 'lib', 'client.js')
const expectedId = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).name

let checks = 0
const failures = []
/** Record one expectation. */
function check(label, condition, detail = '') {
  checks++
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// ── a miniature React ──────────────────────────────────────────────────────────
const Fragment = Symbol('Fragment')
let hooks = null

/** Create one element. `children` passed inside props survives, as in React. */
function createElement(type, props, ...children) {
  const next = { ...(props ?? {}) }
  if (children.length === 1) next.children = children[0]
  else if (children.length > 1) next.children = children
  return { element: true, type, props: next }
}
/** Hooks are positional per component instance, as in React. */
function useState(initial) {
  const instance = hooks.instance
  const slot = hooks.index++
  if (!(slot in instance.values)) instance.values[slot] = typeof initial === 'function' ? initial() : initial
  // Bound to the instance, not to the ambient render: a handler runs long after
  // the render that created it returned.
  const set = (next) => {
    instance.values[slot] = typeof next === 'function' ? next(instance.values[slot]) : next
    instance.dirty = true
  }
  return [instance.values[slot], set]
}
/** Memoize on the dependency list. */
function useMemo(factory, deps) {
  const slot = hooks.index++
  const previous = hooks.memo[slot]
  if (previous !== undefined && sameDeps(previous.deps, deps)) return previous.value
  const value = factory()
  hooks.memo[slot] = { deps, value }
  return value
}
/** Effects run once per instance, so a subscription installed in one is live. */
function useEffect(callback) {
  const instance = hooks.instance
  const slot = hooks.index++
  const effects = instance.effects ?? (instance.effects = new Set())
  if (effects.has(slot)) return
  effects.add(slot)
  callback()
}
/** Whether two dependency lists match. */
function sameDeps(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}
const React = { createElement, Fragment, useState, useMemo, useEffect, useRef: (value) => ({ current: value }) }

// ── stubbed ui-primitives ──────────────────────────────────────────────────────
const primitives = {
  MenuItemButton: (props) => createElement('button', { 'data-role': 'menu-item', 'data-danger': props.danger === true ? 'yes' : undefined, onClick: props.onSelect }, [props.icon, props.children]),
  // `style` and `variant` are forwarded: the real primitive spreads native button
  // attributes, and the destructive buttons are told apart by exactly those.
  Button: (props) => createElement('button', { 'data-role': 'button', 'data-variant': props.variant, style: props.style, disabled: props.disabled, onClick: props.onClick }, [props.icon, props.children]),
  Modal: (props) => props.open === false ? null : createElement('div', { 'data-role': 'modal', title: props.title }, [
    createElement('h2', { key: 'title' }, props.title),
    createElement('p', { key: 'description' }, props.description),
    createElement('div', { key: 'body' }, props.children),
    createElement('div', { key: 'footer' }, props.footer)
  ]),
  IconTrashOutlineRegular: () => createElement('span', null, '🗑')
}

// ── load the bundle the way the module table does ──────────────────────────────
let registration
const window = { __ModuleLoader__: { load: (value) => { registration = value } } }
const source = readFileSync(bundlePath, 'utf8')
try {
  new Function('window', source)(window)
} catch (error) {
  console.error(`lib/client.js did not execute: ${error.message}`)
  process.exit(1)
}

const requireSeed = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`require(${JSON.stringify(specifier)}) is not a platform seed module`)
}
const mod = registration.factory(requireSeed)

// ── the fake browser context ───────────────────────────────────────────────────
const requests = []
let list = { ids: [], byId: {}, current: undefined }
let refreshes = 0
const registrations = []
const dictionaries = {}

const ctx = {
  effect: (callback) => {
    callback()
    return () => {}
  },
  locale: {
    register: (namespace, dicts) => {
      dictionaries[namespace] = dicts
      return () => {}
    }
  },
  sessions: {
    list: { getSnapshot: () => list, subscribe: () => () => {} },
    refresh: async () => {
      refreshes++
    }
  },
  slots: {
    inject: (key, callback) => {
      callback()
      return () => {}
    },
    register: (options, Component) => {
      registrations.push({ key: options.name, options, Component })
      return () => {}
    }
  }
}

/** The reply the stubbed Host gives next; scenarios swap it. */
let respond = (body) => ({
  ok: true,
  status: 200,
  body: { ok: true, value: { sessionId: body?.sessionId, directory: 'x', files: [], cacheRemoved: true } }
})

/**
 * What the Host's durable-facts route answers. The cleanup reads these instead of
 * guessing from the list, so they are the interesting fixture in the cleanup
 * scenarios; `list` now only supplies the live facts (running, open).
 */
let unusedFacts = []
/** A forced failure of the durable-facts route, to prove it is worded not swallowed. */
let unusedFailure = null

/** What the trash route answers, and how often it was asked. */
let trashAnswer = { entries: [], retentionDays: 7 }
let trashCalls = 0
/** Every restore or purge the dialog fired, in order. */
const trashActions = []

/** One durable row as the Host reports it. */
function fact(sessionId, overrides = {}) {
  const at = Date.now() - 3 * 60 * 60 * 1000
  return {
    sessionId,
    cwd: `C:\\work\\${sessionId}`,
    createdAt: at,
    updatedAt: at,
    blank: true,
    proven: true,
    lastPromptAt: null,
    ...overrides
  }
}

globalThis.fetch = async (url, init) => {
  const target = String(url)
  const body = init?.body === undefined || String(init.body) === '' ? undefined : JSON.parse(String(init.body))
  requests.push({ url: target, method: init?.method, body: init?.body })
  if (target === '/api/session.unused') {
    return unusedFailure === null
      ? { ok: true, status: 200, json: async () => ({ ok: true, value: { sessions: unusedFacts } }) }
      : { ok: false, status: 500, json: async () => ({ ok: false, error: unusedFailure }) }
  }
  if (target === '/api/session.trash') {
    trashCalls++
    return { ok: true, status: 200, json: async () => ({ ok: true, value: trashAnswer }) }
  }
  if (target === '/api/session.restore' || target === '/api/session.purge') {
    trashActions.push({ action: target.endsWith('restore') ? 'restore' : 'purge', body: init?.body })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: target.endsWith('restore') ? { sessionId: 'x', directory: 'y' } : { purged: ['x'] } })
    }
  }
  const answer = respond(body)
  return { ok: answer.ok, status: answer.status, json: async () => answer.body }
}

// ── rendering ──────────────────────────────────────────────────────────────────
/** Per-root component instances, so state survives a handler and a re-render. */
const rootInstances = new Map()
/** Forget one component's rendered state, so a scenario starts from a fresh mount. */
function resetRoot(...components) {
  for (const component of components) rootInstances.delete(component)
}
/** Render a component, re-rendering while state setters fired. */
function renderRoot(Component, props) {
  const instances = rootInstances.get(Component) ?? new Map()
  rootInstances.set(Component, instances)
  let tree = null
  for (let pass = 0; pass < 20; pass++) {
    hooks = null
    tree = renderNode({ element: true, type: Component, props }, instances)
    // A dirty flag raised before this call (a store notification, say) is cleared
    // only after the pass that could see it.
    const dirty = [...instances.values()].some((instance) => instance.dirty)
    for (const instance of instances.values()) instance.dirty = false
    if (!dirty) break
  }
  return tree
}
/** Render one node, resolving function components through the hook scope. */
function renderNode(node, instances) {
  if (node === null || node === undefined || typeof node === 'boolean') return node
  if (Array.isArray(node)) return node.map((child) => renderNode(child, instances))
  if (typeof node === 'string' || typeof node === 'number') return node
  if (node.element !== true) return node
  if (node.type === Fragment) return renderNode(node.props.children, instances)
  if (typeof node.type === 'function') {
    const outer = hooks
    const instance = instances.get(node.type) ?? { values: {}, memo: {}, dirty: false }
    instance.dirty = false
    instances.set(node.type, instance)
    hooks = { index: 0, values: instance.values, memo: instance.memo, instance }
    const rendered = node.type(node.props)
    hooks = outer
    return renderNode(rendered, instances)
  }
  const props = { ...node.props }
  props.children = renderNode(props.children, instances)
  return { ...node, props }
}
/** Flatten a tree to text, and collect every element carrying a handler. */
function inspect(node, handlers = [], text = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return { handlers, text }
  if (Array.isArray(node)) {
    for (const child of node) inspect(child, handlers, text)
    return { handlers, text }
  }
  if (typeof node === 'string' || typeof node === 'number') {
    text.push(String(node))
    return { handlers, text }
  }
  const before = text.length
  inspect(node.props.children, handlers, text)
  const own = text.slice(before).join(' ').replace(/\s+/g, ' ').trim()
  for (const [key, value] of Object.entries(node.props)) {
    if (key.startsWith('on') && typeof value === 'function') handlers.push({ label: own, handler: value, props: node.props })
  }
  return { handlers, text }
}

/** Translate through the recorded dictionary, flagging missing keys. */
function translator() {
  const dict = dictionaries.sessionDelete?.zh ?? {}
  return (key, params) => {
    let value = dict[key]
    if (value === undefined) return `!${key}!`
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.split(`{${name}}`).join(String(replacement))
    return value
  }
}
/**
 * One fake Session summary, in the shape the shipped store produces for a Session
 * loaded from disk: blankness lives in the durable projection, not in the live flag.
 */
function summary(sessionId, overrides = {}) {
  return {
    id: sessionId,
    running: false,
    updatedAt: Date.now() - 3 * 60 * 60 * 1000,
    projectionValues: { sessionListMetadata: { blank: true, lastPromptAt: null } },
    ...overrides
  }
}
/** Find the handler whose rendered label matches. */
function handlerFor(tree, pattern) {
  const { handlers } = inspect(tree)
  return handlers.find((entry) => pattern.test(entry.label))
}
/**
 * Let a handler's promise chain finish.
 *
 * The destructive handlers start their work and return undefined (they are click
 * handlers, not async APIs), so the harness has to drain the loop before it can
 * see the settled state.
 */
async function flush() {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve, 0))
}

// ── checks ─────────────────────────────────────────────────────────────────────
console.log(`bundle: ${bundlePath}`)
console.log('')
console.log('bundle shape')
check(`declares the module id ${expectedId}`, registration.id === expectedId, registration.id)
check('exports apply and inject', typeof mod.apply === 'function' && Array.isArray(mod.inject), JSON.stringify(Object.keys(mod)))
check('declares its required services', mod.inject.join(',') === 'slots,sessions,locale', mod.inject.join(','))

console.log('')
console.log('registrations')
mod.apply(ctx)
check('registered six slot entries', registrations.length === 6, String(registrations.length))
const menu = registrations.find((entry) => entry.options.id === 'session-delete')
const cleanup = registrations.find((entry) => entry.options.id === 'session-cleanup')
const trash = registrations.find((entry) => entry.options.id === 'session-trash')
const dialogs = registrations.filter((entry) => entry.options.id.endsWith('-dialog'))
check('the row menu entry targets the session menu slot', menu?.key === 'sidebar.workspaces.session.menu.item', menu?.key)
check('the row menu entry sorts after the shipped archive row (order 900)', menu?.options.order === 900, String(menu?.options.order))
check('the cleanup entry targets the sidebar foot', cleanup?.key === 'sidebar.footer.action', cleanup?.key)
check('the trash entry sits beside it in the foot', trash?.key === 'sidebar.footer.action' && trash?.options.order === 510, `${String(trash?.key)} order ${String(trash?.options.order)}`)
check('all three dialogs mount into the frame overlay', dialogs.length === 3 && dialogs.every((entry) => entry.key === 'shell.overlay'), dialogs.map((entry) => entry.key).join(','))
check('dictionaries registered under sessionDelete with zh and en', dictionaries.sessionDelete?.zh !== undefined && dictionaries.sessionDelete?.en !== undefined, JSON.stringify(Object.keys(dictionaries.sessionDelete ?? {})))

const t = translator()

console.log('')
console.log('menu row and its confirmation')
const menuTree = renderRoot(menu.Component, { sessionId: 'session-a', displayTitle: '重构会话存储', useMenuOpenState: () => [false, () => {}], t })
check('renders the localized delete row', JSON.stringify(menuTree).includes('删除对话'), JSON.stringify(menuTree).slice(0, 400))
check('renders a trash icon', JSON.stringify(menuTree).includes('🗑'))
const openDialog = handlerFor(menuTree, /删除对话/)
check('the row is clickable', openDialog !== undefined)
openDialog.handler()
const deleteDialog = dialogs.find((entry) => entry.options.id === 'session-delete-dialog')
const dialogTree = renderRoot(deleteDialog.Component, { t, ...{} , refreshSessions: async () => {} })
const dialogText = inspect(dialogTree).text.join(' ')
check('the dialog opens with the conversation title', dialogText.includes('重构会话存储'), dialogText)
// Removal is a move now, and the confirmation has to say so: the words "permanently"
// and "cannot be undone" belong to the purge route, not to this dialog.
check('the dialog promises a restorable move', dialogText.includes('移入本机回收站') && dialogText.includes('恢复'), dialogText)
check('the dialog states the scope', dialogText.includes('投影缓存'), dialogText)
check('no copy key is missing', !dialogText.includes('!'), dialogText)
const confirm = handlerFor(dialogTree, /^移入回收站$/)
check('the confirm button exists', confirm !== undefined, JSON.stringify(inspect(dialogTree).handlers.map((entry) => entry.label)))
await confirm.handler()
await flush()
check('confirm posts one removal to the Host route', requests.length === 1 && requests[0].url === '/api/session.delete', JSON.stringify(requests))
check('the request is a POST of the session id', requests[0]?.method === 'POST' && requests[0]?.body === JSON.stringify({ sessionId: 'session-a' }), JSON.stringify(requests[0]))
check('the dialog closes after it settles', renderRoot(deleteDialog.Component, { t, refreshSessions: async () => {} }) === null)

console.log('')
console.log('blank-Session cleanup')
// The live list now only supplies the live facts; blankness comes from the Host.
list = {
  ids: ['session-open', 'session-blank-old', 'session-blank-fresh', 'session-used', 'session-running'],
  byId: {
    'session-open': summary('session-open'),
    'session-blank-old': summary('session-blank-old'),
    'session-blank-fresh': summary('session-blank-fresh'),
    'session-used': summary('session-used'),
    'session-running': summary('session-running', { running: true })
  },
  current: 'session-open'
}
unusedFacts = [
  fact('session-open'),
  fact('session-blank-old', { cwd: 'C:\\work\\alpha', title: '演示对话', bytes: 12_400 }),
  fact('session-blank-fresh', { updatedAt: Date.now() - 60_000 }),
  fact('session-used', { blank: false, lastPromptAt: Date.now() - 5 * 60 * 60 * 1000 }),
  fact('session-running'),
  // No projection on the Host: the cleanup must skip it rather than guess.
  fact('session-unproven', { proven: false, blank: false })
]
requests.length = 0
const buttonTree = renderRoot(cleanup.Component, { wide: true, t })
check('the cleanup trigger renders its label', inspect(buttonTree).text.join(' ').includes('清理空会话'), inspect(buttonTree).text.join(' '))
const railTree = renderRoot(cleanup.Component, { wide: false, t })
check('the rail form still renders', railTree !== null)
const openCleanup = handlerFor(buttonTree, /清理空会话/)
openCleanup.handler()
const pendingDialog = dialogs.find((entry) => entry.options.id === 'session-cleanup-dialog')
let refreshCalls = 0
const renderCleanupDialog = () => renderRoot(pendingDialog.Component, {
  t,
  useSessions: (selector) => selector(list),
  refreshSessions: async () => {
    refreshCalls++
  }
})
const loadingText = inspect(renderCleanupDialog()).text.join(' ')
check('it says what it is waiting for', loadingText.includes('正在向宿主确认'), loadingText)
await flush()
const cleanupDialog = pendingDialog
const cleanupTree = renderCleanupDialog()
const cleanupText = inspect(cleanupTree).text.join(' ')
check('the dialog promises exactly the one eligible Session', cleanupText.includes('有 1 个从未使用过的空会话'), cleanupText)
check('it names the conversation by its title', cleanupText.includes('演示对话'), cleanupText)
check('it says what the run reclaims', cleanupText.includes('12.4 kB'), cleanupText)
check('it explains the grace period', cleanupText.includes('60 分钟'), cleanupText)
check('the open Session is not listed', !cleanupText.includes('session-open'), cleanupText)
check('the fresh Session is not listed', !cleanupText.includes('session-blank-fresh'), cleanupText)
check('a Session the Host could not prove is not listed', !cleanupText.includes('session-unproven'), cleanupText)
check('no copy key is missing', !cleanupText.includes('!'), cleanupText)
const cleanupConfirm = handlerFor(cleanupTree, /删除 1 个/)
check('the confirm button carries the count', cleanupConfirm !== undefined, JSON.stringify(inspect(cleanupTree).handlers.map((entry) => entry.label)))
requests.length = 0
await cleanupConfirm.handler()
await flush()
check('cleanup removes exactly the eligible Session', requests.length === 1 && requests[0].body.includes('session-blank-old'), JSON.stringify(requests.map((entry) => entry.body)))
check('cleanup refreshes the list once when it settles', refreshCalls === 1, String(refreshCalls))
const settled = renderCleanupDialog()
check('the settled dialog reports the outcome', inspect(settled).text.join(' ').includes('已删除 1 个空会话'), inspect(settled).text.join(' '))

console.log('')
console.log('a cleanup whose facts cannot be read')
{
  resetRoot(pendingDialog.Component)
  respond = (body) => ({ ok: true, status: 200, body: { ok: true, value: { sessionId: body?.sessionId } } })
  unusedFacts = []
  unusedFailure = { code: 'storage-unreadable', message: 'cannot list stored sessions: disk offline' }
  openCleanup.handler()
  await flush()
  const text = inspect(renderCleanupDialog()).text.join(' ')
  check('the dialog reports the Host failure', text.includes('清理失败') && text.includes('disk offline'), text)
  check('it does not pass a failure off as "nothing to clean"', !text.includes('没有可清理的空会话'), text)
  check('no confirmation is offered', handlerFor(renderCleanupDialog(), /删除 \d+ 个/) === undefined, text)
  unusedFailure = null
}

// ── refusal paths ──────────────────────────────────────────────────────────────
// The happy paths above prove the wiring; these prove the branches an operator
// actually meets, where a wrong code mapping or a swallowed failure would hide.
console.log('')
console.log('a refused removal')
{
  resetRoot(deleteDialog.Component)
  respond = () => ({
    ok: false,
    status: 409,
    body: { ok: false, error: { code: 'session-live', message: 'session "session-a" is live in this process' } }
  })
  let refreshesAfterRefusal = 0
  openDialog.handler()
  const tree = renderRoot(deleteDialog.Component, {
    t,
    refreshSessions: async () => {
      refreshesAfterRefusal++
    }
  })
  await handlerFor(tree, /^移入回收站$/).handler()
  await flush()
  const text = inspect(renderRoot(deleteDialog.Component, { t, refreshSessions: async () => {} })).text.join(' ')
  check('the Host message reaches the operator', text.includes('session "session-a" is live'), text)
  check('the refusal is worded in the operator\'s language', text.includes('该对话正被当前窗口打开'), text)
  check('the dialog stays open for a retry', text.includes('删除这个对话？'), text)
  check('no list refresh is attempted after a refusal', refreshesAfterRefusal === 0, String(refreshesAfterRefusal))
}

console.log('')
console.log('a partly failing cleanup')
{
  resetRoot(pendingDialog.Component)
  unusedFacts = [fact('blank-one', { cwd: 'C:\\work\\one' }), fact('blank-two', { cwd: 'C:\\work\\two' })]
  const seen = []
  respond = (body) => {
    seen.push(body.sessionId)
    if (body.sessionId === 'blank-two') {
      return { ok: false, status: 404, body: { ok: false, error: { code: 'session-not-found', message: 'no stored session log' } } }
    }
    return { ok: true, status: 200, body: { ok: true, value: { sessionId: body.sessionId, directory: 'x', files: [], cacheRemoved: true } } }
  }
  requests.length = 0
  openCleanup.handler()
  await flush()
  const tree = renderCleanupDialog()
  check('both blank Sessions are planned', inspect(tree).text.join(' ').includes('有 2 个从未使用过的空会话'), inspect(tree).text.join(' '))
  refreshCalls = 0
  await handlerFor(tree, /删除 2 个/).handler()
  await flush()
  check('every planned Session is attempted, one at a time', seen.join(',') === 'blank-one,blank-two', seen.join(','))
  const settledText = inspect(renderCleanupDialog()).text.join(' ')
  check('the summary separates deleted from failed', settledText.includes('已删除 1') && settledText.includes('1 个失败'), settledText)
  check('the summary carries the failure reason', settledText.includes('no stored session log'), settledText)
  check('the list is refreshed once even on partial failure', refreshCalls === 1, String(refreshCalls))
}

console.log('')
console.log('a cleanup target that became live')
{
  resetRoot(pendingDialog.Component)
  unusedFacts = [fact('session-blank-old')]
  respond = () => ({
    ok: false,
    status: 409,
    body: { ok: false, error: { code: 'session-live', message: 'session is live in this process' } }
  })
  requests.length = 0
  openCleanup.handler()
  await flush()
  const tree = renderCleanupDialog()
  await handlerFor(tree, /删除 1 个/).handler()
  await flush()
  const settledText = inspect(renderCleanupDialog()).text.join(' ')
  check('an in-use Session is reported as skipped, not failed', settledText.includes('正在使用，已跳过'), settledText)
  check('it is not reported as an error', !settledText.includes('1 个失败'), settledText)
}

console.log('')
console.log('the trash')
{
  const trashDialog = dialogs.find((entry) => entry.options.id === 'session-trash-dialog')
  const trashButton = registrations.find((entry) => entry.options.id === 'session-trash')?.Component
  check('the trash has a footer trigger', trashButton !== undefined)
  resetRoot(trashDialog.Component)
  const day = 24 * 60 * 60 * 1000
  trashAnswer = {
    entries: [
      {
        sessionId: 'session-gone',
        cwd: 'C:\\work\\alpha',
        title: '演示对话',
        bytes: 12_400,
        deletedAt: Date.now() - day,
        expiresAt: Date.now() + 6 * day,
        files: ['session.v4.jsonl.zstd']
      }
    ],
    retentionDays: 7
  }
  trashCalls = 0
  trashActions.length = 0
  const buttonTree = renderRoot(trashButton, { wide: true, t })
  check('the trigger renders its label', inspect(buttonTree).text.join(' ').includes('回收站'), inspect(buttonTree).text.join(' '))
  handlerFor(buttonTree, /回收站/).handler()
  await flush()
  const tree = renderRoot(trashDialog.Component, { t })
  const text = inspect(tree).text.join(' ')
  check('the dialog counts what is in there and states the window', text.includes('1 个对话') && text.includes('7 天'), text)
  check('it names the Session by its title', text.includes('演示对话'), text)
  check('it says what it still holds', text.includes('12.4 kB'), text)
  check('it says how long is left', text.includes('6 天'), text)
  check('no copy key is missing', !text.includes('!'), text)

  const restore = handlerFor(tree, /^恢复$/)
  check('a restore action is offered', restore !== undefined, JSON.stringify(inspect(tree).handlers.map((entry) => entry.label)))
  await restore.handler()
  await flush()
  check('restoring calls the Host route', trashActions[0]?.action === 'restore' && String(trashActions[0]?.body).includes('session-gone'), JSON.stringify(trashActions))
  check('and re-reads the listing afterwards', trashCalls >= 2, String(trashCalls))
  const afterRestore = inspect(renderRoot(trashDialog.Component, { t })).text.join(' ')
  check('it reports what happened', afterRestore.includes('已恢复'), afterRestore)

  // Destroying for good asks first: the label changes to the confirmation.
  const purge = handlerFor(renderRoot(trashDialog.Component, { t }), /^彻底删除$/)
  purge.handler()
  await flush()
  const asking = inspect(renderRoot(trashDialog.Component, { t })).text.join(' ')
  check('purging asks before it destroys', asking.includes('无法恢复'), asking)
  const confirmed = handlerFor(renderRoot(trashDialog.Component, { t }), /确定删除这一个/)
  check('and the question carries the action', confirmed !== undefined, asking)
  // Red at both steps, from the theme's own token rather than a literal: `Button` has
  // no danger variant, so this is the only way to say "irreversible" in its language.
  const red = 'var(--dsw-alias-state-error-primary)'
  check('the destructive row action is red', inspect(renderRoot(trashDialog.Component, { t })).handlers.some((entry) => entry.props?.style?.color === red), JSON.stringify(inspect(renderRoot(trashDialog.Component, { t })).handlers.map((entry) => entry.props?.style)))
  check('and its confirmation is filled red', confirmed?.props?.style?.backgroundColor === red, JSON.stringify(confirmed?.props?.style))
  const purgeAll = handlerFor(renderRoot(trashDialog.Component, { t }), /^清空回收站$/)
  check('emptying the trash is red too', purgeAll?.props?.style?.color === red, JSON.stringify(purgeAll?.props?.style))
  await confirmed.handler()
  await flush()
  check('the purge reaches the Host', trashActions.some((entry) => entry.action === 'purge'), JSON.stringify(trashActions))
}

console.log('')
console.log(`${checks - failures.length}/${checks} checks passed`)
process.exit(failures.length === 0 ? 0 : 1)
