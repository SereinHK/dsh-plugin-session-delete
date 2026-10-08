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
export const LOCALE_NAMESPACE = 'sessionDelete'

/** Simplified Chinese dictionary. */
export const zh: Record<string, string> = {
  'menu.delete': '删除对话',

  'dialog.title': '删除这个对话？',
  'dialog.desc': '“{title}”会从列表移除：日志移入本机回收站，可以从回收站恢复。',
  'dialog.detail': '移动的是这台机器上的会话日志（sessions 目录下该会话的整个目录）与它的投影缓存记录。回收站到期会自动清除，也可以随时在里面彻底删除。已导出的文件、附件与工作区文件不受影响；归档记录里的这个会话编号会随之下线。',
  'dialog.live': '该对话正被当前窗口打开，无法删除。请先切换到其他对话（或新建一个对话）后再试。',
  'dialog.notFound': '没有找到这个对话的会话日志：可能已经删除，也可能在回收站里。',
  'dialog.unsafe': '出于安全考虑拒绝了这次删除：目标路径不在会话根目录之内。',
  'dialog.failed': '删除失败：{reason}',
  'confirm': '移入回收站',
  'cancel': '取消',
  'deleting': '移动中…',
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

  'trash.button': '回收站',
  'trash.title': '回收站',
  'trash.loading': '正在向宿主查询回收站…',
  'trash.empty': '回收站是空的。',
  'trash.desc': '{n} 个对话在回收站里，日志还在磁盘上：{days} 天内可以恢复，到期自动清除。',
  'trash.restore': '恢复',
  'trash.purge': '彻底删除',
  'trash.purgeAll': '清空回收站',
  'trash.confirmPurgeAsk': '“{title}”将被永久删除，无法恢复。',
  'trash.confirmPurgeButton': '确定删除',
  'trash.confirmAllAsk': '清空回收站会永久删除全部 {n} 项，无法恢复。',
  'trash.confirmAllButton': '确定清空',
  'trash.restored': '已恢复“{title}”，回到原来的工作区。',
  'trash.purged': '已彻底删除。',
  'trash.purgeAllDone': '已彻底删除 {n} 项。',
  'trash.failed': '回收站操作失败：{reason}',
  'trash.missing': '回收站里已经没有这一项了。',
  'trash.taken': '它原来所在的位置已被占用，无法恢复——可以先把占用它的那个对话移走。',
  'trash.expires': '还有 {days} 天',
  'trash.working': '处理中…',

  'age.justNow': '刚刚',
  'age.minutes': '{n} 分钟前',
  'age.hours': '{n} 小时前',
  'age.days': '{n} 天前'
}

/** English dictionary, complete against {@link zh}. */
export const en: Record<string, string> = {
  'menu.delete': 'Delete conversation',

  'dialog.title': 'Delete this conversation?',
  'dialog.desc': '“{title}” leaves the list: its log moves into the trash on this machine, and can be restored from there.',
  'dialog.detail': 'What moves is the session log on this machine (the whole session directory under the sessions root) and its projection-cache record. The trash is purged automatically once the window closes, and anything in it can be deleted for good at any time. Exported files, attachments and workspace files are untouched; the id also drops out of the archive set.',
  'dialog.live': 'This conversation is open in a window right now, so it cannot be deleted. Switch to another conversation (or start a new one) and try again.',
  'dialog.notFound': 'No session log was found for this conversation: it may be deleted, or it may be in the trash.',
  'dialog.unsafe': 'The deletion was refused for safety: the target path is not inside the session root.',
  'dialog.failed': 'Deletion failed: {reason}',
  'confirm': 'Move to trash',
  'cancel': 'Cancel',
  'deleting': 'Moving…',
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

  'trash.button': 'Trash',
  'trash.title': 'Trash',
  'trash.loading': 'Asking the Host for the trash…',
  'trash.empty': 'The trash is empty.',
  'trash.desc': '{n} conversations are in the trash, their logs still on disk: restorable for {days} days, then purged automatically.',
  'trash.restore': 'Restore',
  'trash.purge': 'Delete for good',
  'trash.purgeAll': 'Empty the trash',
  'trash.confirmPurgeAsk': '“{title}” will be deleted for good. This cannot be undone.',
  'trash.confirmPurgeButton': 'Delete for good',
  'trash.confirmAllAsk': 'Emptying the trash permanently deletes all {n} entries. This cannot be undone.',
  'trash.confirmAllButton': 'Empty it',
  'trash.restored': 'Restored “{title}” to its workspace.',
  'trash.purged': 'Deleted for good.',
  'trash.purgeAllDone': 'Deleted {n} entries for good.',
  'trash.failed': 'Trash action failed: {reason}',
  'trash.missing': 'That entry is no longer in the trash.',
  'trash.taken': 'Its old place is taken, so it cannot be restored — move whatever holds that name first.',
  'trash.expires': '{days} days left',
  'trash.working': 'Working…',

  'age.justNow': 'just now',
  'age.minutes': '{n} min ago',
  'age.hours': '{n} h ago',
  'age.days': '{n} d ago'
}
