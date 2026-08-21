# AIC for Standard Notes

<p align="center">
  <img src="./public/aic-logo.svg" alt="AIC logo" width="96" height="96">
</p>

`AIC` is a Markdown editor component for Standard Notes. It keeps the note body as ordinary
Markdown and derives headings, lists, task checkboxes, tables, frontmatter properties, fenced-code
highlighting, AIC details cards, and Mermaid diagrams in the editor.

## Install

In Standard Notes, open **Preferences → Plugins**, find **Install Custom Plugin**, and paste:

```text
https://ldzyha.github.io/standard-notes-aic/ext.json
```

This is an independent third-party plugin and is not reviewed by the Standard Notes team. Web and
mobile clients use the hosted GitHub Pages editor; desktop clients can use the versioned release
archive.

After installation, choose **AIC** from a note's editor menu. Existing Markdown stays byte-for-byte
compatible with Plain Text and other interchangeable Markdown editors.

## Preview and source controls

AIC keeps Markdown as the source of truth. Four replacement previews—**Details**, **Mermaid**,
**Table**, and **Properties**—show a compact **Edit source** button. Clicking preview content does
not switch modes; links and detail controls remain independently actionable. **Edit source** reveals
the exact Markdown, including in a locked note where it is available for read-only inspection.

AIC details use this exact non-nested grammar:

```text
>>>|open| Title
Body
<<<
```

Omit `|open|` for a closed card: `>>> Title`. Click either the title or SVG chevron to toggle. In a
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
production plugin and registers `AIC (Local)` as an `editor-editor` component with the Markdown
note/file type. Do not keep production and local variants installed at the same time.

Opening the page directly runs a standalone development document stored only in the browser's local
storage. Inside Standard Notes, the narrow `sn-extension-api` bridge owns working-note loading,
saving, lock state, environment detection, and theme activation. The full legacy account/runtime
stack pulled by EditorKit is deliberately not bundled into this editor.

## Data contract

- The exact CodeMirror document is the only value sent to Standard Notes.
- Rendered tables, properties, checkboxes, syntax highlighting, and Mermaid SVG are never persisted.
- Switching to Plain Text exposes the same Markdown source.
- AIC stays read-only until Standard Notes supplies the first working-note payload.
- Saves attach a bounded plain-text preview derived from visible Markdown content; the stored note
  body remains exact Markdown.
- Mermaid uses the bundled strict runtime and performs no render-time network request.

## Distribution

`npm run build` writes the static component to `dist/`, including the production and local
manifests. Pushes to `main` run the complete check and deploy only `dist/` to GitHub Pages. Tags in
the form `vX.Y.Z` run the same check, require an exact `package.json` version match, and publish a
release archive containing root `package.json` plus `dist/`.

The production manifest is canonical at
`https://ldzyha.github.io/standard-notes-aic/ext.json`. Its desktop archive is version-pinned, so a
release must update `package.json`, `public/ext.json`, and `public/ext.local.json` together before
tagging.

This project follows the AIC `R.F.B` release convention: successful release sequence,
release-local feature outcomes, and release-local fixed-bug outcomes. `4.0.1` is sequence 4 with
no feature outcomes and one fixed-bug outcome; it is not a SemVer compatibility claim. See
[`CHANGELOG.md`](CHANGELOG.md).
