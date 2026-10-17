import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  cargoArgsForSuite,
  loadInventory,
  parseExecutedTests,
  parseListedTests,
  requiredTestStatus,
} from "./pse-read-model-check.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);

describe("pse read-model inventory", () => {
  it("loads the committed inventory schema and required tests", () => {
    const inventory = loadInventory();
    assert.equal(inventory.schema, "masterocta-pse-read-model-inventory:v1");
    assert.ok(inventory.suites.length >= 2);
    const names = inventory.suites.flatMap((suite) => suite.required_tests);
    assert.ok(names.includes("working_and_saved_bank_documents_stay_separate_entries"));
    assert.ok(names.includes("patterns_using_part_follows_the_reference_not_nesting"));
    assert.ok(names.includes("unmodeled_dependencies_are_explicit"));
  });

  it("keeps the existing cargo feature split", () => {
    const inventory = loadInventory();
    const domain = inventory.suites.find((suite) => suite.package === "ot-domain");
    const app = inventory.suites.find((suite) => suite.package === "masterocta");
    assert.deepEqual(domain.features, []);
    assert.deepEqual(app.features, ["test-seams"]);
    assert.deepEqual(cargoArgsForSuite(app, ["--list"]).slice(0, 7), [
      "test",
      "--locked",
      "-p",
      "masterocta",
      "--lib",
      "--features",
      "test-seams",
    ]);
    assert.ok(!cargoArgsForSuite(domain, ["--list"]).includes("--workspace"));
    for (const suite of inventory.suites) {
      assert.equal(
        suite.filter.includes("|"),
        false,
        `${suite.id} must use a cargo substring filter, not a regex alternation`,
      );
    }
  });
});

describe("pse read-model cargo parsers", () => {
  it("treats a zero-test cargo success as a failure condition", () => {
    const listed = parseListedTests("0 tests, 0 benchmarks\n");
    assert.deepEqual(listed.tests, []);
    const executed = parseExecutedTests(
      "running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out\n",
    );
    assert.equal(executed.passedCount, 0);
    assert.equal(executed.failedCount, 0);
  });

  it("detects missing, ignored, and not-run required tests", () => {
    const status = requiredTestStatus(
      ["keep_me", "ignored_me", "missing_me", "not_executed"],
      ["module::tests::keep_me", "module::tests::not_executed"],
      ["module::tests::ignored_me"],
      ["module::tests::keep_me"],
    );
    assert.deepEqual(status.missing, ["missing_me"]);
    assert.deepEqual(status.ignoredRequired, ["ignored_me"]);
    assert.deepEqual(status.notRun, ["not_executed"]);
  });

  it("parses executed cargo lines including failures", () => {
    const parsed = parseExecutedTests(`
test project_structure_reader::tests::alpha ... ok
test project_structure_reader::tests::beta ... FAILED
test project_structure_reader::tests::gamma ... ignored

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out
`);
    assert.deepEqual(parsed.executed, [
      "project_structure_reader::tests::alpha",
      "project_structure_reader::tests::beta",
    ]);
    assert.deepEqual(parsed.failed, ["project_structure_reader::tests::beta"]);
    assert.equal(parsed.passedCount, 1);
  });
});

describe("pse read-model package wiring", () => {
  it("exposes the shared entry in package.json", () => {
    assert.equal(
      packageJson.scripts["test:pse-read-model"],
      "node scripts/pse-read-model-check.mjs",
    );
    assert.equal(
      packageJson.scripts["test:pse-scripts"],
      "node --test scripts/pse-fixture-manifest.test.mjs scripts/pse-read-model-check.test.mjs scripts/pse-ci-scope.test.mjs scripts/pse-ci-aggregate.test.mjs scripts/pse-ci-workflow.test.mjs scripts/pse-bank-mutation-guard.test.mjs scripts/pse-bank-multi-device-manifest.test.mjs scripts/pse-bank-internal-identity-audit.test.mjs scripts/pse-arrangement-capture.test.mjs scripts/pse-bank-identity-device.test.mjs scripts/pse-bank-identity-device-2.test.mjs scripts/pse-bank-identity-crossover.test.mjs scripts/pse-pattern-paste-persistence.test.mjs scripts/pse-bank-copy-state-doc-device-evidence.test.mjs",
    );
    assert.equal(
      packageJson.scripts["check:pse-bank-mutation"],
      "node scripts/pse-bank-mutation-guard.mjs",
    );
  });

  it("canonicalizes the copied tree before invoking the reader", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "scripts/pse-read-model-check.mjs"),
      "utf8",
    );
    assert.match(source, /realpathSync\(tree\)/);
    assert.match(source, /canonicalRoot/);
  });
});
