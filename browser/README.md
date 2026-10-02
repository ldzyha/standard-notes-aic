# AIC notes for Chrome and Edge

[English](README.md) · [Українська](README.uk.md)

[Terms and privacy](https://aic.dzyha.com/terms) ·
[Releases and installation](https://aic.dzyha.com/releases) ·
[How to write documents](https://aic.dzyha.com/how-to)

AIC edits local Markdown files in a browser side panel. The PWA, browser extension
and VS Code use the same Markdown and fenced `aic` syntax. Browser notes can also
be linked to page URLs. This page describes the prepared plain-file version;
package publication and store approval are verified separately.

## Open files and start writing

Choose **Open file** or **Open folder** through the browser's file picker. Notes are
saved directly to those files. A folder opens a file tree; select a note to edit
it. **More options → New file** creates a blank document at a selected destination
or a named path inside the connected folder. Add Markdown or an AIC block when needed.

A remembered location shows its name and one **Continue** button when access needs
renewal. The button becomes available once the saved file handle is ready; it
requests access to that same location without choosing it again. Use **More options**
to open a different file or folder.

Folder scanning shows entries checked, notes ready and the current path; the total
is unknown, so progress has no percentage. **Use found notes** stops the scan and
keeps notes already read. Use **Scan again** after stopping, or **More options →
Refresh folder**, to rescan explicitly. Once connected, ordinary note loads,
tab changes and saves reuse the indexed files rather than scanning the folder again.

When a folder scan finds notes, the **Notes** tree opens automatically. Large
trees load child rows on expansion and show 100 rows per level at a time; **Show
more** reveals the next rows. Search covers all indexed notes, including those
outside the currently displayed rows.

The selected location and save status stay visible. Wait for the disk-save
confirmation before closing. If the file changed elsewhere, was deleted or lost
permission, AIC keeps the draft unsaved and offers recovery or retry; it does not
silently overwrite newer content or recreate a deleted file. Reconnect access
when the browser requests it.

An open panel retains its live file handle while the background worker restarts.
When editing permission expires, **Reconnect access** appears beside the file
location. It reuses the selected file or folder and retries pending saves without
replacing your draft. Read access alone is not a saved/write-ready state. A file
conflict is shown as **File changed**, not a permission problem.

If the browser does not show a permission prompt in the side panel, choose
**More options → Open AIC in tab**, then **Continue** there. This uses the same
selected files. Returning to the original panel checks access again and can resume
without another picker. Declining access keeps the draft unsaved.

The browser controls permission duration. Reconnect uses a normal permission
request; when Chrome offers **Allow on every visit**, that choice can reduce
future prompts. See [Chrome's permission guidance](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).

Files stay on disk when you remove the extension. Uninstalling does remove
browser-local recovery copies and remembered file access. After reinstalling,
choose the same file or folder again. Use your own filesystem, Git, Google Drive
or other sync software to move files between devices. AIC has no sync server.

There is no app password, encrypted workspace or `.aicnotes` importer. Existing
old files and unused legacy browser data are left untouched. Secret fields remain
masked in the editor, but Markdown files and local recovery copies contain plain
text. File encryption is managed by your device or filesystem.

## Notes and web pages

For a folder connection, **Link file to current page** associates the selected
file with the exact page URL. Choose **Follow active tab** to resume page-based
navigation after selecting files. Merely visiting a page does not create a note. A folder stores URL and scope associations in
`.aic/links.json`; the note content remains in Markdown files.

Current, Shared and Global focus one note at a time. Current is linked to an exact
URL, Shared to an exact origin, and Global to the selected folder. Switching
waits for pending saves and does not copy shared content into the current note.
All three tabs open the same Markdown editor directly: prose, lists, diagrams and
AIC blocks can be mixed freely. The visible path and **Download copy** action refer
to the active tab. Global stays selected when the browser page changes. Shared
follows the page context; after choosing an independent file, **Follow active tab**
restores that context.
The file tree remains the way to browse documents independently of the website.
A single-file connection edits just that file, without folder scopes or URL linking.

Pinning keeps a note selected while navigating. When typing in a pinned note,
related page links are ordinary Markdown and share the edit's Undo operation.
Switching pages alone does not add content. Pinning belongs to the open panel.

## Editing and importing

- Use Preview or Markdown source, slash snippets, and shared block controls.
  The same source opens in the PWA and VS Code.
- Page or selection import reads content only after your click and site-access
  approval. It appends to the chosen note; it does not modify the website.
  Protected pages, forms, editable controls and inaccessible frames are excluded.
- **Insert from file…** appends another Markdown file to Current. **Open file**
  changes the selected source; **Download copy** downloads the active note.
- Copy and Markdown export include the exact chosen content, including masked
  secrets. Clipboard history and destination applications are outside AIC's control.
- `|`, `*|`, `#|`, `_|`, `1|` and `0|` retain their ordinary, secret,
  authenticator, card and one-time-value syntax. Password generation remains local
  and only fills an empty editable field.
- **AIC guide** is bundled and works offline. The public How to page explains
  document writing and the shared DDK method.

Menus use SVG icons, keyboard focus and touch-sized controls. Code and Mermaid
previews use their content height so scrolling continues through the note.

## Recovery and updates

While editing, AIC requests a separate local draft checkpoint. Acknowledged
checkpoints can survive Reload or a browser restart; they do not mean the file
has been saved. The active checkpoint is cleared after the file save is confirmed.
Recovered drafts are reviewed explicitly and can be saved as copies. Recovery
never automatically replaces a file or restores a deleted note. If a checkpoint
fails, keep the panel open and save or export the draft before closing.

For an unpacked installation, keep the same extension directory and use Reload.
Removing the extension first clears its local recovery data. Saved disk files
remain unchanged. This version does not migrate older encrypted notes.

## Local build

```bash
npm run build:browser
```

The command creates `dist-browser/chromium/` and a versioned ZIP under
`dist-browser/artifacts/`. In `chrome://extensions` or `edge://extensions`, enable
Developer mode, choose **Load unpacked**, and select the folder containing
`manifest.json`. A GitHub ZIP or successful local build is not a store release.

The supported targets are desktop Google Chrome and Microsoft Edge. Incognito
and InPrivate are disabled. All runtime resources are bundled; there is no
account, telemetry, analytics or background website capture. See the bundled
[privacy policy](PRIVACY.md) and [verification record](VERIFICATION.md).
