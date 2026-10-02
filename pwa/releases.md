# Releases and installation

> **Public releases and installation:** <https://aic.dzyha.com/releases>

[Українська](/releases/uk/) · [Open AIC Notes](/) · [Terms and privacy](/terms)

AIC uses ordinary Markdown files in the PWA, browser extension and VS Code.
Choose your files once, edit them directly, and let your own sync service move
them between devices. There is no app password or encrypted workspace format.
Standard Notes uses the same editor syntax with its own storage and sync.

## Start here — prepared plain-file update

These instructions describe the new working version. Deployment, signed packages
and store availability must still be verified. Older release entries below
record their original behavior and may mention features removed from this version.

| Where to work             | What to open                                        | Where a save goes                                               |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| [AIC Notes PWA](/)        | A `.md` file or folder                              | The connected file on disk                                      |
| Chrome or Edge side panel | A `.md` file or folder; optionally link it to a URL | The connected file; links stay in `.aic/links.json` for folders |
| VS Code desktop or Web    | A Markdown file through **AIC Markdown**            | The workspace's filesystem provider, using native Save/Undo     |
| Standard Notes            | A note with the **AIC** editor                      | Standard Notes, under its own storage and sync settings         |

The same file syntax works across the three file-based hosts. Standard Notes
does not automatically open or synchronize that folder; transfer content there
explicitly. Old `.aicnotes` files are not opened or converted. Existing files
remain untouched by this removal.

### Open, create and save

1. In the PWA choose **Files** or **Folder**. In the browser panel choose
   **Open file** or **Open folder**. Grant access and select a note in the tree.
   Folder scanning shows Markdown and applies `node_modules`, `.git`, `.gitignore`
   and `.ignore` exclusions.
2. Use **New note** in the PWA or **More options → New file** in the browser panel. With direct
   write access, choose a destination or a name within the connected folder.
   A new file starts blank; opening an existing file keeps its text.
3. Write in Preview or Markdown source. **Save** or Ctrl/Cmd+S flushes a pending
   save. Wait for **Saved to file** in the PWA or **On disk** in the browser;
   **Unsaved**, **Saving…** or **Reconnect** does not confirm a completed write.
4. To renew permission use **Note options → Reconnect files** in the PWA or
   **More options → Reconnect access** in the browser. The visible source shows
   the filename and relative location; browsers do not expose its absolute OS path.
5. If another app changed the file, review its content or keep your draft as a
   separate copy: **Save a copy** in the PWA, **Download copy** in the
   browser. A deleted source is not recreated automatically.
6. Removing a workspace connection or uninstalling an app does not delete its
   original files. Uninstalling or clearing browser data can remove local recovery
   copies, so those copies do not replace saved files and backups.

Direct write-back needs a supported picker and writable provider. On a browser
with that support, an old cache-only copy stays read-only until **Save to file**
connects a destination. On a browser without direct writes, the PWA lets you edit
browser drafts and download Markdown copies. **Browser draft · download to save**
means the original was not updated: choose **Save a copy** or **Export Markdown**
to keep the text as a file.

In the browser extension, a folder scan shows entries checked, notes ready and
the current path, without guessing a percentage. **Use found notes** stops the
scan and keeps notes already read. **Scan again** or **More options → Refresh
folder** explicitly rescans; ordinary loads, tab changes and saves reuse the
connected folder's index. When notes are found, **Notes** opens automatically.
The tree expands lazily, 100 rows per level; **Show more** reveals more rows,
while search includes every indexed note.

### Keep one note in focus

For a remembered browser location, **Continue** restores access to the selected
files. Other locations and **New file** are in **More options**. If no permission
prompt appears in the side panel, use **More options → Open AIC in tab** and
continue there. The original panel checks access when you return.

**Current**, **Shared** and **Global** show one scope at a time. For files, Current
is the selected document, Shared is its nearest existing folder note, and Global
is its project note. For `project/src/page.md`, the sidecars are `project/src.note.md`
and `project/project.note.md`. A scope switch does not copy inherited content.

For browser URL associations, open a **folder**, select a file, then choose
**More options → Link file to current page**. Choose **Follow active tab** to resume
page-based navigation after browsing files. Current follows the exact URL, Shared
belongs to its exact origin, and Global belongs to the selected folder. A single
file connection opens only that file, without folder scopes or URL linking.
All three browser scopes edit ordinary Markdown and AIC blocks directly, without
an additional Edit/Done step. The source path and Download copy follow the active
scope; Global stays selected when you change browser pages.

A page visit by itself does not create a note. Links live in `.aic/links.json`;
content stays in `.md` files that other editors can read. Selecting a file from
the tree lets you work independently of the active website.

### Reuse project context with a coding agent

Keep existing answers, decisions and previews in auxiliary `.note.md` documents.
For `project/src/parser.ts`, inspect `project/project.note.md`,
`project/src.note.md` and `project/src/parser.note.md` in the project's declared
context order. Include sidecars in the agent's available semantic or text search;
check the current source before treating an old note or preview as implemented.
Owner notes remain read-only without an explicit request to change them.

The local AIC guide's **Instructions for coding agents** carries these rules.
VS Code also has **Copy Agent Instructions** and trusted-workspace **Enable AIC
Agent Workflow → Copy handoff**; **Sync Agent Instructions** refreshes the handoff
after an update. Send the text or path to the agent yourself. This does not add a
search service, auto-share notes or override project instructions.
See [agent context and path examples](/how-to#give-coding-agents-the-existing-context).

### Write, copy and reuse blocks

Use `/` to choose a document or block template. Keep only the parts the reader
needs: ordinary paragraphs, headings, ordered or bullet lists, tables, code,
Mermaid, details and AIC typed fields. The [How to guide](/how-to) links the current
[DDK writing method](https://ddk.dzyha.com/prompt.html) and a reusable AIC addendum.
DDK's structured JSON is a separate format, not a Markdown import.

An empty AIC secret field looks like this in Markdown source:

````markdown
```aic
## Account
Login | name@example.invalid
Password *|
```
````

Secret values stay masked in Preview. Use their copy button without revealing
them; source mode and copied text contain the actual value. Masking is display
behavior, not encryption. Copying an unused one-time value changes `1|` to `0|`
and saves that change. Password generation fills only empty editable fields.

In the PWA, **Fix grammar** or **Improve** offers optional on-device assistance.
Select prose, review the proposal, then choose **Apply** or **Cancel**. Undo reverses
an applied change. Code and secret fences stay out of the model input. The browser
may need an initial model download; ordinary editing does not depend on AI.

### Sync and work offline

Place the folder in Google Drive, OneDrive, Dropbox, Git or another location you
manage, then open that local folder in each app. AIC saves files; your chosen tool
transfers them. Wait for both file-save and sync completion before switching
devices. Concurrent changes must be reviewed rather than overwritten silently.

Open the PWA online once so its interface is cached. Install it from the browser's
app menu, or **Share → Add to Home Screen** where available. The cached interface
works offline with available files; external sync needs a connection. Updates wait
for safe draft handling. If saving fails, keep the app open and save a copy first.

### Install extensions and update

- **VS Code:** use the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
  or a verified VSIX from [GitHub releases](https://github.com/ldzyha/aic-notes/releases).
  Run **Extensions: Install from VSIX…** for a downloaded file. In code-server:
  `code-server --install-extension ./aic-notes-VERSION.vsix --force`.
- **Chrome/Edge:** use the available store release or extract the verified
  Chromium ZIP from [GitHub releases](https://github.com/ldzyha/standard-notes-aic/releases).
  In `chrome://extensions` or `edge://extensions`, enable Developer mode and
  **Load unpacked** from the folder containing `manifest.json`. For updates, replace
  files in that same directory and choose Reload after notes are saved.
- **Standard Notes:** in **Preferences → Plugins → Install Custom Plugin**, use
  `https://ldzyha.github.io/standard-notes-aic/ext.json`, then choose **AIC** as the
  note editor. Updates use the same manifest.

Store versions can lag behind source releases. For a downloaded ZIP or VSIX,
verify its neighboring `.sha256`: `sha256sum -c FILE.sha256` on Linux,
`shasum -a 256 FILE` on macOS, or `(Get-FileHash .\FILE -Algorithm SHA256).Hash`
in PowerShell. Build success, publication and installed behavior are separate checks.

The writing guidance was reviewed on October 2 against local Core revision
`c152359c05f572b701651baebca09a49594114bf`, its document guide, format rules and
templates, and the current public DDK guide. [The review record](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/VERIFICATION.md)
identifies the sources and differences. AIC reuses the writing method in Markdown;
this does not claim a merge of DDK's editor runtime or JSON format.

[Open notes](/) · [Document writing](/how-to) · [Data and permissions](/terms)

## Earlier releases

The entries below preserve their original release context. Use the guide above
for the prepared plain-file version.

## Prepared update: Standard Notes 51.0.1 / VS Code 60.0.2 / browser 0.11.3

Shared core 7.5.3 lets vertical scrolling over code previews continue through
the document. Code previews retain their full height and horizontal scrolling
for long lines across all editor hosts. VS Code also restores scrolling in long
linked notes by keeping their editor within the available sidebar height.

Publication of these versions is pending verification. After publication, use
[VSIX 60.0.2](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix)
and its [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix.sha256),
[Standard Notes 51.0.1](https://github.com/ldzyha/standard-notes-aic/releases/tag/v51.0.1),
and [Chromium 0.11.3 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip)
with [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip.sha256).
PWA deployment and store submission or approval are verified separately.
The October 2 store check confirmed Marketplace **59.0.2** public and Chrome
**0.9.3** public, with **0.11.1 pending review** and new Chrome uploads disabled.

## Available releases: Standard Notes 50.0.1 / VS Code 59.0.2 / browser 0.11.2

Shared core 7.5.2 centers Mermaid diagrams at their natural size within a full-width
canvas. Wider diagrams shrink to fit, long labels wrap, and height follows all
content without internal scrollbars. Copy and Edit remain; zoom controls are
removed. Mermaid loads only when needed. VS Code also refreshes diagram colors
when its theme changes, without reopening the note.

Download [59.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix)
and [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix.sha256),
[Standard Notes 50.0.1](https://github.com/ldzyha/standard-notes-aic/releases/tag/v50.0.1).
The PWA is deployed. GitHub packages are published and their SHA-256 checksums
are verified. [Chromium 0.11.2 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip)
and [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip.sha256)
are available for manual installation in Chrome or Edge.
The October 1 store check recorded Marketplace 58.1.1 public and Chrome 0.9.3
public, with Chrome 0.11.1 pending review and new uploads disabled. Store status
must be checked again for a later update.

## AIC Notes 58.1.1 — VS Code desktop and web

AIC Notes now includes a browser host for vscode.dev and github.dev alongside
its desktop host. Both use the same editor, files, linked notes and encrypted
`.aicnotes` format. Read-only repositories support viewing; saving requires a
writable filesystem provider. Confirmed saves also clear stale failure notices
after rapid Undo/Redo.

Download the [58.1.1 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v58.1.1/aic-notes-58.1.1.vsix)
and [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v58.1.1/aic-notes-58.1.1.vsix.sha256).
Run **Extensions: Install from VSIX…** in VS Code or vscode.dev, select the file,
and reload. Marketplace updates become available after store validation.

## Web update — October 1, 2026

Opening a large project no longer fails after 10,000 inspected entries: AIC scans
the selected tree in bounded batches, saves found notes before continuing from
the current position, and releases temporary buffers between batches. Canceling
or a later scan error keeps the notes already saved on this device.
The interface now uses compact editor-style headers, an explorer sidebar, neutral
light/dark surfaces and touch-sized controls on phones.

The **Update app** button now follows activation through to completion, including
updates already waiting when the app opens. It shows progress, offers a retry
if activation stalls, and preserves unsaved drafts before reloading. The separate
**Install AIC Notes** button stops offering a browser prompt after it is consumed.

Folder imports skip nested `node_modules` and `.git` directories, and honor
`.gitignore` and `.ignore` in the selected folder and its descendants. Excluded
paths are pruned before reading note content. The browser's fallback picker
may still enumerate the folder before AIC receives the selection.

Choose **Open folder** on the start screen to import Markdown notes. Install the
available app update first if that button or the new filtering is missing.

## PWA and portable files — 48.4.5 / browser 0.11.0

This release pairs the installable Notes PWA at [aic.dzyha.com](https://aic.dzyha.com/)
with [AIC for Standard Notes 48.4.5](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.5),
[AIC Notes 56.4.5](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.5),
experimental browser 0.11.0 and shared core 7.5.0.

- From the start screen, choose **New workspace**, then **New note**, or
  **Open notes** for files, a folder or an encrypted file. Changes autosave
  locally; **Save** or Ctrl/Cmd+S retries a pending or failed save. They never
  update the original folder or Drive.
- Opening a folder imports a snapshot. **Export Markdown** in the note menu and
  **Export all notes** in workspace options write readable files explicitly.
  **Save encrypted copy** makes a separate protected `.aicnotes` file.
- **Current**, **Shared** and **Global** identify the active file, its nearest
  parent note and its workspace/project note while retaining the initial current
  file as the return anchor.
- A confirmed deletion of an existing file rejects a later save instead of
  recreating that file. A deliberate new-note placeholder can still create one.
- Portable runtime files keep their verified byte hashes on Windows checkouts;
  Git line-ending conversion cannot change packaged runtime bytes.
- Protected `.aicnotes` files open in the PWA, Chrome/Edge file-notes view and
  VS Code. Their cache contains ciphertext; optional entity names do not determine
  keys. Existing non-Markdown bundle files remain intact and are included in
  folder export. Observed external changes block connected-file overwrites.
- The PWA caches its interface for offline use. Publisher workflows verify the
  exact extension package and checksum before submitting it; store approval and
  account configuration remain separate steps.
- **Grammar** and **Improve** use Chrome's on-device AI, as in the Core
  playground. Suggestions are reviewed before **Apply**, and applied edits can
  be undone.

### Install the PWA and use it offline

1. Open [AIC Notes](/) online over HTTPS. Allow the initial interface to finish
   loading so its offline cache can install.
2. In Chrome or Edge, use **Install app** in the browser menu or address bar. On
   iPhone or iPad, use Safari's **Share → Add to Home Screen**. Installation labels
   can vary by browser.
3. From the start screen, choose **New workspace**, then **New note**, or choose
   **Open notes** for files, a folder or an encrypted file. Changes autosave
   locally; **Save** or Ctrl/Cmd+S retries a pending or failed save. Local saves
   do not update the original folder or Drive.
4. Use **Export Markdown** from the note menu or **Export all notes** from
   workspace options for readable files. Use **Save encrypted copy** for a
   protected `.aicnotes` file in your own sync folder.
5. Reopen the installed app without a connection to edit local notes. Your
   separate file-sync service needs a connection when transferring exported files.

When **Update app** appears, AIC saves the current draft before applying
the update. **Updating…** disappears after the new version opens. If saving fails,
keep the app open and retry the save. Keep exported backups: browser data can be cleared or evicted.
Writable file and folder pickers are available in supported desktop browsers;
other browsers use file selection and downloads. See [data handling and
limits](/terms).

### Use built-in AI offline

Open a text note and choose **Grammar** or **Improve**. Chrome may first need
to download its on-device model; that browser-managed step needs a connection
and compatible hardware. When the model is ready, AI can work offline. Review
the suggestion and choose **Apply** to change the note; use Undo to revert it.
AIC does not send the note to a remote AI service. AI availability depends on the
browser API, device and supported language; ordinary editing remains available
offline in other browsers. See [Chrome's current Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api).

## Coordinated source release — 48.4.5 / 56.4.5 — October 1, 2026

This release pairs [AIC Notes for VS Code 56.4.5](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.5),
[AIC for Standard Notes 48.4.5](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.5)
and experimental Chrome/Edge 0.11.0 on core 7.5.0.

- Focused **Current**, **Shared** and **Global** tabs follow file, parent-note
  and workspace/project-note relationships without changing the current-file
  anchor, save owner or native Undo.
- Folder browsing, the searchable Notes list and compact phone header make
  local note navigation practical on small screens.
- Local **Grammar** and **Improve** remain optional Chrome capabilities; their
  reviewed edits use normal editor Undo.
- A deletion guard prevents a late save from recreating a confirmed-deleted
  existing file, while intentional new placeholders still create files.
- Portable runtime files preserve their verified bytes on Windows checkouts.

### VS Code and code-server

Use [AIC Notes 56.4.5 on GitHub](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.5)
for its VSIX and neighboring `.sha256` file. The
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
is a separate channel; check its displayed version.

For a downloaded VSIX, run **Extensions: Install from VSIX…** in the Command
Palette, choose the file and reload the window. In code-server, use
`code-server --install-extension ./aic-notes-VERSION.vsix --force` with the
downloaded filename. code-server's Open VSX distribution is separate.

Marketplace installations follow VS Code's automatic-update settings. A VSIX
installation can enable **Auto Update** for AIC Notes to receive Marketplace
updates.

### Standard Notes

Open **Preferences → Plugins → Install Custom Plugin** and paste:

```text
https://ldzyha.github.io/standard-notes-aic/ext.json
```

Select **AIC** in the note editor menu. Existing installations check the same
manifest for updates; restart Standard Notes if a previous version remains
visible. Downloadable ZIPs and checksums are on the
[AIC 48.4.5 release page](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.5).

### Chrome and Microsoft Edge — experimental

1. Download the `aic-browser-chromium-0.11.0.zip` and neighboring `.sha256` file
   from the [AIC 48.4.5 release page](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.5).
2. Extract the ZIP into a permanent folder with `manifest.json` at its root.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   select **Load unpacked**, and choose the folder. Pin AIC and select its icon.

Wait for **Note saved** and export an encrypted backup before updating. Replace
the files in the same folder and select **Reload** on the existing extension
card. Removing the extension can delete its local notes. Store installations
receive browser-managed updates after approval; unpacked installations require
Reload. Chrome Web Store and Microsoft Edge Add-ons are separate store channels.
The experimental page-notes package still requires
[Chrome/Edge runtime verification](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/VERIFICATION.md).

### Check a downloaded package

Each release archive or VSIX has a neighboring `.sha256` file. In the download
directory, run `sha256sum -c FILE.sha256` on Linux; on macOS, compare
`shasum -a 256 FILE` with the file's value. In Windows PowerShell, use
`(Get-FileHash .\FILE -Algorithm SHA256).Hash`.

## Full release history

The maintained bilingual changelogs preserve earlier changes:

- [AIC editor and browser — English](https://github.com/ldzyha/standard-notes-aic/blob/main/CHANGELOG.md)
  · [Українська](https://github.com/ldzyha/standard-notes-aic/blob/main/CHANGELOG.uk.md)
- [AIC Notes for VS Code — English](https://github.com/ldzyha/aic-notes/blob/main/CHANGELOG.md)
  · [Українська](https://github.com/ldzyha/aic-notes/blob/main/CHANGELOG.uk.md)

<!-- AIC_CHANGELOG -->
