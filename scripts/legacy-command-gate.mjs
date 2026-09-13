import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const LIST_NAMES = ["READ_COMMANDS", "AUTHORIZED_COMMANDS", "DISABLED_COMMANDS"];

/** @param {string} gateRsText */
export function parseLegacyGateLists(gateRsText) {
  /** @type {Record<string, string[]>} */
  const lists = {};
  for (const name of LIST_NAMES) {
    const re = new RegExp(
      `pub const ${name}:\\s*&\\[\\&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\];`,
    );
    const match = gateRsText.match(re);
    if (!match) {
      throw new Error(`legacy_command_gate.rs missing ${name}`);
    }
    const items = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    lists[name] = items;
  }
  return lists;
}

/** @param {string} source @param {string} fnName */
function findTauriCommandHandler(source, fnName) {
  const re =
    /#\[tauri::command\][\s\S]*?\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (match[1] === fnName) {
      return match;
    }
  }
  return null;
}

/** @param {string} source @param {number} bodyOpen */
function firstExecutableAfterBodyOpen(source, bodyOpen) {
  let index = bodyOpen + 1;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1;
    }
    if (index >= source.length) {
      return "";
    }
    if (source.startsWith("//", index)) {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    return source.slice(index);
  }
  return "";
}

/** @param {string} libRsText */
export function extractGenerateHandlerLegacyCommands(libRsText) {
  const handlerMatch = libRsText.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!handlerMatch) {
    throw new Error("lib.rs missing generate_handler!");
  }
  return handlerMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("v2_api::"));
}

/**
 * @param {{ gateRs?: string, libRs?: string, projectManagerRs?: string, repositoryRoot?: string }} [options]
 * @returns {{ errors: string[], lists: Record<string, string[]>, handlerLegacy: string[] }}
 */
export function validateLegacyCommandContainment(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const gateRs =
    options.gateRs ??
    readFileSync(path.join(root, "src-tauri/src/legacy_command_gate.rs"), "utf8");
  const libRs =
    options.libRs ?? readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const projectManagerRs =
    options.projectManagerRs ??
    readFileSync(path.join(root, "src-tauri/src/project_manager.rs"), "utf8");

  const errors = [];
  const lists = parseLegacyGateLists(gateRs);
  const handlerLegacy = extractGenerateHandlerLegacyCommands(libRs);

  const read = lists.READ_COMMANDS;
  const authorized = lists.AUTHORIZED_COMMANDS;
  const disabled = lists.DISABLED_COMMANDS;

  if (read.length + authorized.length + disabled.length !== 84) {
    errors.push(
      `legacy gate must partition 84 commands (39+7+38); got ${read.length}+${authorized.length}+${disabled.length}`,
    );
  }

  const all = [...read, ...authorized, ...disabled];
  const seen = new Set();
  for (const name of all) {
    if (seen.has(name)) {
      errors.push(`duplicate legacy command classification: ${name}`);
    }
    seen.add(name);
  }

  const classified = new Set(all);
  const handlerSet = new Set(handlerLegacy);
  for (const name of handlerLegacy) {
    if (!classified.has(name)) {
      errors.push(`generate_handler legacy entry is not classified: ${name}`);
    }
  }
  for (const name of all) {
    if (!handlerSet.has(name)) {
      errors.push(`classified legacy command missing from generate_handler: ${name}`);
    }
  }

  if (!libRs.includes("mod legacy_command_gate")) {
    errors.push("lib.rs must declare mod legacy_command_gate (gate wiring)");
  }

  if (!disabled.includes("purge_project_files") || !disabled.includes("purge_pool_files")) {
    errors.push("purge_* commands must be in DISABLED_COMMANDS");
  }
  if (read.includes("purge_project_files") || read.includes("purge_pool_files")) {
    errors.push("purge_* must not be classified as read commands");
  }

  for (const command of disabled) {
    const shortName = command.startsWith("project_manager::")
      ? command.slice("project_manager::".length)
      : command;
    const source = command.startsWith("project_manager::") ? projectManagerRs : libRs;
    const handlerMatch = findTauriCommandHandler(source, shortName);
    if (!handlerMatch) {
      errors.push(`disabled command has no handler stub: ${command}`);
      continue;
    }
    const fnStart = handlerMatch.index + handlerMatch[0].lastIndexOf(`fn ${shortName}`);
    const sigClose = source.indexOf(") ->", fnStart);
    const bodyOpen =
      sigClose === -1
        ? -1
        : source.indexOf("{", sigClose);
    if (bodyOpen === -1) {
      errors.push(`disabled command handler has no body: ${command}`);
      continue;
    }
    const firstStatement = firstExecutableAfterBodyOpen(source, bodyOpen);
    if (!firstStatement.startsWith("crate::deny_legacy_write!()")) {
      errors.push(`disabled command must deny before body work: ${command}`);
    }
  }

  return { errors, lists, handlerLegacy };
}
