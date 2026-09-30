/**
 * The Session row's "..." menu row: order 900, after the shipped
 * pin/rename/fork/archive rows, marked as a destructive action.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/DeleteSessionMenuItem
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate, UseMenuOpenState } from './contract'
import { requestDelete } from './pending'

/** Owner share plus the slot's menu hook and this package's locale seat. */
export interface DeleteSessionMenuItemProps {
  /** Session the row shows. */
  readonly sessionId: string
  /** Row display title, empty when the Session has none. */
  readonly displayTitle: string
  /** The menu's open state, injected by the slot owner. */
  readonly useMenuOpenState: UseMenuOpenState
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
}

/**
 * Render the delete row.
 * @param props - the row's owner share, menu hook, and locale seat.
 * @returns the danger menu row that opens the confirmation.
 */
export function DeleteSessionMenuItem(props: DeleteSessionMenuItemProps): React.ReactElement {
  const [, setMenuOpen] = props.useMenuOpenState()
  return React.createElement(primitives.MenuItemButton, {
    danger: true,
    separatorBefore: true,
    icon: React.createElement(primitives.IconTrashOutlineRegular, { size: 14 }),
    onSelect: () => {
      setMenuOpen(false)
      requestDelete(props.sessionId, props.displayTitle)
    },
    children: props.t('menu.delete')
  })
}
