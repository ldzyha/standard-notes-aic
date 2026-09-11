# AIC Standard Notes plugin functional index

This file is the release contract for the Standard Notes editor component. The
plugin and AIC Notes extension share the small runtime core for explicit drafts,
managed file properties, structured preview mutation, the complete CodeMirror code-fence extension,
slash templates, CSS-mask icons, and the Mermaid viewport. Markdown remains the only cross-client
storage format. Release 21.3.5 pairs with AIC Notes 28.4.5 and AIC Editor Core 3.4.0.

## Release 21.3.5 additions

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

| Area / owner                                | Behavior                                                                                      | State / side effect                            | Failure boundary                                 | Coverage                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Bootstrap (`src/main.ts`)                   | Detects standalone vs Standard Notes, mounts one editor, subscribes before editing            | active UUID draft and remote generation        | Missing identity is read-only/unavailable        | main, host tests              |
| Host adapter (`src/standard-notes-host.ts`) | Pins compatibility knowledge for `sn-extension-api` 0.4.0                                     | writes preview before text                     | UUID mismatch/locked item returns false          | standard-notes-host           |
| Draft registry                              | Isolates `DraftSession` by UUID across rapid note switches                                    | dirty/current text per note                    | Remote refresh never discards dirty local text   | registry, main, draft-session |
| Explicit save                               | Stamps managed note fields, computes plain preview, writes once                               | dirty → pending → saved/dirty                  | Failed save keeps the draft dirty                | main, editor                  |
| Preview selection                           | Native preview selection remains stable; source selection reveals intersected Markdown        | shared keyboard/DOM boundary                   | `Ctrl/Cmd+A` reveals the complete source         | structured-preview/editor     |
| Preview navigation                          | Replaced previews are atomic; Edit pins one source block while the selection remains in it    | shared CodeMirror range contract               | Arrow keys never enter hidden source mid-command | preview-ranges/editor         |
| Links                                       | Click label to open; Copy and Edit icons are always visible                                   | host URL/clipboard adapters                    | Unsafe targets remain closed                     | link-actions                  |
| Details                                     | Summary/chevron toggles independently from checkbox and body                                  | exact open/closed marker                       | Fence-contained terminators do not close a card  | details                       |
| Code fences                                 | Same preview card, language label, and permanent Copy/Edit icons as VS Code                   | exact fenced body; explicit source reveal      | Unknown language remains readable and copyable   | code-fence/core/editor        |
| Slash templates                             | `/` opens a compact grouped catalog in both shared editor surfaces without delayed activation | snippet fields; Tab advances                   | Disabled in code and read-only notes             | slash-snippets/editor         |
| Mermaid                                     | Render, copy, edit, zoom, reset, clockwise rotate, two-axis scroll                            | transform and viewport state only              | Render error exposes recoverable source          | mermaid/viewport              |
| Tables                                      | Content-sized columns, word-only wrapping, horizontal grid scroll                             | one transient textarea popover; row/column DnD | Invalid mutation is rejected atomically          | blocks/structured-preview     |
| Properties                                  | Static nested preview and one transient editor popover                                        | add/edit/move full sibling branch              | Structural roots cannot be split/moved illegally | blocks/structured-preview     |
| Read-only                                   | Keeps preview, navigation, selection, and copy available                                      | all mutation controls disabled                 | No host write can run                            | editor/main                   |
| Theme and icons                             | Uses host tokens, CSS SVG masks, and Standard Notes' supported `>_` Code icon                 | renderer-independent editor actions            | No custom top-bar SVG API is assumed             | manifest/editor/publication   |
| Distribution                                | Stable plugin identifier, hosted manifest, versioned desktop archive                          | GitHub Pages plus release ZIP                  | Tag/package/manifest versions must match         | manifest/publication          |

## Shared core modules

| Module                                                | Contract                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `draft-session`                                       | Explicit commit boundary and remote-update protection                                                   |
| `file-properties`                                     | Three managed note fields, ordinary-document preservation, safe legacy migration                        |
| `structured-preview`                                  | Stable preview selection plus table/property mutations with structural validation                       |
| `preview-ranges`                                      | Atomic CodeMirror navigation contract for every replaced preview range                                  |
| `code-fence-preview`                                  | Text-safe code card plus permanent Copy/Edit actions shared by both adapters                            |
| `code-fence-extension`                                | Shared CodeMirror discovery, replacement, selection, read-only, and copy routing                        |
| `slash-snippets`                                      | Seven-group catalog, contextual query, question fields, and host-token presentation                     |
| `formatting`                                          | Shared heading/list transactions, protected source boundaries, physical-key shortcuts and one-step Undo |
| `indentation`                                         | Shared Enter/Tab indentation with snippet navigation and native source Undo preserved                   |
| `diagram-model`, `diagram-palette`, `diagram-builder` | Bounded Mermaid grammar, semantic elements/relations, and compact editing on actual SVG                 |
| `diagram-session`                                     | Inline draft lifecycle, exact block replacement, conflict protection and explicit host save             |
| `agentic-notes`                                       | Tested note scope/section utilities only; no enabled universal agent adapter or standalone writer       |
| `icons.css`                                           | CSS-mask action icons with inherited renderer colors                                                    |
| `mermaid-viewport`                                    | Zoom/rotation transform and bidirectional overflow behavior                                             |

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
  structured mutations, code-fence cards/extensions, slash templates, formatting, indentation,
  diagram model/palette/builder/session, icons, and Mermaid viewport state. The
  foundations remain dependency-free; the shared fence extension uses the CodeMirror public APIs
  already pinned identically by both products.
- Every Markdown editor interaction listed above has an adapter-owned regression test in both
  products. A release cannot describe a raw-source fallback where the paired editor exposes a
  preview action.
- VS Code workspace navigation, sidecar/project notes, Explorer trees, local Trash, and source-file
  selection comments are host capabilities, not Markdown editor behavior. Standard Notes UUID,
  lock state, note switching, and component theming are likewise host-only. Neither product fakes
  the other host's storage model inside Markdown.
- Agentic Notes utilities do not enable a universal agent integration. This release adds no
  cross-application note synchronization transport or collaborative locking channel.

## Release verification

- Unit/model suites cover parsing, commands, details boundaries, link actions, code-fence cards, slash templates,
  tables/properties, draft identity, host identity, file properties, selection,
  Mermaid transform/viewport, and manifest/publication metadata.
- Browser QA covers real layout, popovers, persistent actions, table overflow,
  selection reveal, details checkbox, and Mermaid scrolling after transforms.
- The production build must contain no external runtime dependency beyond the
  bundled component and must be installable from the stable `ext.json` URL.
