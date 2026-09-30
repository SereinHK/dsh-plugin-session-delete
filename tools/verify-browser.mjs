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
  MenuItemButton: (props) => createElement('button', { 'data-role': 'menu-item', onClick: props.onSelect }, [props.icon, props.children]),
  Button: (props) => createElement('button', { 'data-role': 'button', disabled: props.disabled, onClick: props.onClick }, [props.icon, props.children]),
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

globalThis.fetch = async (url, init) => {
  const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
  requests.push({ url: String(url), method: init?.method, body: init?.body })
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
/** One fake Session summary. */
function summary(sessionId, overrides = {}) {
  return { sessionId, blank: true, running: false, updatedAt: Date.now() - 3 * 60 * 60 * 1000, ...overrides }
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
check('registered four slot entries', registrations.length === 4, String(registrations.length))
const menu = registrations.find((entry) => entry.options.id === 'session-delete')
const cleanup = registrations.find((entry) => entry.options.id === 'session-cleanup')
const dialogs = registrations.filter((entry) => entry.options.id.endsWith('-dialog'))
check('the row menu entry targets the session menu slot', menu?.key === 'sidebar.workspaces.session.menu.item', menu?.key)
check('the row menu entry sorts after the shipped archive row (order 900)', menu?.options.order === 900, String(menu?.options.order))
check('the cleanup entry targets the sidebar foot', cleanup?.key === 'sidebar.footer.action', cleanup?.key)
check('both dialogs mount into the frame overlay', dialogs.length === 2 && dialogs.every((entry) => entry.key === 'shell.overlay'), dialogs.map((entry) => entry.key).join(','))
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
check('the dialog states the scope', dialogText.includes('永久删除') && dialogText.includes('投影缓存'), dialogText)
check('no copy key is missing', !dialogText.includes('!'), dialogText)
const confirm = handlerFor(dialogTree, /^永久删除$/)
check('the confirm button exists', confirm !== undefined, JSON.stringify(inspect(dialogTree).handlers.map((entry) => entry.label)))
await confirm.handler()
await flush()
check('confirm posts one removal to the Host route', requests.length === 1 && requests[0].url === '/api/session.delete', JSON.stringify(requests))
check('the request is a POST of the session id', requests[0]?.method === 'POST' && requests[0]?.body === JSON.stringify({ sessionId: 'session-a' }), JSON.stringify(requests[0]))
check('the dialog closes after it settles', renderRoot(deleteDialog.Component, { t, refreshSessions: async () => {} }) === null)

console.log('')
console.log('blank-Session cleanup')
list = {
  ids: ['session-open', 'session-blank-old', 'session-blank-fresh', 'session-used', 'session-running'],
  byId: {
    'session-open': summary('session-open'),
    'session-blank-old': summary('session-blank-old', { cwd: 'C:\\work\\alpha' }),
    'session-blank-fresh': summary('session-blank-fresh', { updatedAt: Date.now() - 60_000 }),
    'session-used': summary('session-used', { blank: false }),
    'session-running': summary('session-running', { running: true })
  },
  current: 'session-open'
}
requests.length = 0
const buttonTree = renderRoot(cleanup.Component, { wide: true, t })
check('the cleanup trigger renders its label', inspect(buttonTree).text.join(' ').includes('清理空会话'), inspect(buttonTree).text.join(' '))
const railTree = renderRoot(cleanup.Component, { wide: false, t })
check('the rail form still renders', railTree !== null)
const openCleanup = handlerFor(buttonTree, /清理空会话/)
openCleanup.handler()
const cleanupDialog = dialogs.find((entry) => entry.options.id === 'session-cleanup-dialog')
let refreshCalls = 0
const cleanupTree = renderRoot(cleanupDialog.Component, {
  t,
  useSessions: (selector) => selector(list),
  refreshSessions: async () => {
    refreshCalls++
  }
})
const cleanupText = inspect(cleanupTree).text.join(' ')
check('the dialog promises exactly the one eligible Session', cleanupText.includes('有 1 个从未使用过的空会话'), cleanupText)
check('it lists the workspace path of what will go', cleanupText.includes('C:\\work\\alpha'), cleanupText)
check('it explains the grace period', cleanupText.includes('60 分钟'), cleanupText)
check('the open Session is not listed', !cleanupText.includes('session-open'), cleanupText)
check('the fresh Session is not listed', !cleanupText.includes('session-blank-fresh'), cleanupText)
check('no copy key is missing', !cleanupText.includes('!'), cleanupText)
const cleanupConfirm = handlerFor(cleanupTree, /删除 1 个/)
check('the confirm button carries the count', cleanupConfirm !== undefined, JSON.stringify(inspect(cleanupTree).handlers.map((entry) => entry.label)))
await cleanupConfirm.handler()
await flush()
check('cleanup removes exactly the eligible Session', requests.length === 1 && requests[0].body.includes('session-blank-old'), JSON.stringify(requests.map((entry) => entry.body)))
check('cleanup refreshes the list once when it settles', refreshCalls === 1, String(refreshCalls))
const settled = renderRoot(cleanupDialog.Component, {
  t,
  useSessions: (selector) => selector(list),
  refreshSessions: async () => {
    refreshCalls++
  }
})
check('the settled dialog reports the outcome', inspect(settled).text.join(' ').includes('已删除 1 个空会话'), inspect(settled).text.join(' '))

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
  await handlerFor(tree, /^永久删除$/).handler()
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
  resetRoot(cleanupDialog.Component)
  const two = {
    ids: ['blank-one', 'blank-two'],
    byId: {
      'blank-one': summary('blank-one', { cwd: 'C:\\work\\one' }),
      'blank-two': summary('blank-two', { cwd: 'C:\\work\\two' })
    },
    current: undefined
  }
  const seen = []
  respond = (body) => {
    seen.push(body.sessionId)
    if (body.sessionId === 'blank-two') {
      return { ok: false, status: 404, body: { ok: false, error: { code: 'session-not-found', message: 'no stored session log' } } }
    }
    return { ok: true, status: 200, body: { ok: true, value: { sessionId: body.sessionId, directory: 'x', files: [], cacheRemoved: true } } }
  }
  requests.length = 0
  let refreshesAfterCleanup = 0
  openCleanup.handler()
  const props = {
    t,
    useSessions: (selector) => selector(two),
    refreshSessions: async () => {
      refreshesAfterCleanup++
    }
  }
  const tree = renderRoot(cleanupDialog.Component, props)
  check('both blank Sessions are planned', inspect(tree).text.join(' ').includes('有 2 个从未使用过的空会话'), inspect(tree).text.join(' '))
  await handlerFor(tree, /删除 2 个/).handler()
  await flush()
  check('every planned Session is attempted, one at a time', seen.join(',') === 'blank-one,blank-two', seen.join(','))
  const settledText = inspect(renderRoot(cleanupDialog.Component, props)).text.join(' ')
  check('the summary separates deleted from failed', settledText.includes('已删除 1') && settledText.includes('1 个失败'), settledText)
  check('the summary carries the failure reason', settledText.includes('no stored session log'), settledText)
  check('the list is refreshed once even on partial failure', refreshesAfterCleanup === 1, String(refreshesAfterCleanup))
}

console.log('')
console.log('a cleanup target that became live')
{
  resetRoot(cleanupDialog.Component)
  respond = () => ({
    ok: false,
    status: 409,
    body: { ok: false, error: { code: 'session-live', message: 'session is live in this process' } }
  })
  requests.length = 0
  openCleanup.handler()
  const props = { t, useSessions: (selector) => selector(list), refreshSessions: async () => {} }
  const tree = renderRoot(cleanupDialog.Component, props)
  await handlerFor(tree, /删除 1 个/).handler()
  await flush()
  const settledText = inspect(renderRoot(cleanupDialog.Component, props)).text.join(' ')
  check('an in-use Session is reported as skipped, not failed', settledText.includes('正在使用，已跳过'), settledText)
  check('it is not reported as an error', !settledText.includes('1 个失败'), settledText)
}

console.log('')
console.log(`${checks - failures.length}/${checks} checks passed`)
process.exit(failures.length === 0 ? 0 : 1)
