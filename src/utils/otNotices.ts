export type OtOutcome = 'copied' | 'rescaled' | 'refused' | 'removed'

/** What happened to one imported file's `.ot` (Rust `ot_sidecar::OtCarry`). */
export interface OtCarry {
  audio: string
  ot: string
  outcome: OtOutcome
  from_rate: number | null
  reason: string | null
  replaced: boolean
  /** Positions past the end of the audio were cut to its length, as the device does. */
  clamped: boolean
}

/** A slot assigned with the `.ot` next to its audio (Rust `ot_sidecar::OtApplied`). */
export interface OtApplied {
  slot_index: number
  ot: string
  slices: number
  clamped: boolean
  error: string | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The badge lines for what a slot import did with `.ot` files: copied (or rescaled) next to
 * the audio, applied to the slot, or left out and why. A drop bringing more than three lines
 * is counted rather than listed, so the badge stays readable.
 */
export function otNotices(carries: OtCarry[], applied: OtApplied[], slotPrefix: string) {
  const refused = carries.filter(c => c.outcome === 'refused')
  const failed = applied.filter(a => a.error)
  const warning = refused.length > 0 || failed.length > 0

  const lines: string[] = []
  for (const c of carries) {
    const extra = (c.clamped ? ", cut to the audio's length" : '')
      + (c.replaced ? ', older one moved to backups' : '')
    if (c.outcome === 'copied') lines.push(`${c.ot} copied with ${c.audio}${extra}`)
    if (c.outcome === 'rescaled') {
      lines.push(`${c.ot} rescaled from ${(c.from_rate ?? 0) / 1000} kHz and copied with ${c.audio}${extra}`)
    }
    if (c.outcome === 'removed') lines.push(`${c.audio} replaced: its old ${c.ot} moved to backups`)
    if (c.outcome === 'refused') lines.push(`${c.ot || `${c.audio}'s .ot`} not copied: ${c.reason}`)
  }
  for (const a of applied) {
    const slot = `${slotPrefix}${a.slot_index}`
    if (a.error) {
      lines.push(`${a.ot} not applied to ${slot}: ${a.error}`)
    } else {
      const slices = a.slices ? ` and ${plural(a.slices, 'slice', 'slices')}` : ''
      const cut = a.clamped ? ", cut to the audio's length" : ''
      lines.push(`${slot} took its settings${slices} from ${a.ot}${cut}`)
    }
  }
  if (lines.length <= 3) return { lines, warning }

  const copied = carries.filter(c => c.outcome === 'copied' || c.outcome === 'rescaled')
  const rescaled = copied.filter(c => c.outcome === 'rescaled').length
  const removed = carries.filter(c => c.outcome === 'removed').length
  const took = applied.length - failed.length
  const counted: string[] = []
  if (copied.length) {
    counted.push(`${plural(copied.length, '.ot file', '.ot files')} copied`
      + (rescaled ? ` (${rescaled} rescaled to 44.1 kHz)` : ''))
  }
  if (removed) counted.push(`${plural(removed, 'old .ot file', 'old .ot files')} moved to backups`)
  if (took) {
    counted.push(took === 1 ? '1 slot took its settings from its .ot'
      : `${took} slots took their settings from their .ot`)
  }
  const unused = refused.length + failed.length
  if (unused) {
    counted.push(`${plural(unused, '.ot', '.ot files')} not used (unreadable or made for other audio)`)
  }
  return { lines: counted, warning }
}
