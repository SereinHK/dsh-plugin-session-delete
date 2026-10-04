/**
 * Small display helpers shared by this package's surfaces.
 *
 * Their own module because the client bundle is assembled into one flat factory
 * scope: two modules declaring the same top-level name is a build error, so anything
 * two dialogs need lives here once.
 *
 * @module @deepseek-ai/dsh-client-ui-session-delete/client/format
 */

/**
 * Word a byte count for the operator, or nothing when it is unknown.
 *
 * Decimal units, one fraction digit: this answers "roughly how much", and a fake
 * precision would mislead. An unknown size renders as an empty string so callers can
 * drop it out of a `·`-joined line.
 *
 * @param bytes - the measured size, when the Host could measure it.
 * @returns display text such as `12.4 MB`, or an empty string.
 */
export function formatBytes(bytes: number | undefined): string {
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
