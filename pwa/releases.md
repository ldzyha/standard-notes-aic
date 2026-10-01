# Releases and installation

[Українська](/releases/uk/) · [Open AIC Notes](/) · [Terms and privacy](/terms)

Use the PWA for local Markdown workspaces with optional encryption, the browser
extension for encrypted page notes, or AIC Notes in VS Code. Protected file
editors share the same `.aicnotes` data; synchronize exported files through a
service you manage.

## PWA and portable files — 48.4.4 / browser 0.11.0

This release pairs the installable Notes PWA at [aic.dzyha.com](https://aic.dzyha.com/)
with [AIC for Standard Notes 48.4.4](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.4),
[AIC Notes 56.4.4](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.4),
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

When **Install app update** appears, AIC saves the current draft before applying
the update. Keep exported backups: browser data can be cleared or evicted.
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

## Coordinated source release — 48.4.4 / 56.4.4 — October 1, 2026

This release pairs [AIC Notes for VS Code 56.4.4](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.4),
[AIC for Standard Notes 48.4.4](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.4)
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

### VS Code and code-server

Use [AIC Notes 56.4.4 on GitHub](https://github.com/ldzyha/aic-notes/releases/tag/v56.4.4)
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
[AIC 48.4.4 release page](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.4).

### Chrome and Microsoft Edge — experimental

1. Download the `aic-browser-chromium-0.11.0.zip` and neighboring `.sha256` file
   from the [AIC 48.4.4 release page](https://github.com/ldzyha/standard-notes-aic/releases/tag/v48.4.4).
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
