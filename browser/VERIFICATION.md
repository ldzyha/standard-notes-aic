# Chrome / Edge experimental build verification — 2026-09-23

[English](VERIFICATION.md) · [Українська](VERIFICATION.uk.md)

Status: **0.9.0 experimental component**, not a store release or an independently
audited password manager. Supported browser targets are **Chrome and Edge only**,
using one Chromium Manifest V3 package. All test passphrases, notes and clipboard
substitutes are synthetic. No user profile or real notes are part of these tests.

## 0.9.0 responsive records and edit-exit ordering — verification scope

- Version pair: Standard Notes **44.1.0**, browser **0.9.0**, AIC Notes
  **52.1.0**, shared core **7.3.0**. Browser vault format is unchanged.
- The regression contract covers natural-width field wrapping, lock-only
  password copy, stable row sorting at source-edit exit and preserved values.
- In-app Chromium checks of the real editor at 320, 360, 393 and 768 px found
  no record or page overflow in light/dark and read-only cases. The shipped
  coarse-pointer CSS was exercised synthetically: labels and lock buttons
  measured 44 px. This is CSS verification, not physical touch-device testing.
- Built VS Code primary and Linked Note bundles were checked with a synthetic
  host at narrow widths in both themes. Copy feedback, edit-exit sorting and
  immediate secret masking passed without visible errors. No real note or OS
  clipboard was used. `test/fixtures/security-layout.html` retains the canonical
  synthetic fixture for repeatable visual checks.
- Narrow-width browser checks use synthetic data. Physical mobile devices and
  authenticated installed Standard Notes/Chrome/Edge hosts require separate
  acceptance; this entry does not claim those checks have run.

## 0.8.0 compact credential rows — release verification

- Version pair: Standard Notes **43.1.0**, browser **0.8.0**, AIC Notes
  **51.1.0**, shared core **7.2.0**. Browser vault format is unchanged.
- Canonical DOM tests verify the compact lock-and-six-dot protected copy target,
  one trailing creation menu in the final value, and no detached footer row.
- The shared core gate covers narrow responsive CSS; packaged Chrome/Edge
  acceptance remains a separate manual check.

## 0.7.0 whole-block Cut — release verification

- Version pair: Standard Notes **42.1.0**, browser **0.7.0**, AIC Notes
  **50.1.0**, shared core **7.1.0**. Browser vault format is unchanged.
- Canonical editor tests cover clipboard-first exact-range Cut for every managed
  block preview, read-only omission and preservation after clipboard failure.

## 0.6.1 bilingual documentation — release verification

- English and Ukrainian product, privacy and verification documents are emitted
  into the Chromium build and enforced by the package verifier.
- The runtime and encrypted library format are unchanged from 0.6.0.

## 0.6.0 Mermaid source and preview — release verification

- Version pair: Standard Notes **41.1.1**, browser **0.6.0**, AIC Notes
  **49.1.1**, shared core **7.0.0**. Browser vault format is unchanged.
- Canonical editor tests and synthetic Chromium regressions cover source
  editing with a live flowchart preview, one Edit icon, Copy, preview zoom,
  and the absence of the visual builder and rotation. Installed Chrome/Edge
  acceptance remains separate.

## 0.5.2 quote accents and editable fences — release verification

- Version pair: Standard Notes **40.0.1**, browser **0.5.2**, AIC Notes
  **48.0.1**, shared core **6.2.2**. Browser vault format is unchanged.
- Headless Chromium at 320 and 560 px showed distinct quote, warning and error
  accents with gaps between the blocks and no page overflow. An unfinished
  ```language line stayed in source. Focused parser tests distinguish the
  three quote markers from `>>> … <<<` details and ignore callout-like text
  inside fenced code. Installed Chrome/Edge acceptance remains separate.
  ```

## 0.5.1 Markdown layout — release verification

- Version pair: Standard Notes **39.0.1**, browser **0.5.1**, AIC Notes
  **47.0.1**, shared core **6.2.1**. Browser vault format is unchanged.
- Synthetic Markdown in headless Chromium at 320 and 560 px showed a centered
  thematic break 53–96 px wide, 12.8 px of row padding above and below, and
  no horizontal page overflow. Heading-to-quote and quote-to-list text gaps
  remained at least 13 px. Clicking the break revealed raw Markdown while its
  row height stayed constant. These checks used the standalone editor and do
  not replace installed Chrome/Edge or store acceptance.

## 0.5.0 narrow-panel layout — release verification

- Version pair: Standard Notes **38.1.1**, browser **0.5.0**, AIC Notes
  **46.1.1**, shared core **6.2.0**. No browser vault format change is made.
- The canonical suite passed 1,069 tests across 94 files, TypeScript, lint,
  notices and both production builds. The VS Code mirror passed its 30 tests,
  byte-parity check and build.
- A headless Chromium layout check used synthetic fields at widths from 160 to
  720 px. It found no page or panel horizontal overflow, clipped labels or
  values-only scrolling. Labels and values wrapped together; password generation
  was hidden at 600 px and below and present at 720 px.
- This check does not replace installation in a clean Chrome or Edge profile,
  interactive permission tests or browser-store review. Prior 0.4.0 packaged
  runtime evidence below applies to that prior version only.

## 0.4.0 Global Shared and section copy — release verification

- Version pair: Standard Notes **37.2.0**, browser **0.4.0**, AIC Notes
  **45.1.0**, shared core **6.1.0**. Library v3 adds one explicit profile-local
  Global Shared record. Reading v1/v2 preserves content without writing; the next
  mutation writes v3. Older builds cannot read v3. No synchronization or generated
  key/VS Code vault is introduced.
- Final installed Edge package passed **16 checks** in a disposable profile:
  actual worker/sidebar activation, sender isolation, outgoing-request CSP,
  unchanged empty Global placeholder, first edit through visible UI, exact-origin
  Shared, masked cross-origin/no-page Global, ordered light/dark 320/600 px layout,
  encrypted local storage, Lock, and full browser restart/unlock restoring all
  scopes. Scanning 230 disposable profile files found neither synthetic Global
  nor domain secrets in UTF-8/UTF-16. This is not a forensic erasure guarantee.
  Evidence: `D:\aic\reviews\browser-extension-20260914\release-0.4.0-edge-final`.
- Section-copy runtime QA passed eight Chrome/Edge light/dark 320/600 px cases,
  using an in-memory clipboard substitute. Standalone AIC contains only the chosen
  section, including masked/filter-hidden rows; labels and typed values round-trip
  through the canonical serializer. Focus and read-only source stay intact, there
  is no horizontal overflow, and coarse controls are 44 px. Unnamed empty sections
  remain layoutless without a redundant copy action. Evidence:
  `D:\aic\reviews\section-copy-20260915`.
- Shared core is distributed byte-identically into VS Code. Its full local suite
  passed 217 tests and its production build passed. Native VS Code acceptance,
  actual installed Chrome, interactive permissions, OS clipboard integration and
  cross-panel Lock remain separate checks; the packaged Edge run does not claim
  them. Browser unit tests separately cover two-panel Global conflicts, one-time
  state acknowledgments, stale controls, migration and encrypted backup restore.
- Final canonical verification passed 1,070 tests in 94 files, TypeScript, whole
  repository lint, formatting, notices, shared-core parity and production builds.
- The reported Standard Notes PWA exit is **not fixed or reproduced** by this
  release. A repaired synthetic stress harness exercised 1,020 edits with current
  typed fields and 498k-character JavaScript source without page errors, crashes
  or unexpected disconnects; DOM/listener counts were stable and destroyed editor
  roots were collectible. That bounded run is not authenticated PWA acceptance.
  See `D:\aic\reviews\pwa-crash-20260915` for observations and limitations.
- GitHub publication and Pages deployment must be checked after CI completes.
  Store submissions and independent security audit remain unverified.

## 0.3.1 compact shared editor toolbar — prior release verification

- Scope: Standard Notes and the browser share one always-compact editor
  toolbar with direct strike, link, bullet-list, ordered-list and task-list actions,
  source mode, and a local guide where the host enables its trigger. The browser
  explicitly suppresses the editor-level guide because its panel owns that entry
  point. Style/Insert selectors and Bold/Italic/Inline-code buttons are absent;
  keyboard shortcuts, Markdown and slash commands retain those operations.
- Responsive contract: the toolbar wraps without horizontal scrolling and
  coarse-pointer actions retain 44 px targets.
- Version pair: Standard Notes AIC **36.0.1**, browser **0.3.1**, AIC Notes
  **44.4.7**, shared core **6.0.0**. The browser version changes because its package
  contains the changed shared host-toolbar and CSS bundle; the encrypted-library
  format is unchanged.
- The full canonical suite passed **1,054 tests in 92 files**. Typecheck, lint,
  formatting, notices, shared-core parity and production builds passed. Focused
  tests cover the default seven-button Standard Notes surface, host-owned help,
  readonly access, keyboard formatting, source mode and save/retry states.
- The compiled Standard Notes build passed Chrome and Edge checks in light/dark,
  320/600 px and fine/coarse-pointer layouts. The clean toolbar is 32 px with a
  mouse and a single 49 px row with 44 px touch targets, including at 320 px. Dirty
  Save/retry controls remain reachable without horizontal overflow; narrow touch
  layouts wrap only when those extra controls require it. Synthetic storage
  failure exposes Retry and returns to saved after recovery. A compiled iframe
  fixture verifies readonly formatting, enabled source/help and heading focus.
  These are isolated synthetic host fixtures, not a signed-in Standard Notes PWA
  session. Evidence: `D:\aic\reviews\standard-notes-toolbar-20260915-compiled-edge`
  and the corresponding `-compiled-chrome` directory.
- Final installed Edge runtime passed **12 checks** in a fresh disposable profile:
  worker/sidebar activation, sender isolation, outgoing-request CSP, encrypted
  page/domain saves, masked shared preview, Lock and restart/unlock. A bounded scan
  of 229 profile files found no synthetic shared secret; this is not a forensic
  erasure claim. Evidence: `D:\aic\reviews\browser-extension-20260914\release-0.3.1-edge-final`.
  Panel JavaScript SHA-256:
  `2a8cde214193c9a62ff6edf97182d16a9133052708709911111d4f864340daa2`;
  panel CSS SHA-256:
  `e8a258fe2a41c68da49325bff5c8a14458d89f966ac1fb7f34561bcd0260766d`.
  Documentation-only repackaging must preserve all runtime/manifest bytes.
- Updated lifecycle checks passed 200 cycles with embedded help and 200 with
  host-owned help: zero retained editor roots, DOM nodes 7, listeners 0 and no
  reported errors. This bounded result does not prove every workload leak-free.
- Installed Chrome acceptance, interactive permission prompts, real OS clipboard
  behavior and installed-runtime cross-panel Lock remain unverified. Historical
  evidence below is not substituted for this version's checks.

## 0.3.0 AIC-only fields — release-candidate verification

- Shared core 6.0.0 replaces active YAML Properties interpretation with one fenced
  `aic` document. Typed separators apply to the next value, including independent
  ordinary, secret, authenticator, card, unused one-time and used one-time parts.
  Field adds a typed value, Row inserts below its row, and Section inserts after
  its section. Empty sections keep Row and Section inline. The bundled local guide
  explains independent values and usage templates; unsupported old source remains
  available for manual repair without automatic conversion.
- The canonical unit suite passed **1,053 tests in 92 files**. The VS Code host
  suite passed **217 tests**. Final type, lint, formatting, notice, build and shared
  core parity checks are release gates, not replacements for runtime acceptance.
- A genuine Edge 153.0.4234.32 **final 0.3.0 runtime** passed all 12 existing
  smoke checks: actual MV3 worker and toolbar-opened sidebar, sender isolation,
  outgoing-request CSP, encrypted page/domain saves, masked shared preview, Lock,
  and full browser restart/unlock/reopen. A bounded scan of 230 disposable-profile
  files found no synthetic shared value in UTF-8 or UTF-16LE. This is not a forensic
  erasure claim. Evidence is under
  `D:\aic\reviews\browser-extension-20260914\release-0.3.0-edge-final`.
  Tested panel JavaScript SHA-256:
  `d290f5c65b6497bee501279e64b9294235a4cb0133a98076a888e852f9ef07c3`;
  panel CSS SHA-256:
  `0a5236783aaba60c1148c647e41b8f9f6a4200f8251b6fa55e26024aed56051b`.
  Documentation-only repackaging must preserve runtime and manifest byte parity.
- Actual Chrome and Edge rendering passed eight light/dark, 320/600 px cases,
  plus coarse-pointer checks. Row labels and first values share aligned columns;
  narrow coarse-pointer layouts retain 44 px controls on a second grid line.
  Empty cards keep one compact Row/Section action line. Keyboard copy/paste was
  exercised with a synthetic clipboard substitute, not the OS clipboard.
- The maintained general browser regression passed **11 groups** in Edge,
  including retired-format opacity, typed field masking, Markdown navigation,
  Undo, table, Mermaid, slash commands and keyboard behavior, with no page errors.
  The VS Code production webview bundle passed **nine scenario groups in each of
  Chrome and Edge**, including a single source toggle, a distinct linked-source
  action, no date rows and save/navigation races. The host bridge was synthetic;
  this is not a native VS Code workbench acceptance result.
- A final typed-source lifecycle run completed 400 cycles, 200 with each toolbar
  mode. It reported zero retained editor roots; nodes 7 → 7, listeners 0 → 0 and
  documents 1 → 1. Approximate heap changed 10,121,724 → 10,410,304 bytes in the
  default mode and 10,770,872 → 11,271,300 bytes in compact mode, with no errors.
  This bounded run
  is not a claim that every workload is leak-free.
- Maintained browser runners cover general editing, panel layout, inline fields,
  lifecycle and installed-extension smoke. Historical one-off scripts and the
  older evidence below are not claimed as current release acceptance.
  Chrome installed-runtime acceptance, interactive site permission behavior,
  actual OS clipboard behavior and installed-runtime cross-panel Lock remain
  unverified. Unit-level cross-panel behavior does not close those runtime gates.
- Prepared release pair: Standard Notes AIC **35.3.9**, AIC Notes **44.4.7**,
  shared core **6.0.0**. This release does not include the proposed global Shared
  hierarchy, a central generated encryption key or automatic migration of old
  plaintext syntax. Existing raw note source remains available for manual repair.

## 0.2.1 card/action alignment and bounded navigation labels (historical)

- The source candidate aligns card/composite labels and first values with adjacent
  simple fields, omits the extra card-label colon, and separates field actions from
  the bordered Section footer. Masking, independent copy targets and existing field
  actions are unchanged. Core 5.4.0 exposes the supporting section-action/footer BEM
  elements additively; compatibility hooks remain.
- A 16-case real-renderer source matrix passed in Chrome and Edge across light/dark,
  320/600 px and Security/Properties. It covered the corrected card alignment,
  distinct field/Section action surfaces, masked card parts, independent copy
  feedback and empty-field actions. This is source-renderer evidence, not an
  installed-extension or native VS Code workbench pass.
- Browser navigation now projects bounded readable titles without visibly exposing
  the complete query or fragment. The exact stored URL, navigation target and note
  identity remain unchanged; the correction does not redact an exported note or
  alter encrypted storage.
- Plain Markdown preview now uses parser-backed link records rather than a
  parenthesis-fragile regular expression, preventing destination suffixes from being
  appended to visible link labels. Final regression and package gates remain required
  for the 0.2.1 candidate.
- The final source candidate also replaces the compact browser's nested
  Format/Style/Insert controls with five direct formatting icons and makes shared
  field-add menus compact and left-aligned. These two later changes are not covered by
  the preceding 16-case result; final renderer and package gates remain required.
- Direct content/Markdown import/export controls, native paste, redundant Copy
  removal and the reduced More/backup grouping were added after that matrix as well.
  No renderer or packaged-runtime pass is claimed for those changes yet.
- No packaged Chrome/Edge runtime has yet been built or tested as version 0.2.1.
  The 0.2.0 installed Edge smoke and source matrices below remain historical evidence
  and do not prove this candidate's package identity. Chrome installed-runtime,
  interactive permission/OS clipboard and cross-panel Lock gates remain open.
- Release pair: Standard Notes AIC **35.0.7**, AIC Notes **44.0.3**, shared core
  **5.4.0**. This release does not include the separately proposed global
  Shared/encryption design. Library v2 and the encryption envelope are unchanged.

## 0.2.0 compact shared UI and local deletion

- Shared UI primitives now have one canonical BEM/token implementation and an
  explicit component registry. Feature ownership covers all canonical and VS Code
  adapter source files. Contract tests check registry/runtime parity, real paths,
  source coverage and the absence of duplicated host preview-shell styles.
  This is a tested migration slice, not completion of every legacy selector.
- Empty domain Properties are a **Shared** action inside the page's Format
  toolbar, without a separate empty-state header or panel. Populated shared data
  remains above the saved ancestor links and current page note. Ancestors expose
  exact-origin, strict path-prefix metadata only; sibling content and parent
  Markdown/secrets are never copied into the current document.
- Local page deletion requires confirmation, waits for the owning draft's save
  acknowledgment and compares the stored identity/revision before mutation. Tests
  cover delayed/failed saves, concurrent edits, newly created drafts, history-only
  entries and page changes before/after acknowledgment. The active page resets to
  a memory-only placeholder; unrelated notes and domain Properties remain intact.
- Canonical unit/integration verification passed **1,118 tests in 91 files**;
  VS Code passed **231 tests**. TypeScript, ESLint and locked dependency notice
  verification passed. Final package/build evidence is recorded separately below.
- Final real-renderer matrix passed in both Chrome and Edge, light/dark at
  320/600/900 px: the compact toolbar is 36 px, the page editor starts at 72 px,
  and neither panel nor document exceeds viewport width. At 320 x 360 px with
  populated sharing and long ancestor paths, all ten Format actions are reachable;
  Format and field menus fit the viewport and scroll internally. Escape restores
  focus. Current/other-page deletion and the non-persisted replacement placeholder
  also passed real-renderer flows.
- Explicit touch buttons and coarse-pointer controls retain at least 44 px targets,
  including compact field controls. The 16-case Chrome/Edge x light/dark x 320/600
  x Security/Properties matrix passed for cards and generic fields: one 35.55 px
  row, optional title, masked number/CVV, independent copying, feedback and
  empty-field actions. Computed fonts are `system-ui, sans-serif`. The primary
  reviewer inspected narrow light/dark empty and card screenshots.
- Real-renderer checks use isolated synthetic APIs and clipboard substitutes;
  they are not proof of browser permission prompts, actual OS clipboard behavior,
  authenticated Standard Notes PWA stability or native VS Code workbench rendering.
  Previous 0.1.4 installed-package results below remain historical evidence, not a
  claimed 0.2.0 installed-runtime pass. Browser-store submission is not included.
- A fresh genuine **Edge 153.0.4234.32 packaged 0.2.0 smoke passed all 12 checks**:
  actual MV3 worker, toolbar-opened sidebar, sender isolation, outgoing-request
  CSP, encrypted page/domain saves, masked child preview, Lock, and full browser
  restart/unlock/reopen. A bounded scan of 230 disposable-profile files found no
  synthetic shared secret in UTF-8/UTF-16LE; this is not a forensic erasure claim.
  The primary reviewer inspected the restored masked preview. This package smoke
  does not cover deletion/ancestor flows (covered separately above), cross-panel
  Lock, OS clipboard or interactive permission prompts. Chrome installed-runtime
  acceptance remains unverified; the renderer checks do not fill that gap.

Packaged runtime identity (before/after evidence-only documentation updates):
`panel-CtUtbYR1.js`, `panel-1NeeW91x.css`, and `worker.js`; SHA-256 values and the
12-check report are under `release-0.2.0-edge/runtime-smoke-report.md` in the review
directory below. No network permissions, encrypted-library schema or user profile
were changed by these checks.

Release pair: Standard Notes AIC **34.3.1**, AIC Notes **43.0.1**, shared core
**5.3.0**. Library v2 and encryption-envelope formats are unchanged in this release.

Evidence: `D:\aic\reviews\browser-extension-20260914\compact-{chrome,edge}` and
`inline-*.png`. Bounded implementation/inventory/renderer QA used **GPT-5.6 Sol
(high)**; storage review, integration and release verification used **GPT-6 Astra
(high)**. The primary reviewer checked the implementation and test results.

## 0.1.4 shared Properties, navigation and caret verification

- Separate encrypted library v2 records own shared Properties by exact URL origin.
  Version 1 notes/history and homepage Markdown remain unchanged on migration;
  encrypted backup merges skip existing origins. Page copying/export/import does
  not include or mutate inherited shared fields.
- Shared previews mask secrets and remain readonly even under selection. Explicit
  editing uses the canonical editor. Opening an empty shared editor creates no
  record; first valid edits persist. Failed/invalid drafts survive retained-panel
  navigation, and conflicts cannot overwrite newer saved data.
- The integration checks cover cross-panel refresh, storage events arriving before
  acknowledgments, editing during a delayed save, remote updates to clean editors,
  and clearing both renderers on Lock. Page editor identity/selection stays intact
  during shared editing and refresh.
- Compact navigation retains page titles and useful common-path groups, not unary
  URL ladders. Full URLs are tooltips rather than repeated visible text.
- Real renderer checks cover shared creation/edit/save/copy and child inheritance
  in light/dark at 320/600 px. Narrow layouts have no horizontal overflow. Separate
  Chrome/Edge caret checks cover 64 stages: typing, focus, source mode, toolbar and
  live theme changes. The drawn caret is 2 px; tested contrast is 13.27:1 in light
  and 12.32:1 in dark. Renderer hosts use synthetic extension APIs.
- Pipe-style Properties/Security fields are single rows without visible Value or
  Description subheaders. All 16 Chrome/Edge × light/dark × 320/600 × block-kind
  checks passed: 35.55 px rows, independent copying, masked values and no page
  horizontal overflow. The main agent inspected the narrow dark screenshot.
- The main agent ran the final complete canonical suite: **1,069 tests / 86 files
  passed**, plus repository TypeScript and ESLint. Shared-core byte parity,
  Standard Notes production build and VS Code build passed.
- Final **actual Edge packaged smoke passed (12 checks)**: genuine MV3 worker and
  sidebar; Done immediately after typing; exactly one shared-origin record;
  masked child preview before/after restart; page/domain restoration after unlock;
  encrypted storage and sender/CSP checks. A bounded scan of 231 disposable-profile
  files found no synthetic shared secret in UTF-8/UTF-16. This is not a forensic
  erasure guarantee. Actual cross-panel Lock is unverified (integration tests pass).
  Chrome installed-package automation remains unverified; renderer results do not
  substitute for it. The release recheck on Chrome 152.0.7977.83 returned an
  extension ID but no service-worker target; opening the packaged panel returned
  `net::ERR_BLOCKED_BY_CLIENT`. No Chrome installed-runtime pass is claimed.

- Release packaging verifies a deterministic inventory of locked and upstream
  prebundled dependency licenses. The Chrome/Edge ZIP includes full notices and a
  separate SHA-256 sidecar; VS Code preserves its additional Lezer CSS and font
  notices. VS Code's complete 231-test suite passed. These checks are distinct from
  browser-store approval and the remaining interactive acceptance gates below.

Screenshots are under `D:\aic\reviews\browser-extension-20260914`, prefixed
`domain-` and `caret-`. The main agent inspected the narrow dark shared preview;
delegates inspected navigation and other variants. Bounded implementation/QA used
**GPT-5.6 Sol (high)**; the storage design and independent integration review used
**GPT-6 Astra (high)**. The main agent integrated changes and verified results.

Upgrade note: preserve a pre-update encrypted backup if rollback matters. Once v2
is written, old extension builds cannot read that library; they are not a downgrade
migration tool. The encryption envelope is unchanged. This component accompanies
Standard Notes AIC 33.2.4 and AIC Notes 42.0.3; store publication is a separate gate.

## Standard Notes PWA memory investigation (33.2.4 source fix)

- A real pinned `sn-extension-api@0.4.0` test confirmed that the transport retained
  full outbound notes after acknowledged saves: 20 saves left 20 snapshots, about
  4 million text characters. The adapter now releases its own one-shot messages on
  acknowledgment, failure, timeout or disposal, including queued saves. Completed
  save snapshots fall to zero; context streams and unrelated callers stay intact.
- The shared Security renderer no longer repeats the full syntax-tree scan once
  per block per edit. Block counting now reuses one scan per decoration rebuild.
- A bounded isolated Edge workload performed 680 edits across a 48-block note and
  a single block with 384 fields, with source/preview toggling. Mounted node and
  listener counts were stable between batches; closed editor roots were collectible.
  After disposal, listeners returned to 5 (baseline 5), nodes 87 (warmed baseline
  81). Post-GC heap growth across 300 measured edits was about 0.56 MB and 0.16 MB,
  respectively. No renderer errors occurred. This is bounded regression evidence,
  not proof that every workload is leak-free or that the user's PWA crash is fixed.
- The later user console screenshot showed a separate host-network failure:
  Standard Notes API preflights failed CORS. A credential-free local probe also
  received HTTP 503 with an upstream connection timeout and no CORS allow headers.
  Neither this observation nor the screenshot establishes VPN causation. No VPN,
  browser security settings, account data or PWA storage was changed.

## 0.1.3 placeholder and field-menu verification

- Opening a new page mounts the shared Properties preview and editor immediately,
  without a Create note step. An unchanged placeholder creates no note record
  (the existing page-history behavior is unchanged). First edits create a note;
  untouched imports replace only the seed with exact imported Markdown.
- First-create acknowledgments keep the same editor, selection and undo history.
  In-flight edits are drained after creation. Conflicting creation never appends
  or overwrites another panel's note. Failed drafts remain editable/exportable.
- A quick tab switch before first save retains the draft and gives a page-specific
  message; returning to the source page retries automatically. Closing warnings
  include in-flight writes even when Undo has returned the visible text to its base.
- Security/Properties menus fit inside the visible editor, stay below the toolbar,
  choose space above or below the trigger and scroll internally without resetting
  their scroll position. Positioning listeners and observers are disposed on close.
- Final canonical suite: **1,014 tests / 79 files passed**. TypeScript, repository
  ESLint, touched-file Prettier and shared-core byte parity passed. All **231 VS Code
  tests** and both Standard Notes and VS Code production builds passed. The VS Code core snapshot explicitly marks
  its source as a working tree; no published extension version changed.
- **Edge and Chrome real-renderer checks passed**, six light/dark layouts each at
  320/600/900 px, including placeholder, import, editing, saving, export, Lock and
  reopening. Separate 320×360 light/dark checks hit-test all seven enabled menu
  choices for both Properties and Security using menu-only scrolling. These use
  simulated extension APIs, not real site permission or clipboard prompts.
- **Actual Edge packaged smoke passed**: genuine MV3 worker/sidebar, placeholder,
  encrypted local save, Lock, restart/unlock/reopen, sender isolation and network
  CSP checks. Initial automation attempts delivered only a suffix of the typed
  fixture; diagnostics confirmed that this received text was saved. The regression
  now clicks the visible writing line to place the caret before typing, instead of
  directly focusing the contenteditable; the complete-input/save/restart run passed.
  This does not verify user clipboard/site-access prompts or cross-panel Lock.
- **400 isolated editor lifecycle cycles passed**, 200 per toolbar mode: zero
  retained editor roots, nodes 7 → 7 and listeners 0 → 0 after collection. This is
  bounded regression evidence, not proof that every workload is leak-free.
- Chrome packaged automation was not retried: the previously recorded worker
  discovery limitation remains. Chrome renderer results are not a substitute for
  actual installed-extension acceptance.

Screenshots: `D:\aic\reviews\browser-extension-20260914\placeholder-menu-edge`
and `placeholder-menu-chrome`. The main agent inspected the generated placeholder
and narrow-menu images. Two bounded delegates used **GPT-5.6 Sol (high)** for the
draft coordinator, shared menu and regression coverage; the main agent integrated
the changes and independently ran the complete suite, builds and Edge smoke.

## Previous 0.1.2 target cleanup

- One browser manifest, one service worker and one Chromium side-panel adapter.
- One unpacked `dist-browser/chromium/` folder and one Chromium ZIP for both browsers.
- Unsupported build modes fail; no alternate browser archive is emitted.
- Runtime requires the native Chrome-compatible side-panel API and explicit trusted
  local/session storage restrictions. Missing or failed protections fail closed;
  the key is never moved to persistent storage as a fallback.
- Canonical Markdown, encryption, page capture, save ownership, Standard Notes and
  VS Code behavior are unchanged by this target cleanup. Old generated files and
  isolated test evidence are not current supported artifacts; they were not deleted.

## Previous 0.1.2 verification

- The main agent reran the integrated repository suite: **995 tests / 78 files
  passed**. TypeScript, repository ESLint and canonical shared-core parity passed.
  New regressions verify Chromium-only build modes, the service-worker requirement,
  one ZIP output, native API selection and trusted-storage failures.
- The package builds with manifest version 0.1.2 and 111 bundled files. No runtime
  dependencies or permissions were added; Standard Notes/VS Code/core versions were
  not changed.
- **Actual Edge 153.0.4234.32 packaged smoke passed** in an isolated profile: MV3
  worker, toolbar-opened sidebar, sender isolation, encrypted local save, Lock,
  restart/re-unlock/reopen and CSP fetch/WebSocket/image denial. This does not cover
  actual site-permission prompts, clipboard integration or cross-panel Lock.
- **Actual Chrome 152.0.7977.83 packaged automation remains blocked**: one isolated
  attempt returned an extension ID but exposed no running service worker. No Chrome
  extension-runtime assertion passed, and no repeated or security-setting workaround
  was attempted. Manual unpacked installation is documented, not claimed tested.

## Previous compact-panel baseline (0.1.1, not a 0.1.2 runtime claim)

- Full canonical suite: 989 tests across 77 files; TypeScript, ESLint and touched-file
  Prettier checks passed. Standard Notes production build passed. The main agent
  reran 231 VS Code tests and both read-only shared-core integrity checks.
- Actual Edge and Chrome renderer checks passed at 320, 600 and 900 px in light/dark
  themes (six layouts each), using **simulated extension API/storage/clipboard**.
  The compact editor occupied 87–88% of an 800 px panel without horizontal overflow.
- Isolated Edge lifecycle checks passed for 200 cycles per toolbar mode: zero
  retained editor roots, nodes 7 → 7 and listeners 0 → 0 after collection. Compact
  cycles also opened/closed Formatting. This is bounded regression evidence, not
  proof that every workload is leak-free.
- Package/model tests cover safe deterministic archives, icon integrity, bundled
  assets, WebCrypto/tamper rejection, sole-writer ordering, conflicts, failed writes,
  quotas, draft disposal, cursor preservation, stale capture/clipboard replies,
  bounded read-only import, compact menus and focus restoration.

## Current packaged-runtime acceptance matrix

| Target | Existing evidence                                                                                                                                                                                               | Remaining acceptance checks                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge   | 0.1.4 genuine worker/sidebar: 12 packaged smoke checks passed, including page/domain encrypted save, immediate Done, restart/unlock/reopen, sender isolation and CSP. Renderer layout/menu/caret checks passed. | Actual user-driven site-access prompt/import, clipboard and cross-panel Lock.                                                                                              |
| Chrome | 0.1.4 real-renderer layout, domain preview and caret checks passed; packaged automation did not establish a running worker.                                                                                     | Confirm current packaged worker/sidebar, save/restart, permissions, clipboard and Lock. An automation limitation is not a pass or evidence that manual installation fails. |

The host renderer runner is `scripts/browser-panel-regression.mjs`; the installed
Chromium package runner is `scripts/browser-extension-regression.mjs`; lifecycle
checks use `scripts/browser-lifecycle-regression.mjs`. The packaged runner creates
an isolated profile, never attaches to the user's running browser, and reports
infrastructure limitations rather than substituting an ordinary extension tab for
the genuine sidebar. Earlier local evidence remains under
`D:\aic\reviews\browser-extension-20260914`.

## Safety and release boundaries

Only acknowledged saves and exported files are durable. Shutdown/pagehide saving
is best effort. Global Lock clears plaintext and discards other panels' uncommitted
memory drafts; save them first. Lock does not erase the OS clipboard or exports.
Capturing visible content is not universal secret detection. Incognito/InPrivate
are excluded by the manifest; no mobile-browser support is claimed.

Before production distribution, check the current artifact in **both Chrome and
Edge**, including real clipboard/site-permission behavior, then separately verify
store distribution and upgrades. There was no store submission, automatic update,
or installation into the user's profile during this work.

See README.md for installation and dependency-ordered release gates, and PRIVACY.md
for data/permission handling. The shared adaptive workspace remains a proposal in
ADAPTIVE_PREVIEW_STUDY.md, not a feature of this build.

Scope-cleanup execution: GPT-5.6 Sol (high) handled the Chromium runtime/security
boundary; GPT-5.6 Sol (medium) handled build targets and package regressions. The
main agent owns documentation, integration and independent final verification.
