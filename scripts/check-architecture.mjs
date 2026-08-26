import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  ["ot-storage-ports", ["ot-domain"]],
  [
    "ot-application",
    ["ot-codec-ports", "ot-domain", "ot-storage-ports"],
  ],
]);
const allowedCompositionDependencies = new Set([
  "ot-application",
  "ot-domain",
  "ot-storage-ports",
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

const legacyPackage = packagesByName.get("octatrack-manager");
if (!legacyPackage) {
  failures.push("missing legacy octatrack-manager package");
} else {
  const nextCoreNames = new Set(dependencyRules.keys());
  const unauthorizedDependencies = legacyPackage.dependencies
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
  "v2_library_list",
  "v2_root_close",
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
  const rawPathParameters = parameters.match(
    /\b(?:raw_path|path|[a-z0-9_]+_path)\s*:\s*(?:String|PathBuf)/g,
  ) ?? [];
  if (commandName === "v2_root_register") {
    if (
      rawPathParameters.length !== 1 ||
      !rawPathParameters[0].startsWith("raw_path")
    ) {
      failures.push("v2_root_register must be the only raw path boundary");
    }
  } else if (rawPathParameters.length > 0) {
    failures.push(
      `${commandName} must not accept raw path parameters: ${rawPathParameters.join(", ")}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Architecture dependency check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Architecture dependency rules passed.");
