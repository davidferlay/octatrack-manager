import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("useMediaQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setInnerWidth(1280);
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      media: query,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks max-width queries from innerWidth", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 840px)"));
    expect(result.current).toBe(false);
    act(() => {
      setInnerWidth(840);
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);
  });

  it("falls back to matchMedia for non max-width queries", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: () => void) => {
        listeners.delete(listener);
      },
    }));
    const { result } = renderHook(() => useMediaQuery("(prefers-reduced-motion: reduce)"));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(true);
  });
});
