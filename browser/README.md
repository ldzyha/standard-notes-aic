# AIC notes for Chrome and Edge

[English](README.md) · [Українська](README.uk.md)

[Terms and privacy](https://aic.dzyha.com/terms) ·
[Releases and installation](https://aic.dzyha.com/releases) ·
[How to write documents](https://aic.dzyha.com/how-to)

AIC edits one local Markdown note file in a browser side panel and shows the
part of it that belongs to the page you are on. The PWA, browser extension
and VS Code use the same Markdown and fenced `aic` syntax. This page describes the prepared plain-file version;
package publication and store approval are verified separately.

## Open files and start writing

Choose **Open note file** or **Create note file** (suggested name `aic.md`)
through the browser's file picker. Notes are saved directly to that one file,
which is used unchanged. AIC reads and writes no other file and does not open
folders. The note file can be up to 512 KiB; a larger file is not opened or
saved and is never truncated.

A remembered location shows its name and one **Continue** button when access needs
renewal. The button becomes available once the saved file handle is ready; it
requests access to that same location without choosing it again. Use **More options**
to open a different note file. A folder remembered by an earlier version is not
reopened; open its `aic.md` instead.

The selected location and save status stay visible. Wait for the disk-save
confirmation before closing. If the file changed elsewhere, was deleted or lost
permission, AIC keeps the draft unsaved and offers recovery or retry; it does not
silently overwrite newer content or recreate a deleted file. Reconnect access
when the browser requests it.

An open panel retains its live file handle while the background worker restarts.
When editing permission expires, **Reconnect access** appears beside the file
location. It reuses the note file and retries pending saves without
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
choose the same note file again. Use your own filesystem, Git, Google Drive
or other sync software to move files between devices. AIC has no sync server.

There is no app password, encrypted workspace or `.aicnotes` importer. Existing
old files and unused legacy browser data are left untouched. Secret fields remain
masked in the editor, but Markdown files and local recovery copies contain plain
text. File encryption is managed by your device or filesystem.

## Notes and web pages

Inside the note file, a `---` line after a blank line starts a new page and
`--- https://example.com/docs` binds the following page to exactly that
address. The panel shows only the page bound to the active tab's address, as one
card. An address without a page shows an empty card; the page is added at the end
of the file when you start typing. Merely visiting a page writes nothing.
**Open target** on the card opens its address in a new tab.

Changing tabs changes the page shown; the file, Undo history and an unsaved draft
stay. A tab without an `http` or `https` address, such as a browser settings page,
shows the whole note as cards. A change made to the file elsewhere appears when
the panel gets focus or the tab changes, unless you have an unsaved draft; then
the save reports **File changed** and the draft is kept.

Earlier versions kept one Markdown file per page (`pages/`), Shared
(`shared/<id>.md`) and Global (`global.md`) files and a `.aic/links.json` index.
Those files are never deleted, moved or rewritten and are no longer read or
shown: they stay on disk as ordinary Markdown. There is no import into
`aic.md`; copy text from them yourself when needed. Recovery copies of drafts
from those versions stay under **Review recovered drafts** and are never applied
automatically.

## Editing and importing

- Use Preview or Markdown source, slash snippets, and shared block controls.
  The same source opens in the PWA and VS Code.
- Page or selection import reads content only after your click and site-access
  approval. It is added at the end of the shown page; it does not modify the website.
  Protected pages, forms, editable controls and inaccessible frames are excluded.
- **Insert from file…** adds another Markdown file at the end of the shown page.
  **Download page** downloads the shown page; **Download note file** downloads
  the whole note.
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
