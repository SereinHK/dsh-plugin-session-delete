/**
 * The sidebar-foot action that opens blank-Session cleanup: an icon-only
 * control in the rail, icon plus label when the column is wide.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/CleanupButton
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './contract'
import { requestCleanup } from './pending'

/** Owner share of a sidebar-foot action plus this package's locale seat. */
export interface CleanupButtonProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  readonly wide: boolean
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
}

/**
 * Render the cleanup trigger.
 * @param props - the column state and the locale seat.
 * @returns the action button.
 */
export function CleanupButton(props: CleanupButtonProps): React.ReactElement {
  const label = props.t('cleanup.button')
  const icon = React.createElement(primitives.IconTrashOutlineRegular, { size: 16 })
  const onClick = (): void => {
    requestCleanup()
  }
  if (!props.wide) {
    return React.createElement(primitives.Button, {
      variant: 'icon',
      size: 'sm',
      icon,
      title: label,
      'aria-label': label,
      onClick
    })
  }
  return React.createElement(primitives.Button, {
    variant: 'ghost',
    size: 'sm',
    icon,
    onClick,
    children: label
  })
}
