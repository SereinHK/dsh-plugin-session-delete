/**
 * The sidebar-foot action that opens the trash: an icon-only control in the rail,
 * icon plus label (and a count when there is something in there) when the column is
 * wide.
 *
 * The count matters more than it looks: a restore window is only useful if the
 * operator remembers there is something to restore.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/TrashButton
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './contract'
import { requestTrash } from './pending'

/** Owner share of a sidebar-foot action plus this package's locale seat. */
export interface TrashButtonProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  readonly wide: boolean
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
}

/**
 * Render the trash trigger.
 * @param props - the column state and the locale seat.
 * @returns the action button.
 */
export function TrashButton(props: TrashButtonProps): React.ReactElement {
  const label = props.t('trash.button')
  // A clock, not a bin: what this opens is a place things can come back from.
  // (Checked against the primitives' own icon list rather than guessed: a name that
  // does not exist would take the whole page's plugin boot down with it.)
  const icon = React.createElement(primitives.IconClockOutlineRegular, { size: 16 })
  const onClick = (): void => {
    requestTrash()
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
