# Changelog

## Unreleased

## 32.1.1 — 2026-09-14

Release sequence 32 · 1 feature outcome · 1 fixed-bug outcome. Release source target;
publication and hosted-manifest deployment require separate verification. The shared
editor core moves to 5.1.0.

### Feature

1. All three Security value slots, and custom Properties slots behind `# aic-fields: v2`, accept optional JSON-style double-quoted strings. Quoted pipes (including `|`), quotes, backslashes and control escapes retain their logical values. Serialization quotes values containing a pipe or quote, including pasted and imported values; ordinary values need no quotes. YAML outer quoting remains a separate storage layer: `Password*: '"a | b" | "description"'` preserves the inner slot quotes. Labels and titles have no quote syntax.

### Fix

1. Only the exact spaced `|` outside quotes separates slots. Bare or one-sided pipes remain literal data, while existing `\|` outside quotes still parses. Invalid quotes, escapes or trailing text receive generic, non-secret errors; Security errors identify exact source positions.

Compatibility: AIC Notes 41.1.1 mirrors AIC Editor Core 5.1.0. Existing authored values are not automatically rewritten. Masking is visual, not encryption; this release adds no authentication or note synchronization. Publication requires separate verification.

## 31.5.6 — 2026-09-13

Release sequence 31 · 5 feature outcomes · 6 fixed-bug outcomes. Release source target;
publication and hosted-manifest deployment require separate verification. The shared
editor core moves to 5.0.0 because the Security fence grammar changes to one format.

### Features

1. One unversioned `aic` fence replaces the versioned Security fence variants for new content. Security sections use the single grammar with optional labels; authored legacy blocks require review when moving to the new format rather than an assumed automatic migration.
2. Compact payment-card rows show only the last four number digits, expiry and masked CVV while preserving independent copying and source Edit.
3. Security fields can be dragged across sections as well as reordered within a section; moves retain exact authored source outside the changed fields.
4. Properties presents managed metadata, the related-note tree and custom fields in the compact shared Security surface, while managed values and navigation stay read-only.
5. Labelled Add controls expose capacity and explain why an action is disabled at a limit instead of leaving an unexplained inactive control.

### Fixes

1. Escape handling is consistent across source, preview and Mermaid fence boundaries.
2. Target feedback is transient and guarded against stale document or widget state.
3. Field labels and values copy independently, without substituting one for the other.
4. Filtering does not expose a masked card number (PAN).
5. Label and drag controls remain legible and usable across narrow layouts and dark/light themes.
6. Preview filtering and rendering avoid repeated work for unchanged content.

Compatibility: AIC Notes 40.6.6 mirrors AIC Editor Core 5.0.0. This release changes the Security fence grammar; it does not add Standard Notes authentication or note synchronization. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 30.3.3 — 2026-09-13

Release sequence 30 · 3 feature outcomes · 3 fixed-bug outcomes. Release source target;
publication and hosted-manifest deployment require separate verification.

### Features

1. `aic-security v3` adds standalone `---` section boundaries and optional `##` section headings. New templates use v3; existing unversioned/v2 blocks retain their grammar and are not migrated.
2. Authenticator JSON conversion preserves ordered records and exact string values in grouped v3 blocks, spilling at canonical capacity and splitting oversized accounts only at field boundaries. Invalid input still rejects atomically without partial conversion.
3. Security previews show section, field and text capacity. Add controls that would exceed a limit are disabled, while New block remains available; conversion guidance suggests separate blocks by purpose, such as services, banks, web and social networks.

### Fixes

1. Security and Properties errors provide safe, precise source line/column diagnostics and Edit navigation without exposing credentials or raw parser messages.
2. New block closes an EOF-terminated previous fence before inserting an independent Security block.
3. Whole-card reordering preserves exact authored source and supports versioned v2/v3 fences without rewriting fields or unrelated Markdown.

Compatibility: AIC Notes 39.3.3 mirrors AIC Editor Core 4.3.0. No authentication or note-synchronization change. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 29.4.3 — 2026-09-13

Release sequence 29 · 4 feature outcomes · 3 fixed-bug outcomes. Release source target;
publication and hosted-manifest deployment require separate verification.

### Features

1. Compact, searchable Security and Properties groups provide group menus, one **+** disclosure and independent `#` Security card titles. Search matches names and visible values, never hidden values, recovery codes or generated one-time codes.
2. Safe drag/drop and Alt+Up/Down handles reorder Security fields, sections and standalone cards, and supported sibling Properties fields/groups. Filtered lists, managed metadata, sequence items and unsupported layouts cannot be reordered; host-managed saves remain undoable.
3. A temporary whole-editor **Show Markdown source / Show preview** toggle exposes the current note's raw Markdown in place without entering a native editor, persisting mode, changing source, saving or resetting Undo.
4. Opt-in versioned pipe fields use `aic-security v2` and the first-body-line Properties YAML comment `# aic-fields: v2`. `*` masks a value, `#` identifies a TOTP seed, and `_` identifies a card with separately copyable PAN/date/CVV. The third slot is hidden; Paste targets only empty parts and populated parts require source Edit. New Security templates and newly converted Authenticator records use v2. Existing unversioned blocks/headers retain literal pipes and legacy `#`/`_` labels; activating an existing header requires an explicit marker and review/escaping, not automatic migration. Managed `file`/`created`/`updated` stay read-only.

### Fixes

1. Retire stale code-preview callbacks after source or note changes so detached controls cannot mutate a replacement document.
2. Preserve Mermaid visual drafts and focus across the temporary source toggle; reject Apply when the underlying source has changed.
3. Improve coarse mobile contrast, menu placement and multi-part field layout so controls remain readable without overflow.

Compatibility: AIC Notes 38.4.3 mirrors AIC Editor Core 4.2.0. No authentication or note-synchronization change. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 28.1.4 — 2026-09-13

Release sequence 28 · 1 feature outcome · 4 fixed-bug outcomes.

### Feature

1. Properties frontmatter now uses the shared Security-card renderer: copy-only managed metadata, root and nested custom YAML fields, explicit `*` masking, empty-field actions and source-only editing of filled values. The paired VS Code host places its read-only related-note tree after metadata; no relationship is written into YAML.

### Fixes

1. Keep nested, quoted and multiline YAML values and their ownership intact during targeted field actions; preserve authored comments, ordering and unrelated Markdown rather than rewriting the whole header.
2. Preserve exact numeric scalars and the original `created` value type while managed note metadata is stamped. Display formatting never substitutes for the authored value copied from the property.
3. Preserve the unchanged Security block DOM and live actions during Properties cursor/selection changes; detached widget callbacks remain retired.
4. Redact starred Properties from unfinished or truncated plain-text note excerpts, including nested secrets, without claiming to encrypt raw Markdown or exports.

Compatibility: AIC Notes 37.1.4 mirrors AIC Editor Core 4.1.0. No new runtime dependency, note synchronization or authentication change. The 27.4.4 security recovery, title and save-boundary features remain available; they are not new outcomes in this release. Publication and host deployment require separate verification.

## 27.4.4 — 2026-09-12

Release sequence 27 · 4 feature outcomes · 4 fixed-bug outcomes.

### Features

1. Hidden recovery-code batches: paste one code per line, copy each code independently, and retain reversible Used flags without deleting values. Whole-block Copy preserves the complete batch and flags.
2. Delete genuinely empty security fields in preview; populated and whitespace-only fields cannot be removed by this action.
3. Optional security titles occupy the existing card header instead of a duplicate row; a bare `##` section marker keeps the default Security title.
4. Shared Save/Ctrl+S/leave-editor boundaries and immediate security preview saves, owned by the host managers. No per-keystroke autosave; queued requests stay bound to their original note, with acknowledged status and failed-save retry.

### Fixes

1. Restore working Copy/Paste after conversion, scrolling and CodeMirror viewport remounts. Each live DOM has its own lifetime; detached controls, clipboard completions and TOTP timers stay retired.
2. Remove Paste from filled fields instead of leaving a misleading disabled icon; failed/empty clipboard reads remain non-destructive.
3. Improve light/dark text, controls, cards and status contrast using paired editor-theme colours. Mermaid theme detection follows editor-specific theme overrides too.
4. Remove the retired File Context sphere from shared distribution and the paired extension, including its UI, commands, setting and background analysis. Markdown diagrams and parent-note relationships are unaffected.

Compatibility: AIC Notes 36.4.4 mirrors AIC Editor Core 4.0.0. The core major removes the experimental sphere exports. No new runtime dependency, AIC note synchronization or authentication change. Masking is not encryption; raw Markdown and copied blocks remain plaintext. Host save acknowledgement does not certify cloud synchronization or survival of a forced app termination before acknowledgement.

## 26.0.1 — 2026-09-12

Release sequence 26 · 0 feature outcomes · 1 fixed-bug outcome.

### Fix

1. Persist Authenticator conversion from the explicit Convert and save action, including on mobile. Previously it changed only the draft and reopening could show the original JSON. The normal host save manager now sends converted Markdown immediately, shows success only after acknowledgement, and keeps failed drafts available for retry. A compact toolbar Save action remains available for dirty drafts restored after switching notes. Input/blur autosave remains disabled; raw values, masking and atomic conversion are unchanged.

Compatibility: AIC Notes 35.0.1 mirrors AIC Editor Core 3.7.1. The Standard Notes adapter supplies acknowledged persistence; VS Code retains explicit Ctrl/Cmd+S saving. No authentication, synchronization or sphere changes.

## 25.1.0 — 2026-09-12

Release sequence 25 · 1 feature outcome · 0 fixed-bug outcomes.

### Feature

1. Add a shared, explicit Authenticator JSON converter: one record becomes one security block, with exact-value preservation, hidden TOTP/password fields, bounded all-or-nothing validation and one-step Undo. The contextual action works on the current array or selection without clipboard access, account scanning or automatic saving. Duplicate keys, unrepresentable fields and unsafe nested Markdown contexts reject conversion without partial edits.

Compatibility: AIC Notes 34.1.0 shares AIC Editor Core 3.7.0 with the same converter and contextual controls. Authentication, synchronization, clipboard actions and the file-context sphere are unchanged. Markdown remains plaintext outside host encryption.

## 24.0.1 — 2026-09-12

Release sequence 24 · 0 feature outcomes · 1 fixed-bug outcome.

### Fix

1. Paste is now strictly empty-field-only for every security field. Filled fields keep a disabled Paste icon and can only be copied or changed through full-block Markdown Edit; there is no Replace action. Paste reads the latest clipboard value directly without an AIC picker, intermediate input or visible reading panel. Only clipboard denial/unavailability/timeout offers inline masked paste-only capture. Empty input, stale completion or a field filled in the meantime cannot overwrite a value. The browser may still require its own clipboard permission; no history storage or platform-specific helper is introduced.

Compatibility: AIC Notes 33.0.1 shares AIC Editor Core 3.6.1. Password generation, field Copy and explicit Ctrl/Cmd+S saving are unchanged. Raw Markdown and clipboard values remain plaintext.

## 23.2.1 — 2026-09-12

Release sequence 23 · 2 feature outcomes · 1 fixed-bug outcome.

### Features

1. Security fields: tap/click a label or value to copy only its value with local success feedback. The field icon pastes from the clipboard without revealing hidden values. Filled-field replacement requires confirmation; empty clipboard data cannot erase a field. Browser denial or a three-second timeout offers paste-only capture. Late results are rejected after cancellation, document changes, source Edit or disposal. All changes remain drafts until Ctrl/Cmd+S; whole-block Copy remains available.
2. Empty hidden password fields offer a configurable WebCrypto-only generator: default 24 characters, uppercase/lowercase/digits/symbols; length 8–128. Every enabled class is included with unbiased sampling and no weak fallback. It never overwrites a filled field or generates TOTP/API keys. Clear the value through Markdown Edit before generating again.

### Fix

1. Security controls use explicit theme foreground/background colors and 44px coarse-pointer targets. Field label/value activation and keyboard navigation are distinct: Tab navigates, Enter/Space activates, and secrets never appear in feedback.

Compatibility: AIC Notes 32.2.1 consumes the same explicit AIC Editor Core 3.6.0 inventory. No new dependencies, account migration, note synchronization or native Authenticator conversion. Markdown masking is not encryption; source, files, exports and clipboard remain plaintext. Physical mobile client clipboard permissions still depend on the embedding app.

## 22.1.8 — 2026-09-12

Release sequence 22 · 1 feature outcome · 8 fixed-bug outcomes.

- F01: shared `/security` blocks use independent sections and `Label*: value` masking.
  Preview supports explicit field/block Copy, safe URL Open, source Edit, section/field
  insertion and New block. TOTP derives current codes locally; legacy YAML stays readable.
  Masking is not encryption: Markdown, exports and copied blocks contain plaintext secrets.
- B01: invalidate null host contexts, preserve omitted same-note metadata, block unknown-note
  text from accidental replacement and clear stale HTML previews on explicit save.
- B02: retain dirty or pending drafts across delayed acknowledgements; prune only inactive,
  clean, acknowledged sessions. A save ACK is host acceptance, not a cloud-sync guarantee.
- B03: centralize task controls, fence languages and details parsing; preserve nested-control
  selection and reject detached controls instead of stealing focus or editing another note.
- B04: reject duplicate property names and unrelated drag data; preserve extra authored cells
  when editing ragged tables, and retire stale table/popover actions.
- B05: preserve ordinary Markdown frontmatter byte-for-byte. Only `.note.md` receives managed
  file/created/updated properties; ambiguous legacy metadata is not deleted automatically.
- B06: bound and cancel pending Mermaid work, retain the active engine mutex until completion,
  retire widget timers and prevent overlapping TOTP updates or detached-widget writes.
- B07: lock Mermaid resource-sensitive configuration against note directives, test the actual
  renderer, and enforce the visual-model element limit even on the final source line.
- B08: normalize text checkout line endings across Windows and Linux so the same formatting
  and release checks apply on both platforms. The blocked `v22.1.7` tag was not published as a
  release and is retained unchanged for traceability.

Compatibility: AIC Notes 31.3.8 consumes the same explicit AIC Editor Core 3.5.0 inventory.
The sphere renderer is shared, but workspace graph collection is VS Code-only. No note
synchronization transport, QR import UI or encrypted Markdown storage is introduced.
See FUNCTIONAL_INDEX.md for feature owners, contracts and verification limits.

## 21.3.5 — 2026-09-11

Release sequence 21 · 3 feature outcomes · 5 fixed-bug outcomes.

- F01: align the shared template catalog with Core questions, early answers, contextual sections,
  and noise/wave investigation and execution prompts. Add plain `/list`, `/list-numbered`,
  `/checklist` and `/table` blocks without compulsory page scaffolding or metadata; checkbox and
  tasklist searches find the same checklist entry. Keep specialized verification and comparison
  templates separate. Agentic Notes scope/section utilities are tested core foundations only.
- F02: edit supported Mermaid flowcharts, class diagrams and sequence diagrams inline on their
  actual preview. Share palette insertion, connection dragging, line selection, relationship
  labels/types/direction, deletion and draft history with AIC Notes. Keep controls in compact bars
  at narrow widths and enlarged document fonts, with semantic entity names and on-demand
  endpoint/member/connection popovers. Mermaid owns layout; no arbitrary coordinates are stored.
  Preserve labeled legacy dotted flowchart links and expose visual editing above active source,
  including selected snippet fields. Apply changes the local draft; Ctrl/Cmd+S explicitly saves.
- F03: share heading and list formatting commands across AIC editors: Ctrl/Cmd+Alt+1…6 toggles
  headings, Ctrl/Cmd+Alt+0 restores a paragraph, and Ctrl/Cmd+Shift+7/8/9 toggles numbered, bullet
  and checkbox lists. Respect protected source structures, selection boundaries and one-step Undo;
  formatting never saves implicitly.
- B01: start slash completion without a typing delay and keep narrow-editor menus compact.
  Section labels flow with results instead of overlapping as stacked sticky headers; each row
  reserves only its command and one-line description space.
- B02: preserve indentation on Enter and indent/outdent on Tab/Shift+Tab, including Mermaid source
  fields, while retaining snippet field navigation and native source Undo.
- B03: keep preview spacing and source boundaries compatible with CodeMirror cursor geometry.
  Opening a source block preserves editable fence boundaries and selection; ArrowUp does not
  jump through hidden source or collapse navigation to the beginning of the note.
- B04: retire stale popovers and diagram sessions on note identity changes, isolate per-note
  history, and reject stale edit targets. Outside-block edits preserve a diagram draft; conflicting
  edits retain it for copying rather than overwriting the changed Markdown.
- B05: acknowledge only the exact explicit save for its working-note UUID and process metadata-only
  lock updates without replacing local content. Failed or stale acknowledgments keep the draft
  dirty; a host acknowledgment confirms local pre-sync acceptance, not cloud synchronization.

Compatibility: Standard Notes custom `editor-editor` component with interchangeable Markdown
storage and the supported Code icon. AIC Notes 28.4.5 consumes the same byte-identical AIC Editor
Core 3.4.0. The stable plugin identifier is unchanged.

Limitations: visual editing remains experimental and supports a bounded flow/class/sequence
grammar; unsupported Mermaid stays editable as original source. Multiselect, subgraph authoring,
visual timeline editing and cross-scale drill-down are not implemented. No universal agent adapter,
standalone memory writer or cross-application synchronization transport is enabled. Verification
uses automated suites, production builds and synthetic Windows browser checks; authenticated
Standard Notes clients and live Linux sessions have not been smoke-tested for this release.

## 20.1.1 — 2026-09-03

Release sequence 20 · 1 feature outcome · 1 fixed-bug outcome.

- F01: divide the shared slash catalog into seven visible, task-oriented groups: Page templates,
  Page structure, Risks & verification, References, Tables & lists, Diagrams, and Content blocks.
  Existing pages rank their structural sections first; empty documents still rank complete page
  templates first. AIC Notes mounts the same completion in both ordinary Markdown documents and
  contextual notes.
- B01: make the slash menu, group headers, detail panel, selection, and snippet fields use the
  shared editor background/foreground/accent tokens with selectors that override CodeMirror's
  light base theme. Dark hosts no longer receive a white completion surface, and the real
  `completion-section` elements render as sticky labeled dividers.

Compatibility: Standard Notes custom `editor-editor` component with interchangeable Markdown
storage and the supported Code icon. AIC Notes 27.1.1 consumes the same AIC Editor Core 3.3 slash
catalog, grouping, theme contract, and completion behavior.

## 19.1.0 — 2026-09-03

Release sequence 19 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: add a byte-identical slash-snippet core to AIC for Standard Notes and AIC Notes. Typing `/`
  on an otherwise empty Markdown line opens a contextual catalog of complete documentation pages,
  page sections, and formatting blocks. Each insertion is a usable example whose perspective
  questions are editable CodeMirror snippet fields; `Tab` advances through them. Empty notes rank
  page templates first, existing pages rank sections first, and code/read-only contexts stay
  untouched.

Compatibility: Standard Notes custom `editor-editor` component with interchangeable Markdown
storage and the supported Code icon. AIC Notes 26.1.0 consumes the same AIC Editor Core 3.2 slash
catalog, query boundary, insertion behavior, placeholder, and menu styling.

## 18.0.4 — 2026-09-03

Release sequence 18 · 0 feature outcomes · 4 fixed-bug outcomes.

- B01: expose every replaced preview range through CodeMirror's public `atomicRanges` contract.
  Arrow-key and deletion commands now cross code, Mermaid, table, properties, Details, and link
  previews as stable units instead of entering hidden Markdown and rebuilding the layout midway.
- B02: give fenced-code Edit an explicit source-open state in the byte-identical shared core. The
  opening fence, language label, body, and closing fence remain ordinary editable Markdown while
  the selection stays in that block, including a cursor or selection at either boundary.
- B03: keep direct programmatic selections inside a fence source-capable while making normal
  keyboard navigation skip a closed preview. Leaving the edited fence restores its card without
  leaking edit state into a neighboring block.
- B04: add regression coverage for the exact reported boundary: Edit exposes a writable
  `contenteditable` editor, the opening backticks can be selected, and every closed block publishes
  its complete source range as an atomic navigation unit.

Compatibility: Standard Notes custom `editor-editor` component with interchangeable Markdown
storage and the supported Code icon. AIC Notes 25.0.3 consumes the same AIC Editor Core 3.1
navigation contract.

## 18.0.3 — 2026-09-03

Release sequence 18 · 0 feature outcomes · 3 fixed-bug outcomes.

- B01: stop converting native mouse selection inside a rendered preview into a whole-block
  CodeMirror selection on `pointerup`. Preview text now stays selectable for normal copying without
  destroying its widget or stealing focus; explicit Edit still reveals one source block and
  `Ctrl+A`/`Cmd+A` still reveals the complete Markdown source. The interaction lives in the
  byte-identical AIC Editor Core 3.0 module consumed by both editors.
- B02: update a repeated stream for the active Standard Notes UUID as one minimal, non-history
  CodeMirror change instead of replacing the complete editor state. Cursor, selection, focus, and
  unaffected preview DOM now survive host refreshes and the managed timestamp update on explicit
  save.
- B03: make theme refresh idempotent and limit Details recomputation to document/selection,
  read-only, and Details-owned effects. Repeated host/theme signals no longer trigger unrelated
  preview work that could disturb an in-progress interaction.

Compatibility: Standard Notes custom `editor-editor` component with interchangeable Markdown
storage and the supported Code icon. AIC Notes 25.0.2 consumes the same preview-selection core.

## 17.2.0 — 2026-09-03

Release sequence 17 · 2 feature outcomes · 0 fixed-bug outcomes.

- F01: share the complete CodeMirror code-fence extension byte-for-byte with AIC Notes instead of
  maintaining parallel fence discovery, replacement, selection, read-only, and clipboard logic.
  Each product supplies only its host clipboard callback; the preview DOM remains in the same
  dependency-free shared card module. AIC Editor Core advances to 2.9.
- F02: register AIC under Standard Notes' supported Code note type so the app renders the `>_`
  editor icon instead of the Markdown `[ ]` icon. Storage remains `file_type: md`, interchangeable,
  and exact Markdown; the bundled favicon/logo now uses the same `>_` identity.

Compatibility: Standard Notes custom `editor-editor` component with the Code icon and
interchangeable Markdown storage. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier.

## 16.1.1 — 2026-09-03

Release sequence 16 · 1 feature outcome · 1 fixed-bug outcome.

- F01: move the fenced-code preview card into AIC Editor Core 2.8 and consume the byte-identical
  module from both the Standard Notes and VS Code adapters. Non-Mermaid fences now render the same
  language caption, text-safe scrollable body, and permanent icon-only Copy/Edit actions in both
  products; Copy uses the exact fenced body and Edit focuses its Markdown source.
- B01: close the editor-parity gap that left Standard Notes code fences as raw decorated source
  while VS Code exposed a preview card. Selection and `Ctrl+A`/`Cmd+A` now reveal code source using
  the same shared range contract, and locked notes keep Copy plus an explicit source-inspection
  action.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.8.

## 15.1.2 — 2026-09-02

Release sequence 15 · 1 feature outcome · 2 fixed-bug outcomes.

- F01: add a packaged functional index that maps every editor surface, shared-core module,
  interaction, state boundary, failure rule, and verification owner. Publication tests now require
  the index and the versioned desktop archive ships it beside the installation instructions.
- B01: normalize the complete legacy generated sidecar header to the three managed `file`,
  `created`, and `updated` fields on explicit save. The migration runs only for the exact old
  title/level/empty-scope/live/agent signature and preserves every additional authored property.
- B02: keep Mermaid fit/zoom dimensions independent of rotation. Quarter-turns now swap the stable
  source bounds instead of fitting the rotated width a second time, preventing wide diagrams from
  expanding to extreme heights while retaining real horizontal and vertical scrolling.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.7.

## 14.1.1 — 2026-09-02

Release sequence 14 · 1 feature outcome · 1 fixed-bug outcome.

- F01: add permanent icon-only Mermaid zoom, reset, and clockwise quarter-turn controls. Rotation
  advances through 0°, 90°, 180°, and 270°, while Reset returns both scale and direction to their
  initial values; controls remain available in preview without opening the Markdown source.
- B01: replace transform-only Mermaid sizing with a shared two-dimensional viewport whose stage
  receives the diagram's real zoomed and rotated bounds. Enlarged diagrams now scroll horizontally
  and vertically instead of being clipped, including after any 90° direction change.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.6.

## 13.2.1 — 2026-09-02

Release sequence 13 · 2 feature outcomes · 1 fixed-bug outcome.

- F01: move managed `file`, stable `created`, and explicit-save `updated` metadata from ordinary
  Markdown documents to `*.note.md` items. Existing authored note frontmatter is merged without
  loss, dates render in the user's locale, and an exact legacy three-field document signature is
  removed without touching unrelated properties.
- F02: replace permanent table and Properties inputs with static selectable previews and one
  transient editor popover opened only for the active cell. Columns size to content, wrap only at
  word boundaries, retain horizontal scrolling for wide values, and use CSS-mask Apply/Cancel
  actions shared through AIC Editor Core 2.5.
- B01: require a complete syntax tree before deriving table blocks, preventing a valid table near
  the end of a busy document from intermittently remaining raw during initial rendering.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.5.

## 12.2.0 — 2026-09-01

Release sequence 12 · 2 feature outcomes · 0 fixed-bug outcomes.

- F01: add a permanent Copy action to parsed and fallback table previews. It copies the exact
  Markdown table source through the Clipboard API with a restricted-client DOM fallback and
  reports success by changing only the accessible icon state.
- F02: replace textual preview, link, details, Mermaid, drag, and formatting-toolbar actions with
  custom icon-only buttons. AIC Editor Core 2.4 supplies the shared button, clipboard, and feedback
  contracts; embedded SVG data URIs are painted exclusively through CSS masks, so action rendering
  does not depend on the host's inline-SVG support. Every control retains an explicit `aria-label`.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.4.

## 11.1.0 — 2026-09-01

Release sequence 11 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: reduce managed properties for ordinary Markdown files to `file`, `created`, and `updated`.
  Ctrl+S/Cmd+S derives the filename and creation time from the active Standard Notes item, preserves
  the original creation value and Markdown body, and writes a fresh UTC update timestamp before the
  explicit save. `*.note.md` sidecars remain unchanged so their hierarchy and synchronization
  identities stay intact. The dependency-free AIC Editor Core 2.3 owns the same transformation used
  by the VS Code adapter.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.3.

## 10.2.0 — 2026-09-01

Release sequence 10 · 2 feature outcomes · 0 fixed-bug outcomes.

- F01: make table previews readable at every editor width. Header and body cells use wrapping,
  auto-height textareas; the grid fills the card without a blank right-hand zone, and a dedicated
  body scroller provides horizontal navigation when the minimum readable column widths exceed the
  pane. The action header remains fixed and Properties inputs stay compact and single-line.
- F02: bridge selection from preview DOM back into CodeMirror. Ctrl+A/Cmd+A now selects the complete
  Markdown document even when focus is inside a table cell or another preview control, while a real
  mouse selection over a rendered block opens and selects that block's source. Browser-only
  selection can no longer leave the editor visually selected but non-editable.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.2.

## 9.1.0 — 2026-09-01

Release sequence 9 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: upgrade the shared AIC Editor Core to 2.2 and make source selection a universal escape from
  rendered previews. Ctrl+A/Cmd+A selects the complete Markdown document and reveals raw source for
  every intersected Properties, Table, Details, code, Mermaid, link, and inline-syntax view. A
  smaller non-empty selection reveals only the blocks it crosses; ordinary clicks and collapsed
  cursors retain preview behavior, and the visible **Edit** action remains available for focused
  source editing.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.2.

## 8.1.2 — 2026-09-01

Release sequence 8 · 1 feature outcome · 2 fixed-bug outcomes.

- F01: upgrade the shared AIC Editor Core to 2.1 and render nested YAML maps and sequences as a
  real hierarchical Properties preview. Indentation levels and list items remain visible, leaf
  values stay directly editable, group nodes cannot be turned into invalid scalars, and
  drag-and-drop moves a complete branch only among structurally valid siblings. Unsupported YAML
  stays raw.

- B01: replace selection-driven Properties/Table source disclosure with explicit source-mode state.
  Both blocks now open in preview even when the initial cursor is inside their Markdown; ordinary,
  repeated, and double clicks cannot reveal raw source. Only **Edit** opens source, and moving the
  cursor outside the block returns to preview.
- B02: keep link **Copy** and **Edit** controls visible at all times. The control no longer reserves
  a blank hover-only gap, so link rows stay compact and their available actions are immediately
  clear on mouse, keyboard, and touch clients.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. Preview inputs, add actions, and drag-and-drop remain interactive; the hosted manifest and
desktop archive keep the stable `com.dzyha.standard-notes-aic` identifier and AIC Editor Core 2.1.

## 7.1.3 — 2026-08-31

Release sequence 7 · 1 feature outcome · 3 fixed-bug outcomes.

- F01: make Ctrl+S/Cmd+S the only persistence boundary and expose unobtrusive visual states:
  unchanged notes are lightly green, dirty notes keep the normal surface, and empty placeholders
  are gray.
- B01: isolate in-memory drafts by the Standard Notes working-note UUID and verify that UUID again
  before writing, so switching notes cannot save an old draft into the new note. Returning to a
  note restores its unsaved in-memory draft without plaintext persistence or a conflict dialog.
- B02: keep Details summary controls independent while making the expanded Markdown body directly
  editable; long titles wrap, and checkbox/disclosure controls no longer collapse into the title.
- B03: recompute viewport-dependent table previews through a guarded post-update state effect,
  preventing nested CodeMirror transactions from crashing the block-view plugin.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier and the shared AIC Editor Core 2.0 contract.

## 6.4.1 — 2026-08-31

Release sequence 6 · 4 feature outcomes · 1 fixed-bug outcome.

- F01: introduce AIC Editor Core 2.0, shared byte-for-byte with the VS Code extension for
  structured Markdown mutations and the compact link control.
- F02: replace the link tooltip with a direct label action plus explicit **Copy** and **Edit**
  controls; ordinary Markdown links and bare URLs now use the same compact interaction.
- F03: table previews edit headers/cells in place, add rows or columns, and reorder rows or columns
  with drag handles while committing one valid Markdown transaction.
- F04: properties previews edit validated keys and values in place, add uniquely named properties,
  and reorder them with drag handles while YAML remains plain Markdown source.
- B01: moving focus among structured controls stays inside the draft boundary, so a note commits
  only when focus leaves the complete editor or through Ctrl+S/Cmd+S.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier.

## 5.2.2 — 2026-08-31

Release sequence 5 · 2 feature outcomes · 2 fixed-bug outcomes.

- F01: add the dependency-free AIC Editor Core draft lifecycle shared byte-for-byte with the VS
  Code extension; input stays local and commits only on editor blur or Ctrl+S/Cmd+S.
- F02: remove the note search UI, shortcut, styling, and CodeMirror search dependency.
- B01: request an immediate CodeMirror measurement after mount and document hydration so previews
  initialize without requiring an unrelated click or scroll.
- B02: reject remote refreshes while a local draft is dirty, preserving the exact local Markdown
  until its explicit commit boundary.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier.

## 4.0.1 — 2026-08-21

Release sequence 4 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: raw Space is no longer bound to task toggling. Authors can type `- [ ]` followed by the
  required trailing space or task text so the checkbox renders normally; clicking an already
  rendered checkbox remains the explicit toggle action.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive keep the stable
`com.dzyha.standard-notes-aic` identifier.

## 3.2.0 — 2026-08-21

Release sequence 3 · 2 feature outcomes · 0 fixed-bug outcomes.

- F01: add the exact AIC details grammar with one continuous contrast-surface card, a real rotating
  SVG chevron, title/chevron disclosure, separate checkbox and link controls, and explicit source
  inspection. Writable toggles persist the marker; locked-note toggles remain visual only.
- F02: make **Edit source** the only preview-to-source activation for Details, Mermaid, Table, and
  Properties. Preview content and container keyboard activation remain inert while links and other
  explicit controls keep their actions.

Compatibility: Standard Notes custom `editor-editor` component, interchangeable Markdown note/file
type. The hosted manifest and desktop archive use the stable
`com.dzyha.standard-notes-aic` identifier.

## Consumed release baseline

- `0.1.1` — public release sequence 2.
- `0.1.0` — public release sequence 1.

These successful historical publications establish the immutable sequence baseline; their old
version strings are not retroactively interpreted as `R.F.B` counts.
