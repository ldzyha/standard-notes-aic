# AIC for Standard Notes

<p align="center">
  <img src="./public/aic-logo.svg" alt="AIC logo" width="96" height="96">
</p>

`AIC` is a Markdown editor component for Standard Notes. It registers under the Code note type so
Standard Notes displays its supported `>_` icon, while `file_type: md` and interchangeability keep
the note body as ordinary Markdown. It derives headings, lists, task checkboxes, tables, typed AIC fields, fenced-code
highlighting, AIC details cards, and Mermaid diagrams in the editor.

The complete, test-owned behavior map is in [`FUNCTIONAL_INDEX.md`](FUNCTIONAL_INDEX.md).

## Security field actions

### Authenticator JSON conversion

Open the original Authenticator JSON array in AIC, or select the complete array inside
a Markdown document. A contextual **Convert and save security blocks** action appears for
recognized `service`, `account`, `secret` records. One click converts every record in
that array into sections of one `aic` block and explicitly saves the changed note.
Sections are separated by standalone `---`; titles are optional. Overflow continues in
additional blocks without dropping records or fields. The preview states account/block counts
before conversion. Consider grouping separate blocks by purpose: services, banks, web or social networks.
Wait for **Note saved** before leaving. A failed save keeps the draft and offers
**Retry save**. The toolbar's Save note icon also saves dirty drafts after switching
back to a note, including on mobile. Nothing is converted on opening or on each
keystroke. Ctrl/Cmd+S, Save note and leaving the editing surface save a draft;
security preview actions save immediately. Undo is a new draft until a save boundary.

`service`, `account`, and notes become text parts; `secret` becomes a `#|` TOTP
part and `password` becomes a `*|` secret part. Safe HTTP(S) service URLs, including simple
Markdown links, also get an Open-capable URL field without changing the original service.
Extra string fields are retained and hidden. Invalid records, duplicate keys and unsupported
values stop the entire conversion without losing part of the array. Limits: 256 records
and 1 MiB of UTF-8 source. Original credential strings are preserved exactly: malformed JSON
escapes must be corrected in the export, not guessed by the converter.

This converts the current JSON body or selection, not all notes in your account. It does
not change Standard Notes note types or read the clipboard. Raw JSON, Markdown and exports
remain plaintext; use your normal protected account, not the standalone demo, for secrets.

### Copy, Paste and generation

Tap/click a field label to copy its label, or a value to copy its value; “Copied” appears
briefly over the pressed target after success. Tab moves focus; Enter/Space activates a focused field.
The field icon is **Paste**, present only while the field is empty. Empty fields also offer
Delete; filled fields have neither button. There is no Replace action. Copy remains available; manual editing
or clearing uses **Edit** for the complete Markdown block. Whole-block Copy stays in the header.
Preview mutations request an immediate save through the host manager. Ordinary typing
stays a draft until Ctrl/Cmd+S, Save or leaving the editor. Wait for the acknowledged save
state before closing the app; an interrupted process cannot guarantee completion.

Paste reads the latest clipboard text directly on the click and fills the empty field.
There is no AIC dialog, history picker or intermediate input on a successful read.
VS Code uses its [native clipboard API](https://code.visualstudio.com/api/references/vscode-api#Clipboard);
Standard Notes uses the [browser Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText).
The browser may require its own permission prompt, which the component cannot bypass.
Only if clipboard access is denied, unavailable or times out does AIC offer an inline,
masked paste-only input. Direct typing is blocked and hidden values are never previewed.
Empty clipboard text makes no change. AIC does not enumerate or store clipboard history.

On wider layouts, empty `*|` secret parts in password-oriented rows offer
**Generate password**. The control is hidden when the viewport is 600px wide
or narrower, including mobile layouts.
Default: 24 characters,
uppercase, lowercase, numbers and symbols. Length: 8–128; each enabled group is represented.
Generation never overwrites, previews or copies the value automatically. To generate again,
clear the value through source Edit and return to preview. TOTP/API keys and arbitrary
masked labels are not password-generation targets.

The shared generator uses local [Web Crypto randomness](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues),
unbiased sampling and no weak fallback. Controls are inspired by
[1Password's configurable options](https://1password.com/blog/how-to-generate-random-password),
not its proprietary implementation. [Clipboard permissions](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
vary between browsers/embedded clients. Markdown and copied values remain plaintext.

### One-time values and optional titles

The One-time codes template inserts `1|` unused values. A successful value Copy changes
that part to `0|` used. Activating a used value changes it back to `1|` without copying;
the next activation copies and marks it used again. Used values expose only their remove
action. Both states stay visually masked and remain plaintext in Markdown source.

Without an independent `#` card title, the first section title replaces the card name in
its header. Use an optional `## Account name` at a section's start; omit the heading
for the default Security header. Later named sections retain their own compact heading.
Standalone `---` lines separate sections; earlier Security formats are not parsed.

## Compact groups, reordering and Markdown source

The AIC field card has a filter, visible section separators and one **+** disclosure
after each group's fields. The filter matches names and visible values only; hidden values,
recovery codes and generated one-time codes are never indexed. Filtering is local UI state,
does not edit or save the note, and leaves host-provided relationship navigation visible.

In `aic`, an optional `# Group title` names the card independently of its `---` sections.
Untitled blocks remain readable. Drag handles move fields within or between sections (including empty sections),
sections within their card, and standalone Security cards within the same document.
Alt+Up/Down on a handle provides keyboard reordering. Filtered lists cannot reorder.
Unsupported layouts and old YAML Properties
remain editable through source, without an implicit reorder/migration. Moves request one save
through the host and remain undoable.

Standard Notes and the browser editor use one always-compact formatting toolbar:
strike, link, bullet list, ordered list and task list are direct actions, followed
by source mode and the bundled local `?` guide where that host mounts it. There are
no Style/Insert selectors or Bold/Italic/Inline-code buttons. Use their existing
keyboard shortcuts, authored Markdown or slash commands instead. The toolbar wraps
onto another row rather than scrolling horizontally; coarse-pointer controls keep
44 px targets.

The editor-level **Show Markdown source / Show preview** icon toggles all previews together,
without opening another editor, changing source, resetting Undo or saving. The mode lasts only
for the current note and resets on a different note. It also exposes starred values in their raw
Markdown form; this is explicit source access, not an additional secret-reveal control.

New templates and converted Authenticator records use one bounded `aic` fence.
Existing text is never rewritten automatically. A standalone `---` separates sections.
Every value starts with its type separator: `|` text, `*|` secret, `#|` TOTP,
`_|` card, `1|` unused one-time, or `0|` used one-time. For example,
`Card _| 4111111111111111 | 12/30 *| 123` independently types all three values.
A label is optional and appears only before the first separator. JSON double quotes
protect a value containing a pipe, quote, boundary whitespace, or control character.
Typed cards accept 12–19 digits; invalid values show fixed repair advice without
echoing their contents. Colon fields, old YAML Properties, and earlier Security
formats stay raw and require manual source editing; AIC performs no automatic migration.

### Capacity and repair locations

Each AIC block shows its capacity: 16 sections, 64 rows per section, 64 typed
values per row, 65,536 UTF-16 text units per block and 16,384 encoded text units
per row. Add actions that would
exceed a limit are disabled; **New block** remains available. The converter automatically
packs overflow into more blocks, splitting oversized accounts only at field boundaries.
It never truncates values. Existing notes are not automatically repartitioned.

Invalid AIC previews identify the source line and column and provide
an Edit action to that location. Advice never echoes a password, TOTP seed or raw parser
exception. If an exact field position is unavailable, the block start is identified honestly.

```aic
# Services
Service | Example
| example@example.invalid
Password *|
---
## Optional account title
Service | Another example
Password *|
```

## AIC fields in Markdown

One complete top-level fenced `aic` document owns the structured field UI. The blank,
Card, and One-time codes presets are combinations of the same typed values,
not additional field types. Add Field targets the current row, Add Row inserts below
it, and Add Section inserts after the current section. A blank text row can hold an
email or another identifier. The local `?` guide shows the
grammar in Standard Notes, the browser panel, and both VS Code editor surfaces.

Legacy YAML Properties remain ordinary authored Markdown. They are not rendered as
fields, interpreted as metadata, rewritten on save, or automatically migrated. Source
mode keeps that text accessible for manual repair.

## Release 40.0.1

This coordinated update pairs with AIC Notes 48.0.1, shared editor core 6.2.2
and experimental browser 0.5.2. Information (`>`), warning (`!>`) and error
(`!>>`) quotes use subtle backgrounds and distinct side accents. Quoted and
italic text is smaller, and neighboring Markdown blocks have more space.
`>>> … <<<` remains the details syntax. An opening three-backtick code fence stays
editable while its language is typed; a completed code block previews only
after the caret leaves its delimiters. See the [one-page installation guide](RELEASE_INSTALL.md)
for all three products.

## Release 39.0.1

This display fix pairs with AIC Notes 47.0.1, shared editor core 6.2.1 and the
experimental browser component 0.5.1. Headings, quotes and lists have more
space between them. A thematic break is a centered 50–100 px line with space
above and below, and its row keeps the same height when the caret reveals the
raw Markdown. The underlying note text is unchanged.

## Release 38.1.1

This release pairs with AIC Notes 46.1.1, shared editor core 6.2.0 and the
experimental browser component 0.5.0. New AIC blocks offer a blank text row for
an email or username instead of the Account preset. Password and TOTP are optional
separate fields. At narrow widths, field labels and their values wrap together in
readable columns, and the browser panel can shrink without values-only scrolling.
Password generation is hidden at viewport widths of 600 px or less. Existing note
content is preserved. The browser package remains experimental; see its
[verification record](browser/VERIFICATION.md) before using real secrets.

## Release 37.2.0

This release pairs with AIC Notes 45.1.0 and AIC Editor Core 6.1.0. This document
describes the release source and its contracts; deployment and the hosted manifest
are verified separately by the release workflow.

Two features are included. **Copy section** in each AIC section header copies a
standalone fenced `aic` block containing that section, including its masked and
filter-hidden rows, without the card title or sibling sections. The shared serializer
preserves logical values and their types; authored whitespace and quoting may change.
Copy works in read-only views and leaves the note and save state unchanged. Unnamed
empty sections omit the redundant action. The same
action is shared by Standard Notes, the browser and both VS Code editor surfaces.

Browser 0.4.0 adds **Global Shared**: one encrypted record in the current browser
profile's vault, available above Domain Shared on every page and without an active
web page. The empty **Global** action opens an editable placeholder; the first
actual edit creates the record. This record has its own
revision and draft; it is not copied into page or domain Markdown. Library v1/v2
content migrates without changes, and the next write uses library v3. Older builds
cannot read v3. During backup merge, an existing local Global record is preserved
and a persistent notice reports that the imported Global record was skipped; the
original encrypted backup remains available.

Global Shared belongs only to the browser vault. This release does not implement
the proposed generated-key or VS Code `global.aic` encryption architecture, account
connections or synchronization. It makes no PWA crash-fix claim. Core 6.1.0 is an
additive section-copy release; AIC Notes 45.1.0 adds that shared action only.
The browser archive remains experimental and has explicit
[verification boundaries](browser/VERIFICATION.md); use synthetic data while its
remaining packaged-runtime gates are open. See the [browser guide](browser/README.md)
and [marketplace HOWTO](MARKETPLACE_HOWTO.md) for installation and future submissions.

The prior 36.0.1 release unified the Standard Notes and browser compact toolbar,
including direct source and guide actions, wrapping and 44 px coarse-pointer targets.

The prior 35.3.9 release introduced the typed-pipe AIC document and local guide,
aligned card and field actions, bounded browser labels, parser-backed link labels,
compact field menus and direct browser import/export actions. Core 6.0.0 remains
breaking because old colon/YAML field forms are no longer active syntax; old text
stays accessible and is not converted.

The prior 34.3.1 release added the compact browser surface, metadata-only saved
ancestors and guarded local page-note deletion, plus the shared component/BEM layer
and compact inline card row.

The prior 33.2.4 release added the page notebook and exact-origin shared Properties,
and fixed compact generic pipe fields, bounded Add menus, caret visibility and
retained Standard Notes transport messages.

Earlier field grammars and their release history remain recorded in
[`CHANGELOG.md`](CHANGELOG.md), but they are not accepted input for the current
structured renderer. Use the typed separators documented above. This is **visual
masking, not encryption of the Markdown itself**: raw source, other Markdown
editors, exports, copied values and local files can expose the data. Standard Notes
owns account sign-in, note encryption and synchronization; AIC Notes for VS Code is
local-only.

Task checkboxes, details parsing, code-language aliases and the bounded Mermaid render queue now
have canonical implementations in `src/core`, consumed by both this editor and AIC Notes.
Nested text controls retain their own Ctrl/Cmd+A selection. Completed inactive drafts are pruned
after their matching save acknowledgement; newer, failed and pending drafts remain intact.
Canceled pending Mermaid work releases its payload immediately, while an active render retains
the engine slot until it actually finishes.

`CORE_FILES.json` explicitly selects the distributed modules. `npm run core:sync` mirrors them;
`node scripts/sync-editor-core.mjs --snapshot` also generates extension provenance. Uncommitted
canonical sources are marked as working-tree input and blocked from extension publication.
The retired File Context sphere is not distributed. Removing it does not affect
Markdown diagrams or VS Code's contextual linked-note relationships.

The host adapter clears unavailable note contexts, retains omitted same-note
metadata without crossing UUIDs, and waits for the matching save acknowledgement.
AIC blocks are excluded from plain previews even inside quotes/lists; each
save also clears a previous editor's stale HTML preview. Invalid drag payloads
cannot reorder data, and table
edits retain extra authored cells. Retired controls and TOTP refreshes cannot
update a replacement document.

Run `npm run test:browser:lifecycle` against a local Vite server on port 5189 to exercise 200
synthetic editor lifecycles. Like `test:browser`, it uses an available Playwright installation;
`AIC_REVIEW_PLAYWRIGHT`, `AIC_REVIEW_BROWSER` and `AIC_REVIEW_URL` can select the local test runtime.
It checks collectible editor roots and stable DOM/listener counts, not every possible memory leak.
No Standard Notes account data was used for these synthetic tests. Actual live
sign-in and Linux runtime behavior have not been verified.

## Editor features

The shared editor features below are included in the release source; the visual
Mermaid builder remains experimental. Automated suites and synthetic browser
checks cover the implementation. They do not certify authenticated Standard Notes
clients or a live Linux session.

- Type `/page` or `/section` for Core-aligned questions, early answers and contextual detail, without
  compulsory Purpose/Proposal sections. `/context` links parent and shared descriptions without
  copying them; section headings nest under the current Markdown heading.
- Use `/noise` to investigate uncertainty, then `/wave` in the same note for a result, prerequisites,
  dependency-ordered actions and verification. `/implementation` adds steps with error handling.
  These are editable prompts, not automatic task states or extra required properties.
- Basic blocks are `/list` (unordered), `/list-numbered` (ordered), `/checklist` (checkboxes)
  and `/table` (a simple table). `/checkbox` and `/tasklist` also find `/checklist`.
  Each list item holds one idea; no heading or metadata is imposed. Specialized `/mapping-table`,
  `/comparison` and `/tasks` remain separate choices in Tables & lists.
- Insert `/flowchart`, `/class-diagram`, `/sequence` or `/entity-map`, then use **Edit diagram visually**
  in the Mermaid preview. Controls open inline in that same block, without a dialog. Drag an element
  from the palette onto the preview, then select the node to
  edit its label/type in the compact context bar. Drag a connection handle onto another node for
  a solid arrow; click the line itself to edit its label/type/direction. Mermaid computes positions
  from the source and direction; palette drop positions are not saved as coordinates. Sequence
  ordering remains semantic. Undo/Redo, deletion, zoom, scroll and fit
  are available. The separate source-edit action remains available.
- Diagram controls use a compact bar independent of document font size. Endpoints, entity
  members and related connections open only on demand. Palette and selectors share semantic
  names; Mermaid geometry stays internal. The entity-map profile uses Entity and
  Association/Dependency rather than lifecycle terminology.
- The visual-editor button also appears above active Mermaid source, including immediately after
  `/sequence` or `/class-diagram`. It does not replace source text or require leaving the selected
  snippet field. `/class` filters to `/class-diagram`; there is no duplicate command.
- **Apply diagram changes** updates this Markdown block; **Ctrl/Cmd+S** saves the note. Pressing
  Ctrl/Cmd+S inside the builder applies first and then requests the same explicit host save. Cancel
  discards the builder draft. Changes outside the block preserve it; conflicting block edits disable
  Apply and retain a copyable draft. Switching notes retires the old session.
- Visual editing supports a bounded flow/class/sequence grammar. Unsupported syntax opens in source
  mode with the original text intact. Inline editing and read preview share the same Mermaid
  renderer and layout configuration. Legacy `%% aic-builder-layout` coordinates are ignored and
  removed only when a supported visual edit rewrites the source, not on opening or unchanged Apply.
- Enter preserves indentation; Tab/Shift+Tab indent/outdent except while navigating snippet fields.
  The Mermaid source textarea shares this behavior and retains native Undo in supported browsers.
- Ctrl/Cmd+Alt+1…6 toggles headings; Ctrl/Cmd+Alt+0 restores a paragraph.
  Ctrl/Cmd+Shift+7/8/9 toggles numbered, bullet and checkbox lists in the shared editor.
  Formatting does not save on input; the common Save/shortcut/leave boundary applies.
- Agentic Notes scope/section utilities are present in the shared source core, but no universal
  agent adapter or standalone writer is enabled. Host-owned live-document transactions are required
  before agents can safely update a note that may have an unsaved editor draft.

The entity map is an overview of composition and relationships; `/timeline` remains chronological
and source-edited. Automatic drill-down/cross-scale links, noise/wave grouping UI, multiselect,
subgraph authoring and full arbitrary Mermaid support are **not implemented**. Standard Notes does
not automatically populate blank notes or create VS Code project structures. Existing notes remain
unchanged until edited. Save-acknowledgement, note-identity, popup, lock and cursor-navigation fixes
are also included in this release. A host acknowledgment confirms its local pre-sync save,
not completion of Standard Notes cloud synchronization.

## Install

For the coordinated VS Code, Standard Notes and Chrome/Edge release, use the
[single installation guide](RELEASE_INSTALL.md).

In Standard Notes, open **Preferences → Plugins**, find **Install Custom Plugin**, and paste:

```text
https://ldzyha.github.io/standard-notes-aic/ext.json
```

This is an independent third-party plugin and is not reviewed by the Standard Notes team. Web and
mobile clients use the hosted GitHub Pages editor; desktop clients can use the versioned release
archive.

After installation, choose **AIC** from a note's editor menu. Existing Markdown stays byte-for-byte
compatible with Plain Text and other interchangeable Markdown editors.

For an existing installation, no second import is required. Standard Notes automatically checks
the manifest's `latest_url`; after a release and the hosted manifest are published, it offers or
applies the newer component. If the client still displays the previous build, restart it so the
component cache is reloaded. The stable plugin identifier is unchanged, so updating does not create
a second editor or convert note data.

## Slash templates

On an otherwise empty Markdown line, type `/` and continue typing to filter the shared template
catalog. Empty notes put complete pages first; an existing page puts its sections first. Choose a
template with the keyboard or pointer, then use `Tab` to move through its highlighted thinking
questions and replace each answer in place.

The compact menu separates Pages, Structure, Review, References, Tables & lists, Diagrams, and
Blocks. Its examples include progressive documentation, architecture,
capability and decision pages; focused sections; tables and comparisons; Mermaid
flow/class/sequence/timeline diagrams; code, details, tasks and synthesis. Slash completion is
disabled in fenced/inline code and in locked notes, so `/` remains ordinary Markdown there. AIC
Notes uses this same catalog in both ordinary `.md` documents and contextual `.note.md` notes.

## Preview and source controls

AIC keeps Markdown as the source of truth without duplicating it into tooltip editors. Clicking a
link label opens it; compact, always-visible Copy and Edit icon actions stay beside the label.
**Table** preview shows static values and opens one focused editor popover after activation;
it adds and reorders table rows through drag handles. **AIC field** preview uses the
typed row/part actions and explicit source Edit described above. Unsupported YAML
remains ordinary source. Dragging over
preview text keeps a stable native selection for copying and never steals the editor cursor.
`Ctrl+A`/`Cmd+A` selects the complete Markdown source and exits preview for the note; a CodeMirror
selection that crosses a structure reveals that source. A collapsed cursor keeps preview, while the
explicit Edit icon reveals and focuses one structure, including read-only inspection in a locked note.
Table columns size to their content and wrap only at word boundaries. The table fills its card and places only the grid
inside a horizontal scroller when its readable columns are wider than the editor. Its Copy icon
copies the exact Markdown table source. Action graphics are embedded SVG data URIs rendered as CSS
masks; button DOM stays text-free and accessible through `aria-label` values.

Non-Mermaid fenced code uses the same preview card as AIC Notes for VS Code. The language caption
and icon-only Copy/Edit actions are always visible; Copy returns the exact fenced body, Edit reveals
and focuses the Markdown source, and native selection inside the card remains stable for copying.
`Ctrl+A`/`Cmd+A` reveals the full source without changing it. Unknown languages remain readable and
copyable.

Mermaid previews keep Zoom out, Zoom in, Reset, and Rotate actions permanently visible. Rotate
turns the diagram clockwise by 90° per activation; Reset restores both 100% scale and the original
direction. The diagram viewport scrolls on both axes after zoom or rotation and can receive keyboard
focus without exposing the Mermaid source.

AIC details use this exact non-nested grammar:

```text
>>>|open| Title
Body
<<<
```

Omit `|open|` for a closed card: `>>> Title`. Click either the title or CSS chevron to toggle. In a
writable note the marker is persisted; in a locked note disclosure is visual only. A summary in the
form `- [ ] [Source](target)` also exposes a separate checkbox and compact link action. Delimiters
inside fenced code do not close a card, while invalid, nested, or unmatched blocks stay visible as
ordinary Markdown.

To author a task, type the raw marker `- [ ]` and then a trailing Space or task text. Raw Space is
ordinary source input and is never intercepted as a toggle; once the complete task syntax renders,
click its checkbox to change only that task marker.

## Use AIC for new notes

To make AIC the account-wide Markdown editor for new notes, open **Preferences → General → New
Note Defaults** and select **AIC**. Standard Notes owns this preference; the plugin does not change
it during installation.

You can also choose AIC as the default editor for one tag from that tag's options. This keeps, for
example, project notes in AIC without changing the editor used by the rest of the account.

The Standard Notes Clipper currently creates **Super** notes. To continue a clipped note in AIC,
open its note-type chooser, select **AIC**, review the conversion preview supplied by Standard
Notes, and confirm the conversion. The resulting note is ordinary Markdown and can still be opened
with Plain Text or another interchangeable Markdown editor.

## Development

Requirements: Node.js 20.19 or newer (or 22.12+) and npm.

```sh
npm install
npm run check
npm run dev
```

With the development server running, install `http://localhost:5178/ext.local.json` through
Standard Notes' custom-plugin field. The local manifest uses the same stable identifier as the
production plugin and registers `AIC (Local)` as an `editor-editor` component with the Code icon
and interchangeable Markdown file type. Do not keep production and local variants installed at
the same time.

Opening the page directly runs a standalone development document stored only in the browser's local
storage. Inside Standard Notes, the narrow `sn-extension-api` bridge owns working-note loading,
saving, lock state, environment detection, and theme activation. The full legacy account/runtime
stack pulled by EditorKit is deliberately not bundled into this editor.

The source of shared behavior is `src/core`; with the sibling `aic-notes` checkout present,
run `npm run core:sync` and then `npm run core:check` to distribute and compare every shared
JavaScript, CSS and declaration file. Do not change the vendor copy independently.

`npm run test:browser` runs synthetic navigation, identity, popup and diagram regressions against
a local Vite server. It requires Playwright and a local Chromium-family browser. Set
`AIC_REVIEW_URL` to your server (default `http://127.0.0.1:5189`), optionally
`AIC_REVIEW_PLAYWRIGHT` to the Playwright module path and `AIC_REVIEW_BROWSER` to the executable.
It never opens a real Standard Notes account or modifies workspace documents.

## Data contract

- The exact CodeMirror document is the only value sent to Standard Notes.
- Rendered tables, AIC field cards, checkboxes, syntax highlighting, and Mermaid SVG are never persisted.
- Switching to Plain Text exposes the same Markdown source.
- AIC stays read-only until Standard Notes supplies the first working-note payload.
- Saves attach a bounded plain-text preview derived from visible Markdown content, redact complete
  security blocks, and clear stale HTML previews; the stored body remains exact Markdown.
- Input stays in the shared draft core. Save note, Ctrl+S/Cmd+S, leaving the editing surface or
  switching notes request persistence. Security preview mutations save immediately. No timer
  saves on every input; failed saves remain dirty with Retry. Page/process termination is not
  an acknowledged save guarantee.
- Saves persist only the authored Markdown. Legacy YAML Properties and historical
  `file`, `created`, or `updated` fields remain accessible as raw text; AIC does not
  interpret, stamp, clean up, or migrate them automatically.
- The Standard Notes host adapter binds each in-memory draft to the working-note UUID and checks
  that UUID again at save time. Switching notes cannot redirect a draft into another note, and
  returning during the same editor session restores the correct dirty draft without storing its
  plaintext on disk.
- Save state has a colour indicator and readable feedback. A neutral surface means the current
  text is acknowledged; dirty drafts are amber, pending saves distinct, failures visible, and
  empty placeholders gray. A saved state is never inferred from sending a request.
- A null context makes the editor unavailable and read-only. Partial metadata preserves omitted
  fields only for the same UUID; a newly identified note without its text remains locked.
- Failed, unknown, timed-out or disposed saves do not mark drafts saved. An acknowledgement
  confirms the Standard Notes host's local save, not completion of cloud synchronization.
- Mermaid uses the bundled strict runtime and performs no render-time network request.

## Distribution

`npm run build` writes the static component to `dist/`, including the production and local
manifests. Pushes to `main` run the complete check and deploy only `dist/` to GitHub Pages. Tags in
the form `vX.Y.Z` run the same check, require an exact `package.json` version match, and publish a
release archive containing root release documentation and registries, `package.json`,
and `dist/`. The same release
also builds and attaches the experimental Chrome/Edge ZIP, its SHA-256 checksum,
and the [marketplace HOWTO](MARKETPLACE_HOWTO.md). No store submission is automatic.

The production manifest is canonical at
`https://ldzyha.github.io/standard-notes-aic/ext.json`. Its desktop archive is version-pinned, so a
release must update `package.json`, `public/ext.json`, and `public/ext.local.json` together before
tagging.

This project follows the AIC `R.F.B` release convention: successful release sequence,
release-local feature outcomes, and release-local fixed-bug outcomes. `40.0.1` is sequence 40 with
zero feature outcomes and one fixed-bug outcome; it is not a SemVer compatibility claim. See
[`CHANGELOG.md`](CHANGELOG.md).
