# Chrome / Edge experimental build verification — 2026-09-14

Status: **0.1.4 experimental component**, not a store release or an independently
audited password manager. Supported browser targets are **Chrome and Edge only**,
using one Chromium Manifest V3 package. All test passphrases, notes and clipboard
substitutes are synthetic. No user profile or real notes are part of these tests.

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
