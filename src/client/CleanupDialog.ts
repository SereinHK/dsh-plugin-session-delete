/**
 * The `shell.overlay` entry for blank-Session cleanup: one modal that lists what
 * will go, runs the removals one at a time, and reports the outcome.
 *
 * The plan is computed from the client list snapshot (see `cleanup-plan.ts`), and
 * each removal is the same authenticated Host call the row menu uses, so cleanup
 * needs no Host surface of its own.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/CleanupDialog
 */
import * as React from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListLike, Translate } from './contract'
import { usePendingRequest, settleRequest, type CleanupRequest } from './pending'
import { describeCleanupFailure, deleteSession, type SessionDeleteFailure } from './host'
import { CLEANUP_LIST_LIMIT, describeAge, graceMinutes, planBlankCleanup, type CleanupPlan } from './cleanup-plan'

/** Selector hook handed to root-scoped slot entries by the renderer. */
export type UseSessions = <T>(selector: (list: SessionListLike) => T) => T

/** The slot gives the entry its locale seat, the list hook, and the refresh hop. */
export interface CleanupDialogProps {
  /** Locale seat for the `sessionDelete` namespace. */
  readonly t: Translate
  /** The client list snapshot hook. */
  readonly useSessions: UseSessions
  /** Re-pull the Host-authoritative Session list after the run. */
  readonly refreshSessions: () => Promise<void>
}

/** What the dialog is doing right now. */
interface RunState {
  readonly phase: 'confirm' | 'running' | 'done'
  readonly attempted: number
  readonly removed: number
  readonly failed: number
  readonly inUse: number
  readonly firstFailure: string | null
}

const INITIAL_RUN: RunState = {
  phase: 'confirm',
  attempted: 0,
  removed: 0,
  failed: 0,
  inUse: 0,
  firstFailure: null
}

/**
 * Render the pending cleanup, if any.
 * @param props - the locale seat, the list hook, and the refresh hop.
 * @returns the open dialog, or null.
 */
export function CleanupDialog(props: CleanupDialogProps): React.ReactElement | null {
  const request = usePendingRequest()
  if (request === null || request.kind !== 'cleanup') return null
  // One clock per opening: the grace window and every age read the same instant,
  // so the list cannot drift while the operator reads it.
  return React.createElement(CleanupForm, {
    key: 'cleanup',
    t: props.t,
    useSessions: props.useSessions,
    refreshSessions: props.refreshSessions,
    request
  })
}

/**
 * Render one cleanup confirmation and its run.
 * @param props - the locale seat, the list hook, the refresh hop, and the request.
 * @returns the cleanup modal.
 */
function CleanupForm(props: CleanupDialogProps & { readonly request: CleanupRequest }): React.ReactElement {
  const snapshot = props.useSessions((list) => list)
  const [openedAt] = React.useState(() => Date.now())
  const [run, setRun] = React.useState<RunState>(INITIAL_RUN)
  const plan = React.useMemo(
    () => planBlankCleanup({ facts: props.request.rows ?? [], live: snapshot }, openedAt),
    [props.request.rows, snapshot, openedAt]
  )

  const running = run.phase === 'running'
  const close = (): void => {
    if (!running) settleRequest()
  }

  const confirm = (): void => {
    const targets = plan.targets
    setRun({ ...INITIAL_RUN, phase: 'running' })
    void runCleanup(targets, (patch) => {
      setRun((previous) => ({ ...previous, ...patch }))
    }).then(async (settled) => {
      setRun({ ...settled, phase: 'done' })
      await props.refreshSessions()
    })
  }

  // The durable facts are a Host round-trip, so the dialog has three states before
  // its run: loading, a load failure, and the plan itself.
  const loading = props.request.loading
  const loadError = props.request.loadError

  return React.createElement(primitives.Modal, {
    open: true,
    onClose: close,
    closeLabel: props.t('close'),
    title: props.t('cleanup.title'),
    description: loadError !== undefined
      ? describeCleanupFailure(loadError, props.t)
      : loading
        ? props.t('cleanup.loading')
        : describeRun(plan, run, props.t),
    footer: React.createElement(React.Fragment, null, React.createElement(primitives.Button, {
      variant: 'outline',
      disabled: running,
      onClick: close,
      children: run.phase === 'done' ? props.t('close') : props.t('cancel')
    }), run.phase === 'confirm' && !loading && loadError === undefined && plan.targets.length > 0 && React.createElement(primitives.Button, {
      variant: 'primary',
      disabled: running,
      onClick: confirm,
      children: props.t('cleanup.confirm', { n: plan.targets.length })
    })),
    children: loadError !== undefined
      ? null
      : loading
        ? null
        : run.phase === 'confirm'
          ? renderPlan(plan, openedAt, props.t)
          : renderRun(run, plan.targets.length, props.t)
  })
}

/**
 * Remove the planned Sessions one at a time, reporting progress after each.
 * Sequential on purpose: every removal is a filesystem operation on the Host,
 * and a burst of parallel requests buys nothing but interleaved failures.
 *
 * @param targets - the planned Sessions, oldest activity first.
 * @param report - progress sink.
 * @returns the settled counts, without a phase.
 */
async function runCleanup(
  targets: CleanupPlan['targets'],
  report: (patch: Partial<RunState>) => void
): Promise<RunState> {
  let attempted = 0
  let removed = 0
  let failed = 0
  let inUse = 0
  let firstFailure: string | null = null

  for (const target of targets) {
    try {
      await deleteSession(target.sessionId)
      removed++
    } catch (reason) {
      const code = (reason as SessionDeleteFailure).code
      if (code === 'session-live') inUse++
      else {
        failed++
        firstFailure ??= reason instanceof Error ? reason.message : String(reason)
      }
    }
    attempted++
    report({ attempted, removed, failed, inUse, firstFailure })
  }

  return { ...INITIAL_RUN, attempted, removed, failed, inUse, firstFailure }
}

/**
 * Word the modal's description for the current phase.
 * @param plan - the computed plan.
 * @param run - the current run state.
 * @param t - the locale seat.
 * @returns the description line.
 */
function describeRun(plan: CleanupPlan, run: RunState, t: Translate): string {
  if (run.phase === 'confirm') {
    if (plan.targets.length === 0) {
      // "Nothing to clean" is worth qualifying when the reason is that blankness
      // could not be proven yet — otherwise the operator reads it as "there is
      // nothing there", which is what a projection-less snapshot looks like.
      const none = t('cleanup.none')
      return plan.unprovenSkipped > 0
        ? `${none}\n${t('cleanup.unproven', { n: plan.unprovenSkipped })}`
        : none
    }
    return t('cleanup.desc', { n: plan.targets.length })
  }
  if (run.phase === 'running') return t('cleanup.running', { done: run.attempted, total: plan.targets.length })
  if (run.failed > 0) {
    return t('cleanup.partial', {
      done: run.removed,
      failed: run.failed,
      reason: run.firstFailure ?? ''
    })
  }
  const done = t('cleanup.done', { done: run.removed })
  return run.inUse > 0 ? `${done}\n${t('cleanup.skipped', { n: run.inUse })}` : done
}

/**
 * Render the pre-confirmation body: the skip rules and the rows that will go.
 * @param plan - the computed plan.
 * @param openedAt - the instant the dialog opened.
 * @param t - the locale seat.
 * @returns the body nodes.
 */
function renderPlan(plan: CleanupPlan, openedAt: number, t: Translate): React.ReactNode {
  const shown = plan.targets.slice(0, CLEANUP_LIST_LIMIT)
  const hidden = plan.targets.length - shown.length
  return [
    React.createElement('p', { key: 'detail', children: t('cleanup.detail', { minutes: graceMinutes() }) }),
    shown.length > 0 && React.createElement('div', {
      key: 'rows',
      style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto' }
    }, shown.map((target) => React.createElement('div', {
      key: target.sessionId,
      style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '13px' }
    }, [
      // The title is what the operator recognises the conversation by; the path is
      // the fallback for one that never got a title. The size says what the run is
      // actually reclaiming.
      React.createElement('span', {
        key: 'name',
        style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        title: target.cwd,
        children: target.title ?? target.cwd ?? target.sessionId
      }),
      React.createElement('span', {
        key: 'meta',
        style: { whiteSpace: 'nowrap', opacity: 0.75 },
        children: [formatBytes(target.bytes), describeAge(target.updatedAt, openedAt, t)].filter(Boolean).join(' · ')
      })
    ]))),
    hidden > 0 && React.createElement('p', { key: 'more', children: t('cleanup.more', { n: hidden }) })
  ]
}

/**
 * Word a byte count for the operator, or nothing when it is unknown.
 *
 * Decimal units, one fraction digit: this exists to answer "roughly how much am I
 * reclaiming", and a fake precision would mislead.
 *
 * @param bytes - the measured size, when the Host could measure it.
 * @returns display text such as `12.4 MB`, or an empty string.
 */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1000) return `${String(Math.round(bytes))} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? 'TB'}`
}

/**
 * Render the running or finished body: the outcome already reads in the
 * description, so only an in-flight run adds a live progress line here.
 * @param run - the current run state.
 * @param total - how many removals the run plans.
 * @param t - the locale seat.
 * @returns the body nodes, or an empty list when there is nothing to add.
 */
function renderRun(run: RunState, total: number, t: Translate): React.ReactNode {
  if (run.phase !== 'running') return []
  return [
    React.createElement('p', {
      key: 'progress',
      role: 'status',
      children: t('cleanup.running', { done: run.attempted, total })
    })
  ]
}
