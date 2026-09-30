import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { OctatrackProject } from "../types/projectManagement";

const STORAGE_KEY = "otm.project-bookmarks";

/**
 * A project the user pinned to the top of the home page.
 *
 * The name and Set are stored alongside the path rather than looked up in the scan
 * results: the point of a bookmark is to be there on launch, before (or without) a
 * rescan. Live scan data still wins when the project is found - see `mergeBookmarks`.
 */
export interface ProjectBookmark {
  path: string;
  name: string;
  setPath: string;
  setName: string;
}

function isBookmark(value: unknown): value is ProjectBookmark {
  const b = value as ProjectBookmark;
  return (
    !!b &&
    typeof b.path === "string" &&
    b.path.length > 0 &&
    typeof b.name === "string" &&
    typeof b.setPath === "string" &&
    typeof b.setName === "string"
  );
}

/** Reads the stored bookmarks, tolerating absent, unreadable or malformed storage. */
export function loadBookmarks(): ProjectBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBookmark) : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(bookmarks: ProjectBookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch (err) {
    console.error("Error saving project bookmarks:", err);
  }
}

/**
 * Bookmarks with each entry refreshed from the current scan when that project was
 * found, so a rename shows up without the user re-bookmarking. Entries the scan did
 * not turn up are kept as stored - the project may simply be on a drive that is not
 * plugged in right now.
 */
export function mergeBookmarks(
  bookmarks: ProjectBookmark[],
  discovered: ProjectBookmark[],
): ProjectBookmark[] {
  const byPath = new Map(discovered.map((d) => [d.path, d]));
  return bookmarks.map((b) => byPath.get(b.path) ?? b);
}

/** Bookmark state for the home page, persisted to localStorage on every change. */
export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<ProjectBookmark[]>(loadBookmarks);

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  const isBookmarked = useCallback(
    (path: string) => bookmarks.some((b) => b.path === path),
    [bookmarks],
  );

  const toggleBookmark = useCallback(
    (project: OctatrackProject, setPath: string, setName: string) => {
      setBookmarks((current) =>
        current.some((b) => b.path === project.path)
          ? current.filter((b) => b.path !== project.path)
          : [...current, { path: project.path, name: project.name, setPath, setName }],
      );
    },
    [],
  );

  /** Drops a bookmark by path - for a project that was deleted or renamed away. */
  const removeBookmark = useCallback((path: string) => {
    setBookmarks((current) => current.filter((b) => b.path !== path));
  }, []);

  /**
   * Follows an operation performed on the project itself: a rename, or a move to
   * another Set, carries the bookmark with it; `null` drops it, for a delete.
   *
   * Without this a bookmark would go stale the moment its project was renamed - it
   * would point at a path that no longer exists and be pruned on the next scan,
   * which is not what "rename" should do to something the user pinned.
   */
  const retargetBookmark = useCallback(
    (oldPath: string, next: ProjectBookmark | null) => {
      setBookmarks((current) => {
        if (!current.some((b) => b.path === oldPath)) return current;
        return next
          ? current.map((b) => (b.path === oldPath ? next : b))
          : current.filter((b) => b.path !== oldPath);
      });
    },
    [],
  );

  /**
   * Drops bookmarks whose project is no longer on disk - moved or deleted outside
   * the app, or a card that was bookmarked and then removed by other means.
   *
   * Deliberately asks the backend rather than trusting the last scan: a project can
   * be absent from scan results for innocent reasons (a filtered search, a location
   * that was not rescanned), and losing a bookmark to that would be wrong.
   */
  const pruneMissingBookmarks = useCallback(async () => {
    const current = loadBookmarks();
    if (current.length === 0) return;
    const checks = await Promise.all(
      current.map((b) =>
        invoke<boolean>("project_exists", { projectPath: b.path })
          // A failing check is not evidence the project is gone - keep the bookmark.
          .catch(() => true),
      ),
    );
    const alive = current.filter((_, i) => checks[i]);
    if (alive.length !== current.length) {
      setBookmarks((live) => live.filter((b) => alive.some((a) => a.path === b.path)));
    }
  }, []);

  /**
   * Follows an operation on a whole Set: renaming it moves every project inside it,
   * deleting it takes them with it. `null` as the new path drops those bookmarks.
   */
  const retargetBookmarksUnder = useCallback(
    (oldSetPath: string, next: { setPath: string; setName: string } | null) => {
      setBookmarks((current) => {
        const prefix = `${oldSetPath}/`;
        if (!current.some((b) => b.path.startsWith(prefix))) return current;
        if (!next) return current.filter((b) => !b.path.startsWith(prefix));
        return current.map((b) =>
          b.path.startsWith(prefix)
            ? {
                ...b,
                path: `${next.setPath}/${b.path.slice(prefix.length)}`,
                setPath: next.setPath,
                setName: next.setName,
              }
            : b,
        );
      });
    },
    [],
  );

  return {
    bookmarks,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    retargetBookmark,
    retargetBookmarksUnder,
    pruneMissingBookmarks,
  };
}
