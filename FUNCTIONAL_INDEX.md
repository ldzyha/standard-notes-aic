# AIC Standard Notes plugin functional index

This file is the release contract for the Standard Notes editor component. The
plugin and AIC Notes extension share the small runtime core for explicit drafts,
managed file properties, structured preview mutation, the complete CodeMirror code-fence extension,
slash templates, CSS-mask icons, and the Mermaid viewport. Markdown remains the only cross-client
storage format. Release 28.1.4 pairs with AIC Notes 37.1.4 and AIC Editor Core 4.1.0.
This index describes the current release source; it does not assert that its archive,
GitHub Pages deployment or hosted manifest has already been published.

## Current editor and lifecycle contracts

- The 28.1.4 feature outcome is the shared Security-style Properties renderer over authored
  YAML frontmatter. Four release fixes protect nested/quoted/multiline YAML ownership,
  exact numeric and `created` scalar types, unchanged Security widget DOM lifetimes, and
  starred-Properties redaction from unfinished plain-text excerpts. Earlier recovery-code,
  optional-title and save-boundary work remains available but is not counted again.
- `security-recovery` parses hidden Recovery codes/Backup codes batches into independent,
  bounded codes; exact values and duplicates are preserved. The shared UI masks each code,
  supports individual Copy and reversible Used flags, and serializes flags into the Markdown
  value. Marking never deletes a code, and copying alone never marks a code accepted by a service.
  Empty fields offer Paste/Delete; filled fields cannot be replaced. Tests: `security-recovery`,
  `security-recovery-ui`, `security-field-actions`.
- Optional section titles use an explicit bare `##` marker when unnamed, keeping legacy YAML
  parsing strict. The first title occupies the card header; later named sections keep compact
  headings. Tests: `security-model`, `security-block-ui`.
- `save-boundary` centralizes focus-leave and annotated-action intent. Host managers own save
  queues, immutable note targets, acknowledgement and retry; widgets never write storage.
  Live widget sessions are distinct from CodeMirror descriptors, so viewport remounts remain
  interactive and retired async callbacks/timers cannot mutate new notes. Tests: `save-boundary`,
  `security-post-import`, `security-paste-feedback`, parent manager and mobile transport suites.

- `core/security-import` and `security-import-extension` convert the recognized
  current Authenticator JSON array or selection into one security block per record. This is
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
- Field label/value tap copies only its value with local feedback; Tab navigates normally.
  Paste directly reads the latest value and is absent on every populated field. Delete is
  available only for genuinely empty fields; whitespace is a value. There is
  no Replace, history picker or visible panel during a successful read. Empty reads cannot
  erase; pending, stale or readonly operations cannot overwrite values or another note.
  Only denied/unavailable/timed-out access offers inline masked paste-only capture.
  Source Edit is the only manual value editor. Whole-block Copy stays; AIC stores no history.
  Tests: `security-field-actions`, `security-block-ui`.

- `core/security-model`, `security-block` and `security-otp` own one fenced
  `aic-security` Markdown format in both hosts. `/security` inserts a parseable
  example. `##` headings define independent sections; `Label*: value` masks a
  field and `Label: value` leaves it visible, independent of the label text.
  Preview excludes the block, including quoted/list-contained fences, from Standard Notes
  plain-text metadata; each save also clears stale `preview_html`. Copy
  block copies complete source, including secrets; safe HTTP(S) URLs can open.
  Edit opens raw Markdown, and Add section, quick field actions and New block
  insert content and request a host-managed save. `TOTP*: ...` derives the current code in memory
  from Base32 or `otpauth://totp` without displaying its seed; unstarred TOTP
  remains an ordinary visible value. No QR import UI, generated QR, native Authenticator
  note-type migration or separate cryptographic storage is claimed. Standard Notes owns its
  account authentication, encryption and synchronization. The paired VS Code
  authentication integration does not synchronize notes.
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
- Table drops require a valid typed index and retain extra authored cells beyond the visible
  header width. Properties reuse the Security widget: copy-only managed metadata, nested custom
  fields, explicit `*` masking, empty-field paste/delete/generation and source-only replacement.
  Targeted YAML edits preserve comments, scalar types and untouched source; no property drag or
  inline value editor remains. Related-note navigation is dynamic host context, not persisted YAML.
- Security TOTP refreshes permit one pending generation and retire with their widget;
  late results cannot update a replacement document.
- `CORE_FILES.json` defines the shared distribution. The retired File Context sphere
  and its graph/styles are no longer distributed in either product.
  The lifecycle browser test measures bounded synthetic creation/switch/disposal; it does not
  certify the authenticated Standard Notes host or every long-running scenario.

## Shared editor capabilities

The release includes these shared contracts. Visual Mermaid editing remains experimental within
the grammar limits below. Verification covers automated tests, production builds and synthetic
Windows browser checks; authenticated Standard Notes clients and live Linux sessions remain
unverified environments.

| Area / owner                                        | Implemented contract                                                                                                                                                                      | Explicit limitation                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Core templates (`slash-snippets`, `note-template`)  | Questions, early answers, contextual section levels; `/noise`, `/wave`, `/implementation`, `/context`, `/entity-map`; no compulsory Purpose/Proposal or new metadata                      | Prompts do not classify tasks, group notes or create cross-scale navigation                                      |
| Shared builder (`diagram-model`, `diagram-builder`) | Actual Mermaid SVG supports palette insertion, connection dragging, typed relationships, compact semantic controls, draft Copy, history/deletion; sequence ordering stays within branches | Bounded flowchart/classDiagram/sequenceDiagram subset; no multiselect, subgraph authoring or visual timeline     |
| Diagram session (`diagram-session`)                 | Inline Apply replaces the exact block; outside edits preserve the draft; conflicting edits/read-only retain a Copy-only draft; Ctrl/Cmd+S saves                                           | Cancel explicitly discards the draft; note identity changes retire the session; unsupported syntax stays source  |
| Layout                                              | Inline editing and read preview share one Mermaid renderer and auto-layout; sequence uses participant/message order                                                                       | No arbitrary coordinates; legacy `%% aic-builder-layout` is ignored and removed only after an actual visual edit |
| Shared formatting (`formatting`)                    | Heading/paragraph and numbered/bullet/checkbox-list commands preserve selection and protected structures; one operation is one Undo                                                       | Applies inside AIC editors; not a new native-editor or operating-system shortcut                                 |
| Stability                                           | Geometry-safe preview spacing; identity-bound history/popovers; exact host save acknowledgement and metadata-aware locking                                                                | Host acknowledgement means local pre-sync acceptance, not confirmed cloud synchronization                        |

Usage: `/` inserts a template; Mermaid **Edit diagram visually** opens the builder. Apply updates
the local note draft, then Ctrl/Cmd+S saves. Ctrl/Cmd+S inside the builder applies first and forwards
the host save shortcut. Zoom/scroll do not save or rewrite content. Native source Edit and Copy remain
available. Entity-map links are ordinary Markdown references, not implemented drill-down.

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
- Only a title ending in `.note.md` receives managed `file`, `created`, and
  `updated` fields. Ordinary Markdown documents receive no generated fields or automatic
  cleanup; authored frontmatter, including the exact three-field triplet, is preserved.
- Host writes use an identity-bound target captured while the note was writable;
  queued saves cannot be redirected to the newly active note. Known locks fail closed.
- Preview widgets mutate one exact Markdown source range. No widget maintains
  parallel note data and no tooltip editor duplicates the source.

## Functional matrix

| Area / owner                                   | Behavior                                                                                                     | State / side effect                                                       | Failure boundary                                                                                       | Coverage                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Bootstrap (`src/main.ts`)                      | Detects standalone vs Standard Notes, mounts one editor, subscribes before editing                           | active UUID draft and remote generation                                   | Missing identity is read-only/unavailable                                                              | main, host tests                                         |
| Host adapter (`src/standard-notes-host.ts`)    | Pins `sn-extension-api` 0.4.0, invalidates null contexts and retains same-note partial metadata              | sends a snapshot with text, redacted plain preview and empty HTML preview | UUID/lock/unknown-text guard; explicit empty-object ACK only                                           | standard-notes-host, standard-notes-transport, main      |
| Draft registry                                 | Isolates `DraftSession` by UUID across rapid note switches                                                   | dirty/current text per note                                               | Remote refresh never discards dirty local text                                                         | registry, main, draft-session                            |
| Explicit save                                  | Stamps managed note fields, computes plain preview, writes once                                              | dirty → pending → saved/dirty                                             | Failed save keeps the draft dirty                                                                      | main, editor                                             |
| Preview selection                              | Native preview selection remains stable; source selection reveals intersected Markdown                       | shared keyboard/DOM boundary                                              | Outer `Ctrl/Cmd+A` reveals source; nested inputs retain their own selection                            | structured-preview, editor, lifecycle-regression         |
| Preview navigation                             | Replaced previews are atomic; Edit pins one source block while the selection remains in it                   | shared CodeMirror range contract                                          | Arrow keys never enter hidden source mid-command                                                       | preview-ranges/editor                                    |
| Links                                          | Click label to open; Copy and Edit icons are always visible                                                  | host URL/clipboard adapters                                               | Unsafe targets remain closed                                                                           | link-actions                                             |
| Details                                        | Summary/chevron toggles independently from checkbox and body                                                 | exact open/closed marker                                                  | Fence-contained terminators do not close a card                                                        | details                                                  |
| Code fences                                    | Same preview card, language label, and permanent Copy/Edit icons as VS Code                                  | exact fenced body; explicit source reveal                                 | Unknown language remains readable and copyable                                                         | code-fence/core/editor                                   |
| Slash templates                                | `/` opens a compact grouped catalog in both shared editor surfaces without delayed activation                | snippet fields; Tab advances                                              | Disabled in code and read-only notes                                                                   | slash-snippets/editor                                    |
| Mermaid                                        | Render, copy, edit, zoom, reset, clockwise rotate, two-axis scroll                                           | transform and viewport state only                                         | Render error exposes recoverable source                                                                | mermaid/viewport                                         |
| Tables                                         | Content-sized columns, horizontal grid scroll and preservation of extra authored cells                       | one transient textarea popover; typed row/column DnD                      | Invalid/stale/unrelated mutations are rejected                                                         | blocks, structured-preview, editor                       |
| Properties                                     | Shared Security-style card over authored root/nested YAML; managed metadata copy-only, starred fields masked | Empty-field Paste/Delete/quick Add; populated fields use source Edit      | Targeted edits retain comments, numeric scalars and unrelated source; no property drag or cell popover | properties-model, properties-block-ui, editor            |
| Security (`core/security-*`, `src/preview.ts`) | Star-controlled masking, independent sections, field/code/block Copy and source Edit                         | plaintext Markdown; local in-memory TOTP                                  | Bounded fixed-error parsing, HTTP(S)-only opening, preview redaction, retired refresh guards           | security-model, security-block-ui, security-otp, preview |
| Read-only                                      | Keeps preview, navigation, selection, and copy available                                                     | all mutation controls disabled                                            | No host write can run                                                                                  | editor/main                                              |
| Theme and icons                                | Uses host tokens, CSS SVG masks, and Standard Notes' supported `>_` Code icon                                | renderer-independent editor actions                                       | No custom top-bar SVG API is assumed                                                                   | manifest/editor/publication                              |
| Distribution                                   | Stable plugin identifier, hosted manifest, versioned desktop archive                                         | GitHub Pages plus release ZIP                                             | Tag/package/manifest versions must match                                                               | manifest/publication                                     |

Coverage names identify `test/<name>.test.ts`; browser scripts add synthetic DOM,
navigation and lifecycle checks. They are separate from authenticated host verification.

## Shared core modules

| Module owner in `src/core`                                     | Contract                                                                                                                                          | Test ownership / boundary                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `draft-session`                                                | Explicit commit, pending-generation and remote-update protection                                                                                  | draft-session, note-draft-registry, main                                       |
| `file-properties`                                              | `.note.md` managed fields; preserve ordinary Markdown and all authored frontmatter without cleanup                                                | file-properties, main                                                          |
| `structured-preview`                                           | Selection boundaries, disposable table cell popovers, safe table mutations and extra authored cell preservation                                   | structured-preview, editor, shared-controls-regression, lifecycle-regression   |
| `preview-ranges`                                               | Atomic navigation for replacement decorations and explicit source reveal                                                                          | editor, code-fence-core, details                                               |
| `code-fence-preview`, `code-fence-extension`                   | Text-safe cards, permanent Copy/Edit, discovery, read-only and source/copy routing; security fences have their own renderer                       | code-fence-core, editor, security-block-ui                                     |
| `code-languages`                                               | Shared aliases for bundled CodeMirror language support                                                                                            | language, editor                                                               |
| `slash-snippets`, `note-template`                              | Grouped shared catalog, contextual queries, thinking fields, sections and `/security`; no implicit save                                           | slash-snippets, security-block-ui, editor                                      |
| `formatting`, `indentation`                                    | Heading/list transactions and Enter/Tab behavior preserve protected source, selection, snippet navigation and Undo                                | formatting, indentation, commands                                              |
| `task-marker`                                                  | Exact checkbox mutation, read-only checks, keyboard activation and ARIA; detached controls are inert                                              | shared-controls-regression, editor                                             |
| `details-model`                                                | One-pass non-nested details grammar, fence exclusion and immutable-document cache                                                                 | details, shared-controls-regression                                            |
| `diagram-model`, `diagram-builder`                             | Bounded flow/class/sequence parsing, semantic mutations, source preservation on unsupported grammar                                               | diagram-builder, diagram-builder-guidance, diagram-flow-links                  |
| `diagram-palette`, `diagram-renderer`                          | Semantic palette actions and interaction over the actual Mermaid SVG                                                                              | diagram-palette, diagram-native-renderer, diagram-canvas-interaction           |
| `diagram-session`                                              | Inline draft Apply/Cancel, exact block replacement, conflict/read-only protection, explicit host save                                             | diagram-session, diagram-source-actions, lifecycle-regression                  |
| `mermaid-runtime`                                              | One strict bundled renderer and SVG sanitization; source cannot override protected security configuration                                         | mermaid-runtime, mermaid-runtime-directives, mermaid                           |
| `render-queue`                                                 | Bounded engine work; pending cancellation releases payload while active work retains its slot until completion                                    | mermaid, lifecycle-regression                                                  |
| `mermaid-viewport`                                             | Zoom/rotation, bidirectional overflow and disposable event ownership                                                                              | mermaid-viewport, mermaid, lifecycle-regression                                |
| `security-model`                                               | Bounded line/legacy-YAML parsing, explicit masking, independent sections, stable serialization, safe URLs and fence redaction                     | security-model, preview                                                        |
| `security-block`, `properties-model`                           | Shared Security/Properties cards, masked values, copy-only metadata, targeted YAML edits, source-only filled-value Edit and retired async actions | security-block-ui, properties-model, properties-block-ui, lifecycle-regression |
| `security-otp`                                                 | In-memory Base32/otpauth parsing and WebCrypto TOTP; fixed non-secret diagnostics                                                                 | security-otp: RFC 6238 SHA-1/SHA-256/SHA-512 vectors and rejected inputs       |
| `security-qr`                                                  | Retained bounded local-image decoder with resource cleanup                                                                                        | security-qr; no mounted QR import or generation UI                             |
| `agentic-notes`                                                | Scope/section utilities only                                                                                                                      | agentic-notes; no enabled universal agent adapter or standalone writer         |
| `icons.css`, `preview-layout.css`, module CSS and declarations | Common action presentation, preview geometry and adapter API contracts                                                                            | editor, publication, TypeScript checks and browser layout QA                   |

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
- Security field Copy: the exact value, including a masked secret; TOTP Copy: a
  freshly generated code. Security block Copy: the entire plaintext fenced source.
  Security Edit opens Markdown only. `## Section` headings and `Label*:` markers
  remain the authored data; no inline form or QR interface duplicates them.
- Mermaid Copy: exact fenced body. Edit: reveal the complete fence.
- Mermaid Zoom/Reset/Rotate: change preview only; never rewrite diagram source.
- Table value activation opens one positioned textarea popover; Enter/explicit action
  commits, while Escape/outside dismissal does not invent data. Table Add and drag
  handles serialize one valid Markdown block.
- Properties label/value activation copies only its original value. Managed metadata is
  read-only; empty custom fields offer Paste/Delete and quick Add, while populated fields
  and YAML structure change only through source Edit. No property drag or inline cell editor remains.
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

- AIC Notes and this plugin consume byte-identical core modules for drafts, managed properties,
  structured mutations, code-fence cards/extensions, slash templates, formatting, indentation,
  diagram model/palette/builder/session, security, task/details helpers, language aliases,
  render queue, icons, and Mermaid viewport state. The shared fence extension uses
  the CodeMirror public APIs pinned by both products; security legacy parsing and
  rendering use their bundled dependencies.
- Shared-source distribution does not imply every host interface is mounted in both
  products. The test matrix identifies implemented routes and their owning suites.
- VS Code workspace navigation, sidecar/project notes, Explorer trees, local Trash, and source-file
  selection comments are host capabilities, not Markdown editor behavior. Standard Notes UUID,
  lock state, note switching, and component theming are likewise host-only. Neither product fakes
  the other host's storage model inside Markdown.
- Agentic Notes utilities do not enable a universal agent integration. This release adds no
  cross-application note synchronization transport or collaborative locking channel.
- Standard Notes owns sign-in, encryption and its cloud service. This editor component
  does not implement an account-login screen. VS Code's Standard Notes integration
  is authentication-only and does not transfer or synchronize notes.

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
