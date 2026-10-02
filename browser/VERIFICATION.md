# Chrome / Edge working build verification — 2026-10-02

[English](VERIFICATION.md) · [Українська](VERIFICATION.uk.md)

## Continue after restart and shared-file refresh — October 2, 2026

The final `npm run check` passed on **Node 22.23.3**: **1,325 tests in 112 files**,
formatting, ESLint, TypeScript, dependency notices, and Standard Notes/PWA builds.
`npm run core:check` passed, and the canonical and VS Code `FEATURES.json` copies
match byte for byte. The three maintained browser adapter commands passed syntax,
`--list`, `--help` and registered-path checks; their tests ran in the full suite,
not as an additional native-browser run.

A remembered location now shows one **Continue** action after browser restart or
extension Reload. The action waits for its native handle to be ready and requests
permission directly from the click. Startup does not prompt or turn an expected
missing grant into a failed folder scan. **Open AIC in tab** is an explicit option
when access needs permission. The worker accepts only the exact internal editor
page in a normal top-level extension tab; foreign, private, framed and stale-source
requests remain rejected. A grant made in that tab can resume the original panel
without selecting the files again or replacing a pending draft.

Current, Shared and Global edit their own Markdown files with the same editor and
save feedback. Regression tests cover Shared/Global external file changes with
both lower and higher content tokens, retained dirty drafts, and an old reload
response arriving after a newer successful save. Content tokens are not treated
as chronological version numbers.

CUA checked the production panel and service using disposable native OPFS files
and a controlled permission fixture. At 320 px, light/dark views had no horizontal
overflow and coarse-pointer actions measured 44 px. One Continue click restored
access. An ordinary Shared Markdown edit was written to disk and remained after
permission expiry, panel reload and Continue. Current/Shared/Global displayed
their correct file paths. Clean screenshots are retained beside the local build.
This does **not** verify an installed Chrome/Edge profile, a real system permission
prompt, browser restart, or automatic persistent grants.

Core writing guidance was refreshed from clean revision
`c152359c05f572b701651baebca09a49594114bf`; the reviewed documents and unavailable
on-ramp references are recorded below. Shared editor help was synchronized through
the canonical core owner. The Chromium manifest remains **0.11.3**. The package is
a local working update; no version bump, publication or store submission is claimed.

## File permission recovery — October 2, 2026

All **1,313 tests in 111 files** passed, together with formatting, ESLint,
TypeScript, shared-core parity and the Chromium package build. This is a local
working build; it has not been submitted to a store.

Open panels now retain native source handles independently of the background
worker. Candidate handles remain retained until pending writes to the previous
source are acknowledged. Read and write permissions have separate status;
reconnect runs from a user click without a directory-enumeration probe. Source
and generation checks reject late responses after switching files or disposal.
The reconnect button remains mounted across blur/save updates so the first click
is not lost. A successful single-file save accepts its content revision token
only when the exact file, submitted text and current save owner match.

Regression coverage includes worker restart, read-only access, denied permission,
partial permission recovery, candidate retention, delayed source status, stale
responses, two successive single-file saves, undo during a write and external
file conflicts. CUA checked the real panel/service and native OPFS writes with a
controlled permission shim: one reconnect click saved the retained draft; a later
write succeeded after recreating the worker service. The 320 px panel had no
horizontal overflow. Real installed Chrome/Edge permission prompts were not part
of this fixture. Browser-controlled revocation remains authoritative; see
[Chrome's permission guidance](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).

## Folder scanning and agent context update — October 2, 2026

The browser panel now reports inspected entries, found/read Markdown files and
the current path while opening or refreshing a folder. The user can stop a scan
and use the notes already read. Native reads have a deadline, cancelled work
cannot change a newer selection, and ordinary saves use the observed file index
instead of rescanning the whole folder. Large trees mount children on expansion
and page long sibling lists; search still covers every indexed note.

All **1,283 tests in 108 files** passed, including slow iterator/read cancellation,
safe partial results, explicit refresh, timeout, stale response suppression,
single-flight progress polling and stable controls between progress updates.
Formatting, ESLint, TypeScript, core parity and Chromium/PWA/Standard Notes builds
passed. The shared agent guide is version 3: it describes `*.note.md` as searchable
context, preserves declared resolver precedence and keeps owner notes read-only
unless an edit is explicitly requested. VS Code bootstrap tests cover safe guide
upgrades without replacing existing AGENTS, owner notes or `.ai` state.

CUA checked the production panel and service at 390 px with disposable native
OPFS Markdown files, a Chrome API shim and a deliberately slow directory iterator
(600 non-Markdown entries with 40 ms delay each). Progress updated during the scan;
**Use found notes** stopped it at 117 inspected entries with two notes ready. Both
notes were available, and editing one reached **On disk** without restarting the
scan. These are local fixture checks; actual installed Chrome/Edge profiles and
system picker permission prompts were not exercised. The packages remain local
working builds, not a publication or store submission.

## Plain-file working update and Core review — October 2, 2026

This is source-level preparation, not a release or installed Chrome/Edge check.
The VS Code adapter no longer registers, builds or packages the encrypted portable
editor. Its 257 automated tests passed after removal, including real browser-host
bundle activation, virtual Markdown Save/Undo, read-only provider handling and
untouched existing legacy-file bytes. Installed Chrome/Edge profile acceptance
remains separate from the local checks below.

Earlier plain-file checks: all 1,271 canonical tests in 106 files passed; formatting,
ESLint and TypeScript checks passed. All 91 shared core files match the VS Code
mirror. Standard Notes, PWA and Chromium builds completed. The local universal
VSIX includes both desktop and browser bundles and excludes the retired portable
runtime. The core snapshot is explicitly a working-tree snapshot, not a published
release. These results do not assert deployment, store submission or approval.

CUA exercised the production browser panel and service with disposable native
OPFS files and a Chrome API shim. Two successive Markdown edits reached **On disk**
and survived Reload; the selected folder handle was restored from IndexedDB.
The file tree and menus were inspected at 390 px and in dark mode at 320 px, where
the page width and scroll width were both 320 px. System pickers were replaced by
the fixture's OPFS handles; this does not verify real picker permissions or an
installed extension. Native exclusive writer semantics were checked against the
[File System API documentation](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable).

The source for the public releases page now begins with the plain-file usage guide in both
languages; earlier release entries are retained as history. Browser README and
privacy pages describe direct `.md` files/folders, URL metadata, local plain
recovery copies and external sync rather than an app password or legacy import.

The [canonical pre-release rule](../AGENTS.md) requires a fresh review of writing
guidance, the block catalogue, document templates and applicable authoring skills.
External skill connection instructions do not replace the active harness.

Pre-release writing knowledge was refreshed from clean local Core revision
`c152359c05f572b701651baebca09a49594114bf`: `AGENTS.md`,
`playground/document/DOCUMENT-GUIDE.md`, `README.md`, `format-guide.js` and
`templates.js` in that playground. Core's on-ramp points to Windows Desktop/Core
files unavailable on this host; those files were not read. The accessible
playground documents describe seven section templates and a block-local AI
context. Their BlockNote JSON is not AIC's Markdown storage format.

The public [DDK prompt](https://ddk.dzyha.com/prompt.html) redirected to
`/?system=guide`. Its fetched `assets/index-vz_MQNHW.js` SHA-256 was
`382a038f351fe2b922199d9e5a24e1eb5a5a3dedb2aac07eff086becb5843d14`;
[published agent skill](https://ddk.dzyha.com/skills/document-design-kit/SKILL.md)
SHA-256 was `70f14c6656cb70b772bac91bb7d3b046d0621e49fb07e020a763c9046a787236`.
That guide has the first-sufficient-document method, reading visibility and
Technical Study/Technical Specification templates absent from the older local
playground. Its agent connection still describes a local MCP companion. The
installed skill's adapter now describes WebMCP instead; these transport revisions
were not conflated or used to change the active harness.

Compared AIC's `src/core/agent-guide.js` and `slash-snippets.js`: shared writing
principles and glossary, bibliography, architecture, errors and verification
formats already align. AIC keeps Markdown headings, lists, tables, fenced Mermaid,
details and typed `aic` fields. It does not promise native DDK JSON import or
automatic structured-block completion. This review did not change Core, skills,
user data, syntax or runtime AI capabilities.

## Historical verification — 0.9.3 and earlier

The following records describe their original versions, including retired encrypted
features. They are not the acceptance status of the prepared plain-file update.

Status: **0.9.3 experimental submission candidate**, not a store release or an independently
audited password manager. Supported browser targets are **Chrome and Edge only**,
using one Chromium Manifest V3 package. Agent-run automated and renderer checks
use synthetic passphrases, notes and clipboard substitutes; they do not use the
owner's profile or notes. The owner's manual report is recorded separately below.

## 0.9.3 — owner-reported Chrome check

On September 24, 2026, after the manual Chrome checklist, the owner reported
that everything works and explicitly confirmed that **Lock blocks both panels**
and **import/export work**. This is a manual owner-reported pass for the installed
0.9.3 candidate, not an independently observed or automated result.

The exact Chrome version, operating system and export type were not provided.
The general confirmation is not a separate recorded result for every acceptance
matrix row. Current Edge acceptance and store installation/update checks remain
separate; this report does not establish those outcomes.

## 0.9.3 — Chrome Web Store preparation

The browser manifest drops redundant `activeTab`; capture still requests optional
origin access before `scripting.executeScript`. Privacy documentation adds the
Chrome Limited Use statement. Runtime code and shared editor versions are unchanged.
Installed Chrome/Edge acceptance and store submission are not established by this
permission and documentation update.

The 34 existing focused tests passed across browser build configuration, package
assets, platform adapter, service authorization and panel actions. Tests that
spawn Node were rerun outside the sandbox after its process restriction blocked
them; no product test failure remained.

## 0.9.2 — accordion layout and save feedback verification

- Coordinated targets: Standard Notes **46.0.2**, AIC Notes **54.0.2** and shared
  core **7.3.2**. Browser storage format and permissions are unchanged.
- CUA inspection in a Chromium renderer used a synthetic fixture running the
  canonical `AicEditor`, the runtime shared by Standard Notes and the browser.
  Light and dark themes were checked at 360 and 1280 px. Code, Mermaid and table
  children retained their accordion insets and bounds without horizontal
  overflow at the document root. Read-only behavior remained intact.
- The compiled production VS Code webview bundle was inspected with a synthetic
  host in both the main editor and Linked Note. In dark Linked Note, toggling a
  checkbox made the draft dirty while the editor background remained
  `rgb(24, 26, 28)` and its text color stayed unchanged. The Save button visibly
  pulsed; a simulated save acknowledgement hid it.
- Collapsing an accordion hid its complete body. Editing a child code block
  opened only that block's source.
- These are synthetic renderer and host UI checks, not verification of the
  Standard Notes transport, an installed browser extension or a physical device.
  Full release gates and final artifact checks are recorded separately; earlier
  evidence below does not establish installed Chrome/Edge acceptance for 0.9.2.

## 0.9.1 narrow credential controls — UI verification

- Version pair: Standard Notes **45.0.1**, browser **0.9.1**, AIC Notes
  **53.0.1**, shared core **7.3.1**. Browser vault format is unchanged.
- The regression scope is empty-field generation at narrow widths, wrapping
  options, preservation of filled values and read-only omission.
- The canonical editor's generator was checked with synthetic data and
  coarse-pointer CSS at 240, 320, 360, 600 and 601 px, including dark theme at
  360 px. It remained visible and within the panel. Generation produced a masked
  lock button, removed the generation action from the filled field and preserved
  its neighboring value.
- The production VS Code webview bundle was inspected with a synthetic host:
  main editor in light theme and Linked Note in dark theme at 360 px, plus the
  main editor in light theme at 320 and 240 px. There was no horizontal overflow;
  group titles measured 16 px with weight 750, neutral surfaces separated groups
  and rows, and the generator panel fit at 240 px.
- At 360 px in dark theme, password Copy changed lock → checkmark → lock while
  retaining exactly 44 × 44 px geometry and an accessible live status message.
  Clipboard responses were simulated; the OS clipboard was not used.
- These are synthetic host UI checks of the canonical editor and production VS
  Code bundle. They do not establish acceptance of an installed browser extension,
  authenticated Standard Notes host or physical mobile device.

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

## Historical packaged-runtime evidence (not plain-file acceptance)

| Target | Existing evidence                                                                                                                                                                                               | Remaining acceptance checks                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge   | 0.1.4 genuine worker/sidebar: 12 packaged smoke checks passed, including page/domain encrypted save, immediate Done, restart/unlock/reopen, sender isolation and CSP. Renderer layout/menu/caret checks passed. | Actual user-driven site-access prompt/import, clipboard and cross-panel Lock.                                                                            |
| Chrome | 0.9.3 manual owner-reported checklist pass on September 24, 2026; explicitly confirmed Lock across two panels and working import/export. Earlier packaged automation did not establish a running worker.        | Exact Chrome version, OS, export type and individual checklist outcomes were not supplied. Store installation and updates require separate verification. |

## Current adapter regressions — October 2, 2026

The old encrypted-runtime harnesses have been retired. Their three script names
now run Vitest suites with simulated browser APIs and DOMs:

| Command                                         | Current verification scope                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `node scripts/browser-panel-regression.mjs`     | Draft saves, panel actions, deletion, navigation and related links            |
| `node scripts/browser-extension-regression.mjs` | Plain-file adapter/concurrency, service/recovery, build and package contracts |
| `node scripts/browser-domain-regression.mjs`    | Shared/Global scopes, independent drafts and ancestor navigation              |

All three entrypoints passed on October 2: **93 panel tests**, **54 extension
adapter tests** and **66 domain tests**. The ancestor fixture now models a connected
folder and disconnection, retaining its save-before-navigation, export isolation
and editor-preservation assertions. The current English/Ukrainian release pages
also rendered successfully, and ten site/package tests passed.

Use `--list` to inspect exact test files or `--help` for the execution boundary.
These scripts do not launch Chromium, read a browser profile, or verify real
clipboard/file/site permission prompts. A successful run is not evidence of an
installed extension or store release. The unrelated editor syntax and lifecycle
renderer scripts retain their separate scope. Earlier real-browser evidence above
remains historical; its files were recorded under
`D:\aic\reviews\browser-extension-20260914`.

## Safety and release boundaries

Only acknowledged disk saves are the authoritative saved files. Local draft
checkpoints provide separate, bounded recovery; shutdown/pagehide handling is
best effort. Explicitly review recovered text before saving a copy. Recovery never
automatically replaces an original or recreates a deleted document. Removing the
extension clears its local recovery data and remembered handles, not external
files. Masking does not encrypt disk files, recovery text or clipboard copies.
Capturing visible content is not universal secret detection. Incognito/InPrivate
are excluded by the manifest; no mobile-browser extension support is claimed.

Before production distribution, check the current artifact in **both Chrome and
Edge**, including real clipboard/site-permission behavior, then separately verify
store distribution and upgrades. Agent-run checks did not install into the owner's
profile; the later owner-reported Chrome check is recorded above. Current store
submission status is tracked in [STORE_LISTING.md](STORE_LISTING.md).

See README.md for installation and dependency-ordered release gates, and PRIVACY.md
for data/permission handling. The shared adaptive workspace remains a proposal in
ADAPTIVE_PREVIEW_STUDY.md, not a feature of this build.

Scope-cleanup execution: GPT-5.6 Sol (high) handled the Chromium runtime/security
boundary; GPT-5.6 Sol (medium) handled build targets and package regressions. The
main agent owns documentation, integration and independent final verification.

## 2026-10-01 — compact header and DDK authoring review

Working-tree verification only; no website deployment, extension installation or
store publication is established by these checks. The header now has Notes and
history, More options and Lock; transfers, pinning and help use named menu actions.
Synthetic renderer checks at 320 × 568 confirmed three 44 × 44 targets, no horizontal
overflow, a bounded scrolling menu and Escape focus restoration. The real browser
regression workflow was updated but not executed in this session.

The affected browser/guide/site/registry suites passed 93 tests; built PWA offline
checks passed 17; VS Code shared-guide and runtime integrity checks passed 35.
All three web targets and the VS Code extension built successfully.

Before preparing these artifacts, the Core authoring knowledge was refreshed from
the current DDK guide, format rules and [public writing prompt](https://ddk.dzyha.com/prompt.html).
The reviewed Core checkout was based on `c152359`, with working-tree authoring
documents `playground/document/DOCUMENT-GUIDE.en.md` and
`playground/document/public/prompt.html`; this is not a claim that those documents
were committed at that revision. The public prompt matched the reviewed source,
SHA-256 `d3c8f51c98ea8d5b940f15d47bb7b758d097c9abb062e2a22e3820eacd08b1ca`.
The older sibling Core block-writing prompt was not treated as the current DDK
contract. The updated AIC guides preserve Markdown and fenced `aic` fields.

# Mobile workflow and Terms routing — October 1, 2026

The release refresh reviewed the current local DDK
`playground/document/DOCUMENT-GUIDE.en.md` and the live
[DDK writing prompt](https://ddk.dzyha.com/prompt.html). The local source remains
the `c152359`-based worktree with authoring changes. Both describe a reader's next
action, a meaningful title, the necessary questions and the first sufficient
document. This UI change preserves AIC Markdown and fenced `aic` blocks.

Synthetic browser checks use a separate localhost origin. They cover direct
note creation, a 320-pixel landing page, the 390-pixel editor, the native Notes
drawer and returning to the same saved draft. Production user notes are not
used as test fixtures. Store draft link changes are verified independently of
package publication and approval.
