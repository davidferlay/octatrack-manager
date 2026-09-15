import { useLayoutEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const readMatches = () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = useState(readMatches);

  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
