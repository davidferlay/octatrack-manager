/** Split a root-relative path into parent directory and basename. */
export function splitRelativePath(relativePath: string): {
  parentPath: string;
  basename: string;
} {
  const lastSlash = relativePath.lastIndexOf("/");
  if (lastSlash < 0) {
    return { parentPath: "", basename: relativePath };
  }
  return {
    parentPath: relativePath.slice(0, lastSlash),
    basename: relativePath.slice(lastSlash + 1),
  };
}

/** Combine parent directory with a new basename (same-directory rename). */
export function combineBasename(parentPath: string, basename: string): string {
  const trimmed = basename.trim();
  if (parentPath === "") return trimmed;
  return `${parentPath}/${trimmed}`;
}

export type BasenameValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/** Frontend convenience validation; backend remains authoritative. */
export function validateBasename(
  newBasename: string,
  currentBasename: string,
): BasenameValidationResult {
  const trimmed = newBasename.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter a new file name." };
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return { ok: false, message: "Directory changes are not supported in this step." };
  }
  if (trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    return { ok: false, message: "The new name contains an unsafe path component." };
  }
  if (trimmed.includes("\0")) {
    return { ok: false, message: "The new name contains invalid characters." };
  }
  if (trimmed === currentBasename) {
    return { ok: false, message: "The new name matches the current name." };
  }
  return { ok: true };
}
