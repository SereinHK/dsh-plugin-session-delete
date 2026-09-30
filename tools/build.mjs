#!/usr/bin/env node
/**
 * Build `lib/` for packages/client/ui-session-delete from its `src/`.
 *
 * Upstream builds every dual-face package with `tsdown` (`pnpm run bundle`).
 * This checkout has no toolchain, so this script produces the same two
 * artifacts with Node alone:
 *
 *   lib/index.js   — the node half: `src/index.ts` with its types stripped.
 *   lib/client.js  — the browser half: the `window.__ModuleLoader__.load({id,
 *                    factory})` bundle the host serves verbatim, assembled from
 *                    the `src/client/*.ts` module graph.
 *
 * Two deliberate constraints keep it honest:
 *
 *  1. **A declared subset.** The client sources may use `import * as X from
 *     '<seed>'`, `import { a } from '<seed>'`, `import type ...`, relative
 *     `import { a } from './mod'`, and `export function|const|interface|type`.
 *     Anything else fails the build loudly instead of emitting a broken bundle.
 *  2. **The platform seed table is the only external source.** A `require()`
 *     for anything else would make the browser row fail to activate, which
 *     takes the whole page's boot down with it — so it is a build error here,
 *     not a runtime surprise.
 *
 * Types are erased with Node's own `module.stripTypeScriptTypes`, so the
 * scripts stay dependency-free.
 *
 * Usage: node tools/build.mjs [--check]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The repository root IS the package: a git-installable bundle resolves its
// manifest there, and the module id the browser registers must equal the
// installed package name, so both come from one place.
const packageDir = repoRoot
const packageName = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).name
const clientEntry = join(packageDir, 'src', 'client', 'index.ts')
const check = process.argv.includes('--check')

/** Module specifiers the browser shell always answers (the platform seed table). */
const SEED_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit'
])

/** Import forms the client subset admits. */
const IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?$/gm
const IMPORT_NAMESPACE = /^import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*'([^']+)'\s*;?$/gm
const IMPORT_TYPE = /^import\s+type\s*\{[^}]*\}\s*from\s*'[^']+'\s*;?$/gm
/** Value exports the concatenated factory scope can carry. */
const EXPORT_VALUE = /^export\s+(?:async\s+)?(function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm

/** Read one source file, failing with the path in the message. */
function readSource(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${relative(repoRoot, path)}: ${error.message}`)
  }
}

/** Erase types through Node's own stripper. No `sourceUrl`: the bundle carries
 * its own `//#region` markers, and a per-module debug trailer would land in the
 * middle of the concatenated factory. */
function stripTypes(source, path) {
  try {
    return stripTypeScriptTypes(source, { mode: 'strip' })
  } catch (error) {
    throw new Error(`type stripping failed for ${relative(repoRoot, path)}: ${error.message}`)
  }
}

/**
 * Collect one module's value imports and its export names.
 * @param source - the raw TypeScript module.
 * @param path - its absolute path, for diagnostics.
 * @returns the module's edges and exported value names.
 */
function analyse(source, path) {
  const where = relative(repoRoot, path)
  const namespaces = [...source.matchAll(IMPORT_NAMESPACE)].map((match) => ({ local: match[1], from: match[2] }))
  const named = [...source.matchAll(IMPORT_NAMED)]
    // `import type { X } from ...` is written with the keyword, so it never lands here.
    .map((match) => ({ names: match[1].split(',').map((part) => part.trim()).filter(Boolean), from: match[2] }))
  const exports = [...source.matchAll(EXPORT_VALUE)].map((match) => match[2])

  for (const edge of [...namespaces, ...named]) {
    if (edge.from.startsWith('.')) continue
    if (!SEED_MODULES.has(edge.from)) {
      throw new Error(`${where}: import '${edge.from}' is neither a relative module nor a platform seed module — a require() the browser cannot answer takes the whole page's boot down`)
    }
    if (edge.names !== undefined && edge.names.some((name) => name.startsWith('type '))) {
      throw new Error(`${where}: an inline 'type' specifier in a seed import is outside the supported subset; import the seed as a namespace instead`)
    }
  }
  return { namespaces, named, exports }
}

/** Resolve one relative import to its file. */
function resolveRelative(fromPath, specifier) {
  const target = resolve(dirname(fromPath), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`)
  readSource(target)
  return target
}

/**
 * Walk the client module graph from the entry, dependencies first.
 * @param entry - the entry module.
 * @returns ordered module records.
 */
function collectModules(entry) {
  const order = []
  const seen = new Set()
  const visit = (path) => {
    if (seen.has(path)) return
    seen.add(path)
    const source = readSource(path)
    const analysis = analyse(source, path)
    for (const edge of [...analysis.namespaces, ...analysis.named]) {
      if (!edge.from.startsWith('.')) continue
      visit(resolveRelative(path, edge.from))
    }
    order.push({ path, source, analysis })
  }
  visit(entry)
  return order
}

/** The seed modules a module graph actually needs, in first-use order. */
function seedBindings(modules) {
  const locals = new Map()
  for (const module of modules) {
    for (const edge of module.analysis.namespaces) {
      const existing = locals.get(edge.from)
      if (existing !== undefined && existing !== edge.local) {
        throw new Error(`${relative(repoRoot, module.path)}: seed '${edge.from}' is bound twice as '${existing}' and '${edge.local}'`)
      }
      locals.set(edge.from, edge.local)
    }
    for (const edge of module.analysis.named) {
      if (edge.from.startsWith('.')) continue
      if (!locals.has(edge.from)) {
        throw new Error(`${relative(repoRoot, module.path)}: seed '${edge.from}' must be imported as a namespace (import * as X from '...') so the factory can hoist it`)
      }
    }
  }
  return locals
}

/** Rewrite one module into factory-scope source: no imports, no `export` keyword. */
function toFactorySource(module) {
  const body = module.source
    .replace(IMPORT_TYPE, '')
    .replace(IMPORT_NAMESPACE, '')
    .replace(IMPORT_NAMED, '')
    // Keep every modifier (`async`, `*`): only the keyword goes.
    .replace(EXPORT_VALUE, (match) => match.replace(/^export\s+/, ''))
  return stripTypes(body, module.path).trim()
}

/**
 * Compose `lib/client.js`: the exact registration script the host serves.
 * @returns the bundle source.
 */
function buildClientBundle() {
  const modules = collectModules(clientEntry)
  const seeds = seedBindings(modules)
  const declared = new Map()
  for (const module of modules) {
    for (const name of module.analysis.exports) {
      const previous = declared.get(name)
      if (previous !== undefined) {
        throw new Error(`top-level name '${name}' is declared by both ${relative(repoRoot, previous)} and ${relative(repoRoot, module.path)}; the factory scope is flat`)
      }
      declared.set(name, module.path)
    }
  }

  const entry = modules[modules.length - 1]
  if (entry.path !== clientEntry) throw new Error('the entry module must be last in the ordered graph')

  const lines = ['window.__ModuleLoader__.load({', `\tid: ${JSON.stringify(packageName)},`, '\tfactory: (require) => {', '\t\tvar module = { exports: {} };', '\t\tvar exports = module.exports;', '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });']
  for (const [specifier, local] of seeds) lines.push(`\t\tlet ${local} = require(${JSON.stringify(specifier)});`)
  for (const module of modules) {
    lines.push(`\t\t//#region ${posix.join('src/client', relative(join(packageDir, 'src', 'client'), module.path))}`)
    lines.push(toFactorySource(module).split('\n').map((line) => (line.length === 0 ? line : `\t\t${line}`)).join('\n'))
    lines.push('\t\t//#endregion')
  }
  for (const name of entry.analysis.exports) lines.push(`\t\texports.${name} = ${name};`)
  lines.push('\t\treturn module.exports;', '\t}', '});', '')
  return lines.join('\n')
}

/** Compose `lib/index.js` from the node-half source. */
function buildHostHalf() {
  const source = readSource(join(packageDir, 'src', 'index.ts'))
  return `${stripTypes(source, join(packageDir, 'src', 'index.ts')).trim()}\n`
}

const artifacts = [
  ['lib/index.js', buildHostHalf()],
  ['lib/client.js', buildClientBundle()],
  ['lib/types/index.d.ts', buildHostTypes()],
  ['lib/types/client/index.d.ts', buildClientTypes()]
]

if (check) {
  const stale = artifacts.filter(([name, content]) => {
    try {
      return readFileSync(join(packageDir, name), 'utf8') !== content
    } catch {
      return true
    }
  })
  if (stale.length > 0) {
    console.error(`lib/ is stale: ${stale.map(([name]) => name).join(', ')} — run node tools/build.mjs`)
    process.exit(1)
  }
  console.log(`lib/ is current (${artifacts.length} artifacts)`)
  process.exit(0)
}

for (const [name, content] of artifacts) {
  const target = join(packageDir, name)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
  console.log(`${name}  ${Buffer.byteLength(content)} bytes`)
}

await selfCheck()

/**
 * Prove the artifacts are what the host will actually run: the browser half must
 * parse as the classic script the module loader evaluates, and the node half must
 * import and export the plugin surface. A build that emits broken bytes is worse
 * than no build, because the failure would otherwise surface as a dead page.
 */
async function selfCheck() {
  const vm = await import('node:vm')
  try {
    new vm.Script(readFileSync(join(packageDir, 'lib', 'client.js'), 'utf8'), { filename: 'lib/client.js' })
  } catch (error) {
    throw new Error(`lib/client.js does not parse: ${error.message}`)
  }
  const host = await import(`${pathToFileURL(join(packageDir, 'lib', 'index.js')).href}?built=${String(Date.now())}`)
  for (const name of ['apply', 'inject', 'SESSION_DELETE_PATH', 'encodeSegment', 'projectKey']) {
    if (host[name] === undefined) throw new Error(`lib/index.js does not export ${name}`)
  }
  console.log(`self-check ok: client bundle parses, host half exports ${Object.keys(host).sort().join(', ')}`)
}

/** The node half's declaration file (upstream's build emits this from source). */
function buildHostTypes() {
  return `/**
 * Delete-conversation plugin, node half.
 * @module ${packageName}
 */
export declare const SESSION_DELETE_PATH = "/api/session.delete";
/** Required Host services. */
export declare const inject: readonly ["connection", "sessionPersistence", "sessions"];
/** Register the authenticated delete route for this plugin's lifetime. */
export declare function apply(ctx: unknown): void;
/** Encode one path segment exactly as the JSONL persistence backend does. */
export declare function encodeSegment(raw: string): string;
/** Build the project directory key for one cwd exactly as the backend does. */
export declare function projectKey(cwd: string): string;
`
}

/** The browser half's declaration file. */
function buildClientTypes() {
  return `/**
 * Delete-conversation surface, browser half.
 * @module ${packageName}/client
 */
export declare const inject: readonly ["slots", "sessions", "locale"];
/** Register this package's slot entries for the plugin's lifetime. */
export declare function apply(ctx: unknown): void;
`
}
