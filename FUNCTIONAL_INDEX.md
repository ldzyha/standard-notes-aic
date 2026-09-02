# AIC Standard Notes plugin functional index

This file is the release contract for the Standard Notes editor component. The
plugin and AIC Notes extension share the small runtime core for explicit drafts,
managed file properties, structured preview mutation, CSS-mask icons, and the
Mermaid viewport. Markdown remains the only cross-client storage format.

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

| Area / owner                                | Behavior                                                                           | State / side effect                            | Failure boundary                                 | Coverage                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| Bootstrap (`src/main.ts`)                   | Detects standalone vs Standard Notes, mounts one editor, subscribes before editing | active UUID draft and remote generation        | Missing identity is read-only/unavailable        | main, host tests              |
| Host adapter (`src/standard-notes-host.ts`) | Pins compatibility knowledge for `sn-extension-api` 0.4.0                          | writes preview before text                     | UUID mismatch/locked item returns false          | standard-notes-host           |
| Draft registry                              | Isolates `DraftSession` by UUID across rapid note switches                         | dirty/current text per note                    | Remote refresh never discards dirty local text   | registry, main, draft-session |
| Explicit save                               | Stamps managed note fields, computes plain preview, writes once                    | dirty → pending → saved/dirty                  | Failed save keeps the draft dirty                | main, editor                  |
| Preview selection                           | Collapsed cursor previews; non-empty selection reveals intersected Markdown        | CodeMirror selection only                      | `Ctrl/Cmd+A` reveals the complete source         | preview                       |
| Links                                       | Click label to open; Copy and Edit icons are always visible                        | host URL/clipboard adapters                    | Unsafe targets remain closed                     | link-actions                  |
| Details                                     | Summary/chevron toggles independently from checkbox and body                       | exact open/closed marker                       | Fence-contained terminators do not close a card  | details                       |
| Code fences                                 | Highlighted Markdown source for known languages                                    | direct CodeMirror editing and native copy      | Unknown language remains readable source         | language/editor               |
| Mermaid                                     | Render, copy, edit, zoom, reset, clockwise rotate, two-axis scroll                 | transform and viewport state only              | Render error exposes recoverable source          | mermaid/viewport              |
| Tables                                      | Content-sized columns, word-only wrapping, horizontal grid scroll                  | one transient textarea popover; row/column DnD | Invalid mutation is rejected atomically          | blocks/structured-preview     |
| Properties                                  | Static nested preview and one transient editor popover                             | add/edit/move full sibling branch              | Structural roots cannot be split/moved illegally | blocks/structured-preview     |
| Read-only                                   | Keeps preview, navigation, selection, and copy available                           | all mutation controls disabled                 | No host write can run                            | editor/main                   |
| Theme and icons                             | Uses host theme tokens and CSS SVG masks                                           | renderer-independent CSS                       | No inline/external SVG capability required       | editor/publication            |
| Distribution                                | Stable plugin identifier, hosted manifest, versioned desktop archive               | GitHub Pages plus release ZIP                  | Tag/package/manifest versions must match         | manifest/publication          |

## Shared core modules

| Module               | Contract                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| `draft-session`      | Explicit commit boundary and remote-update protection                            |
| `file-properties`    | Three managed note fields, ordinary-document preservation, safe legacy migration |
| `structured-preview` | Pure table/property source mutations with structural validation                  |
| `icons.css`          | CSS-mask action icons with inherited renderer colors                             |
| `mermaid-viewport`   | Zoom/rotation transform and bidirectional overflow behavior                      |

## Interaction contract

- Link label: open. Adjacent Copy: copy destination. Adjacent Edit: reveal source.
- Mermaid Copy: exact fenced body. Edit: reveal the complete fence.
- Mermaid Zoom/Reset/Rotate: change preview only; never rewrite diagram source.
- Table/Properties value activation: open one positioned textarea popover.
  Enter/explicit action commits; Escape/outside dismissal does not invent data.
- Table/Properties Add and drag handles: serialize one valid Markdown block.
- Task checkbox: change only its Markdown marker; disclosure controls do not
  consume checkbox activation.
- Any non-empty selection, including `Ctrl/Cmd+A`, exits preview for every
  intersected range so normal copy and editing remain predictable.

## Release verification

- Unit/model suites cover parsing, commands, details boundaries, link actions,
  tables/properties, draft identity, host identity, file properties, selection,
  Mermaid transform/viewport, and manifest/publication metadata.
- Browser QA covers real layout, popovers, persistent actions, table overflow,
  selection reveal, details checkbox, and Mermaid scrolling after transforms.
- The production build must contain no external runtime dependency beyond the
  bundled component and must be installable from the stable `ext.json` URL.
