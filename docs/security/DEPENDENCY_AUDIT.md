# Dependency advisory audit

Audit date: 2026-08-27

Base commit: `0d2aba22097093289710544e6b04fabc865cad35`

Package managers: pnpm `11.24.0`, Node.js `22.18.0`

## Decision

No `critical` or `high` advisory is currently reachable in the shipped Tauri
application through an affected API. The RootRegistry read-only vertical slice
may start **after this audit PR is reviewed and merged**.

This is not a declaration that the dependency graph is clean. It is a scoped
reachability decision:

- the root JavaScript graph reports 31 advisories, including one `critical`;
- the documentation graph reports 73 unique advisories (88 affected
  package/version findings), including two `critical`;
- the Rust lockfile has 29 unique OSV/RustSec findings, including three `high`;
- the findings are accepted only for the stated usage and recheck conditions;
- dependency remediation must be done in separate, reviewable PRs before a
  signed public binary release.

No dependency, lockfile, override, runtime code, or install-script permission
was changed by this audit.

## Scope and method

The audit covered:

- `pnpm-lock.yaml` and `pnpm audit` for the application;
- `user-guide/pnpm-lock.yaml` and `pnpm --dir user-guide audit` for docs/PDF;
- all 567 crates.io package entries in `src-tauri/Cargo.lock`, queried against
  the official OSV API;
- direct and transitive dependency paths;
- package install/build scripts and `allowBuilds` policy;
- application imports, router/navigation calls, Vite/Vitest configuration,
  Tauri configuration, and the affected upstream Rust source paths.

`cargo` is not installed in the audit environment, so `cargo audit` could not
be run. The Rust result is an OSV query of every locked crates.io package,
deduplicated across GHSA/RUSTSEC aliases. A later remediation PR must rerun
`cargo audit` with the Rust toolchain available. Git dependencies were reviewed
from their immutable lockfile revisions rather than treated as crates.io
packages.

Reachability terms:

- **reachable**: the application or build invokes the affected component in
  its current configuration;
- **potentially reachable**: the dependency executes, but exploitation also
  requires an input or mode not used by the current workflow;
- **not runtime reachable**: the affected mode/API is absent from the shipped
  application or exists only in docs/dev/test tooling;
- **unknown**: evidence was insufficient. No `critical` finding remains in this
  category.

Actions used below:

- **isolate**: keep the dependency outside the product runtime or affected
  mode;
- **accept temporarily**: do not update it in this classification PR, retain
  the stated boundary, and reassess by the deadline;
- **monitor**: rerun the audit on the stated trigger;
- **remediate**: update or replace it in a separate dependency PR.

## Application JavaScript graph

`pnpm audit` reported `low: 2`, `moderate: 12`, `high: 16`, `critical: 1`.
`pnpm audit --prod` contains only the 13 React Router advisories (`low: 1`,
`moderate: 6`, `high: 6`, `critical: 0`).

| Package / resolved version | Shortest dependency path | Advisory, severity, fixed version | Affected use and reachability | Action |
| --- | --- | --- | --- | --- |
| `react-router@7.12.0` | `react-router-dom > react-router` | `GHSA-49rj-9fvp-4h2h` high, `>=7.14.2`; `GHSA-8646-j5j9-6r62` high, `>=7.13.2`; `GHSA-f22v-gfqf-p8f3` moderate, `>=7.13.2`; `GHSA-8x6r-g9mw-2r78` high, `>=7.15.0`; `GHSA-rxv8-25v2-qmq8` high, `>=7.14.0`; `GHSA-84g9-w2xq-vcv6` low, `>=7.15.1`; `GHSA-wrjc-x8rr-h8h6` moderate, `>=7.18.0`; `GHSA-jjmj-jmhj-qwj2` moderate, `>=7.13.0`; `GHSA-h8fp-f39c-q6mh` moderate, `>=7.18.0`; `GHSA-337j-9hxr-rhxg` moderate, `>=7.18.0`; `GHSA-chx6-hx7r-mcp5` high, `>=7.18.0`; `GHSA-2j2x-hqr9-3h42` moderate, `>=7.14.1`; `GHSA-qwww-vcr4-c8h2` high, `>=7.18.2` | The app uses `HashRouter`, `Routes`, and `Route` in Declarative Mode. The RSC, Framework Mode, SSR/hydration, prerender, manifest, single-fetch, action/CSRF, and `redirect()` paths are absent. The two open-redirect findings affect navigation APIs, but every current `navigate()` target is an internal `/...` path and interpolated identifiers are `encodeURIComponent`-encoded. **Not runtime reachable under current code.** | Accept temporarily; remediate in a focused React Router PR. Recheck immediately if RSC/Framework/SSR APIs are introduced or untrusted input can become a direct `to`, `redirect()`, or `navigate()` target. |
| `vitest@4.0.17` | direct dev dependency | `GHSA-5xrq-8626-4rwp` critical, `>=4.1.0` | Arbitrary file read/execution requires a listening Vitest UI server. The repository runs `vitest run` and does not enable the UI server. Test-only; **not runtime reachable**. | Isolate; remediate before enabling Vitest UI and no later than 2026-09-15. |
| `vite@7.1.12` | direct / `@vitejs/plugin-react > vite` | `GHSA-4w7w-66w2-5vf9` moderate, `>=7.3.2`; `GHSA-v2wj-q39q-566r` high, `>=7.3.2`; `GHSA-p9ff-h696-f583` high, `>=7.3.2`; `GHSA-v6wh-96g9-6wx3` moderate, `>=7.3.5`; `GHSA-fx2h-pf6j-xcff` high, `>=7.3.5` | Dev-server file access/Windows launch-editor issues. The server binds to loopback unless `TAURI_DEV_HOST` is explicitly set; Vite is absent from the production bundle. **Potentially reachable in an explicitly exposed dev session; not runtime reachable.** | Keep loopback-only; never expose it to untrusted networks. Remediate by 2026-09-15 or before changing host/network policy. |
| `rollup@4.52.5` | `vite > rollup` | `GHSA-mw96-cpmx-2vgc` high, `>=4.59.0` | Arbitrary write requires crafted build input/path. It executes only while building reviewed repository sources. **Potentially reachable in the build; not runtime reachable.** | Accept temporarily; do not build untrusted branches with secrets. Remediate with the Vite toolchain by 2026-09-15. |
| `postcss@8.5.6` | `vite > postcss` | `GHSA-qx2v-qp2m-jg93` moderate, `>=8.5.10`; `GHSA-6g55-p6wh-862q` high, `>=8.5.12`; `GHSA-fxqj-rqcc-2cmp` moderate, `>=8.5.23`; `GHSA-r28c-9q8g-f849` high, `>=8.5.18` | Source-map/CSS parsing issues require crafted build input. It processes reviewed repository CSS and is not bundled. **Potentially reachable in the build; not runtime reachable.** | Accept temporarily; remediate with Vite by 2026-09-15 or before processing untrusted CSS. |
| `nanoid@3.3.11` | `vite > postcss > nanoid` | `GHSA-28wg-ghj8-5hjv` high, `>=3.3.16`; `GHSA-2v37-7h3g-55p8` high, `>=3.3.18` | Infinite loops require invalid sizes passed to non-secure/custom generators; application code does not call this transitive copy. **Not runtime reachable.** | Monitor; remediate with PostCSS/Vite by 2026-09-15. |
| `picomatch@4.0.3` | `vite > picomatch` | `GHSA-3v7f-55p6-f55p` moderate, `>=4.0.4`; `GHSA-c2c7-rcm5-vvqj` high, `>=4.0.4` | Glob parser receives build-tool patterns, not product input. **Potentially reachable in build tooling; not runtime reachable.** | Accept temporarily; remediate with Vite by 2026-09-15. |
| `ws@8.19.0` | `jsdom > ws` | `GHSA-58qx-3vcg-4xpx` moderate, `>=8.20.1`; `GHSA-96hv-2xvq-fx4p` high, `>=8.21.0` | Test-only jsdom WebSocket implementation; no listening production server. **Not runtime reachable.** | Isolate to tests; remediate by 2026-09-15 or before adding WebSocket tests against untrusted peers. |
| `@babel/core@7.28.5` | `@vitejs/plugin-react > @babel/core` | `GHSA-4x5r-pxfx-6jf8` low, `>=7.29.6` | Source-map file read requires crafted source comments during compilation. Reviewed source only; **potentially reachable in build tooling, not runtime reachable.** | Accept temporarily; remediate with the frontend toolchain by 2026-09-15. |

## Documentation and PDF graph

`pnpm --dir user-guide audit` reported `low: 5`, `moderate: 33`,
`high: 48`, `critical: 2`. All packages in this lockfile are isolated from the
Tauri application bundle. The table groups advisories that share one resolved
package, path, reachability, and action; every reported advisory ID is listed.

Classification abbreviations in this table:

- **build — reachable/potentially reachable**: executes while building
  reviewed docs content; the row states whether the affected API is invoked;
- **static-serve — potentially reachable**: `docusaurus serve` and
  `serve-handler` run on loopback during PDF generation, with fixed local
  requests and repository paths;
- **dev-server — not runtime reachable**: the transitive
  `webpack-dev-server` path is installed, but no current CI/deploy command
  starts it;
- **PDF — reachable/potentially reachable**: `docs-to-pdf` and Puppeteer run
  against the locally built site; the row states whether the affected API is
  invoked;
- **installed-only — not runtime reachable**: the package is installed, but
  the affected capability is not invoked by current build/PDF workflows.

Every row is **not product-runtime reachable**. Accept temporarily and
remediate or re-evaluate by 2026-09-30, or earlier if untrusted documentation
content is built, a public preview workflow is added, a docs server is exposed,
or the docs/PDF toolchain changes.

| Package / resolved version | Shortest dependency path | Advisory, severity, fixed version | Reachability / affected use |
| --- | --- | --- | --- |
| `minimatch@3.1.2` | `@docusaurus/core > serve-handler > minimatch` | `GHSA-3ppc-4f35-3m26` high, `>=3.1.3`; `GHSA-7r86-cg39-jmmj` high, `>=3.1.3`; `GHSA-23c5-xmqv-rm74` high, `>=3.1.4` | static-serve — **potentially reachable** in PDF CI; the server is loopback-only and receives fixed local URLs, not attacker-controlled glob patterns. |
| `serialize-javascript@6.0.2` | `@docusaurus/core > webpack > terser-webpack-plugin > serialize-javascript` | `GHSA-5c6j-r48x-rmvq` high, `>=7.0.3`; `GHSA-qj8w-gfj5-8c6v` moderate, `>=7.0.5` | build; serializes reviewed build configuration/content. Major-version fix requires Docusaurus/Webpack compatibility review. |
| `brace-expansion@1.1.12` | `@docusaurus/core > serve-handler > minimatch > brace-expansion` | `GHSA-f886-m6hf-6m8v` moderate, `>=1.1.13`; `GHSA-3jxr-9vmj-r5cp` high, `>=1.1.16`; `GHSA-mh99-v99m-4gvg` high, `>=1.1.17`; `GHSA-rgw5-rvv9-x895` high, `>=1.1.18` | static-serve — **potentially reachable** in PDF CI; no untrusted glob pattern input. |
| `brace-expansion@2.0.2` | `workbox-build > ejs > jake > filelist > minimatch > brace-expansion` | `GHSA-f886-m6hf-6m8v` moderate, `>=2.0.3`; `GHSA-3jxr-9vmj-r5cp` high, `>=2.1.2`; `GHSA-mh99-v99m-4gvg` high, `>=2.1.3`; `GHSA-rgw5-rvv9-x895` high, `>=2.1.4` | build; PWA processes fixed repository paths. |
| `brace-expansion@5.0.4` | `workbox-build > glob > minimatch > brace-expansion` | `GHSA-f886-m6hf-6m8v` moderate, `>=5.0.5`; `GHSA-jxxr-4gwj-5jf2` moderate, `>=5.0.6`; `GHSA-3jxr-9vmj-r5cp` high, `>=5.0.7`; `GHSA-mh99-v99m-4gvg` high, `>=5.0.8`; `GHSA-rgw5-rvv9-x895` high, `>=5.0.9` | build; PWA processes fixed repository paths. |
| `picomatch@2.3.1` | `@docusaurus/utils > globby > fast-glob > micromatch > picomatch` | `GHSA-3v7f-55p6-f55p` moderate, `>=2.3.2`; `GHSA-c2c7-rcm5-vvqj` high, `>=2.3.2` | build; fixed repository globs. |
| `picomatch@4.0.3` | `workbox-build > @rollup/pluginutils > picomatch` | `GHSA-3v7f-55p6-f55p` moderate, `>=4.0.4`; `GHSA-c2c7-rcm5-vvqj` high, `>=4.0.4` | build; fixed repository globs. |
| `path-to-regexp@8.3.0` | `docs-to-pdf > express > router > path-to-regexp` | `GHSA-j3q9-mxjg-w52f` high, `>=8.4.0`; `GHSA-27v5-c462-wpq7` moderate, `>=8.4.0` | installed-only — **not runtime reachable**. The current command passes `--initialDocURLs`, so `docs-to-pdf` does not invoke its optional internal Express server. |
| `lodash@4.17.23` | `@docusaurus/utils > lodash` | `GHSA-r5fr-rjxr-66jc` high, `>=4.18.1`; `GHSA-f23m-r3pf-42rh` moderate, `>=4.18.1` | build; affected template/merge-style behavior receives reviewed config/content. Major-version fix needs upstream compatibility review. |
| `basic-ftp@5.2.0` | `docs-to-pdf > puppeteer > proxy-agent > get-uri > basic-ftp` | `GHSA-6v7q-wjvx-w8wg` high, `>=5.2.2`; `GHSA-chqc-8p9q-pq6q` high, no patched version reported; `GHSA-rp42-5vxx-qpwr` high, `>=5.3.0`; `GHSA-rpmf-866q-6p89` high, `>=5.3.1` | installed-only — **not runtime reachable**; PDF targets localhost and no FTP URL or attacker proxy configuration is used. Isolate from untrusted URLs. |
| `follow-redirects@1.15.11` | `webpack-dev-server > http-proxy > follow-redirects` | `GHSA-r4q5-vmmm-2653` moderate, `>=1.16.0` | dev-server — **not runtime reachable**; no webpack proxy server is started. |
| `postcss@8.5.6` | `@docusaurus/cssnano-preset > autoprefixer > postcss` | `GHSA-qx2v-qp2m-jg93` moderate, `>=8.5.10`; `GHSA-6g55-p6wh-862q` high, `>=8.5.12`; `GHSA-fxqj-rqcc-2cmp` moderate, `>=8.5.23`; `GHSA-r28c-9q8g-f849` high, `>=8.5.18` | build; source-map/CSS issues require crafted docs input. |
| `ip-address@10.1.0` | `docs-to-pdf > puppeteer > proxy-agent > socks > ip-address` | `GHSA-v2v4-37r5-5v8g` moderate, `>=10.1.1`; `GHSA-mwp4-54f8-5fhr` high, `>=10.3.1` | installed-only — **not runtime reachable**; no SOCKS proxy or attacker-controlled IP is used. |
| `webpack-dev-server@5.2.3` | `@docusaurus/core > webpack-dev-server` | `GHSA-79cf-xcqc-c78w` moderate, `>=5.2.4`; `GHSA-mx8g-39q3-5c79` moderate, `>=5.2.5`; `GHSA-f5vj-f2hx-8m93` moderate, `>=5.2.6`; `GHSA-m28w-2pqf-7qgj` moderate, `>=5.2.6` | dev-server — **not runtime reachable**. PDF CI starts the separate static `docusaurus serve` command, not webpack-dev-server. |
| `ws@8.20.0` | `webpack-dev-server > ws` | `GHSA-58qx-3vcg-4xpx` moderate, `>=8.20.1`; `GHSA-96hv-2xvq-fx4p` high, `>=8.21.0` | dev-server — **not runtime reachable**; no WebSocket dev server starts. |
| `uuid@8.3.2` | `webpack-dev-server > sockjs > uuid` | `GHSA-w5hq-g745-h8pq` moderate, `>=11.1.1` | dev-server — **not runtime reachable**; SockJS is not started. Major-version fix needs upstream review. |
| `qs@6.14.2` | `webpack-dev-server > express > body-parser > qs` | `GHSA-q8mj-m7cp-5q26` moderate, `>=6.15.2` | dev-server — **not runtime reachable**; the webpack request parser is not started. |
| `@babel/plugin-transform-modules-systemjs@7.29.0` | `@docusaurus/babel > @babel/preset-env > plugin` | `GHSA-fv7c-fp4j-7gwp` high, `>=7.29.4` | build; processes reviewed JavaScript/MDX. |
| `shell-quote@1.8.3` | `webpack-dev-server > launch-editor > shell-quote` | `GHSA-w7jw-789q-3m8p` critical, `>=1.8.4`; `GHSA-395f-4hp3-45gv` high, `>=1.9.0` | dev-server — command injection requires the editor-launch endpoint. webpack-dev-server is never started, so this is **not runtime reachable**. |
| `joi@17.13.3` | `@docusaurus/types > joi` | `GHSA-q7cg-457f-vx79` moderate, `>=17.13.4` | build; validates reviewed configuration. |
| `launch-editor@2.13.2` | `webpack-dev-server > launch-editor` | `GHSA-v6wh-96g9-6wx3` moderate, `>=2.14.1` | dev-server — **not runtime reachable**; the editor endpoint is not started, and the affected UNC behavior is Windows-only. |
| `undici@7.24.6` | `docusaurus-search-local > cheerio > undici` | `GHSA-vmh5-mc38-953g` high, `>=7.28.0`; `GHSA-p88m-4jfj-68fv` moderate, `>=7.28.0`; `GHSA-vxpw-j846-p89q` high, `>=7.28.0`; `GHSA-hm92-r4w5-c3mj` high, `>=7.28.0`; `GHSA-g8m3-5g58-fq7m` low, `>=7.28.0`; `GHSA-pr7r-676h-xcf6` moderate, `>=7.28.0`; `GHSA-8xcm-r25x-g524` moderate, `>=7.29.0`; `GHSA-4cwx-7wf7-3272` high, `>=7.29.0`; `GHSA-m8rv-5g2x-5cg5` moderate, `>=7.29.0`; `GHSA-jr45-8vmc-qm54` moderate, `>=7.29.0`; `GHSA-v3r7-h72x-cjcm` moderate, `>=7.29.0`; `GHSA-35p6-xmwp-9g52` low, `>=7.28.0` | installed-only — the affected HTTP client APIs are not called by local-search indexing, so they are **not runtime reachable**. Recheck if remote content ingestion is added. |
| `http-proxy-middleware@2.0.9` | `webpack-dev-server > http-proxy-middleware` | `GHSA-64mm-vxmg-q3vj` moderate, `>=2.0.10` | dev-server — **not runtime reachable**; no webpack proxy server is started. |
| `js-yaml@3.14.2` | `@docusaurus/utils > gray-matter > js-yaml` | `GHSA-h67p-54hq-rp68` moderate, `>=3.15.0`; `GHSA-52cp-r559-cp3m` high, `>=3.15.0`; `GHSA-5p4m-2wfm-xmqj` high, `>=3.15.1` | build; parses reviewed front matter. Potentially reachable if untrusted docs are accepted. |
| `js-yaml@4.1.1` | `@docusaurus/utils > js-yaml` | `GHSA-h67p-54hq-rp68` moderate, `>=4.2.0`; `GHSA-52cp-r559-cp3m` high, `>=4.3.0`; `GHSA-5p4m-2wfm-xmqj` high, `>=4.3.1` | build; parses reviewed configuration/content. Potentially reachable if untrusted docs are accepted. |
| `ws@7.5.10` | `webpack-bundle-analyzer > ws` | `GHSA-96hv-2xvq-fx4p` high, `>=7.5.11` | installed-only — analyzer server is not enabled, so this is **not runtime reachable**. |
| `websocket-driver@0.7.4` | `webpack-dev-server > sockjs > faye-websocket > websocket-driver` | `GHSA-mp7j-qc5w-4988` moderate, `>=0.7.5`; `GHSA-xv26-6w52-cph6` critical, `>=0.7.5` | dev-server — message corruption/denial of service requires a running SockJS/WebSocket server. None is started, so this is **not runtime reachable**. |
| `@babel/core@7.29.0` | `@docusaurus/babel > @babel/core` | `GHSA-4x5r-pxfx-6jf8` low, `>=7.29.6` | build; source-map read requires crafted source comments. |
| `body-parser@2.2.2` | `docs-to-pdf > express > body-parser` | `GHSA-v422-hmwv-36x6` low, `>=2.3.0` | installed-only — **not runtime reachable**. URL-input mode does not start `docs-to-pdf`'s internal Express server. |
| `body-parser@1.20.4` | `webpack-dev-server > express > body-parser` | `GHSA-v422-hmwv-36x6` low, `>=1.20.6` | dev-server — **not runtime reachable**; webpack-dev-server is not started. |
| `fast-uri@3.1.0` | `webpack > schema-utils > ajv > fast-uri` | `GHSA-v2hh-gcrm-f6hx` high, `>=3.1.4`; `GHSA-7p8r-x3mc-p8w7` high, `>=3.1.5`; `GHSA-q3j6-qgpj-74h6` high, `>=3.1.1`; `GHSA-v39h-62p7-jpjc` high, `>=3.1.2`; `GHSA-4c8g-83qw-93j6` high, `>=3.1.3` | build; validates reviewed Webpack/Docusaurus configuration, not visitor input. |
| `sharp@0.34.5` | direct docs dependency | `GHSA-f88m-g3jw-g9cj` high, `>=0.35.0` | build; image optimizer parses tracked repository images. Potentially reachable if an untrusted image is added. Minor update still needs image-output review. |
| `sanitize-html@2.17.1` | `docs-to-pdf > sanitize-html` | `GHSA-vccv-cmxp-4j9h` moderate, `>=2.17.5` | PDF; sanitizes locally built, reviewed site content. |
| `image-size@2.0.2` | `@docusaurus/mdx-loader > image-size` | `GHSA-w3rx-r6r6-pgpr` high, no patched version reported; `GHSA-5p2g-fcmc-qvqq` high, no patched version reported | build; parses tracked repository images. Potentially reachable if untrusted image input is accepted; replacement may be required. |
| `nanoid@3.3.11` | `postcss > nanoid` | `GHSA-28wg-ghj8-5hjv` high, `>=3.3.16`; `GHSA-2v37-7h3g-55p8` high, `>=3.3.18` | build; invalid generator sizes are not supplied by site content. |
| `extract-zip@2.0.1` | `docs-to-pdf > puppeteer > @puppeteer/browsers > extract-zip` | `GHSA-jmr9-qjv8-65gv` high, no patched version reported | install/PDF — **potentially reachable** during approved Puppeteer browser installation; archive source is Puppeteer's download path, not user input. Re-evaluate Puppeteer/browser provisioning rather than overriding transitives. |
| `svgo@3.3.3` | `cssnano > postcss-svgo > svgo` | `GHSA-2p49-hgcm-8545` high, `>=3.3.4` | build; processes tracked SVG/CSS. Potentially reachable if untrusted SVG is accepted. |

## Rust and Tauri graph

The OSV result contains three `high`, four `moderate`, one `low`, eighteen
unmaintained/informational, two unscored unsoundness reports, and one unscored
vulnerability. No `critical` advisory was returned.

| Package / resolved version | Shortest dependency path | Advisory / fix | Affected use and reachability | Action |
| --- | --- | --- | --- | --- |
| `libyml@0.0.5` | `octatrack-manager > ot-tools-io > serde_yml > libyml` | `RUSTSEC-2025-0067` / `GHSA-gfxp-f68g-8x78`, high; no maintained fixed release | Affected YAML parsing. The pinned `ot-tools` revision exposes YAML convenience APIs, but repository source does not call `from_yaml*`, `to_yaml*`, or `serde_yml`; Octatrack parsing uses binary/text APIs. **Not runtime reachable.** | Isolate behind the legacy adapter. Remediate/replace `serde_yml` before adding YAML import/export; recheck on any `ot-tools` revision change. |
| `quick-xml@0.38.4` | `masterocta > tauri > plist > quick-xml` | `RUSTSEC-2026-0194`, high, `>=0.41.0`; `RUSTSEC-2026-0195`, high, `>=0.41.0` | Still resolved through Tauri `2.11.5` → `plist`. Called by macOS `restart_macos_app` to read `Contents/Info.plist`. The repository does not call process restart, and updater/process integrations remain removed. **Not runtime reachable.** | Keep restart/updater disabled. Recheck immediately if restart/updater is reintroduced or Tauri drops the vulnerable `quick-xml` edge. |
| `tauri@2.11.5` | direct | `GHSA-7gmj-67g7-phm9`, moderate, fixed in `>=2.11.1` | Origin confusion affects Windows/Android remote WebViews. **Remediated** by pinning `tauri`/`@tauri-apps/*` to the 2.11 line (DEP-1). Recheck before any remote WebView. | Remediated 2026-08-30 (DEP-1). |
| `serde_yml@0.0.12` | `octatrack-manager > ot-tools-io > serde_yml` | `RUSTSEC-2025-0068` / `GHSA-hhw4-xg65-fp2x`, moderate; unmaintained, no fixed release | Same unused YAML API path as `libyml`. **Not runtime reachable.** | Replace upstream YAML dependency before exposing YAML features; recheck on `ot-tools` changes. |
| `glib@0.18.5` | `tauri > gtk > glib` | `RUSTSEC-2024-0429` / `GHSA-wrw7-89jp-8q8g`, moderate, `>=0.20.0` | Linux GTK target dependency; not compiled into the macOS application. **Not runtime reachable on supported target.** | Monitor Tauri's Linux dependency update; recheck before Linux distribution. |
| `serde_with@3.16.1` | `tauri > tauri-utils > serde_with` | `GHSA-7gcf-g7xr-8hxj`, moderate, `>=3.21.0` | Affected deserialization helpers are not directly called by application code. The Tauri utility layer is compiled, so **potentially reachable**, but no attacker-controlled use was identified. | Remediate through Tauri; recheck on IPC/schema changes. |
| `rand@0.7.3` | `tauri > tauri-utils > kuchikiki > selectors > phf_codegen > phf_generator > rand` | `RUSTSEC-2026-0097` / `GHSA-cq8v-f236-94qc`, low; fixed `>=0.8.6` for the affected 0.7/0.8 line | This copy runs in a PHF code-generation path. The advisory requires a custom logger that re-enters `rand::rng()`/`thread_rng()` while reseeding; application code defines no such logger. Build-time only and **not product-runtime reachable**. | Monitor and remediate through Tauri; recheck if Rust build scripts, logging, or PHF generation changes. |
| `rand@0.8.5` | `tauri > tauri-utils > phf > phf_macros > phf_generator > rand` | `RUSTSEC-2026-0097` / `GHSA-cq8v-f236-94qc`, low; fixed `>=0.8.6` for the affected 0.7/0.8 line | This copy runs in a PHF procedural-macro/code-generation path with the same unmet custom-logger preconditions. Build-time only and **not product-runtime reachable**. | Monitor and remediate through Tauri; recheck if Rust build scripts, logging, or PHF generation changes. |
| `anyhow@1.0.102` | `octatrack-manager > tauri > anyhow` | `RUSTSEC-2026-0190`, unscored unsoundness, `>=1.0.103` | Requires affected `downcast_mut` behavior; no direct application call was found. **Potentially reachable** through framework error handling, with no current exploit path identified. | Remediate through normal Rust lock update after compatibility review. |
| `crossbeam-epoch@0.9.18` | `octatrack-manager > sysinfo > rayon > rayon-core > crossbeam-deque > crossbeam-epoch` | `RUSTSEC-2026-0204`, unscored vulnerability, `>=0.9.20` | `sysinfo`/Rayon code may execute, but the unsafe invalid-pointer precondition is not controllable through an identified app input. **Potentially reachable.** | Prioritize in the Rust remediation PR; recheck if concurrent scanning behavior changes. |
| `event-listener@5.4.1` | `tauri-plugin-opener > zbus > event-listener` | `RUSTSEC-2026-0221`, unscored unsoundness, `>=5.4.2` | Reached through Linux D-Bus (`zbus`), not the macOS target. **Not runtime reachable on supported target.** | Monitor plugin/Tauri update; recheck before Linux distribution. |
| `bincode@1.3.3` | `octatrack-manager > ot-tools-io > bincode` | `RUSTSEC-2025-0141`, unmaintained; no fixed 1.x release | Used by the legacy Octatrack reader, so the package is **reachable**, but the advisory is maintenance status rather than a known vulnerability. | Keep behind the read-only legacy adapter; plan replacement/upstream migration before expanding write features. |
| `atk@0.18.2`, `atk-sys@0.18.2`, `gdk@0.18.2`, `gdk-sys@0.18.2`, `gdkwayland-sys@0.18.2`, `gdkx11@0.18.2`, `gdkx11-sys@0.18.2`, `gtk@0.18.2`, `gtk-sys@0.18.2`, `gtk3-macros@0.18.2` | `tauri > gtk` (Linux target) | `RUSTSEC-2024-0413`, `RUSTSEC-2024-0416`, `RUSTSEC-2024-0412`, `RUSTSEC-2024-0418`, `RUSTSEC-2024-0411`, `RUSTSEC-2024-0417`, `RUSTSEC-2024-0414`, `RUSTSEC-2024-0415`, `RUSTSEC-2024-0420`, `RUSTSEC-2024-0419`; all unmaintained | Linux GTK3 target packages; not compiled into macOS. **Not runtime reachable on supported target.** | Accept target-specific maintenance risk temporarily; reassess and migrate before Linux distribution. |
| `proc-macro-error@1.0.4` | `tauri > gtk > gtk3-macros > proc-macro-error` | `RUSTSEC-2024-0370`, unmaintained | Linux GTK build-time procedural macro. **Not runtime reachable.** | Reassess with GTK/Tauri dependency migration. |
| `fxhash@0.2.1` | `tauri > tauri-utils > kuchikiki > selectors > fxhash` | `RUSTSEC-2025-0057`, unmaintained | Framework HTML selector implementation; maintenance status only. **Potentially reachable**, with no published vulnerability in this finding. | Monitor and remove through Tauri update. |
| `unic-char-property@0.9.0`, `unic-char-range@0.9.0`, `unic-common@0.9.0`, `unic-ucd-ident@0.9.0`, `unic-ucd-version@0.9.0` | `tauri > tauri-utils > urlpattern > unic-*` | `RUSTSEC-2025-0081`, `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0100`, `RUSTSEC-2025-0098`; all unmaintained | URL-pattern parsing transitive dependencies; maintenance status only. **Potentially reachable.** | Monitor; remediate through Tauri/urlpattern replacement. |

## Install and build scripts

`pnpm-workspace.yaml` permits exactly one dependency build script:

```yaml
allowBuilds:
  puppeteer: true
```

Puppeteer's `node install.mjs` locates/downloads the headless browser required
by the existing `docs-to-pdf` workflow. The permission is restricted to that
package and does not authorize arbitrary dependency scripts.

`pnpm ignored-builds` reports `esbuild`; the user-guide reports `core-js`,
`core-js-pure`, and `sharp`. They remain blocked because the checked-in build
and docs workflows complete with the resolved prebuilt/runtime packages and no
additional install-script permission has been justified. The root package's
own `prepare: husky` is first-party repository setup, not a dependency
allow-list entry. `dangerouslyAllowAllBuilds` is absent.

## Gate and follow-up

The gate for the next architecture slice is **GO after this audit PR is merged**:

- no runtime-reachable `critical` or `high` finding was identified;
- no `critical` finding has `unknown` reachability;
- product-runtime boundaries are unchanged;
- docs/dev/test findings remain isolated and time-bounded.

Required follow-up, without combining it with RootRegistry:

1. Before any signed public binary release, review updates for Tauri,
   React Router, Rust transitives, Vite/Vitest, and the docs/PDF toolchain.
2. By 2026-09-15, remediate or explicitly renew the frontend dev/test tooling
   acceptance; do it earlier if a dev/test server is exposed.
3. By 2026-09-30, remediate or explicitly renew the docs/PDF acceptance; do it
   earlier if untrusted content or public preview workflows are introduced.
4. Run `cargo audit` when a Rust toolchain is available and reconcile it with
   this OSV snapshot before the first remediation PR.
5. Rerun both pnpm audits and the Rust audit whenever a lockfile, target
   platform, updater/restart behavior, remote WebView, YAML feature, install
   script policy, or network-facing development service changes.

## M3-A SQLite catalog dependency delta

Audit date: 2026-08-27

M3-A adds `rusqlite@0.40.2` with `default-features = false` and `bundled`.
The bundled feature compiles SQLite 3.53.2 from `libsqlite3-sys@0.38.2`, avoiding
runtime dependence on the macOS or CI system SQLite version. Disabling rusqlite's
unneeded default statement-cache and wasm features keeps the new graph limited.

The exact newly locked crates.io packages are:

| Package | Purpose and reachability | Advisory result |
| --- | --- | --- |
| `rusqlite@0.40.2` | Direct runtime dependency of the isolated `ot-catalog` adapter. It is not wired into Tauri production state in M3-A. | No OSV finding for this version. The two RustSec package advisories affect versions before `0.26.2` or `0.23.0`. |
| `libsqlite3-sys@0.38.2` | Bundled SQLite FFI used only through rusqlite. | No OSV finding for this version. `RUSTSEC-2022-0090` is fixed in `>=0.25.1`. |
| `fallible-iterator@0.3.0` | rusqlite runtime iterator support. | No OSV finding. |
| `fallible-streaming-iterator@0.1.9` | rusqlite runtime row iteration support. | No OSV finding. |
| `vcpkg@0.2.15` | `libsqlite3-sys` build helper for Windows targets; not runtime reachable on the supported macOS target. | No OSV finding. |

`sha2@0.10.9` was already present in `Cargo.lock`; M3-A only makes it a direct
dependency of the Tauri composition crate for the deterministic root
fingerprint. Existing package versions did not change. `tempfile@3.25.0` was
also already locked and is test-only for catalog databases and fixtures.

`cargo audit` remains unavailable (`cargo: no such command: audit`) and was not
installed. This is therefore not a complete Rust audit. The five new crates.io
package/version pairs were queried against the official OSV API and returned
no findings; current RustSec package pages were also checked for rusqlite and
libsqlite3-sys, the two new packages with historical RustSec advisories.

The JavaScript lockfiles did not change. Re-running the required audits produced
the same classified totals as above:

- root: 31 advisories (`low: 2`, `moderate: 12`, `high: 16`, `critical: 1`);
- docs/PDF: 88 findings (`low: 5`, `moderate: 33`, `high: 48`, `critical: 2`).

No new runtime-reachable `critical` or `high` advisory was identified in the
M3-A dependency delta. The existing acceptance boundaries and deadlines remain
unchanged.

## M3-B catalog production-reachability delta

Audit date: 2026-08-27

M3-B adds no crates.io or JavaScript package and changes no resolved package
version. `Cargo.lock` changes by one dependency edge only: the Tauri composition
package now depends on the existing workspace `ot-catalog` crate. As a result,
`ot-catalog -> rusqlite@0.40.2 -> libsqlite3-sys@0.38.2` becomes product-runtime
reachable when the local application opens its catalog. The catalog remains a
local-only adapter and adds no network endpoint or install-time download.
Below the resolved application data directory, catalog database paths are
opened with SQLite NOFOLLOW before resolving any symlinked parent. Roots with
the same persistent fingerprint cannot hold separate live catalog projections.

The exact five crates.io package/version pairs recorded for M3-A were queried
again through the official OSV API. `rusqlite@0.40.2`,
`libsqlite3-sys@0.38.2`, `fallible-iterator@0.3.0`,
`fallible-streaming-iterator@0.1.9`, and `vcpkg@0.2.15` each returned no
finding. `vcpkg` remains a Windows build helper and is not runtime reachable on
the supported macOS target. `cargo audit` is still unavailable and was not
installed, so this is not a complete Rust audit.

The two JavaScript lockfiles are unchanged. The repeated audits produced the
same classified totals:

- root: 31 advisories (`low: 2`, `moderate: 12`, `high: 16`, `critical: 1`);
- docs/PDF: 88 findings (`low: 5`, `moderate: 33`, `high: 48`, `critical: 2`).

Those JavaScript findings retain their existing reachability classifications
and acceptance deadlines. No new runtime-reachable `critical` or `high`
advisory was identified by the M3-B dependency/reachability delta.

## M3-E3 waveform and preview dependency delta

Audit date: 2026-08-29

M3-E3 adds the workspace crate `ot-audio` and one composition dependency edge.
It adds no crates.io or JavaScript package and changes no resolved package
version or checksum. Its direct third-party dependencies are the already locked
`serde@1.0.228`, `serde_json@1.0.149`, `sha2@0.10.9`, and
`symphonia@0.5.5`; `tempfile@3.25.0` remains test-only. Symphonia was already
product-runtime reachable through the existing audio inspection and conversion
paths. The new crate disables Symphonia default features and requests only WAV,
AIFF, and their PCM decoder; the composition package's pre-existing broader
feature set remains unchanged. M3-E3 does not add a network, install-script, or
removable-media write path.

The post-implementation bug review also makes the already locked
`getrandom@0.3.4` a direct composition dependency so preview capability tokens
are seeded from the operating system CSPRNG rather than time and process data.
This adds only a dependency edge: no package version or checksum changed, and
`getrandom@0.3.4` was already product-runtime reachable through the existing
Tauri dependency graph.

The JavaScript lockfiles are unchanged. Re-running the required audits produced
the same classified totals:

- root: 31 advisories (`low: 2`, `moderate: 12`, `high: 16`, `critical: 1`);
- docs/PDF: 88 findings (`low: 5`, `moderate: 33`, `high: 48`, `critical: 2`).

`cargo audit` remains unavailable (`cargo: no such command: audit`) and was not
installed, so this is not a complete Rust audit. Since this delta introduces no
new third-party package/version pair, no new Rust package query was required.
The existing Rust classifications, acceptance deadlines, and recheck triggers
remain in force. No new runtime-reachable `critical` or `high` advisory was
identified by the M3-E3 dependency delta.

## M4-A transaction foundation dependency delta

Audit date: 2026-08-29

M4-A adds the workspace crates `ot-plan`, `ot-backup`, and `ot-executor` without
adding a crates.io or JavaScript package and without changing a resolved package
version or checksum. The new direct third-party dependency edges use packages
already present in `Cargo.lock`: `fs2@0.4.3`, `serde@1.0.228`,
`serde_json@1.0.149`, `sha2@0.10.9`, and `rustix@1.1.4`; `tempfile@3.25.0`
is test-only. `rustix` provides safe descriptor-relative filesystem operations
for backup sources and executor destinations, so traversal, creation, and
publication do not reopen validated paths through a replaceable symlink parent.

The Tauri composition package does not depend on the three new workspace
crates in M4-A. They are therefore not product-runtime reachable in this PR.
Tests exercise them only against generated temporary directories. M4-B must
repeat the reachability and advisory review before connecting production write
authority or a Tauri API.

M4-A adds no network endpoint or install-time script. Backup, staging, and
journal paths are caller-provided Mac-side local directories and are rejected
before creation if they resolve inside the approved source root. Manifests and
journals contain validated relative paths and opaque/versioned identifiers,
not raw absolute paths or session `RootId` values.

`cargo audit` remains unavailable and is not installed by this PR, so this is
not a complete Rust audit. Because the lockfile delta contains only the three
new local workspace package records and no new third-party package/version
pair, the existing Rust classifications and recheck triggers remain in force.

## M4-B production write reachability delta

Audit date: 2026-08-29

M4-B connects the Tauri composition package directly to the existing local
workspace crates `ot-plan` and `ot-executor`; `ot-backup` becomes product-runtime
reachable through the executor. `Cargo.lock` changes only the composition
package's two local dependency edges. No crates.io package, resolved version, or
checksum changes, and the JavaScript lockfiles are unchanged.

The runtime-reachable third-party edges used by this path are the already locked
`fs2@0.4.3`, `serde@1.0.228`, `serde_json@1.0.149`, `sha2@0.10.9`, and
`rustix@1.1.4`. An exact package/version OSV query returned no advisory for all
five packages. `cargo audit` remains unavailable (`cargo: no such command:
audit`) and was not installed, so this is not a complete RustSec audit. No new
runtime-reachable critical/high advisory or critical advisory with unknown
reachability was identified by this dependency delta.

The new product write path is limited to an absent root-relative destination on
a live, stable, session-approved root. It requires a short-lived write grant,
the exact displayed PlanId as one-shot approval, a verified local backup,
operation journal, descriptor-relative source/destination validation,
no-replace publication, and post-write hash verification. Backup, staging, and
journal state is stored only below Mac-side Application Support. An incomplete
journal blocks later grants and applies; this PR exposes recovery-required
status but does not expose production recovery execution.

Re-running the JavaScript audits produced the same classified totals:

- root: 31 advisories (`low: 2`, `moderate: 12`, `high: 16`, `critical: 1`);
- docs/PDF: 88 findings (`low: 5`, `moderate: 33`, `high: 48`, `critical: 2`).

These findings pre-date M4-B and no JavaScript package changed. M4-B adds no
network endpoint, install-time script, dependency override, or audit suppression.
All write-composition tests used generated temporary directories and synthetic
WAV bytes; no physical Octatrack, SD/CF card, original media, release, deploy,
or user Application Support directory was used.

## DEP-1 Tauri security baseline (2026-08-30)

Pinned the Tauri stack without unrelated dependency bumps or `pnpm.overrides`:

| Component | Before | After |
| --- | --- | --- |
| `tauri` (Rust) | `2.10.2` | `2.11.5` (manifest floor `2.11.1`) |
| `tauri-build` | `2.5.5` | `2.6.3` |
| `tauri-plugin-dialog` | `2.6.0` | `2.7.2` |
| `tauri-plugin-opener` | `2.5.3` | `2.5.4` |
| `@tauri-apps/api` | `2.10.1` | `2.11.1` |
| `@tauri-apps/cli` | `2.10.0` | `2.11.4` |
| `@tauri-apps/plugin-dialog` | `2.6.0` | `2.7.2` |
| `@tauri-apps/plugin-opener` | `2.5.3` | `2.5.4` |

`GHSA-7gmj-67g7-phm9` is remediated by the `tauri` floor. Transitive
`quick-xml@0.38.4` and `serde_with@3.16.1` remain resolved through current
Tauri; restart/updater stay disabled and those edges stay documented above.
No React Router or frontend toolchain packages were changed in DEP-1.

Mac `.app` / `.dmg` generation and live Root/preview/metadata/copy/recovery
smoke require a macOS host and were not executed in the Linux CI agent.

## Reproduction

Commands used:

```bash
pnpm audit
pnpm audit --prod
pnpm --dir user-guide audit
pnpm --dir user-guide audit --prod
pnpm ignored-builds
pnpm --dir user-guide ignored-builds
```

The Rust fallback submitted each crates.io package name/version from
`src-tauri/Cargo.lock` to `https://api.osv.dev/v1/querybatch`. Advisory details
were reconciled by GHSA/RUSTSEC alias, package version, affected range, and
fixed version. Advisory text and versions are point-in-time data; rerunning the
commands can legitimately produce a different count as databases evolve.

No physical Octatrack, SD card, CF card, removable media, release, deploy, or
application data write was used during this audit.
