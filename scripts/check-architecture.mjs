import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestPath = path.join(repositoryRoot, "src-tauri", "Cargo.toml");
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      manifestPath,
      "--no-deps",
      "--format-version",
      "1",
    ],
    { encoding: "utf8" },
  ),
);

const dependencyRules = new Map([
  ["ot-domain", []],
  ["ot-codec-ports", ["ot-domain"]],
  ["ot-codec", ["encoding_rs", "ot-codec-ports", "ot-domain"]],
  ["ot-storage-ports", ["ot-domain"]],
  [
    "ot-catalog",
    ["ot-domain", "ot-storage-ports", "rusqlite"],
  ],
  [
    "ot-audio",
    ["ot-domain", "serde", "serde_json", "sha2", "symphonia"],
  ],
  ["ot-plan", ["ot-domain", "sha2"]],
  [
    "ot-backup",
    ["ot-domain", "ot-plan", "rustix", "serde", "serde_json", "sha2"],
  ],
  [
    "ot-executor",
    [
      "fs2",
      "ot-backup",
      "ot-codec-ports",
      "ot-domain",
      "ot-plan",
      "rustix",
      "serde",
      "serde_json",
      "sha2",
    ],
  ],
  [
    "ot-application",
    ["ot-codec-ports", "ot-domain", "ot-storage-ports"],
  ],
]);
const devDependencyRules = new Map(
  [...dependencyRules.keys()].map((packageName) => [packageName, []]),
);
devDependencyRules.set("ot-catalog", ["tempfile"]);
devDependencyRules.set("ot-audio", ["tempfile"]);
devDependencyRules.set("ot-backup", ["tempfile"]);
devDependencyRules.set("ot-executor", ["ot-codec", "tempfile"]);
devDependencyRules.set("ot-codec", ["ot-tools-io"]);
const allowedCompositionDependencies = new Set([
  "ot-application",
  "ot-audio",
  "ot-backup",
  "ot-catalog",
  "ot-codec",
  "ot-domain",
  "ot-executor",
  "ot-plan",
  "ot-storage-ports",
]);
const allowedCompositionDevDependencies = new Set([
  "tempfile",
]);
const packagesByName = new Map(
  metadata.packages.map((cargoPackage) => [cargoPackage.name, cargoPackage]),
);
const failures = [];

for (const [packageName, allowedDependencies] of dependencyRules) {
  const cargoPackage = packagesByName.get(packageName);
  if (!cargoPackage) {
    failures.push(`missing workspace package: ${packageName}`);
    continue;
  }

  const actualDependencies = cargoPackage.dependencies
    .filter((dependency) => dependency.kind !== "dev")
    .map((dependency) => dependency.name)
    .sort();
  const expectedDependencies = [...allowedDependencies].sort();
  if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
    failures.push(
      `${packageName} dependencies must be [${expectedDependencies.join(", ")}], ` +
        `found [${actualDependencies.join(", ")}]`,
    );
  }
}

for (const [packageName, allowedDependencies] of devDependencyRules) {
  const cargoPackage = packagesByName.get(packageName);
  if (!cargoPackage) continue;

  const actualDependencies = cargoPackage.dependencies
    .filter((dependency) => dependency.kind === "dev")
    .map((dependency) => dependency.name)
    .sort();
  const expectedDependencies = [...allowedDependencies].sort();
  if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
    failures.push(
      `${packageName} dev dependencies must be [${expectedDependencies.join(", ")}], ` +
        `found [${actualDependencies.join(", ")}]`,
    );
  }
}

const legacyPackage = packagesByName.get("masterocta");
if (!legacyPackage) {
  failures.push("missing MasterOCTa composition package");
} else {
  const nextCoreNames = new Set(dependencyRules.keys());
  const actualCompositionDependencies = legacyPackage.dependencies
    .filter((dependency) => allowedCompositionDependencies.has(dependency.name))
    .map((dependency) => dependency.name)
    .sort();
  const expectedCompositionDependencies = [...allowedCompositionDependencies].sort();
  if (
    JSON.stringify(actualCompositionDependencies) !==
    JSON.stringify(expectedCompositionDependencies)
  ) {
    failures.push(
      "Tauri composition root dependencies must be [" +
        expectedCompositionDependencies.join(", ") +
        `], found [${actualCompositionDependencies.join(", ")}]`,
    );
  }
  const unauthorizedDependencies = legacyPackage.dependencies
    .filter((dependency) => dependency.kind !== "dev")
    .map((dependency) => dependency.name)
    .filter(
      (name) => nextCoreNames.has(name) && !allowedCompositionDependencies.has(name),
    );
  if (unauthorizedDependencies.length > 0) {
    failures.push(
      "Tauri composition root has unauthorized next-core dependencies: " +
        unauthorizedDependencies.join(", "),
    );
  }
  const actualCompositionDevDependencies = legacyPackage.dependencies
    .filter((dependency) => dependency.kind === "dev")
    .map((dependency) => dependency.name)
    .sort();
  const expectedCompositionDevDependencies = [
    ...allowedCompositionDevDependencies,
  ].sort();
  if (
    JSON.stringify(actualCompositionDevDependencies) !==
    JSON.stringify(expectedCompositionDevDependencies)
  ) {
    failures.push(
      "Tauri composition root dev dependencies must be [" +
        expectedCompositionDevDependencies.join(", ") +
        `], found [${actualCompositionDevDependencies.join(", ")}]`,
    );
  }
}

const v2ApiSource = readFileSync(
  path.join(repositoryRoot, "src-tauri", "src", "v2_api.rs"),
  "utf8",
);
const v2Commands = [
  ...v2ApiSource.matchAll(
    /#\[tauri::command\]\s*pub async fn (v2_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*->/g,
  ),
];
const expectedV2Commands = [
  "v2_asset_metadata_get",
  "v2_asset_metadata_replace",
  "v2_audio_preview_create",
  "v2_audio_preview_read",
  "v2_audio_waveform_get",
  "v2_change_apply",
  "v2_change_get_plan",
  "v2_change_plan",
  "v2_change_recover",
  "v2_change_recovery_status",
  "v2_change_status",
  "v2_clone_create_managed",
  "v2_clone_issue_authority",
  "v2_clone_record_source_evidence",
  "v2_clone_reverify",
  "v2_clone_verification_status",
  "v2_clone_verify_external",
  "v2_library_list",
  "v2_rename_apply",
  "v2_rename_authorize",
  "v2_rename_continuation_status",
  "v2_rename_continue",
  "v2_rename_create_backup",
  "v2_rename_get_plan",
  "v2_rename_get_prepared_plan",
  "v2_rename_get_status",
  "v2_rename_plan",
  "v2_rename_prepare",
  "v2_rename_recover",
  "v2_rename_recovery_status",
  "v2_rename_verify_committed",
  "v2_rename_verify_rolled_back",
  "v2_root_close",
  "v2_root_disable_write",
  "v2_root_enable_write",
  "v2_root_register",
  "v2_root_status",
];
const actualV2Commands = v2Commands.map((match) => match[1]).sort();
if (JSON.stringify(actualV2Commands) !== JSON.stringify(expectedV2Commands)) {
  failures.push(
    `v2 command surface must be [${expectedV2Commands.join(", ")}], ` +
      `found [${actualV2Commands.join(", ")}]`,
  );
}

for (const [, commandName, parameters] of v2Commands) {
  const pathParameters = parameters.match(
    /\b(?:raw_path|path|[a-z0-9_]+_path)\s*:\s*(?:String|PathBuf)/g,
  ) ?? [];
  if (commandName === "v2_root_register") {
    if (
      pathParameters.length !== 1 ||
      !pathParameters[0].startsWith("raw_path")
    ) {
      failures.push("v2_root_register must be the only raw path boundary");
    }
  } else if (commandName === "v2_change_plan" || commandName === "v2_rename_plan") {
    if (
      pathParameters.length !== 1 ||
      !pathParameters[0].startsWith("destination_relative_path")
    ) {
      failures.push(
        `${commandName} may accept only one explicitly named root-relative destination path`,
      );
    }
  } else if (pathParameters.length > 0) {
    failures.push(
      `${commandName} must not accept raw path parameters: ${pathParameters.join(", ")}`,
    );
  }
}

if (
  !v2ApiSource.includes(
    "RootRelativePath::parse(destination_relative_path)",
  )
) {
  failures.push(
    "v2_change_plan and v2_rename_plan destination must cross the RootRelativePath validation boundary",
  );
}

const colorTokens = readFileSync(
  path.join(repositoryRoot, "src/design-system/tokens/color.css"),
  "utf8",
);
if (/--elektron-/.test(colorTokens)) {
  failures.push(
    "design-system color tokens must not define --elektron-* compat aliases (DS7)",
  );
}

const srcRoot = path.join(repositoryRoot, "src");
const elektronCallSites = [];
function walkSrc(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSrc(fullPath);
      continue;
    }
    if (!/\.(css|tsx|ts|jsx|js)$/.test(entry.name)) continue;
    const relative = path.relative(repositoryRoot, fullPath);
    if (relative === "src/design-system/tokens/color.css") continue;
    const contents = readFileSync(fullPath, "utf8");
    if (/--elektron-/.test(contents)) {
      elektronCallSites.push(relative);
    }
  }
}
walkSrc(srcRoot);
if (elektronCallSites.length > 0) {
  failures.push(
    "DS7 forbids --elektron-* call sites; found in: " +
      elektronCallSites.join(", "),
  );
}

if (failures.length > 0) {
  console.error("Architecture dependency check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Architecture dependency rules passed.");

