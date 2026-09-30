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
  'cleanup.unproven': '另有 {n} 个会话还无法确认是否为空（投影元数据尚未载入），本次跳过。',
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
export const en: Record<string, string> = {
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
  'cleanup.unproven': '{n} more could not be confirmed as empty (their projection has not loaded yet) and were skipped.',
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
