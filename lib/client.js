window.__ModuleLoader__.load({
	id: "dsh-plugin-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/locales.ts
		/**
		 * `sessionDelete` namespace dictionaries: the copy for the row menu, the
		 * per-conversation confirmation, and the blank-Session cleanup surface.
		 *
		 * The Simplified Chinese dictionary is the key-set authority; the English one
		 * is checked complete against it by `tests/locales.test.ts`.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/locales
		 */

		/** Locale namespace this package registers and binds. */
		const LOCALE_NAMESPACE = 'sessionDelete'

		/** Simplified Chinese dictionary. */
		const zh                         = {
		  'menu.delete': '删除对话',

		  'dialog.title': '删除这个对话？',
		  'dialog.desc': '“{title}”的完整对话记录将从本机永久删除，无法恢复。',
		  'dialog.detail': '删除的是这台机器上的会话日志（sessions 目录下该会话的整个目录）与它的投影缓存。已导出的文件、附件与工作区文件不受影响；归档记录里的这个会话编号会随之下线。',
		  'dialog.live': '该对话正被当前窗口打开，无法删除。请先切换到其他对话（或新建一个对话）后再试。',
		  'dialog.notFound': '没有找到这个对话的会话日志，可能已经被删除。',
		  'dialog.unsafe': '出于安全考虑拒绝了这次删除：目标路径不在会话根目录之内。',
		  'dialog.failed': '删除失败：{reason}',
		  'confirm': '永久删除',
		  'cancel': '取消',
		  'deleting': '删除中…',
		  'close': '关闭',
		  'untitled': '未命名对话',

		  'cleanup.button': '清理空会话',
		  'cleanup.title': '清理空会话',
		  'cleanup.desc': '有 {n} 个从未使用过的空会话，将一并删除。',
		  'cleanup.detail': '空会话是创建后从未开始过任何一轮对话的会话——它们会出现在侧边栏，但里面没有任何内容，只占磁盘。清理只删除这些空会话；正在使用（打开中或运行中），以及 {minutes} 分钟内还有活动的会话都会跳过。',
		  'cleanup.none': '没有可清理的空会话。',
		  'cleanup.loading': '正在向宿主确认哪些会话从未使用过…',
		  'cleanup.unproven': '另有 {n} 个会话宿主还没有投影记录（尚未投影），无法确认是否为空，本次跳过。',
		  'cleanup.more': '…另有 {n} 个',
		  'cleanup.confirm': '删除 {n} 个',
		  'cleanup.running': '正在清理 {done}/{total}…',
		  'cleanup.done': '已删除 {done} 个空会话。',
		  'cleanup.partial': '已删除 {done} 个，{failed} 个失败（{reason}）。',
		  'cleanup.skipped': '有 {n} 个会话正在使用，已跳过。',
		  'cleanup.failed': '清理失败：{reason}',

		  'age.justNow': '刚刚',
		  'age.minutes': '{n} 分钟前',
		  'age.hours': '{n} 小时前',
		  'age.days': '{n} 天前'
		}

		/** English dictionary, complete against {@link zh}. */
		const en                         = {
		  'menu.delete': 'Delete conversation',

		  'dialog.title': 'Delete this conversation?',
		  'dialog.desc': 'The complete transcript of “{title}” will be permanently removed from this machine. This cannot be undone.',
		  'dialog.detail': 'This deletes the session log on this machine (the whole session directory under the sessions root) and its projection cache. Exported files, attachments and workspace files are untouched; the id also drops out of the archive set.',
		  'dialog.live': 'This conversation is open in a window right now, so it cannot be deleted. Switch to another conversation (or start a new one) and try again.',
		  'dialog.notFound': 'No session log was found for this conversation — it may already be gone.',
		  'dialog.unsafe': 'The deletion was refused for safety: the target path is not inside the session root.',
		  'dialog.failed': 'Deletion failed: {reason}',
		  'confirm': 'Delete permanently',
		  'cancel': 'Cancel',
		  'deleting': 'Deleting…',
		  'close': 'Close',
		  'untitled': 'Untitled conversation',

		  'cleanup.button': 'Clean up empty conversations',
		  'cleanup.title': 'Clean up empty conversations',
		  'cleanup.desc': '{n} unused empty conversations will be deleted.',
		  'cleanup.detail': 'An empty conversation is one that never started a single turn: it is listed in the sidebar, but it holds nothing and only takes up disk. Only these are removed; anything in use (open or running) and anything active within the last {minutes} minutes is skipped.',
		  'cleanup.none': 'There are no empty conversations to clean up.',
		  'cleanup.loading': 'Asking the Host which conversations were never used…',
		  'cleanup.unproven': '{n} more have no projection on the Host yet, so they could not be confirmed as empty and were skipped.',
		  'cleanup.more': '…and {n} more',
		  'cleanup.confirm': 'Delete {n}',
		  'cleanup.running': 'Cleaning up {done}/{total}…',
		  'cleanup.done': 'Deleted {done} empty conversations.',
		  'cleanup.partial': 'Deleted {done}; {failed} failed ({reason}).',
		  'cleanup.skipped': '{n} conversations are in use and were skipped.',
		  'cleanup.failed': 'Cleanup failed: {reason}',

		  'age.justNow': 'just now',
		  'age.minutes': '{n} min ago',
		  'age.hours': '{n} h ago',
		  'age.days': '{n} d ago'
		}
		//#endregion
		//#region src/client/host.ts
		/**
		 * The browser half's Host calls: one authenticated `POST /api/session.delete` per
		 * conversation, one `POST /api/session.unused` for the durable per-Session facts,
		 * plus the wording for the failures the operator can act on.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/host
		 */

		/** The Host route this package's node half registers inside Connection's `/api` fence. */
		const DELETE_PATH = '/api/session.delete'

		/** The Host route reporting durable per-Session facts (blankness among them). */
		const UNUSED_PATH = '/api/session.unused'

		/** The Host's success report for one removal. */
		                               
		                            
		                            
		                                   
		                                
		 

		/** Durable facts about one stored Session, as the Host reports them. */
		                                   
		                            
		                      
		                                   
		                            
		                                                                                            
		                         
		                                                                                 
		                          
		                                      
		 

		/** A refusal carrying the Host's stable machine code. */
		                                                     
		                       
		 

		/** Host failure codes this package words for itself; anything else keeps the Host diagnostic. */
		const WORDED_FAILURES                                   = {
		  'session-live': 'dialog.live',
		  'session-not-found': 'dialog.notFound',
		  'unsafe-target': 'dialog.unsafe'
		}

		/**
		 * Ask the Host to remove one conversation.
		 * @param sessionId - the Session to delete.
		 * @returns the Host's report.
		 * @throws {SessionDeleteFailure} carrying the Host's code and message.
		 */
		async function deleteSession(sessionId        )                        {
		  const response = await fetch(DELETE_PATH, {
		    method: 'POST',
		    headers: { 'content-type': 'application/json' },
		    body: JSON.stringify({ sessionId })
		  })
		  let payload          = null
		  try {
		    payload = await response.json()
		  } catch {
		    payload = null
		  }
		  const envelope = payload !== null && typeof payload === 'object' ? payload                            : undefined
		  if (envelope?.ok === true) return envelope.value                

		  const error = envelope?.error !== null && typeof envelope?.error === 'object'
		    ? envelope.error                           
		    : undefined
		  const failure = new Error(
		    typeof error?.message === 'string' ? error.message : `HTTP ${String(response.status)}`
		  )                                           
		  failure.code = typeof error?.code === 'string' ? error.code : 'transport'
		  throw failure
		}

		/**
		 * Read the Host's durable per-Session facts.
		 *
		 * The page cannot derive these: a stored Session's list row carries a live
		 * first-turn flag that says nothing about its log, and its projection block is
		 * loaded only for the Session being viewed. The Host projects every stored log, so
		 * it is asked instead of guessed at.
		 *
		 * @returns one row per stored Session, unsorted; the caller applies its policy.
		 * @throws {SessionDeleteFailure} carrying the Host's code and message.
		 */
		async function listUnusedSessions()                                       {
		  const response = await fetch(UNUSED_PATH, {
		    method: 'POST',
		    headers: { 'content-type': 'application/json' },
		    body: JSON.stringify({})
		  })
		  let payload          = null
		  try {
		    payload = await response.json()
		  } catch {
		    payload = null
		  }
		  const envelope = payload !== null && typeof payload === 'object' ? payload                            : undefined
		  if (envelope?.ok === true) {
		    const value = envelope.value                                               
		    return Array.isArray(value?.sessions) ? value.sessions                                : []
		  }

		  const error = envelope?.error !== null && typeof envelope?.error === 'object'
		    ? envelope.error                           
		    : undefined
		  const failure = new Error(
		    typeof error?.message === 'string' ? error.message : `HTTP ${String(response.status)}`
		  )                                           
		  failure.code = typeof error?.code === 'string' ? error.code : 'transport'
		  throw failure
		}

		/**
		 * Word one failure for the operator: the codes this package owns have their own
		 * copy, everything else keeps the Host's diagnostic.
		 * @param reason - the thrown value.
		 * @param t - the locale seat.
		 * @returns display text.
		 */
		function describeFailure(reason         , t           )         {
		  const failure = reason instanceof Error ? reason : new Error(String(reason))
		  const key = WORDED_FAILURES[(failure                        ).code]
		  if (key !== undefined) return `${t(key)}\n${failure.message}`
		  return t('dialog.failed', { reason: failure.message })
		}

		/**
		 * Word a bulk-cleanup failure, which reports a different sentence than one
		 * conversation's removal.
		 * @param reason - the thrown value.
		 * @param t - the locale seat.
		 * @returns display text.
		 */
		function describeCleanupFailure(reason         , t           )         {
		  const message = reason instanceof Error ? reason.message : String(reason)
		  return t('cleanup.failed', { reason: message })
		}
		//#endregion
		//#region src/client/pending.ts
		/**
		 * The one pending destructive request this package owns.
		 *
		 * A menu row, a sidebar action, and the overlay dialogs are separate slot
		 * entries in separate scopes, so they cannot pass props to each other; this
		 * module-scoped store is their only channel. It is deliberately tiny and
		 * subscription-based rather than the slot `store` seat: the dialogs are
		 * root-scoped overlays with no per-occurrence identity to key a store by.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/pending
		 */


		/** One conversation's removal request, opened from its row menu. */
		                                
		                         
		                            
		                               
		 

		/**
		 * A bulk blank-Session cleanup request, opened from the sidebar action.
		 *
		 * The durable facts come from the Host, so the request carries its own load state:
		 * the dialog cannot decide anything until they arrive, and the page has no other
		 * way to learn whether a stored Session is blank.
		 */
		                                 
		                          
		                                                           
		                           
		                                          
		                                                         
		                                                                    
		                              
		 

		/** Either pending request. */
		                                                           

		let pending                        = null
		const listeners = new Set            ()

		/** Notify every mounted subscriber. */
		function publish()       {
		  for (const listener of [...listeners]) listener()
		}

		/**
		 * Read the pending request inside a component.
		 * @returns the current request, or null.
		 */
		function usePendingRequest()                        {
		  const [value, setValue] = React.useState                       (pending)
		  React.useEffect(() => {
		    const listener = ()       => {
		      setValue(pending)
		    }
		    listeners.add(listener)
		    // Re-read once on mount: the request may have opened between render and effect.
		    listener()
		    return () => {
		      listeners.delete(listener)
		    }
		  }, [])
		  return value
		}

		/** Open the confirmation for one conversation. */
		function requestDelete(sessionId        , displayTitle        )       {
		  pending = { kind: 'delete', sessionId, displayTitle }
		  publish()
		}

		/**
		 * Open the blank-Session cleanup confirmation.
		 *
		 * The Host is asked for the durable per-Session facts first, and the dialog shows
		 * its loading state until they arrive. A failure is carried on the request so the
		 * dialog can word it, rather than being swallowed into an empty plan — which would
		 * read as "nothing to clean" when the truth is "we could not find out".
		 */
		function requestCleanup()       {
		  pending = { kind: 'cleanup', loading: true }
		  publish()
		  void listUnusedSessions().then(
		    (rows) => {
		      // A newer request (or a dismissal) owns the store now; drop this answer.
		      if (pending === null || pending.kind !== 'cleanup') return
		      pending = { kind: 'cleanup', loading: false, rows }
		      publish()
		    },
		    (error         ) => {
		      if (pending === null || pending.kind !== 'cleanup') return
		      pending = { kind: 'cleanup', loading: false, loadError: error }
		      publish()
		    }
		  )
		}

		/** Close the pending confirmation (accepted, cancelled, or dismissed). */
		function settleRequest()       {
		  pending = null
		  publish()
		}
		//#endregion
		//#region src/client/DeleteSessionMenuItem.ts
		/**
		 * The Session row's "..." menu row: order 900, after the shipped
		 * pin/rename/fork/archive rows, marked as a destructive action.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/DeleteSessionMenuItem
		 */



		/** Owner share plus the slot's menu hook and this package's locale seat. */
		                                             
		                               
		                            
		                                                            
		                               
		                                                           
		                                             
		                                                       
		                       
		 

		/**
		 * Render the delete row.
		 * @param props - the row's owner share, menu hook, and locale seat.
		 * @returns the danger menu row that opens the confirmation.
		 */
		function DeleteSessionMenuItem(props                            )                     {
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
		//#endregion
		//#region src/client/DeleteSessionDialog.ts
		/**
		 * The `shell.overlay` entry for one conversation's removal: nothing while no
		 * delete is pending, otherwise one modal. The Modal portals to `document.body`,
		 * so the overlay slot only supplies the mount point.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/DeleteSessionDialog
		 */




		/** The slot gives the entry its locale seat and the refresh hop. */
		                                           
		                                                       
		                       
		                                                                     
		                                                                
		 

		/**
		 * Render the pending confirmation, if any.
		 * @param props - the locale seat and the refresh hop.
		 * @returns the open dialog, or null.
		 */
		function DeleteSessionDialog(props                          )                            {
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
		                                  
		                                 
		                       
		                                                                
		 

		/**
		 * Render one removal confirmation.
		 * @param props - the request, the locale seat, and the refresh hop.
		 * @returns the confirmation modal.
		 */
		function DeleteSessionForm(props                        )                     {
		  const [busy, setBusy] = React.useState(false)
		  const [failure, setFailure] = React.useState               (null)

		  const close = ()       => {
		    if (!busy) settleRequest()
		  }
		  const confirm = ()       => {
		    setBusy(true)
		    setFailure(null)
		    deleteSession(props.request.sessionId).then(() => {
		      setBusy(false)
		      settleRequest()
		      return props.refreshSessions(props.request.sessionId)
		    }).catch((reason         ) => {
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
		//#endregion
		//#region src/client/CleanupButton.ts
		/**
		 * The sidebar-foot action that opens blank-Session cleanup: an icon-only
		 * control in the rail, icon plus label when the column is wide.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/CleanupButton
		 */



		/** Owner share of a sidebar-foot action plus this package's locale seat. */
		                                     
		                                                                      
		                        
		                                                       
		                       
		 

		/**
		 * Render the cleanup trigger.
		 * @param props - the column state and the locale seat.
		 * @returns the action button.
		 */
		function CleanupButton(props                    )                     {
		  const label = props.t('cleanup.button')
		  const icon = React.createElement(primitives.IconTrashOutlineRegular, { size: 16 })
		  const onClick = ()       => {
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
		//#endregion
		//#region src/client/cleanup-plan.ts
		/**
		 * Blank-Session cleanup planning: which unused Sessions a cleanup run may
		 * remove, decided from the client list snapshot alone.
		 *
		 * Pure and React-free on purpose — it is the half of the cleanup surface that
		 * can be reasoned about and tested without a browser (see
		 * `tests/cleanup-plan.test.ts`).
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client/cleanup-plan
		 */


		/**
		 * How long a blank Session must have been idle before cleanup may remove it.
		 *
		 * A blank Session is one that never started a turn, so it holds no work — but
		 * the window between "New Session" and the first message is also blank, and a
		 * second window can be sitting in that window. The grace period turns that
		 * narrow race into "leave it alone for an hour".
		 */
		const BLANK_IDLE_GRACE_MS = 60 * 60 * 1000

		/** Rows the cleanup dialog lists before collapsing the rest into a count. */
		const CLEANUP_LIST_LIMIT = 8

		/** One Session the plan selected for removal. */
		                                
		                            
		                            
		                                   
		 

		/** What one cleanup run would do, and why each blank Session was passed over. */
		                              
		                                                              
		                                            
		                                                             
		                             
		                                                        
		                                 
		                                                                             
		                                 
		                                                          
		                               
		                                                                        
		                                  
		 

		/** What the plan is decided from. */
		                               
		                                                             
		                                             
		                                                                                      
		                                             
		 

		/**
		 * Decide which blank Sessions a cleanup run may remove.
		 *
		 * Blankness is taken from the **Host's durable projection** and from nothing else.
		 * Two earlier attempts to derive it in the page failed for the same underlying
		 * reason: a stored Session's list row carries a live first-turn flag that says
		 * nothing about its log, and its projection block is loaded only for the Session
		 * being viewed. A row the Host could not prove is skipped rather than guessed at —
		 * this runs before an irreversible removal, so "unknown" must never mean "yes".
		 *
		 * @param input - the Host's facts plus the client's live list.
		 * @param now - the clock to measure the grace period against.
		 * @param graceMs - the idle grace period.
		 * @returns the plan, with each skip rule counted for the dialog's copy.
		 */
		function planBlankCleanup(
		  input              ,
		  now         = Date.now(),
		  graceMs         = BLANK_IDLE_GRACE_MS
		)              {
		  const targets                  = []
		  let considered = 0
		  let currentSkipped = 0
		  let runningSkipped = 0
		  let freshSkipped = 0
		  let unprovenSkipped = 0

		  for (const fact of input.facts) {
		    if (!fact.proven) {
		      unprovenSkipped++
		      continue
		    }
		    // Proven to have started a turn: not a candidate, and nothing to explain.
		    if (!fact.blank) continue
		    considered++
		    if (fact.sessionId === input.live?.current) {
		      currentSkipped++
		      continue
		    }
		    if (input.live?.byId[fact.sessionId]?.running === true) {
		      runningSkipped++
		      continue
		    }
		    const updatedAt = Math.max(fact.updatedAt, fact.lastPromptAt ?? 0)
		    if (now - updatedAt < graceMs) {
		      freshSkipped++
		      continue
		    }
		    targets.push({ sessionId: fact.sessionId, updatedAt, cwd: fact.cwd })
		  }

		  targets.sort((left, right) => left.updatedAt - right.updatedAt)
		  return { targets, considered, currentSkipped, runningSkipped, freshSkipped, unprovenSkipped }
		}

		/**
		 * Word one timestamp as an age, through the locale seat.
		 * @param updatedAt - durable activity timestamp.
		 * @param now - the clock to measure against.
		 * @param t - the locale seat.
		 * @returns display text such as `3 小时前`.
		 */
		function describeAge(updatedAt        , now        , t           )         {
		  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000)
		  if (minutes < 1) return t('age.justNow')
		  if (minutes < 60) return t('age.minutes', { n: minutes })
		  const hours = Math.floor(minutes / 60)
		  if (hours < 24) return t('age.hours', { n: hours })
		  return t('age.days', { n: Math.floor(hours / 24) })
		}

		/** The grace period as whole minutes, for the dialog's copy. */
		function graceMinutes(graceMs         = BLANK_IDLE_GRACE_MS)         {
		  return Math.round(graceMs / 60_000)
		}
		//#endregion
		//#region src/client/CleanupDialog.ts
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





		/** Selector hook handed to root-scoped slot entries by the renderer. */
		                                                                          

		/** The slot gives the entry its locale seat, the list hook, and the refresh hop. */
		                                     
		                                                       
		                       
		                                       
		                                   
		                                                                   
		                                               
		 

		/** What the dialog is doing right now. */
		                    
		                                                
		                            
		                          
		                         
		                        
		                                      
		 

		const INITIAL_RUN           = {
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
		function CleanupDialog(props                    )                            {
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
		function CleanupForm(props                                                           )                     {
		  const snapshot = props.useSessions((list) => list)
		  const [openedAt] = React.useState(() => Date.now())
		  const [run, setRun] = React.useState          (INITIAL_RUN)
		  const plan = React.useMemo(
		    () => planBlankCleanup({ facts: props.request.rows ?? [], live: snapshot }, openedAt),
		    [props.request.rows, snapshot, openedAt]
		  )

		  const running = run.phase === 'running'
		  const close = ()       => {
		    if (!running) settleRequest()
		  }

		  const confirm = ()       => {
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
		  targets                        ,
		  report                                    
		)                    {
		  let attempted = 0
		  let removed = 0
		  let failed = 0
		  let inUse = 0
		  let firstFailure                = null

		  for (const target of targets) {
		    try {
		      await deleteSession(target.sessionId)
		      removed++
		    } catch (reason) {
		      const code = (reason                        ).code
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
		function describeRun(plan             , run          , t           )         {
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
		function renderPlan(plan             , openedAt        , t           )                  {
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
		      React.createElement('span', {
		        key: 'path',
		        style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
		        children: target.cwd ?? target.sessionId
		      }),
		      React.createElement('span', { key: 'age', children: describeAge(target.updatedAt, openedAt, t) })
		    ]))),
		    hidden > 0 && React.createElement('p', { key: 'more', children: t('cleanup.more', { n: hidden }) })
		  ]
		}

		/**
		 * Render the running or finished body: the outcome already reads in the
		 * description, so only an in-flight run adds a live progress line here.
		 * @param run - the current run state.
		 * @param total - how many removals the run plans.
		 * @param t - the locale seat.
		 * @returns the body nodes, or an empty list when there is nothing to add.
		 */
		function renderRun(run          , total        , t           )                  {
		  if (run.phase !== 'running') return []
		  return [
		    React.createElement('p', {
		      key: 'progress',
		      role: 'status',
		      children: t('cleanup.running', { done: run.attempted, total })
		    })
		  ]
		}
		//#endregion
		//#region src/client/index.ts
		/**
		 * Delete-conversation surface, browser half.
		 *
		 * Three additive contributions and no takeover:
		 *
		 * - `sidebar.workspaces.session.menu.item` — the red "delete conversation" row
		 *   in one Session's "..." menu.
		 * - `sidebar.footer.action` — the blank-Session cleanup trigger beside Settings.
		 * - `shell.overlay` — the two confirmations those entries open.
		 *
		 * Every removal goes through this package's own authenticated Host route
		 * (`POST /api/session.delete`, registered by the node half), and every skip
		 * decision is made by `cleanup-plan.ts`. `apply` is also the only place holding
		 * the sessions service, so it hands the dialogs their refresh hop.
		 *
		 * @module @deepseek-ai/dsh-client-ui-session-delete/client
		 */






		/** Required services: the slot registry, the Session list store, and copy. */
		const inject = ['slots', 'sessions', 'locale']

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
		function sessionRefresh(ctx               )                                        {
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
		function apply(ctx               )       {
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
		}
		//#endregion
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
