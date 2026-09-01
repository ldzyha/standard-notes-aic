# Changelog

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
