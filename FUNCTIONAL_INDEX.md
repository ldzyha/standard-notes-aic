# AIC Standard Notes plugin functional index

[English](FUNCTIONAL_INDEX.md) · [Українська](FUNCTIONAL_INDEX.uk.md)

## Canonical registries and UI rules

This release-oriented narrative is indexed by the machine-readable
[`FEATURES.json`](FEATURES.json). Shared component IDs, BEM vocabulary, current
legacy hooks, and adoption status are registered in
[`COMPONENTS.json`](COMPONENTS.json). Cross-host ownership, naming rules,
dependency-ordered migration steps, verification criteria, and known coverage
gaps are defined in [`UI_ARCHITECTURE.md`](UI_ARCHITECTURE.md). Runtime code
imports the compiled shared modules; it does not load the JSON registries.

This file is the release contract for the Standard Notes editor component. The
plugin and AIC Notes extension share the small runtime core for explicit drafts,
structured AIC fields, structured preview mutation, the complete CodeMirror code-fence extension,
slash templates, CSS-mask icons, and the Mermaid viewport. Markdown remains the only cross-client
storage format. Release 44.1.0 pairs with AIC Notes 52.1.0 and AIC Editor Core 7.3.0.
This index describes the current release source; it does not assert that its archive,
GitHub Pages deployment or hosted manifest has already been published.

Shared core 7.3.0 owns the responsive AIC row layout and edit-exit ordering.

Labels, email addresses and logins use their natural width. A complete value moves
to the next line before its text wraps; only text wider than the full available
line breaks internally. Passwords use compact lock-only copy buttons, while
short card values and TOTP codes remain readable. The `+` menu follows the last
value, and subtle separators distinguish records. Touch controls retain 44 px
targets.

Leaving an AIC block's source edit, or switching the whole note from source to
preview, sorts rows by label within each section using natural, case-insensitive
order. Unlabelled rows remain in their original order at the end. Section order,
value order and exact authored values are preserved. Opening a preview, copying
and manual reordering do not trigger sorting.

## Current host boundary — 2026-09-15

The experimental browser release component 0.9.0 targets Chrome and Edge only, using one
Chromium package and this repository's `AicEditor`, with
the same always-compact editor toolbar as Standard Notes and explicit read-only
page/selection/Markdown import. When shared AIC data are empty, their
action remains inline in the editor toolbar; saved shared data renders as its own
masked section. See [browser/README.md](browser/README.md) and its verification record.
It accompanies this GitHub release; browser-store publication remains a future step.

New pages mount a memory-only AIC placeholder immediately. The draft
coordinator creates a note on first edit, retains editor identity through the
acknowledgment, and keeps failed writes exportable. Untouched placeholders do not
create note records; first imports preserve their exact Markdown. Shared AIC add
menus are bounded by the visible editor and viewport, with
internal scrolling and disposal-owned positioning listeners. The menu fix is
mirrored into the VS Code release core snapshot.
The same shared layout styles theme the actual CodeMirror cursor/drop cursor,
instead of the hidden native caret, with host-aware color and a 2 px stroke.
Focus visibility remains owned by CodeMirror; reduced motion stops blinking and
forced colors use the system text color.

Browser navigation projects saved pages into domain/title groups and only retains
paths that group several notes. It does not rewrite URLs or persist display trees.
Visible history labels are bounded and omit raw query/fragment text; the exact stored
URL remains the navigation target and note identity.
The encrypted browser library v3 contains separate exact-origin AIC records and
one nullable explicit `global` record (`scope: "global"`, identity, Markdown,
timestamps and revision). Global Shared appears before domain properties across
all origins, including history-only or unavailable web-page contexts. Its empty
Global action stays compact; an untouched `AIC_EMPTY_DOCUMENT` placeholder creates
no record. All scopes reuse the masked canonical renderer and draft/save coordinator;
their values are never copied into page Markdown. The current browser profile's
encrypted vault is the boundary: this feature adds no server, synchronization or
generated-key `.aic` storage architecture.

Reading library v1/v2 preserves all authored page/domain text and history, adds
`global: null`, and does not write storage. The next acknowledged mutation writes
v3 inside the existing encrypted envelope. Older browser builds do not understand
v3; backward read compatibility is not claimed. Encrypted export/restore includes
Global, and merge preserves an existing Global record while reporting the skipped
incoming Global record, which remains in the original backup file. Singleton
creation, saves, remote conflicts, pending acknowledgments and Lock share the
worker queue and revision guards. Synthetic storage, encrypted restart/restore,
cross-origin/no-page panel and draft tests cover this contract; package/browser QA
and publication are separate release acceptance steps.

Above the current editor, a compact chain exposes only metadata links for saved
same-origin path-segment ancestors. Query-bearing lookalikes and siblings are not
parents; ancestor Markdown and secret values are never copied into this projection.
Confirmed local deletion is revision-guarded and removes only the selected note and
its AIC history entry. Other notes and exact-origin shared AIC data remain intact;
deleting the active note restores an unsaved placeholder.

This release also compacts card parts into the shared inline composite-field row.
Independent masked copy feedback, empty-part Paste, deletion and ordering semantics
remain owned by the existing field controller.

The browser and Standard Notes share editor composition; VS Code constructs its
own editor and consumes the explicitly distributed `src/core` modules. The compact
browser shell is not automatically a VS Code feature. Adaptive activity, semantic
zoom and a shared workspace tree are proposed, not implemented; their ownership,
risks and dependency-ordered transition are in
[ADAPTIVE_PREVIEW_STUDY.md](ADAPTIVE_PREVIEW_STUDY.md).

## Bilingual documentation in release 41.1.2

Primary product, privacy, verification, functional-index, architecture,
provenance and changelog documents have direct English/Ukrainian navigation.
Localized files are included in the Standard Notes, Chromium and VS Code release
package contracts. Generated third-party notices retain exact upstream wording.

## Responsive rows and edit-exit sorting in release 44.1.0

The shared security renderer owns whole-item wrapping, lock-only password copy
and trailing creation controls. The shared source-mode and security-model
contracts own stable natural row ordering on edit exit. Invalid blocks stay
unchanged; sorting preserves exact source values and uses normal editor Undo.
The regression contract is `test/security-source-sort.test.ts`, alongside the
security-card preview and field-action tests.

## Compact credential rows in release 43.1.0

Credential records use one connected responsive layout. Labels take their
bounded intrinsic width, values share the remaining space, protected values
render as lock-and-six-dot copy buttons, and one trailing `+` menu adds a Field,
Row or Section. One quiet divider separates adjacent records.

## Whole-block Cut in release 42.1.0

Every managed block preview now exposes the same scissors action in editable
notes. Cut first copies the complete Markdown block, including its delimiters,
then removes that exact source range as one undoable editor operation. Tables,
code fences, Mermaid, AIC/Properties cards and `>>> … <<<` details use this
contract. If clipboard writing fails or the source changes while the clipboard
request is pending, the document remains unchanged. Read-only previews omit Cut.

## Mermaid source and live preview in release 41.1.1

Mermaid flowchart, class and sequence diagrams are edited as Markdown source.
A live preview updates while the source is active; Copy and a single Edit icon
appear on the inactive preview. Zoom affects the preview alone. The visual
builder and its drag-and-drop and rotation actions are removed. Source remains
unchanged until the user edits it.

## Quote accents and editable fences in release 40.0.1

Information (`>`), warning (`!>`) and error (`!>>`) quotes share the compact
quote shape with distinct accents and space between neighboring blocks. Italic
and quoted text are smaller. `>>> … <<<` retains its details/accordion meaning.
Unclosed fenced code remains source, and the caret on a fence delimiter keeps
completed code in source until the selection leaves. Note bytes are unchanged.

## Markdown layout fix in release 39.0.1

Headings, quote blocks and list starts gain measured vertical breathing room.
The thematic break is a centered 50–100 px line with space above and below;
revealing its raw Markdown under the caret keeps the same line height. This
presentation does not edit note source.

## Blank rows and narrow fields in release 38.1.1

New AIC blocks use an unlabeled text row; Account is no longer a row preset.
Password and TOTP remain separate optional fields. Narrow field rows wrap their
labels and values together into readable columns, and password generation is
hidden at viewport widths of 600 px or less. Browser toolbar and panel geometry
can shrink without a values-only horizontal scroller. Existing authored text is
not rewritten. The same core rules reach Standard Notes, browser and VS Code.

## Section copy and profile Global in release 37.2.0

Shared core 6.1.0 adds a Copy action for one AIC section using the canonical AIC
serializer. It retains that section's heading and typed/masking markers, excludes
adjacent sections, and leaves field/value and whole-block Copy independent.
The same renderer provides this action in Standard Notes, browser properties and
the VS Code core mirror. Browser 0.4.0 additionally introduces the profile-local
Global scope and encrypted-library v3 migration described above; Global storage
is a browser adapter capability. These changes do not assert a fix for an
unreproduced Standard Notes PWA crash.

## Host toolbar fix in release 36.0.1

- Standard Notes and the browser now share one always-compact toolbar composition:
  direct strike, link, bullet, ordered and task-list actions, source mode, and a
  bundled local guide where the host enables its trigger. The shared editor enables
  the guide by default; the browser disables that editor-level trigger because its
  panel owns the local guide entry point.
- The retired full-toolbar branch, `compactToolbar` choice, Style/Insert selectors
  and Bold/Italic/Inline-code buttons are no longer current surfaces. Those
  operations remain available through existing keymaps, authored Markdown and slash
  commands.
- The toolbar wraps instead of creating horizontal scrolling, while coarse-pointer
  actions retain 44 px targets. Browser 0.3.1 carries the shared host-toolbar and CSS
  bundle change. Shared core remains 6.0.0 and AIC Notes remains 44.4.7.
- This is a release-source contract, not packaged Standard Notes or browser runtime
  acceptance. Current candidate verification is recorded separately in
  [browser/VERIFICATION.md](browser/VERIFICATION.md).

## Prior shared-core changes in release 35.3.9

- Core 6.0.0 replaces legacy colon/YAML field interpretation with one bounded
  `aic` document and typed pipe values. `|`, `*|`, `#|`, `_|`, `1|`, and `0|`
  type each following value as text, secret, TOTP, card, unused one-time, or used
  one-time data. Add Field targets the current row, Add Row inserts below it, and
  Add Section inserts after the current section. This is a breaking source grammar;
  old text remains raw and is not migrated automatically.
- The shared local `?` guide exposes this grammar and the narrow host differences.
  In 35.3.9, Standard Notes mounted it with the then-existing broader controls; the
  browser and VS Code owned their popover triggers without copying guide content.
  Release 36.0.1 retires that broader Standard Notes toolbar.
- Contextual Field/Row/Section actions follow the relevant row. Empty sections keep
  Row and Section inline, without a dedicated New-block or Section footer.
- Card/composite labels and first values use the same grid, typography and alignment
  as adjacent simple rows. Cards omit the extra label colon without changing masked
  parts, copy targets or existing field actions.
- The browser host separately projects bounded history labels without raw query or
  fragment text. Exact stored URLs, source navigation and note identity are unchanged.
- Plain Markdown preview uses parser-backed link records, so URL syntax with nested
  parentheses or query text cannot append a destination suffix to the visible link
  label. Authored Markdown and the destination URL remain unchanged.
- Shared field-add menus use compact left-aligned items while preserving their
  action, viewport-bound and keyboard contracts.
- The compact browser host separately replaces its nested Format/Style/Insert menus
  with five direct strike/link/bullet/ordered/task icons. In 35.3.9, Standard Notes
  still used its broader formatting controls and added the shared local `?` guide;
  release 36.0.1 replaces that surface with the compact action set.
- Browser content/Markdown transfer uses direct import-page-or-selection, Markdown
  import and Markdown download icons. Native paste replaces the dedicated clipboard
  action; redundant Copy actions are removed, and More is limited to note/history
  deletion plus clearly grouped encrypted backups.
- These fixes do not implement or promise the separately proposed global
  Shared/encryption design.

## Prior shared-core changes in release 34.3.1

- Core 5.3.0 exports shared component IDs, BEM-class helpers and geometry tokens
  through the explicit core inventory. The migration is additive and partial:
  CodeMirror/data compatibility hooks and host placement rules remain registered.
- Card previews use the compact inline composite-field row while preserving masking,
  independent copy targets and existing empty-field actions.
- Shared preview layout owns common shell, header and code-preview styling used by
  the Standard Notes and VS Code hosts. This is a canonical ownership change, not a
  claim that every legacy selector or host-specific rule has been removed.

## Prior shared-core changes in release 33.2.4

- Generic pipe fields keep label, value and description in one compact row without
  visible technical subheaders; independent copy, masking and local overflow remain.
- Add menus follow viewport bounds and dispose their owned listeners. Shared caret
  styles make CodeMirror's actual cursor visible in light, dark and forced colors.
- Security parsing reuses one tree scan per rebuild. The additive `previewOnly`
  option supports browser inherited domain Properties without revealing raw source;
  normal Standard Notes and VS Code editing defaults do not change.
- The Standard Notes host separately retires its own settled transport save messages.
  See the changelog and browser verification record for bounded test evidence and
  remaining runtime checks. Adaptive zoom and activity modes are not release features.

## Prior shared-core changes in release 32.1.1

- One feature: every value slot in Security and v2-marked custom Properties supports optional
  JSON-style double quoting. Quoted pipes, quotes, backslashes and control escapes retain
  their logical values. Serialization quotes logical values containing a pipe or quote;
  ordinary values may remain unquoted. Labels and titles do not gain quote syntax.
- One fix: only an exact spaced `|` outside double quotes separates slots. Bare and
  one-sided pipes remain data; legacy `\|` outside quotes still parses. Invalid quotes,
  escapes and trailing text yield generic, non-secret errors, with exact Security locations.
  Properties remains YAML frontmatter: `Password*: '"a | b" | "description"'` uses
  outer YAML single quotes to retain the inner field-slot double quotes; YAML outer quoting
  alone cannot protect an inner spaced separator. Tests must verify these contracts;
  publication and host behavior are separate gates.

## Prior shared-core changes in release 31.5.6

- New Security content uses one unversioned `aic` fence grammar with optional section
  labels. The grammar change is a breaking core change; existing authored versioned
  Security fences are not silently rewritten.
- Compact Security cards show only the last four PAN digits and compact multi-part card fields.
  Field moves now cross section boundaries while retaining unrelated authored source.
- Properties brings managed metadata, related-note navigation and custom fields into
  the compact shared Security surface without making managed fields editable.
- Add controls have explicit labels, show capacity and explain disabled-limit reasons.
  Target feedback retires with its widget/document; label and value Copy remain distinct.
- Escape handling includes Mermaid fence boundaries. PAN stays masked from filtering,
  responsive label/drag styling spans light and dark themes, and unchanged filter/render
  results avoid repeated work. Tests and browser checks must verify these contracts;
  publication is a separate gate.

## Prior shared-core changes in release 30.3.3

- New `/security` templates and Authenticator conversions use `aic-security v3`:
  an implicit first section, standalone `---` boundaries and optional `##` section titles.
  v1/v2 retain their existing grammar; opening a note never migrates it.
- Conversion packs accounts into one block until a canonical limit requires another,
  retaining exact ordered values. Oversized accounts split at field boundaries, never
  by truncating values. The conversion panel reports accounts/blocks and recommends
  purpose-specific grouping for overflow (services, banks, web, social networks).
- The shared preview shows section/field/text/value limits and preflights encoded size
  before enabling Add actions. New block remains available at capacity; an EOF-terminated
  prior fence is closed before inserting the independent block. Existing notes are not auto-split.
- Security/Properties diagnostics use one safe source-range helper and parser-owned
  fixed advice, with one-based line/column and Edit navigation. Diagnostics never retain
  or render credential values or raw YAML errors. Location labels track document offsets
  without remounting widgets; stale/read-only actions cannot edit. Invalid TOTP seeds
  are diagnosed once rather than repeatedly scheduled for generation.
- Exact-source whole-card reordering supports versioned v2/v3 fences without rewriting
  their authored field syntax or unrelated text. Existing v1/v2 grammar is unchanged.
- Tests: `security-separators`, `security-diagnostics`, `properties-diagnostics`,
  `block-diagnostic-ui`, import and shared-preview suites. These are release-source
  contracts; archive and hosted deployment are verified separately.

## Current editor and lifecycle contracts

- One bounded fenced `aic` document owns structured values. Each separator types
  the following part: `|` text, `*|` secret, `#|` authenticator seed, `_|` card,
  `1|` unused one-time and `0|` used one-time. A label before the first separator is
  optional, and a row can combine differently typed parts. Blank, Card and
  One-time codes are canonical presets, not additional field types. New blocks
  include an unlabeled text row for an email or another identifier.
- Credential rows keep their label, responsive value parts and creation actions in
  one connected layout. Labels take only their bounded content width; text values
  flex and wrap, while protected values use a compact lock-and-six-dot copy target.
  The browser panel wraps its toolbar at small widths without a values-only scroller.
- Copying an unused one-time part changes its marker to `0|`; activating a used
  value restores `1|` without copying, and only used values expose removal. Other
  masked parts keep independent copy feedback. Raw Markdown remains visible in
  source mode and can contain secrets regardless of preview masking.
- Field inserts a typed part in the current row, Row inserts beneath the current
  row, and Section inserts after the current section. Mutations are exact local
  Markdown edits and remain subject to stale-document, read-only and capacity
  guards. Presets generate only current AIC syntax.
- Old YAML Properties, colon fields and prior Security forms remain exact authored
  Markdown. They are not rendered, stamped, reordered or automatically migrated;
  users repair them manually in source. Tests: `security-model`,
  `security-templates`, `properties-retirement`, `security-block-ui`.
- `save-boundary` centralizes focus-leave and annotated-action intent. Host managers own save
  queues, immutable note targets, acknowledgement and retry; widgets never write storage.
  Live widget sessions are distinct from CodeMirror descriptors, so viewport remounts remain
  interactive and retired async callbacks/timers cannot mutate new notes. Tests: `save-boundary`,
  `security-post-import`, `security-paste-feedback`, parent manager and mobile transport suites.

- `core/security-import` and `security-import-extension` convert the recognized
  current Authenticator JSON array or selection into the bounded `aic` document. This is
  an explicit, all-or-nothing, undoable draft edit; no clipboard, note-type change or
  account scan. Standard Notes supplies its normal save manager: Convert and save commits
  immediately, confirms host acknowledgement, and exposes failed-save retry. Dirty drafts
  also have a toolbar Save action after switching notes. Both hosts share Save, Ctrl/Cmd+S,
  leaving the editing surface and security-action boundaries; ordinary input does not save.
  TOTP/password and extra string fields are hidden, original
  values remain exact, and malformed/duplicate/oversized input is rejected without partial
  conversion or secret diagnostics. The shared contextual panel is used in both hosts.
  Tests: `security-import`, `security-import-extension`, `main`, browser security and
  mobile import-save transport regressions (synthetic host, not a physical device).

- `security-password` owns WebCrypto-only bounded unbiased generation, length8–128,
  default24 with all enabled groups required. Only empty recognized hidden password labels
  can generate; existing values/TOTP/API keys are excluded. Tests: `security-password`.
- Field label and value Copy are independent, with local feedback; Tab navigates normally.
  Paste directly reads the latest value and is absent on every populated field. Delete is
  available only for genuinely empty fields; whitespace is a value. There is
  no Replace, history picker or visible panel during a successful read. Empty reads cannot
  erase; pending, stale or readonly operations cannot overwrite values or another note.
  Only denied/unavailable/timed-out access offers inline masked paste-only capture.
  Source Edit is the only manual value editor. Whole-block Copy stays; AIC stores no history.
  Tests: `security-field-actions`, `security-block-ui`.

- `core/security-model`, `security-block` and `security-otp` own the single fenced
  `aic` Markdown grammar in both hosts. `/security` inserts a parseable example;
  section labels are optional. `Label*: value` masks a field and `Label: value`
  leaves it visible, independent of the label text.
  Preview excludes the block, including quoted/list-contained fences, from Standard Notes
  plain-text metadata; each save also clears stale `preview_html`. Copy
  block copies complete source, including secrets; safe HTTP(S) URLs can open.
  Edit opens raw Markdown, and Add section, quick field actions and New block
  insert content and request a host-managed save. A `#|` part derives the current
  code in memory from Base32 or `otpauth://totp` without displaying its seed.
  No QR import UI, generated QR, native Authenticator
  note-type migration or separate cryptographic storage is claimed. Standard Notes owns its
  account authentication, encryption and synchronization. The paired VS Code editor
  is local-only and has no Standard Notes account connection.
- Security preview masking does not hide the raw Markdown from a different
  editor, export, clipboard history or a local file. The standalone demo's
  `localStorage` is plaintext and is unsuitable for real credentials.

- `core/task-marker` owns task toggling, read-only validation, keyboard activation and ARIA in
  both hosts; detached controls cannot mutate the document.
- `core/details-model` parses details in one pass, ignores markers inside fences and shares its
  result across decoration layers through a WeakMap keyed by immutable CodeMirror documents.
- `core/code-languages` owns supported fence-language aliases for both editor adapters.
- `core/render-queue` owns pending work for preview and visual-builder renders. Pending cancellation
  removes the payload immediately; canceling an active caller does not release the engine mutex.
- `core/structured-preview` leaves nested controls' selection alone. Selecting the outer Markdown
  surface still expands preview to source as before.
- `note-draft-registry` prunes only inactive, clean, no-pending sessions after an exact save ACK.
  Newer dirty edits and failed saves survive delayed acknowledgements.
- `standard-notes-host` clears null contexts, preserves omitted fields in same-note
  metadata, and refuses saves with missing identity, unknown text, a lock or mismatched UUID.
  Failed/unknown/timeout/disposal replies never become a successful save acknowledgement.
- Table drops require a valid typed index and retain extra authored cells beyond the
  visible header width. AIC field UI never derives created/updated/file metadata from
  Markdown; hosts may retain such metadata internally without rendering it as fields.
- Security TOTP refreshes permit one pending generation and retire with their widget;
  late results cannot update a replacement document.
- `CORE_FILES.json` defines the shared distribution. The retired File Context sphere
  and its graph/styles are no longer distributed in either product.
  The lifecycle browser test measures bounded synthetic creation/switch/disposal; it does not
  certify the authenticated Standard Notes host or every long-running scenario.

## Shared editor capabilities

The release includes these shared contracts. Mermaid source editing keeps a live preview. Verification covers automated tests, production builds and synthetic
Windows browser checks; authenticated Standard Notes clients and live Linux sessions remain
unverified environments.

| Area / owner                                       | Implemented contract                                                                                                                                                 | Explicit limitation                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Core templates (`slash-snippets`, `note-template`) | Questions, early answers, contextual section levels; `/noise`, `/wave`, `/implementation`, `/context`, `/entity-map`; no compulsory Purpose/Proposal or new metadata | Prompts do not classify tasks, group notes or create cross-scale navigation               |
| Mermaid source and preview                         | The Markdown fence is editable directly; an adjacent live preview renders flowchart, class and sequence syntax. Preview offers Copy, Edit, Cut and zoom.             | Mermaid syntax errors remain visible in the preview; source stays intact.                 |
| Shared formatting (`formatting`)                   | Heading/paragraph and numbered/bullet/checkbox-list commands preserve selection and protected structures; one operation is one Undo                                  | Applies inside AIC editors; not a new native-editor or operating-system shortcut          |
| Stability                                          | Geometry-safe preview spacing; identity-bound history/popovers; exact host save acknowledgement and metadata-aware locking                                           | Host acknowledgement means local pre-sync acceptance, not confirmed cloud synchronization |

Usage: `/` inserts a template; Mermaid **Edit** reveals its Markdown source and a live preview.
Ctrl/Cmd+S saves through the host. Preview zoom and scrolling do not rewrite content.
Entity-map links are ordinary Markdown references, not implemented drill-down.

## Global invariants

- Shared formatting shortcuts: Ctrl/Cmd+Alt+1…6 for headings, Ctrl/Cmd+Alt+0 for a
  paragraph, Ctrl/Cmd+Shift+7/8/9 for numbered/bullet/checkbox lists. Formatting is a
  local edit with protected code/frontmatter/structured boundaries, not a save.
- `/checklist` is a plain checkbox block; checkbox/tasklist are search terms for
  the same entry. `/tasks` retains its separate verification-section template.

- The Standard Notes working-note UUID is the draft identity. Title or stream
  order is never used to attach a dirty draft to another note.
- Save, Ctrl/Cmd+S, leaving the editing surface and note switches request saving;
  security preview mutations save immediately. Input never saves by itself. A hard
  page/process termination cannot guarantee a save; success requires a matching host ACK.
- Switching notes restores an unsaved draft only for the same UUID. A clean
  inactive draft can be discarded.
- No save path generates, stamps or cleans up `file`, `created`, or `updated`
  fields. Authored frontmatter remains exact ordinary Markdown, including old
  generated triplets that users may repair manually.
- Host writes use an identity-bound target captured while the note was writable;
  queued saves cannot be redirected to the newly active note. Known locks fail closed.
- Preview widgets mutate one exact Markdown source range. No widget maintains
  parallel note data and no tooltip editor duplicates the source.

## Functional matrix

| Area / owner                                   | Behavior                                                                                                               | State / side effect                                                                   | Failure boundary                                                                             | Coverage                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Bootstrap (`src/main.ts`)                      | Detects standalone vs Standard Notes, mounts one editor, subscribes before editing                                     | active UUID draft and remote generation                                               | Missing identity is read-only/unavailable                                                    | main, host tests                                           |
| Host adapter (`src/standard-notes-host.ts`)    | Pins `sn-extension-api` 0.4.0, invalidates null contexts and retains same-note partial metadata                        | sends a snapshot with text, redacted plain preview and empty HTML preview             | UUID/lock/unknown-text guard; explicit empty-object ACK only                                 | standard-notes-host, standard-notes-transport, main        |
| Draft registry                                 | Isolates `DraftSession` by UUID across rapid note switches                                                             | dirty/current text per note                                                           | Remote refresh never discards dirty local text                                               | registry, main, draft-session                              |
| Explicit save                                  | Preserves authored Markdown, computes plain preview, writes once                                                       | dirty → pending → saved/dirty                                                         | Failed save keeps the draft dirty                                                            | main, editor                                               |
| Preview selection                              | Native preview selection remains stable; source selection reveals intersected Markdown                                 | shared keyboard/DOM boundary                                                          | Outer `Ctrl/Cmd+A` reveals source; nested inputs retain their own selection                  | structured-preview, editor, lifecycle-regression           |
| Preview navigation                             | Replaced previews are atomic; Edit pins one source block while the selection remains in it                             | shared CodeMirror range contract                                                      | Arrow keys never enter hidden source mid-command                                             | preview-ranges/editor                                      |
| Links                                          | Click label to open; Copy and Edit icons are always visible                                                            | host URL/clipboard adapters                                                           | Unsafe targets remain closed                                                                 | link-actions                                               |
| Details                                        | Summary/chevron toggles independently from checkbox and body; Cut copies and removes the complete accordion            | exact open/closed marker; one cut transaction                                         | Fence-contained terminators do not close a card                                              | details                                                    |
| Code fences                                    | Same preview card, language label, and permanent Copy/Edit/Cut icons as VS Code                                        | exact fenced body; explicit source reveal; whole-fence cut                            | Unknown language remains readable and copyable                                               | code-fence/core/editor                                     |
| Slash templates                                | `/` opens a compact grouped catalog in both shared editor surfaces without delayed activation                          | snippet fields; Tab advances                                                          | Disabled in code and read-only notes                                                         | slash-snippets/editor                                      |
| Mermaid                                        | Render, copy, edit, cut, zoom, reset and two-axis scroll                                                               | cut removes the complete fence; zoom/reset affect viewport only                       | Render error exposes recoverable source; failed copy preserves source                        | mermaid/viewport                                           |
| Tables                                         | Content-sized columns, horizontal grid scroll, whole-block Cut and preservation of extra authored cells                | one transient textarea popover; typed row/column DnD                                  | Invalid/stale/unrelated mutations are rejected                                               | blocks, structured-preview, editor                         |
| AIC fields                                     | One bounded fenced `aic` document with independently typed pipe values, including explicit unused/used one-time states | Empty-value actions and supported field/section mutations remain local Markdown edits | Legacy YAML Properties stay raw and editable without automatic conversion                    | security-model, properties-block-ui, properties-retirement |
| Security (`core/security-*`, `src/preview.ts`) | Star-controlled masking, independent sections, field/code/block Copy, whole-block Cut and source Edit                  | plaintext Markdown; local in-memory TOTP; one cut transaction                         | Bounded fixed-error parsing, HTTP(S)-only opening, preview redaction, retired refresh guards | security-model, security-block-ui, security-otp, preview   |
| Read-only                                      | Keeps preview, navigation, selection, and copy available                                                               | all mutation controls disabled                                                        | No host write can run                                                                        | editor/main                                                |
| Theme and icons                                | Uses host tokens, CSS SVG masks, and Standard Notes' supported `>_` Code icon                                          | renderer-independent editor actions                                                   | No custom top-bar SVG API is assumed                                                         | manifest/editor/publication                                |
| Distribution                                   | Stable plugin identifier, hosted manifest, versioned desktop archive                                                   | GitHub Pages plus release ZIP                                                         | Tag/package/manifest versions must match                                                     | manifest/publication                                       |

Coverage names identify `test/<name>.test.ts`; browser scripts add synthetic DOM,
navigation and lifecycle checks. They are separate from authenticated host verification.

## Shared core modules

| Module owner in `src/core`                                     | Contract                                                                                                                                 | Test ownership / boundary                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `draft-session`                                                | Explicit commit, pending-generation and remote-update protection                                                                         | draft-session, note-draft-registry, main                                     |
| `structured-preview`                                           | Selection boundaries, disposable table cell popovers, safe table mutations and extra authored cell preservation                          | structured-preview, editor, shared-controls-regression, lifecycle-regression |
| `preview-ranges`                                               | Atomic navigation for replacement decorations and explicit source reveal                                                                 | editor, code-fence-core, details                                             |
| `code-fence-preview`, `code-fence-extension`                   | Text-safe cards, permanent Copy/Edit/Cut, discovery, read-only and clipboard/source routing; security fences have their own renderer     | code-fence-core, editor, security-block-ui                                   |
| `code-languages`                                               | Shared aliases for bundled CodeMirror language support                                                                                   | language, editor                                                             |
| `slash-snippets`, `note-template`                              | Grouped shared catalog, contextual queries, thinking fields, sections and `/security`; no implicit save                                  | slash-snippets, security-block-ui, editor                                    |
| `formatting`, `indentation`                                    | Heading/list transactions and Enter/Tab behavior preserve protected source, selection, snippet navigation and Undo                       | formatting, indentation, commands                                            |
| `task-marker`                                                  | Exact checkbox mutation, read-only checks, keyboard activation and ARIA; detached controls are inert                                     | shared-controls-regression, editor                                           |
| `details-model`                                                | One-pass non-nested details grammar, fence exclusion and immutable-document cache                                                        | details, shared-controls-regression                                          |
| `mermaid-runtime`                                              | One strict bundled renderer and SVG sanitization; source cannot override protected security configuration                                | mermaid-runtime, mermaid-runtime-directives, mermaid                         |
| `render-queue`                                                 | Bounded engine work; pending cancellation releases payload while active work retains its slot until completion                           | mermaid, lifecycle-regression                                                |
| `mermaid-viewport`                                             | Preview-only zoom, bidirectional overflow and disposable event ownership                                                                 | mermaid-viewport, mermaid, mermaid-edit-preview                              |
| `security-model`, `security-templates`                         | One bounded `aic` document, typed next-value separators, masking, one-time states, stable serialization, safe URLs and canonical presets | security-model, security-templates, preview, properties-retirement           |
| `security-block`, `properties-block-ui`                        | Shared AIC rows and typed parts, local mutations, value feedback and Field/Row/Section insertion                                         | security-block-ui, properties-block-ui, lifecycle-regression                 |
| `security-otp`                                                 | In-memory Base32/otpauth parsing and WebCrypto TOTP; fixed non-secret diagnostics                                                        | security-otp: RFC 6238 SHA-1/SHA-256/SHA-512 vectors and rejected inputs     |
| `security-qr`                                                  | Retained bounded local-image decoder with resource cleanup                                                                               | security-qr; no mounted QR import or generation UI                           |
| `agentic-notes`                                                | Scope/section utilities only                                                                                                             | agentic-notes; no enabled universal agent adapter or standalone writer       |
| `icons.css`, `preview-layout.css`, module CSS and declarations | Common action presentation, preview geometry and adapter API contracts                                                                   | editor, publication, TypeScript checks and browser layout QA                 |

Adapter ownership stays explicit: `src/editor.ts`, `toolbar.ts`, `commands.ts`,
`language.ts`, `markdown-decorations.ts` and `styles.css` mount the editor surface;
`block-views.ts`, `details-extension.ts`, `details-model.ts` and `link-actions.ts`
provide Standard Notes structure/link adapters. `mermaid-source.ts`,
`mermaid-extension.ts` and `mermaid-render.ts` connect scanning, widgets and shared
rendering. `main.ts`, `standard-notes-host.ts`, `note-draft-registry.ts` and
`preview.ts` own note identity, explicit persistence and metadata. Their coverage
is mapped in the functional matrix above; core files are copied through the
explicit distribution manifest, not maintained independently in the extension.

## Interaction contract

- Link label: open. Adjacent Copy: copy destination. Adjacent Edit: reveal source.
- Code Copy: exact fenced body. Code Edit: reveal and focus the fenced source.
  Code Cut: copy the complete fence and remove it only after clipboard success.
- AIC part Copy: the exact value, including a masked secret; authenticator Copy:
  a freshly generated code. Copying an unused `1|` one-time part marks it `0|`;
  activating a used part changes it back to `1|` without copying, and only used
  values expose removal. Field adds a typed part to the current row, Row inserts
  below it and Section inserts after the current section.
- Mermaid Copy: exact fenced body. Edit: reveal the complete fence. Cut copies
  and removes the complete fenced block as one operation.
- Mermaid Zoom/Reset: change preview only; never rewrite diagram source.
- Table, AIC/Properties and details Cut follow the same clipboard-first rule;
  stale or failed clipboard operations leave Markdown unchanged.
- Table value activation opens one positioned textarea popover; Enter/explicit action
  commits, while Escape/outside dismissal does not invent data. Table Add and drag
  handles serialize one valid Markdown block.
- Unsupported legacy YAML/colon field syntax stays exact, plain editable source and
  is never interpreted, stamped, reordered or automatically migrated. Only one
  bounded fenced `aic` document is mounted as structured field UI.
- Task checkbox: change only its Markdown marker; disclosure controls do not
  consume checkbox activation.
- Native mouse selection inside preview remains selectable and copyable without
  rerendering the widget. CodeMirror selections reveal intersected source;
  outer `Ctrl/Cmd+A` reveals the complete note. A nested input keeps its own selection.
- Slash on an otherwise empty Markdown line opens the contextual shared catalog. Empty notes rank
  complete pages first; existing pages rank sections first; `Tab` advances through inserted
  perspective questions. Group headers separate page structure, assurance, references, data,
  diagrams, and content. Code and read-only contexts never activate it.

## Parity boundary

- AIC Notes and this plugin consume byte-identical core modules for drafts, AIC fields,
  structured mutations, code-fence cards/extensions, slash templates, formatting, indentation,
  diagram model/palette/builder/session, security, task/details helpers, language aliases,
  render queue, icons, and Mermaid viewport state. The shared fence extension uses
  the CodeMirror public APIs pinned by both products. Retired Properties parsers,
  reorder helpers and save-time metadata stamping are not distributed.
- Shared-source distribution does not imply every host interface is mounted in both
  products. The test matrix identifies implemented routes and their owning suites.
- VS Code workspace navigation, sidecar/project notes, Explorer trees, local Trash, and source-file
  selection comments are host capabilities, not Markdown editor behavior. Standard Notes UUID,
  lock state, note switching, and component theming are likewise host-only. Neither product fakes
  the other host's storage model inside Markdown.
- Agentic Notes utilities do not enable a universal agent integration. This release adds no
  cross-application note synchronization transport or collaborative locking channel.
- Standard Notes owns sign-in, encryption and its cloud service. This editor component
  does not implement an account-login screen. VS Code has no Standard Notes sign-in
  or synchronization; its remaining retired-auth/sync code only cleans up old state.

## Release verification

- Unit/model suites cover parsing, commands, details boundaries, link actions, code-fence cards, slash templates,
  tables/properties, draft identity, host identity, file properties, selection,
  security masking/TOTP/redaction, Mermaid transform/viewport, and manifest/publication metadata.
- Host regression tests include the actual pinned message bridge, null-context invalidation,
  partial metadata, locks, UUID checks, explicit ACK/error/timeout handling and stale HTML-preview removal.
- Browser QA covers real layout, popovers, persistent actions, table overflow,
  selection reveal, details checkbox, and Mermaid scrolling after transforms.
- `scripts/browser-lifecycle-regression.mjs` exercises 200 synthetic lifecycle iterations
  and measures collectible roots and bounded DOM/listener counts. It is not a proof
  that every long-running workload is leak-free.
- Actual live sign-in, authenticated Standard Notes application behavior and Linux
  runtime smoke testing remain unverified. Synthetic/unit checks do not substitute
  for those environments, and a local save ACK does not prove cloud synchronization.
- The production build must contain no external runtime dependency beyond the
  bundled component and must be installable from the stable `ext.json` URL.
- Publication is a separate acceptance step: verify package/tag/archive versions,
  Pages deployment and the live manifest before announcing deployment.
