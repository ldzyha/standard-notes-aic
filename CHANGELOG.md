# Changelog

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
