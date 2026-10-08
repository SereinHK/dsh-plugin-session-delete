/**
 * The trash surface: what this plugin moved out of the Session list, with the two
 * actions that decide its fate — put it back, or destroy it now.
 *
 * It reads the Host on open (which also expires whatever has aged out), so what it
 * shows is exactly what is still restorable. Rows carry the title and size the Host
 * recorded when the Session was moved, and each action refreshes the listing rather
 * than patching it locally: the Host is the one that knows.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/TrashDialog
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './contract'
import { formatBytes } from './format'
import { purgeTrash, restoreSession, describeTrashFailure, type TrashEntry } from './host'
import { refreshTrash, settleRequest, usePendingRequest, type TrashRequest } from './pending'

/** Owner share of the trash overlay plus this package's locale seat. */
export interface TrashDialogProps {
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
}

/** What the dialog is doing right now. */
interface TrashRunState {
  readonly phase: 'idle' | 'working' | 'done'
  /** Whether the last action worked, and what it was, for the note underneath. */
  readonly note: string | null
  readonly failed: boolean
  /** Which row is mid-action, so its buttons can be disabled. */
  readonly busyId: string | null
  /** True while everything is being destroyed. */
  readonly busyAll: boolean
  /** True while the "empty the trash" question is on screen. */
  readonly askingAll: boolean
  /** Which row's "for good" question is on screen. */
  readonly askingId: string | null
}

const TRASH_INITIAL_RUN: TrashRunState = {
  phase: 'idle',
  note: null,
  failed: false,
  busyId: null,
  busyAll: false,
  askingAll: false,
  askingId: null
}

/**
 * The colour of the actions here that cannot be undone.
 *
 * `Button` has no danger variant — only `primary`, `ghost`, `outline` and `toolbar` — but
 * the theme's destructive colour is a published token (it is what the menu row's `danger`
 * uses), so the red comes from the same place the rest of the UI takes it rather than from
 * a literal. It stays red text on the outline, before and during the confirmation: what
 * changes at that step is the label and the warning above it, not a slab of colour.
 */
const DESTRUCTIVE_TEXT = { color: 'var(--dsw-alias-state-error-primary)' }

/**
 * Render the pending trash, if any.
 * @param props - the locale seat.
 * @returns the open dialog, or null.
 */
export function TrashDialog(props: TrashDialogProps): React.ReactElement | null {
  const request = usePendingRequest()
  if (request === null || request.kind !== 'trash') return null
  return React.createElement(TrashForm, { key: 'trash', t: props.t, request })
}

/**
 * Render one trash listing and its actions.
 * @param props - the locale seat and the request it belongs to.
 * @returns the trash modal.
 */
function TrashForm(props: TrashDialogProps & { readonly request: TrashRequest }): React.ReactElement {
  const [run, setRun] = React.useState<TrashRunState>(TRASH_INITIAL_RUN)
  const entries = props.request.entries ?? []
  const loading = props.request.loading
  const loadError = props.request.loadError
  const working = run.busyId !== null || run.busyAll

  const close = (): void => {
    if (!working) settleRequest()
  }

  /** Run one action, then re-read the listing the Host now has. */
  const act = (options: { readonly sessionId?: string; readonly all?: boolean; readonly label: string }): void => {
    setRun((previous) => ({
      ...previous,
      phase: 'working',
      note: null,
      failed: false,
      busyId: options.sessionId ?? null,
      busyAll: options.all === true,
      askingId: null,
      askingAll: false
    }))
    void purgeTrash(options).then(
      (result) => {
        setRun((previous) => ({
          ...previous,
          phase: 'done',
          note: options.all === true
            ? props.t('trash.purgeAllDone', { n: result.purged.length })
            : props.t('trash.purged'),
          failed: false,
          busyId: null,
          busyAll: false
        }))
        refreshTrash(props.request)
      },
      (error: unknown) => {
        setRun((previous) => ({
          ...previous,
          phase: 'done',
          note: describeTrashFailure(error, props.t),
          failed: true,
          busyId: null,
          busyAll: false
        }))
      }
    )
  }

  /** Put one Session back, then refresh. */
  const restore = (entry: TrashEntry): void => {
    setRun((previous) => ({ ...previous, phase: 'working', note: null, failed: false, busyId: entry.sessionId }))
    void restoreSession(entry.sessionId).then(
      () => {
        setRun((previous) => ({
          ...previous,
          phase: 'done',
          note: props.t('trash.restored', { title: entry.title ?? entry.cwd }),
          failed: false,
          busyId: null
        }))
        refreshTrash(props.request)
      },
      (error: unknown) => {
        setRun((previous) => ({
          ...previous,
          phase: 'done',
          note: describeTrashFailure(error, props.t),
          failed: true,
          busyId: null
        }))
      }
    )
  }

  const footer = React.createElement(React.Fragment, null, React.createElement(primitives.Button, {
    variant: 'outline',
    disabled: working,
    onClick: close,
    children: props.t('close')
  }), entries.length > 0 && run.askingAll
    ? React.createElement(primitives.Button, {
      variant: 'outline',
      style: DESTRUCTIVE_TEXT,
      disabled: working,
      onClick: () => { act({ all: true, label: props.t('trash.purgeAll') }) },
      children: props.t('trash.confirmAllButton')
    })
    : entries.length > 0 && React.createElement(primitives.Button, {
      variant: 'outline',
      style: DESTRUCTIVE_TEXT,
      disabled: working,
      onClick: () => { setRun((previous) => ({ ...previous, askingAll: true, askingId: null })) },
      children: props.t('trash.purgeAll')
    }))

  return React.createElement(primitives.Modal, {
    open: true,
    onClose: close,
    closeLabel: props.t('close'),
    title: props.t('trash.title'),
    description: loadError !== undefined
      ? describeTrashFailure(loadError, props.t)
      : loading && entries.length === 0
        ? props.t('trash.loading')
        : entries.length === 0
          ? props.t('trash.empty')
          : props.t('trash.desc', { n: entries.length, days: props.request.retentionDays ?? 7 }),
    footer,
    children: [
      // The warning is a line of red text, not a red button label: the operator reads
      // what is about to be destroyed before reaching for the control, and the control
      // itself stays a two-word label.
      run.askingAll && React.createElement('p', {
        key: 'asking-all',
        role: 'alert',
        style: { ...DESTRUCTIVE_TEXT, margin: 0 }
      }, props.t('trash.confirmAllAsk', { n: entries.length })),
      run.askingId !== null && React.createElement('p', {
        key: 'asking-one',
        role: 'alert',
        style: { ...DESTRUCTIVE_TEXT, margin: 0 }
      }, props.t('trash.confirmPurgeAsk', {
        title: entries.find((entry) => entry.sessionId === run.askingId)?.title
          ?? entries.find((entry) => entry.sessionId === run.askingId)?.cwd
          ?? run.askingId
      })),
      run.note !== null && React.createElement('p', {
        key: 'note',
        role: run.failed ? 'alert' : 'status',
        style: run.failed ? undefined : { opacity: 0.8 }
      }, run.note),
      loadError === undefined && entries.length > 0 && React.createElement('div', {
        key: 'rows',
        style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }
      }, entries.map((entry) => React.createElement(TrashRow, {
        key: entry.sessionId,
        entry,
        t: props.t,
        busy: run.busyId === entry.sessionId,
        disabled: working,
        asking: run.askingId === entry.sessionId,
        onAsk: () => { setRun((previous) => ({ ...previous, askingId: entry.sessionId, askingAll: false })) },
        onRestore: () => { restore(entry) },
        onPurge: () => { act({ sessionId: entry.sessionId, label: props.t('trash.purge') }) }
      })))
    ]
  })
}

/** One trashed Session: what it was, when it goes, and its two actions. */
function TrashRow(props: {
  readonly entry: TrashEntry
  readonly t: Translate
  readonly busy: boolean
  readonly disabled: boolean
  readonly asking: boolean
  readonly onAsk: () => void
  readonly onRestore: () => void
  readonly onPurge: () => void
}): React.ReactElement {
  const { entry, t } = props
  const days = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
  return React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', fontSize: '13px' }
  }, [
    React.createElement('div', {
      key: 'what',
      style: { display: 'flex', flexDirection: 'column', minWidth: 0 }
    }, [
      React.createElement('span', {
        key: 'title',
        style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        title: entry.cwd,
        children: entry.title ?? entry.cwd
      }),
      React.createElement('span', {
        key: 'meta',
        style: { opacity: 0.7, fontSize: '12px' },
        children: [formatBytes(entry.bytes), t('trash.expires', { days })].filter(Boolean).join(' · ')
      })
    ]),
    React.createElement('div', {
      key: 'actions',
      style: { display: 'flex', gap: '6px', whiteSpace: 'nowrap' }
    }, [
      React.createElement(primitives.Button, {
        key: 'restore',
        variant: 'outline',
        size: 'sm',
        disabled: props.disabled,
        onClick: props.onRestore,
        children: props.busy ? t('trash.working') : t('trash.restore')
      }),
      React.createElement(primitives.Button, {
        key: 'purge',
        variant: 'outline',
        // Red at both steps, and always the same red text on the outline: this button
        // only changes its label when it becomes the confirmation.
        style: DESTRUCTIVE_TEXT,
        size: 'sm',
        disabled: props.disabled,
        onClick: props.asking ? props.onPurge : props.onAsk,
        children: props.asking ? t('trash.confirmPurgeButton') : t('trash.purge')
      })
    ])
  ])
}

