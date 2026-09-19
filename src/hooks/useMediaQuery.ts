import { useLayoutEffect, useState } from "react";

const MAX_WIDTH_QUERY = /^\(max-width:\s*(\d+(?:\.\d+)?)px\)$/;

function readMatches(query: string): boolean {
  if (typeof window === "undefined") return false;
  const parsed = query.trim().match(MAX_WIDTH_QUERY);
  if (parsed !== null) {
    return window.innerWidth <= Number(parsed[1]);
  }
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => readMatches(query));

  useLayoutEffect(() => {
    const sync = () => {
      const next = readMatches(query);
      setMatches((current) => (current === next ? current : next));
    };
    sync();
    const media = window.matchMedia(query);
    media.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, [query]);

  return matches;
}
