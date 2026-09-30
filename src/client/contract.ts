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

/**
 * The durable list metadata the Host projects from a Session's log
 * (`sessionListMetadata`, projected from the stored events).
 */
export interface SessionListMetadataLike {
  /** True while the log holds no accepted prompt. */
  readonly blank?: boolean | undefined
  /** Timestamp of the last accepted prompt; null while there has never been one. */
  readonly lastPromptAt?: number | null | undefined
}

/**
 * One Session row as the client list store holds it (mirrors the entries
 * `projectList()` builds from the Session controller's list snapshot).
 */
export interface SessionSummaryLike {
  readonly id: string
  /**
   * The live first-turn flag. It describes a *resident* Session, so for a Session
   * loaded from disk it is not proof of anything — the durable
   * `projectionValues.sessionListMetadata` is. Nothing destructive may rest on
   * this field alone.
   */
  readonly blank?: boolean | undefined
  readonly running?: boolean | undefined
  /** Durable activity timestamp, already reconciled with `lastPromptAt` by the store. */
  readonly updatedAt?: number | undefined
  readonly cwd?: string | undefined
  /** Projection rows the store carries alongside the row, keyed by projection name. */
  readonly projectionValues?: {
    readonly sessionListMetadata?: SessionListMetadataLike | undefined
  } | undefined
}

/**
 * The client Session-list snapshot (mirrors `SessionListState`).
 *
 * `current` is not part of the shipped state — the open Session lives in the UI,
 * not in this store — so it is read only as a forward-compatible secondary guard.
 * The primary guard is the Host's own refusal of a Session that is in use.
 */
export interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummaryLike | undefined>>
  readonly current?: string | undefined
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
