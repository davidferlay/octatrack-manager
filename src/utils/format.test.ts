import { describe, it, expect } from 'vitest'
import { formatBytes, formatMixerLevel, formatMetronomePitch } from './format'

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB')
    expect(formatBytes(52428800)).toBe('50 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB')
    expect(formatBytes(1395864371)).toBe('1.3 GB')
  })

  it('drops trailing .0', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1048576)).toBe('1 MB')
  })
})

describe('formatMixerLevel', () => {
  it('shows the default raw value (64) as +0', () => {
    expect(formatMixerLevel(64)).toBe('+0')
  })

  it('shows a positive offset with a leading +', () => {
    expect(formatMixerLevel(127)).toBe('+63')
  })

  it('shows a negative offset with a leading -', () => {
    expect(formatMixerLevel(0)).toBe('-64')
  })
})

describe('formatMetronomePitch', () => {
  it('shows the factory default (raw 12) as C6', () => {
    expect(formatMetronomePitch(12)).toBe('C6')
  })

  it('shows raw 0 as C5', () => {
    expect(formatMetronomePitch(0)).toBe('C5')
  })

  it('shows a sharp note', () => {
    expect(formatMetronomePitch(1)).toBe('C#5')
  })
})
