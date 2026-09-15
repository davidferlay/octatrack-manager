/** Test-only harness for WaveformPreview ResizeObserver (not used in production). */
let emitWidth: ((width: number) => void) | null = null;

export function setWaveformPlotWidthForTests(width: number): void {
  emitWidth?.(width);
}

export function installWaveformPlotResizeObserverMock(): void {
  class MockResizeObserver implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      emitWidth = (width) => {
        this.callback(
          [{ contentRect: { width, height: 112 } } as ResizeObserverEntry],
          this,
        );
      };
    }

    observe(): void {
      emitWidth?.(640);
    }

    disconnect(): void {
      if (emitWidth !== null) {
        emitWidth = null;
      }
    }

    unobserve(): void {}
  }

  globalThis.ResizeObserver = MockResizeObserver;
}
