/**
 * Structural contracts this package codes against.
 *
 * Every type here is declared locally and structurally on purpose: the plugin
 * then needs no type dependency on the renderer, the slot map, or the Session
 * controller, and cannot be broken by their internal moves. Each one names the
 * shipped declaration it mirrors, so a maintainer can swap in the real type —
 * `SlotMap['sidebar.workspaces.session.menu.item']`, `ISessions`, the locale
 * service face — without touching a call site.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/contract
 */

/** Copy lookup with interpolation, the shape of `ctx.locale.bind(ns)`. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** `UseMenuOpenState`, injected by the owner of the Session-row menu slot. */
export type UseMenuOpenState = () => readonly [boolean, (open: boolean) => void]

/** One Session summary as the client list store holds it (mirrors `SessionSummary`). */
export interface SessionSummaryLike {
  readonly sessionId: string
  /** True while this Session has never started a turn. */
  readonly blank: boolean
  /** True while its Agent is running. */
  readonly running: boolean
  /** Durable activity timestamp. */
  readonly updatedAt: number
  readonly cwd?: string | undefined
}

/** The client Session-list snapshot (mirrors `SessionListState`). */
export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly current: string | undefined
}

/** The slice of the client sessions service this package uses (mirrors `ISessions`). */
export interface SessionsLike {
  readonly list: { getSnapshot(): SessionListLike; subscribe(listener: () => void): () => void }
  refresh(): Promise<void>
}

/** The slice of the slot registry this package uses (mirrors `SlotRegistry`). */
export interface SlotsLike {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** The slice of the locale service this package uses. */
export interface LocaleLike {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
}

/** The slice of the browser root context this package uses. */
export interface ClientContext {
  readonly slots: SlotsLike
  readonly sessions: SessionsLike
  readonly locale: LocaleLike
  effect(callback: () => unknown, label?: string): unknown
}
