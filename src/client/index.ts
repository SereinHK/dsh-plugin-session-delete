/**
 * Delete-conversation surface, browser half.
 *
 * Additive contributions and no takeover:
 *
 * - `sidebar.workspaces.session.menu.item` — the red "delete conversation" row
 *   in one Session's "..." menu.
 * - `sidebar.footer.action` — the blank-Session cleanup trigger beside Settings, and
 *   the trash beside it.
 * - `shell.overlay` — the confirmations and the trash listing those entries open.
 *
 * A removal is a MOVE into the trash, so it can be taken back; `POST /api/session.delete`
 * does the move and the trash routes list, restore and destroy. Every skip decision is
 * made by `cleanup-plan.ts`. `apply` is also the only place holding the sessions
 * service, so it hands the dialogs their refresh hop.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client
 */
import type { ClientContext } from './contract'
import { LOCALE_NAMESPACE, en, zh } from './locales'
import { DeleteSessionMenuItem } from './DeleteSessionMenuItem'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { CleanupButton } from './CleanupButton'
import { CleanupDialog } from './CleanupDialog'
import { TrashButton } from './TrashButton'
import { TrashDialog } from './TrashDialog'

/** Required services: the slot registry, the Session list store, and copy. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Re-pull the Host-authoritative Session list after a removal.
 *
 * The Host also emits `api-session/removed`, which drops the row without a round
 * trip; this pull repairs the whole baseline (activity order, the archive set,
 * the New Session draft) whatever that row was. A failed refresh is not a failed
 * deletion, so it settles silently.
 *
 * @param ctx - the browser root context.
 * @returns the refresh hop the dialogs call.
 */
function sessionRefresh(ctx: ClientContext): (sessionId?: string) => Promise<void> {
  return async () => {
    try {
      await ctx.sessions.refresh()
    } catch {
      // The list repaints on the next Host frame anyway.
    }
  }
}

/**
 * Register this package's slot entries for the plugin's lifetime.
 * @param ctx - the browser root context.
 */
export function apply(ctx: ClientContext): void {
  const refreshSessions = sessionRefresh(ctx)

  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'ui-session-delete: dictionaries')

  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: 'session-delete',
    order: 900,
    locale: LOCALE_NAMESPACE
  }, DeleteSessionMenuItem))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'session-cleanup',
    order: 500,
    locale: LOCALE_NAMESPACE
  }, CleanupButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-delete-dialog',
    locale: LOCALE_NAMESPACE,
    inject: () => ({ refreshSessions })
  }, DeleteSessionDialog))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-cleanup-dialog',
    locale: LOCALE_NAMESPACE,
    inject: () => ({ refreshSessions: () => refreshSessions() })
  }, CleanupDialog))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'session-trash',
    order: 510,
    locale: LOCALE_NAMESPACE
  }, TrashButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-trash-dialog',
    locale: LOCALE_NAMESPACE
  }, TrashDialog))
}
