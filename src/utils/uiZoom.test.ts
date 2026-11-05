import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
import { zoomStepFor, installUiZoom } from './uiZoom'

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

describe('which keys zoom', () => {
  it('Ctrl with + or = zooms in, - zooms out, 0 resets', () => {
    expect(zoomStepFor(key({ key: '=', ctrlKey: true }))).toBe(1)
    expect(zoomStepFor(key({ key: '+', ctrlKey: true, shiftKey: true }))).toBe(1)
    expect(zoomStepFor(key({ key: '-', ctrlKey: true }))).toBe(-1)
    expect(zoomStepFor(key({ key: '0', ctrlKey: true }))).toBe(0)
  })

  it('Cmd does the same on macOS', () => {
    expect(zoomStepFor(key({ key: '=', metaKey: true }))).toBe(1)
  })

  it('the keypad keys work too', () => {
    expect(zoomStepFor(key({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe(1)
    expect(zoomStepFor(key({ key: '-', code: 'NumpadSubtract', ctrlKey: true }))).toBe(-1)
    expect(zoomStepFor(key({ key: '0', code: 'Numpad0', ctrlKey: true }))).toBe(0)
  })

  it('Ctrl 0 resets on an AZERTY keyboard, where that key types "à"', () => {
    expect(zoomStepFor(key({ key: 'à', code: 'Digit0', ctrlKey: true }))).toBe(0)
  })

  it('leaves the keys alone without Ctrl, or with Alt as well', () => {
    expect(zoomStepFor(key({ key: '=' }))).toBeNull()
    expect(zoomStepFor(key({ key: '-' }))).toBeNull()
    expect(zoomStepFor(key({ key: '=', ctrlKey: true, altKey: true }))).toBeNull()
    expect(zoomStepFor(key({ key: 's', ctrlKey: true }))).toBeNull()
  })
})

describe('zooming the UI from the keyboard', () => {
  let uninstall: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
    uninstall = installUiZoom()
  })

  afterEach(() => {
    uninstall()
    vi.useRealTimers()
    document.querySelectorAll('.zoom-toast').forEach(el => el.remove())
  })

  const badge = () => document.querySelector('.zoom-toast')

  it('asks the backend for the next level and shows it', async () => {
    invokeMock.mockResolvedValue(1.1)
    const event = key({ key: '=', ctrlKey: true })
    document.dispatchEvent(event)
    // The webview's own handling of the keys is not wanted
    expect(event.defaultPrevented).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('step_ui_zoom', { step: 1 })
    await vi.waitFor(() => expect(badge()).toHaveTextContent('Zoom 110%'))
  })

  it('shows each new level in the same badge, and takes it away after a moment', async () => {
    invokeMock.mockResolvedValueOnce(0.9).mockResolvedValueOnce(0.8)
    document.dispatchEvent(key({ key: '-', ctrlKey: true }))
    await vi.waitFor(() => expect(badge()).toHaveTextContent('Zoom 90%'))
    document.dispatchEvent(key({ key: '-', ctrlKey: true }))
    await vi.waitFor(() => expect(badge()).toHaveTextContent('Zoom 80%'))
    expect(document.querySelectorAll('.zoom-toast')).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(badge()).toBeNull()
  })

  it('a press while the badge fades brings up a fresh one, so the new level is seen', async () => {
    invokeMock.mockResolvedValueOnce(1.1).mockResolvedValueOnce(1.25)
    document.dispatchEvent(key({ key: '=', ctrlKey: true }))
    await vi.waitFor(() => expect(badge()).toHaveTextContent('Zoom 110%'))
    const first = badge()
    // The toast style starts fading at 1.2 s
    vi.advanceTimersByTime(1300)
    document.dispatchEvent(key({ key: '=', ctrlKey: true }))
    await vi.waitFor(() => expect(badge()).toHaveTextContent('Zoom 125%'))
    expect(badge()).not.toBe(first)
    expect(first!.isConnected).toBe(false)
    vi.advanceTimersByTime(1400)
    expect(badge()).not.toBeNull()
  })

  it('does nothing for other keys', () => {
    document.dispatchEvent(key({ key: 'a', ctrlKey: true }))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('stops listening once uninstalled', () => {
    uninstall()
    document.dispatchEvent(key({ key: '=', ctrlKey: true }))
    expect(invokeMock).not.toHaveBeenCalled()
    uninstall = () => {}
  })
})
