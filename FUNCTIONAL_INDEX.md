# AIC Standard Notes plugin functional index

This file is the release contract for the Standard Notes editor component. The
plugin and AIC Notes extension share the small runtime core for explicit drafts,
managed file properties, structured preview mutation, the complete CodeMirror code-fence extension,
slash templates, CSS-mask icons, and the Mermaid viewport. Markdown remains the only cross-client
storage format.

## Global invariants

- The Standard Notes working-note UUID is the draft identity. Title or stream
  order is never used to attach a dirty draft to another note.
- Input, click-away, blur, note switch, and page unload never save. Only
  `Ctrl/Cmd+S` commits the active draft.
- Switching notes restores an unsaved draft only for the same UUID. A clean
  inactive draft can be discarded.
- Only a title ending in `.note.md` receives managed `file`, `created`, and
  `updated` fields. Ordinary Markdown documents are byte-identical on save.
- The host write fails closed when the active UUID changed or the Standard
  Notes item is locked.
- Preview widgets mutate one exact Markdown source range. No widget maintains
  parallel note data and no tooltip editor duplicates the source.

## Functional matrix

| Area / owner                                | Behavior                                                                                   | State / side effect                            | Failure boundary                                 | Coverage                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Bootstrap (`src/main.ts`)                   | Detects standalone vs Standard Notes, mounts one editor, subscribes before editing         | active UUID draft and remote generation        | Missing identity is read-only/unavailable        | main, host tests              |
| Host adapter (`src/standard-notes-host.ts`) | Pins compatibility knowledge for `sn-extension-api` 0.4.0                                  | writes preview before text                     | UUID mismatch/locked item returns false          | standard-notes-host           |
| Draft registry                              | Isolates `DraftSession` by UUID across rapid note switches                                 | dirty/current text per note                    | Remote refresh never discards dirty local text   | registry, main, draft-session |
| Explicit save                               | Stamps managed note fields, computes plain preview, writes once                            | dirty → pending → saved/dirty                  | Failed save keeps the draft dirty                | main, editor                  |
| Preview selection                           | Native preview selection remains stable; source selection reveals intersected Markdown     | shared keyboard/DOM boundary                   | `Ctrl/Cmd+A` reveals the complete source         | structured-preview/editor     |
| Preview navigation                          | Replaced previews are atomic; Edit pins one source block while the selection remains in it | shared CodeMirror range contract               | Arrow keys never enter hidden source mid-command | preview-ranges/editor         |
| Links                                       | Click label to open; Copy and Edit icons are always visible                                | host URL/clipboard adapters                    | Unsafe targets remain closed                     | link-actions                  |
| Details                                     | Summary/chevron toggles independently from checkbox and body                               | exact open/closed marker                       | Fence-contained terminators do not close a card  | details                       |
| Code fences                                 | Same preview card, language label, and permanent Copy/Edit icons as VS Code                | exact fenced body; explicit source reveal      | Unknown language remains readable and copyable   | code-fence/core/editor        |
| Slash templates                             | `/` inserts grouped pages, sections, and formatting blocks in both shared editor surfaces  | snippet fields; Tab advances                   | Disabled in code and read-only notes             | slash-snippets/editor         |
| Mermaid                                     | Render, copy, edit, zoom, reset, clockwise rotate, two-axis scroll                         | transform and viewport state only              | Render error exposes recoverable source          | mermaid/viewport              |
| Tables                                      | Content-sized columns, word-only wrapping, horizontal grid scroll                          | one transient textarea popover; row/column DnD | Invalid mutation is rejected atomically          | blocks/structured-preview     |
| Properties                                  | Static nested preview and one transient editor popover                                     | add/edit/move full sibling branch              | Structural roots cannot be split/moved illegally | blocks/structured-preview     |
| Read-only                                   | Keeps preview, navigation, selection, and copy available                                   | all mutation controls disabled                 | No host write can run                            | editor/main                   |
| Theme and icons                             | Uses host tokens, CSS SVG masks, and Standard Notes' supported `>_` Code icon              | renderer-independent editor actions            | No custom top-bar SVG API is assumed             | manifest/editor/publication   |
| Distribution                                | Stable plugin identifier, hosted manifest, versioned desktop archive                       | GitHub Pages plus release ZIP                  | Tag/package/manifest versions must match         | manifest/publication          |

## Shared core modules

| Module                 | Contract                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `draft-session`        | Explicit commit boundary and remote-update protection                               |
| `file-properties`      | Three managed note fields, ordinary-document preservation, safe legacy migration    |
| `structured-preview`   | Stable preview selection plus table/property mutations with structural validation   |
| `preview-ranges`       | Atomic CodeMirror navigation contract for every replaced preview range              |
| `code-fence-preview`   | Text-safe code card plus permanent Copy/Edit actions shared by both adapters        |
| `code-fence-extension` | Shared CodeMirror discovery, replacement, selection, read-only, and copy routing    |
| `slash-snippets`       | Seven-group catalog, contextual query, question fields, and host-token presentation |
| `icons.css`            | CSS-mask action icons with inherited renderer colors                                |
| `mermaid-viewport`     | Zoom/rotation transform and bidirectional overflow behavior                         |

## Interaction contract

- Link label: open. Adjacent Copy: copy destination. Adjacent Edit: reveal source.
- Code Copy: exact fenced body. Code Edit: reveal and focus the fenced source.
- Mermaid Copy: exact fenced body. Edit: reveal the complete fence.
- Mermaid Zoom/Reset/Rotate: change preview only; never rewrite diagram source.
- Table/Properties value activation: open one positioned textarea popover.
  Enter/explicit action commits; Escape/outside dismissal does not invent data.
- Table/Properties Add and drag handles: serialize one valid Markdown block.
- Task checkbox: change only its Markdown marker; disclosure controls do not
  consume checkbox activation.
- Native mouse selection inside preview remains selectable and copyable without
  rerendering the widget. CodeMirror selections reveal intersected source;
  `Ctrl/Cmd+A` reveals the complete note.
- Slash on an otherwise empty Markdown line opens the contextual shared catalog. Empty notes rank
  complete pages first; existing pages rank sections first; `Tab` advances through inserted
  perspective questions. Group headers separate page structure, assurance, references, data,
  diagrams, and content. Code and read-only contexts never activate it.

## Parity boundary

- AIC Notes and this plugin consume byte-identical core modules for drafts, managed properties,
  structured mutations, code-fence cards/extensions, slash templates, icons, and Mermaid viewport state. The
  foundations remain dependency-free; the shared fence extension uses the CodeMirror public APIs
  already pinned identically by both products.
- Every Markdown editor interaction listed above has an adapter-owned regression test in both
  products. A release cannot describe a raw-source fallback where the paired editor exposes a
  preview action.
- VS Code workspace navigation, sidecar/project notes, Explorer trees, local Trash, and source-file
  selection comments are host capabilities, not Markdown editor behavior. Standard Notes UUID,
  lock state, note switching, and component theming are likewise host-only. Neither product fakes
  the other host's storage model inside Markdown.

## Release verification

- Unit/model suites cover parsing, commands, details boundaries, link actions, code-fence cards, slash templates,
  tables/properties, draft identity, host identity, file properties, selection,
  Mermaid transform/viewport, and manifest/publication metadata.
- Browser QA covers real layout, popovers, persistent actions, table overflow,
  selection reveal, details checkbox, and Mermaid scrolling after transforms.
- The production build must contain no external runtime dependency beyond the
  bundled component and must be installable from the stable `ext.json` URL.
