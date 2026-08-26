import { execFileSync } from "node:child_process";
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
  const prematureDependencies = legacyPackage.dependencies
    .map((dependency) => dependency.name)
    .filter((name) => nextCoreNames.has(name));
  if (prematureDependencies.length > 0) {
    failures.push(
      "legacy runtime must not depend on next-core crates in PR-1: " +
        prematureDependencies.join(", "),
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
