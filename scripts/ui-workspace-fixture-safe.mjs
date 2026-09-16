import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const FIXTURE_ROOT_BASENAME = "octatrack-set-root";

/** @returns {string[]} canonical trusted temp directory roots */
export function trustedTempRoots() {
  const candidates = [tmpdir(), "/tmp", "/private/tmp", "/var/folders"];
  const roots = new Set();
  for (const candidate of candidates) {
    try {
      roots.add(realpathSync(candidate));
    } catch {
      /* ignore missing */
    }
  }
  return [...roots];
}

/** @param {string} path */
function canonicalPath(path) {
  return realpathSync(path);
}

/**
 * @param {string} child
 * @param {string} parentCanonical
 */
export function isPathInside(childCanonical, parentCanonical) {
  if (childCanonical === parentCanonical) return true;
  const prefix = parentCanonical.endsWith(sep) ? parentCanonical : `${parentCanonical}${sep}`;
  return childCanonical.startsWith(prefix);
}

/** @param {string} path */
export function assertNotSymlink(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink (${path})`);
  }
}

/** @param {string} path */
export function assertDirectoryEmpty(path) {
  const entries = readdirSync(path);
  if (entries.length > 0) {
    throw new Error(`fixture root must be empty (${path})`);
  }
}

/**
 * @param {string} fixtureRoot absolute path to validate before generation
 */
export function validateEmptyFixtureRoot(fixtureRoot) {
  if (!fixtureRoot || fixtureRoot.trim() === "") {
    throw new Error("fixture root path is required");
  }
  const resolved = resolve(fixtureRoot);
  if (!existsSync(resolved)) {
    throw new Error(`fixture root does not exist (${resolved})`);
  }
  assertNotSymlink(resolved, "fixture root");
  let canonical;
  try {
    canonical = canonicalPath(resolved);
  } catch {
    throw new Error(`fixture root could not be canonicalized (${resolved})`);
  }
  assertNotSymlink(canonical, "canonical fixture root");
  const trusted = trustedTempRoots();
  if (!trusted.some((root) => isPathInside(canonical, root))) {
    throw new Error(
      `fixture root must live under a trusted temp directory (got ${canonical})`,
    );
  }
  const stat = lstatSync(canonical);
  if (!stat.isDirectory()) {
    throw new Error(`fixture root must be a directory (${canonical})`);
  }
  assertDirectoryEmpty(canonical);
  if (existsSync(join(canonical, "SET"))) {
    throw new Error(`refusing to reuse existing Octatrack layout under ${canonical}`);
  }
  return canonical;
}

/**
 * Creates a new empty directory under a trusted temp root.
 * @returns {string} canonical fixture root path
 */
export function createManagedFixtureRoot() {
  const trusted = trustedTempRoots();
  if (trusted.length === 0) {
    throw new Error("no trusted temp directory available");
  }
  const base = trusted[0];
  const prefix = join(base, "mo-ui-native-set-");
  const created = mkdtempSync(prefix);
  assertNotSymlink(created, "managed fixture root");
  return canonicalPath(created);
}

/**
 * @param {string} dir
 */
export function mkdirExclusive(dir) {
  const parent = dirname(dir);
  if (dir !== parent) {
    mkdirExclusive(parent);
  }
  try {
    mkdirSync(dir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const stat = lstatSync(dir);
      if (!stat.isDirectory()) {
        throw new Error(`path exists and is not a directory (${dir})`);
      }
      return;
    }
    throw error;
  }
  assertNotSymlink(dir, "created directory");
}

/**
 * @param {string} filePath
 * @param {Buffer} data
 */
export function writeFileExclusive(filePath, data) {
  mkdirExclusive(dirname(filePath));
  try {
    writeFileSync(filePath, data, { flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`refusing to overwrite existing file (${filePath})`);
    }
    throw error;
  }
}

/**
 * @param {string} ownedRoot canonical path created by this run
 */
export function cleanupOwnedFixtureRoot(ownedRoot) {
  if (!ownedRoot) return;
  try {
    const canonical = canonicalPath(ownedRoot);
    const trusted = trustedTempRoots();
    if (!trusted.some((root) => isPathInside(canonical, root))) {
      return;
    }
    rmSync(canonical, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export { FIXTURE_ROOT_BASENAME };
