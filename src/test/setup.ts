import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// jsdom does not implement media playback
window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
window.HTMLMediaElement.prototype.pause = vi.fn()
window.HTMLMediaElement.prototype.load = vi.fn()

// jsdom does not implement Blob object URLs
URL.createObjectURL = vi.fn(() => 'blob:mock')
URL.revokeObjectURL = vi.fn()

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// jsdom does not implement the Web Audio API (used by useAudioPreview)
class FakeGainNode {
  gain = { value: 1 }
  connect() {}
  disconnect() {}
}
class FakeBufferSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  currentTime = 0
  destination = {}
  createGain() { return new FakeGainNode() }
  createBufferSource() { return new FakeBufferSource() }
  decodeAudioData() { return Promise.resolve({ duration: 4, numberOfChannels: 2, sampleRate: 44100, length: 176400 }) }
  resume() { return Promise.resolve() }
  close() { return Promise.resolve() }
}
;(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext

// Keep the rAF position loop from running in tests (avoids open handles / act noise)
globalThis.requestAnimationFrame = vi.fn(() => 0)
globalThis.cancelAnimationFrame = vi.fn()
