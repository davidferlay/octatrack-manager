/**
 * Complete Octatrack character set (OS 1.40+), transcribed from the
 * hardware naming screen (2 pages).
 */
export const OT_CHARSET =
  // Page 1
  'ABCDEFGHIJKLMNOP' +
  'QRSTUVWXYZ' +
  'ÅÄÖÜØø' +       // Nordic capitals + ø
  'abcdefghijklmnop' +
  'qrstuvwxyz' +
  'åäöü' +           // Nordic lowercase
  '0123456789' +
  '#&"\'._ ' +       // hash, ampersand, double-quote, single-quote, dot, underscore, space
  '+-=$/(),>!?%£¢' + // symbols row
  // Page 2
  ':;<>[]^{|}' +
  '¡¢£×¥¤¦¨©«¬®¯°±²³´µ' +
  '¶·¸¹º»¼½¾¿' +
  'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ' +
  'ÙÚÛÜÝÞß' +
  'àáâãäåæçèéêëìíîïðñòóôõö' +
  'øùúûüýþÿ'

/** Characters the OT supports but that are forbidden in filesystem folder names. */
export const FS_FORBIDDEN = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']

/** Maximum project name length on the Octatrack. */
export const MAX_PROJECT_NAME_LEN = 12

/**
 * The usable character set: OT-supported minus filesystem-forbidden.
 * Deduplicated and sorted for display.
 */
export const ALLOWED_CHARS = [...new Set([...OT_CHARSET])]
  .filter(ch => !FS_FORBIDDEN.includes(ch))

/** Test whether a character is allowed in a project name. */
export function isCharAllowed(ch: string): boolean {
  return OT_CHARSET.includes(ch) && !FS_FORBIDDEN.includes(ch)
}

/**
 * Filter a string to only allowed characters, capped at max length.
 * Returns [filteredString, wasFiltered].
 */
export function filterProjectName(input: string, maxLen: number = MAX_PROJECT_NAME_LEN): [string, boolean] {
  const chars = [...input]
  const filtered = chars.filter(ch => isCharAllowed(ch))
  const wasFiltered = filtered.length !== chars.length
  return [filtered.slice(0, maxLen).join(''), wasFiltered]
}
