import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPARE_SCHEMA,
  EXPECTED_SCHEMA,
  EXCLUSION_POLICY,
  MANIFEST_SCHEMA,
  ManifestStop,
  captureRoot,
  captureToFile,
  compareManifests,
  decodeUtf8EntryName,
  expectedFromPreparedPlan,
  isIgnoredHostMetadata,
  loadManifestFile,
  parseExpectedChanges,
  parseManifest,
  writeManifestAtomic,
} from "./gate-c-byte-manifest.mjs";

const scriptPath = fileURLToPath(new URL("./gate-c-byte-manifest.mjs", import.meta.url));

function makeTree() {
  const root = mkdtempSync(path.join(tmpdir(), "gate-c-manifest-"));
  mkdirSync(path.join(root, "SET", "AUDIO"), { recursive: true });
  mkdirSync(path.join(root, "SET", "PROJECT"), { recursive: true });
  mkdirSync(path.join(root, "SET", "UNRELATED"), { recursive: true });
  writeFileSync(path.join(root, "SET", "AUDIO", "source.wav"), "wav-bytes-aa");
  writeFileSync(path.join(root, "SET", "AUDIO", "source.ot"), "sidecar-aa");
  writeFileSync(path.join(root, "SET", "PROJECT", "project.work"), "project-v1");
  writeFileSync(path.join(root, "SET", "UNRELATED", "keep.txt"), "sentinel");
  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("host metadata allowlist", () => {
  it("matches only the explicit macOS names", () => {
    assert.equal(isIgnoredHostMetadata(".Spotlight-V100"), true);
    assert.equal(isIgnoredHostMetadata(".Trashes"), true);
    assert.equal(isIgnoredHostMetadata(".fseventsd"), true);
    assert.equal(isIgnoredHostMetadata(".DS_Store"), true);
    assert.equal(isIgnoredHostMetadata("._sample.wav"), true);
    assert.equal(isIgnoredHostMetadata(".hidden"), false);
    assert.equal(isIgnoredHostMetadata(".custom"), false);
    assert.equal(isIgnoredHostMetadata("unexpected.bin"), false);
  });
});

describe("capture", () => {
  it("produces a deterministic manifest for the same tree", () => {
    const root = makeTree();
    try {
      const first = captureRoot(root);
      const second = captureRoot(root);
      assert.equal(first.schema, MANIFEST_SCHEMA);
      assert.equal(first.exclusion_policy, EXCLUSION_POLICY);
      assert.deepEqual(first, second);
      const paths = first.entries.map((entry) => entry.relative_path);
      const sorted = [...paths].sort((left, right) =>
        Buffer.from(left).compare(Buffer.from(right)),
      );
      assert.deepEqual(paths, sorted);
    } finally {
      cleanup(root);
    }
  });

  it("excludes explicit macOS metadata and keeps unknown dotfiles", () => {
    const root = makeTree();
    try {
      writeFileSync(path.join(root, ".DS_Store"), "meta");
      mkdirSync(path.join(root, ".Spotlight-V100"));
      writeFileSync(path.join(root, ".Spotlight-V100", "store"), "nope");
      writeFileSync(path.join(root, "._skip.wav"), "appledouble");
      writeFileSync(path.join(root, ".hidden-keep"), "keep-me");
      const manifest = captureRoot(root);
      const paths = manifest.entries.map((entry) => entry.relative_path);
      assert.equal(paths.includes(".DS_Store"), false);
      assert.equal(paths.includes(".Spotlight-V100"), false);
      assert.equal(paths.includes("._skip.wav"), false);
      assert.equal(paths.includes(".hidden-keep"), true);
      assert.ok(manifest.excluded_entry_count >= 3);
    } finally {
      cleanup(root);
    }
  });

  it("captures Unicode and space paths", () => {
    const root = makeTree();
    try {
      writeFileSync(path.join(root, "SET", "AUDIO", "kick drum 名前.wav"), "unicode");
      const manifest = captureRoot(root);
      assert.ok(
        manifest.entries.some(
          (entry) => entry.relative_path === "SET/AUDIO/kick drum 名前.wav",
        ),
      );
    } finally {
      cleanup(root);
    }
  });

  it("captures newline paths as JSON-safe relative paths", () => {
    const root = makeTree();
    try {
      writeFileSync(path.join(root, "SET", "AUDIO", "line\nbreak.wav"), "nl");
      const manifest = captureRoot(root);
      const entry = manifest.entries.find(
        (item) => item.relative_path === "SET/AUDIO/line\nbreak.wav",
      );
      assert.ok(entry);
      const serialized = JSON.stringify(manifest);
      assert.equal(JSON.parse(serialized).entries.some(
        (item) => item.relative_path === "SET/AUDIO/line\nbreak.wav",
      ), true);
    } finally {
      cleanup(root);
    }
  });

  it("fail-closes on fifo entries", () => {
    const root = makeTree();
    const fifo = path.join(root, "SET", "UNRELATED", "pipe");
    try {
      const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
      assert.equal(
        made.status,
        0,
        `mkfifo failed: ${made.stderr || made.stdout || "unknown error"}`,
      );
      assert.throws(() => captureRoot(root), (error) => {
        assert.equal(error instanceof ManifestStop, true);
        assert.equal(error.code, "FORBIDDEN_ENTRY_TYPE");
        return true;
      });
    } finally {
      cleanup(root);
    }
  });

  it("fail-closes on non-UTF-8 directory entry names", () => {
    assert.throws(
      () => decodeUtf8EntryName(Buffer.from([0xff, 0xfe])),
      (error) => {
        assert.equal(error instanceof ManifestStop, true);
        assert.equal(error.code, "NON_UTF8_NAME");
        return true;
      },
    );
  });

  it("fail-closes on symlinks without following them", () => {
    const root = makeTree();
    try {
      symlinkSync(
        path.join(root, "SET", "UNRELATED", "keep.txt"),
        path.join(root, "SET", "UNRELATED", "link.txt"),
      );
      assert.throws(() => captureRoot(root), (error) => {
        assert.equal(error instanceof ManifestStop, true);
        assert.equal(error.code, "FORBIDDEN_ENTRY_TYPE");
        return true;
      });
    } finally {
      cleanup(root);
    }
  });

  it("does not leave a successful manifest after capture failure", () => {
    const root = makeTree();
    const outputDir = mkdtempSync(path.join(tmpdir(), "gate-c-out-"));
    const output = path.join(outputDir, "pre.json");
    try {
      symlinkSync("/tmp", path.join(root, "escape"));
      assert.throws(() => captureToFile(root, output));
      assert.throws(() => readFileSync(output));
    } finally {
      cleanup(root);
      cleanup(outputDir);
    }
  });

  it("does not silently skip unreadable files", () => {
    const root = makeTree();
    const target = path.join(root, "SET", "UNRELATED", "secret.txt");
    writeFileSync(target, "secret");
    chmodSync(target, 0);
    try {
      assert.throws(() => captureRoot(root), (error) => {
        assert.equal(error instanceof ManifestStop, true);
        assert.equal(error.code, "UNREADABLE");
        return true;
      });
    } finally {
      chmodSync(target, 0o644);
      cleanup(root);
    }
  });

  it("rejects writing the manifest inside the clone root", () => {
    const root = makeTree();
    try {
      assert.throws(
        () => captureToFile(root, path.join(root, "manifest.json")),
        (error) => error instanceof ManifestStop && error.code === "OUTPUT_INSIDE_ROOT",
      );
    } finally {
      cleanup(root);
    }
  });
});

describe("compare", () => {
  it("detects SHA-256 content changes", () => {
    const root = makeTree();
    try {
      const pre = captureRoot(root);
      writeFileSync(path.join(root, "SET", "UNRELATED", "keep.txt"), "changed");
      const post = captureRoot(root);
      const report = compareManifests(pre, post, null);
      assert.equal(report.schema, COMPARE_SCHEMA);
      assert.equal(report.verdict, "STOP");
      assert.equal(
        report.diffs.some(
          (diff) =>
            diff.class === "content_changed" &&
            diff.relative_path === "SET/UNRELATED/keep.txt",
        ),
        true,
      );
    } finally {
      cleanup(root);
    }
  });

  it("detects same-size same-mtime different content", () => {
    const root = makeTree();
    const target = path.join(root, "SET", "UNRELATED", "keep.txt");
    try {
      const pre = captureRoot(root);
      const stats = {
        atime: new Date("2020-01-01T00:00:00Z"),
        mtime: new Date("2020-01-01T00:00:00Z"),
      };
      writeFileSync(target, "sentineX");
      utimesSync(target, stats.atime, stats.mtime);
      const post = captureRoot(root);
      const preFile = pre.entries.find(
        (entry) => entry.relative_path === "SET/UNRELATED/keep.txt",
      );
      const postFile = post.entries.find(
        (entry) => entry.relative_path === "SET/UNRELATED/keep.txt",
      );
      assert.equal(preFile.byte_size, postFile.byte_size);
      assert.notEqual(preFile.sha256, postFile.sha256);
      const report = compareManifests(pre, post, null);
      assert.equal(
        report.diffs.some((diff) => diff.class === "content_changed"),
        true,
      );
    } finally {
      cleanup(root);
    }
  });

  it("distinguishes added, removed, modified, and type changed", () => {
    const root = makeTree();
    try {
      const pre = captureRoot(root);
      writeFileSync(path.join(root, "SET", "AUDIO", "new.wav"), "new");
      rmSync(path.join(root, "SET", "UNRELATED", "keep.txt"));
      writeFileSync(path.join(root, "SET", "PROJECT", "project.work"), "project-v2");
      rmSync(path.join(root, "SET", "AUDIO", "source.ot"));
      mkdirSync(path.join(root, "SET", "AUDIO", "source.ot"));
      const post = captureRoot(root);
      const report = compareManifests(pre, post, null);
      const classes = Object.fromEntries(
        report.diffs.map((diff) => [diff.relative_path, diff.class]),
      );
      assert.equal(classes["SET/AUDIO/new.wav"], "added");
      assert.equal(classes["SET/UNRELATED/keep.txt"], "removed");
      assert.equal(classes["SET/PROJECT/project.work"], "content_changed");
      assert.equal(classes["SET/AUDIO/source.ot"], "type_changed");
    } finally {
      cleanup(root);
    }
  });

  it("passes when only expected rename changes occur", () => {
    const root = makeTree();
    try {
      const pre = captureRoot(root);
      const source = pre.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/source.wav",
      );
      const sidecar = pre.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/source.ot",
      );
      const project = pre.entries.find(
        (entry) => entry.relative_path === "SET/PROJECT/project.work",
      );
      writeFileSync(path.join(root, "SET", "AUDIO", "dest.wav"), "wav-bytes-aa");
      writeFileSync(path.join(root, "SET", "AUDIO", "dest.ot"), "sidecar-aa");
      rmSync(path.join(root, "SET", "AUDIO", "source.wav"));
      rmSync(path.join(root, "SET", "AUDIO", "source.ot"));
      writeFileSync(path.join(root, "SET", "PROJECT", "project.work"), "project-v2");
      const post = captureRoot(root);
      const dest = post.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/dest.wav",
      );
      const destSidecar = post.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/dest.ot",
      );
      const rewritten = post.entries.find(
        (entry) => entry.relative_path === "SET/PROJECT/project.work",
      );
      const expected = {
        schema: EXPECTED_SCHEMA,
        changes: [
          {
            op: "removed",
            relative_path: "SET/AUDIO/source.wav",
            entry_type: "file",
            sha256: source.sha256,
          },
          {
            op: "added",
            relative_path: "SET/AUDIO/dest.wav",
            entry_type: "file",
            byte_size: dest.byte_size,
            sha256: dest.sha256,
          },
          {
            op: "removed",
            relative_path: "SET/AUDIO/source.ot",
            sha256: sidecar.sha256,
          },
          {
            op: "added",
            relative_path: "SET/AUDIO/dest.ot",
            sha256: destSidecar.sha256,
          },
          {
            op: "content_changed",
            relative_path: "SET/PROJECT/project.work",
            sha256: rewritten.sha256,
            byte_size: rewritten.byte_size,
          },
        ],
      };
      const report = compareManifests(pre, post, expected);
      assert.equal(report.verdict, "PASS");
      assert.equal(report.unrelated_entries_unchanged, true);
      assert.notEqual(project.sha256, rewritten.sha256);
    } finally {
      cleanup(root);
    }
  });

  it("fails on an unexpected unrelated change", () => {
    const root = makeTree();
    try {
      const pre = captureRoot(root);
      const source = pre.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/source.wav",
      );
      writeFileSync(path.join(root, "SET", "AUDIO", "dest.wav"), "wav-bytes-aa");
      rmSync(path.join(root, "SET", "AUDIO", "source.wav"));
      writeFileSync(path.join(root, "SET", "UNRELATED", "keep.txt"), "tampered");
      const post = captureRoot(root);
      const dest = post.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/dest.wav",
      );
      const expected = {
        schema: EXPECTED_SCHEMA,
        changes: [
          {
            op: "removed",
            relative_path: "SET/AUDIO/source.wav",
            sha256: source.sha256,
          },
          {
            op: "added",
            relative_path: "SET/AUDIO/dest.wav",
            sha256: dest.sha256,
          },
        ],
      };
      const report = compareManifests(pre, post, expected);
      assert.equal(report.verdict, "STOP");
      assert.equal(report.unrelated_entries_unchanged, false);
      assert.ok(report.stop_reason.includes("UNEXPECTED_DIFF"));
    } finally {
      cleanup(root);
    }
  });

  it("rejects duplicate and malformed entries", () => {
    const raw = JSON.stringify({
      schema: MANIFEST_SCHEMA,
      exclusion_policy: EXCLUSION_POLICY,
      entries: [
        {
          relative_path: "SET/a.wav",
          entry_type: "file",
          byte_size: 1,
          sha256: "sha256:aa",
        },
        {
          relative_path: "SET/a.wav",
          entry_type: "file",
          byte_size: 1,
          sha256: "sha256:aa",
        },
      ],
    });
    assert.throws(
      () => parseManifest(raw, "dup"),
      (error) => error instanceof ManifestStop && error.code === "DUPLICATE_PATH",
    );
    assert.throws(
      () => parseManifest("{", "bad"),
      (error) => error instanceof ManifestStop && error.code === "MALFORMED_MANIFEST",
    );
  });

  it("rejects schema and exclusion-policy mismatches", () => {
    const root = makeTree();
    try {
      const pre = captureRoot(root);
      const post = {
        ...pre,
        schema: "other:v1",
      };
      const report = compareManifests(pre, post, null);
      assert.equal(report.verdict, "STOP");
      assert.ok(report.stop_reason.includes("SCHEMA_MISMATCH"));
      const policy = compareManifests(
        pre,
        { ...pre, exclusion_policy: "other-policy" },
        null,
      );
      assert.ok(policy.stop_reason.includes("EXCLUSION_POLICY_MISMATCH"));
    } finally {
      cleanup(root);
    }
  });
});

describe("expected-from-prepared", () => {
  it("builds audio and sidecar expected changes without inventing project hashes", () => {
    const plan = {
      schema: "masterocta-prepared-rename-plan:v1",
      plan: {
        source_relative_path: "SET/AUDIO/source.wav",
        destination_relative_path: "SET/AUDIO/dest.wav",
        source_byte_size: 12,
        source_content_hash: "sha256:abc",
        sidecar_impacts: [
          {
            source_sidecar_relative_path: "SET/AUDIO/source.ot",
            destination_sidecar_relative_path: "SET/AUDIO/dest.ot",
            byte_size: 10,
            content_hash: "sha256:sid",
          },
        ],
        state_document_impacts: [
          {
            relative_path: "SET/PROJECT/project.work",
            reference_updates: [{ slot: 1 }],
          },
        ],
      },
    };
    const expected = expectedFromPreparedPlan(plan);
    assert.equal(expected.schema, EXPECTED_SCHEMA);
    assert.equal(expected.changes.length, 4);
    assert.deepEqual(expected.incomplete_project_post_hashes, [
      "SET/PROJECT/project.work",
    ]);
  });

  it("rejects expected content changes that omit sha256", () => {
    assert.throws(
      () =>
        parseExpectedChanges(
          JSON.stringify({
            schema: EXPECTED_SCHEMA,
            changes: [
              { op: "content_changed", relative_path: "SET/PROJECT/project.work" },
            ],
          }),
          "expected",
        ),
      (error) =>
        error instanceof ManifestStop && error.code === "INCOMPLETE_EXPECTED",
    );
  });

  it("rejects path escape and duplicate expected paths", () => {
    const basePlan = {
      schema: "masterocta-prepared-rename-plan:v1",
      plan: {
        source_relative_path: "SET/AUDIO/source.wav",
        destination_relative_path: "SET/AUDIO/dest.wav",
        source_byte_size: 12,
        source_content_hash: "sha256:abc",
        sidecar_impacts: [],
        state_document_impacts: [],
      },
    };
    assert.throws(
      () =>
        expectedFromPreparedPlan({
          ...basePlan,
          plan: {
            ...basePlan.plan,
            source_relative_path: "../escape.wav",
          },
        }),
      (error) => error instanceof ManifestStop && error.code === "PATH_ESCAPE",
    );
    assert.throws(
      () =>
        expectedFromPreparedPlan({
          ...basePlan,
          plan: {
            ...basePlan.plan,
            destination_relative_path: "/SET/AUDIO/dest.wav",
          },
        }),
      (error) => error instanceof ManifestStop && error.code === "PATH_ESCAPE",
    );
    assert.throws(
      () =>
        expectedFromPreparedPlan({
          ...basePlan,
          plan: {
            ...basePlan.plan,
            destination_relative_path: "SET/AUDIO/source.wav",
          },
        }),
      (error) => error instanceof ManifestStop && error.code === "DUPLICATE_PATH",
    );
  });

  it("stops the CLI when project post-write hashes are incomplete", () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), "gate-c-expected-"));
    const planPath = path.join(outputDir, "prepared-plan.json");
    const expectedPath = path.join(outputDir, "expected.json");
    const plan = {
      schema: "masterocta-prepared-rename-plan:v1",
      plan: {
        source_relative_path: "SET/AUDIO/source.wav",
        destination_relative_path: "SET/AUDIO/dest.wav",
        source_byte_size: 12,
        source_content_hash: "sha256:abc",
        sidecar_impacts: [],
        state_document_impacts: [
          {
            relative_path: "SET/PROJECT/project.work",
            reference_updates: [{ slot: 1 }],
          },
        ],
      },
    };
    try {
      writeFileSync(planPath, JSON.stringify(plan));
      const result = spawnSync(
        process.execPath,
        [
          scriptPath,
          "expected-from-prepared",
          "--plan",
          planPath,
          "--output",
          expectedPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(
        result.stderr,
        /INCOMPLETE_EXPECTED: rewritten project post-write SHA256/,
      );
      assert.match(result.stderr, /SET\/PROJECT\/project\.work/);
      const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
      assert.equal(expected.schema, EXPECTED_SCHEMA);
      assert.equal(expected.changes.length, 2);
    } finally {
      cleanup(outputDir);
    }
  });
});

describe("cli", () => {
  it("capture and compare through the CLI", () => {
    const root = makeTree();
    const outputDir = mkdtempSync(path.join(tmpdir(), "gate-c-cli-"));
    try {
      const prePath = path.join(outputDir, "pre.json");
      const postPath = path.join(outputDir, "post.json");
      const expectedPath = path.join(outputDir, "expected.json");
      const reportPath = path.join(outputDir, "report.json");
      const capturePre = spawnSync(
        process.execPath,
        [scriptPath, "capture", "--root", root, "--output", prePath],
        { encoding: "utf8" },
      );
      assert.equal(capturePre.status, 0, capturePre.stderr);
      writeFileSync(path.join(root, "SET", "AUDIO", "dest.wav"), "wav-bytes-aa");
      rmSync(path.join(root, "SET", "AUDIO", "source.wav"));
      const capturePost = spawnSync(
        process.execPath,
        [scriptPath, "capture", "--root", root, "--output", postPath],
        { encoding: "utf8" },
      );
      assert.equal(capturePost.status, 0, capturePost.stderr);
      const pre = loadManifestFile(prePath, "pre");
      const post = loadManifestFile(postPath, "post");
      const source = pre.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/source.wav",
      );
      const dest = post.entries.find(
        (entry) => entry.relative_path === "SET/AUDIO/dest.wav",
      );
      writeManifestAtomic(expectedPath, {
        schema: EXPECTED_SCHEMA,
        changes: [
          {
            op: "removed",
            relative_path: "SET/AUDIO/source.wav",
            sha256: source.sha256,
          },
          {
            op: "added",
            relative_path: "SET/AUDIO/dest.wav",
            sha256: dest.sha256,
          },
        ],
      });
      const compare = spawnSync(
        process.execPath,
        [
          scriptPath,
          "compare",
          "--pre",
          prePath,
          "--post",
          postPath,
          "--expected",
          expectedPath,
          "--report",
          reportPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(compare.status, 0, compare.stderr + compare.stdout);
      assert.match(compare.stdout, /unrelated_entries_unchanged: true/);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      assert.equal(report.verdict, "PASS");
    } finally {
      cleanup(root);
      cleanup(outputDir);
    }
  });
});
