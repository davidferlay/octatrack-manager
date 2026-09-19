import { accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p || seen.has(p)) {
      continue;
    }
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * Resolve the real user home used for Rust/Node toolchains (not app data).
 */
export function resolveRealHome(env) {
  const realHome = env.REAL_HOME?.trim() || env.HOME?.trim() || "";
  if (!realHome) {
    throw new Error("REAL_HOME or HOME is required to resolve the Rust toolchain");
  }
  return realHome;
}

export function resolveCargoHome(env, realHome) {
  return (env.CARGO_HOME?.trim() || join(realHome, ".cargo")).replace(/\/+$/, "");
}

export function resolveRustupHome(env, realHome) {
  return (env.RUSTUP_HOME?.trim() || join(realHome, ".rustup")).replace(/\/+$/, "");
}

/**
 * Find cargo without requiring it to already be on PATH (Case A/B).
 */
export function resolveCargoExecutable({ pathEnv, cargoHome, realHome }) {
  const candidates = [];
  for (const dir of (pathEnv ?? "").split(":")) {
    if (dir) {
      candidates.push(join(dir, "cargo"));
    }
  }
  candidates.push(join(cargoHome, "bin", "cargo"));
  candidates.push(join(realHome, ".cargo", "bin", "cargo"));

  for (const candidate of uniquePaths(candidates)) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function prependDirToPath(pathEnv, dir) {
  if (!dir) {
    return pathEnv ?? "";
  }
  const normalized = pathEnv ?? "";
  if (normalized.split(":").includes(dir)) {
    return normalized;
  }
  return normalized ? `${dir}:${normalized}` : dir;
}

export function prependCommandDirToPath(pathEnv, command, lookupPath) {
  const pathForLookup = lookupPath ?? pathEnv ?? "";
  const segments = pathForLookup.split(":").filter(Boolean);
  for (const dir of segments) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) {
      return prependDirToPath(pathEnv, dir);
    }
  }
  return pathEnv ?? "";
}

/**
 * Child process env: isolated app HOME, real toolchain homes, PATH with real cargo/node/pnpm.
 */
export function buildNativeAcceptanceChildEnv({
  isolatedHome,
  realHome,
  pathEnv,
  cargoHome,
  rustupHome,
}) {
  if (!isolatedHome?.trim()) {
    throw new Error("isolatedHome is required");
  }

  let childPath = pathEnv ?? "";
  childPath = prependCommandDirToPath(childPath, "node", childPath);
  childPath = prependCommandDirToPath(childPath, "pnpm", childPath);

  const resolvedCargoHome = cargoHome ?? resolveCargoHome({}, realHome);
  const resolvedRustupHome = rustupHome ?? resolveRustupHome({}, realHome);
  const cargoBin = resolveCargoExecutable({
    pathEnv: childPath,
    cargoHome: resolvedCargoHome,
    realHome,
  });

  if (!cargoBin) {
    return {
      ok: false,
      error: `cargo not found; checked PATH and ${resolvedCargoHome}/bin and ${realHome}/.cargo/bin`,
    };
  }

  childPath = prependDirToPath(childPath, dirname(cargoBin));

  return {
    ok: true,
    env: {
      HOME: isolatedHome,
      PATH: childPath,
      CARGO_HOME: resolvedCargoHome,
      RUSTUP_HOME: resolvedRustupHome,
      REAL_HOME: realHome,
    },
    cargoBin,
  };
}

function parseArgs(argv) {
  const args = { mode: "child-env" };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--real-home":
        args.realHome = value;
        i += 1;
        break;
      case "--isolated-home":
        args.isolatedHome = value;
        i += 1;
        break;
      case "--path":
        args.path = value;
        i += 1;
        break;
      case "--cargo-home":
        args.cargoHome = value;
        i += 1;
        break;
      case "--rustup-home":
        args.rustupHome = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  const args = parseArgs(process.argv);
  const realHome = args.realHome ?? resolveRealHome(process.env);
  const result = buildNativeAcceptanceChildEnv({
    isolatedHome: args.isolatedHome,
    realHome,
    pathEnv: args.path ?? process.env.PATH ?? "",
    cargoHome: args.cargoHome || undefined,
    rustupHome: args.rustupHome || undefined,
  });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(result.env)}\n`);
}
