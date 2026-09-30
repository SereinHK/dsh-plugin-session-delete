/**
 * The `shell.overlay` entry for one conversation's removal: nothing while no
 * delete is pending, otherwise one modal. The Modal portals to `document.body`,
 * so the overlay slot only supplies the mount point.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/DeleteSessionDialog
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './contract'
import { usePendingRequest, settleRequest, type DeleteRequest } from './pending'
import { deleteSession, describeFailure } from './host'

/** The slot gives the entry its locale seat and the refresh hop. */
export interface DeleteSessionDialogProps {
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
  /** Re-pull the Host-authoritative Session list after a removal. */
  readonly refreshSessions: (sessionId: string) => Promise<void>
}

/**
 * Render the pending confirmation, if any.
 * @param props - the locale seat and the refresh hop.
 * @returns the open dialog, or null.
 */
export function DeleteSessionDialog(props: DeleteSessionDialogProps): React.ReactElement | null {
  const request = usePendingRequest()
  if (request === null || request.kind !== 'delete') return null
  return React.createElement(DeleteSessionForm, {
    key: request.sessionId,
    request,
    t: props.t,
    refreshSessions: props.refreshSessions
  })
}

/** One request's dialog: in-flight and error state die with it. */
interface DeleteSessionFormProps {
  readonly request: DeleteRequest
  readonly t: Translate
  readonly refreshSessions: (sessionId: string) => Promise<void>
}

/**
 * Render one removal confirmation.
 * @param props - the request, the locale seat, and the refresh hop.
 * @returns the confirmation modal.
 */
function DeleteSessionForm(props: DeleteSessionFormProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)

  const close = (): void => {
    if (!busy) settleRequest()
  }
  const confirm = (): void => {
    setBusy(true)
    setFailure(null)
    deleteSession(props.request.sessionId).then(() => {
      setBusy(false)
      settleRequest()
      return props.refreshSessions(props.request.sessionId)
    }).catch((reason: unknown) => {
      setBusy(false)
      setFailure(describeFailure(reason, props.t))
    })
  }

  return React.createElement(primitives.Modal, {
    open: true,
    onClose: close,
    closeLabel: props.t('close'),
    title: props.t('dialog.title'),
    description: props.t('dialog.desc', { title: props.request.displayTitle || props.t('untitled') }),
    footer: React.createElement(React.Fragment, null, React.createElement(primitives.Button, {
      variant: 'outline',
      disabled: busy,
      onClick: close,
      children: props.t('cancel')
    }), React.createElement(primitives.Button, {
      variant: 'primary',
      disabled: busy,
      onClick: confirm,
      children: busy ? props.t('deleting') : props.t('confirm')
    })),
    children: [
      React.createElement('p', { key: 'detail', children: props.t('dialog.detail') }),
      failure !== null && React.createElement('p', { key: 'failure', role: 'alert', children: failure })
    ]
  })
}
