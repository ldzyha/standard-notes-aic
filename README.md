# AIC for Standard Notes

`AIC` is a Markdown editor component for Standard Notes. It keeps the note body as ordinary
Markdown and derives headings, lists, task checkboxes, tables, frontmatter properties, fenced-code
highlighting, and Mermaid diagrams in the editor.

## Install

In Standard Notes, open **Preferences → Plugins**, find **Install Custom Plugin**, and paste:

```text
https://ldzyha.github.io/standard-notes-aic/ext.json
```

This is an independent third-party plugin and is not reviewed by the Standard Notes team. Web and
mobile clients use the hosted GitHub Pages editor; desktop clients can use the versioned release
archive.

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
