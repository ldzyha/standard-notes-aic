# AIC Notes on your devices

[Українська](README.uk.md)

[Terms and privacy](https://aic.dzyha.com/terms) ·
[Release notes and installation](https://aic.dzyha.com/releases)

AIC Notes opens Markdown notes, files and project folders locally. **New note**
on the start screen immediately creates a local workspace and editable draft,
without a naming dialog or password. **Open files** and **Open folder** are direct
actions and always create a separate workspace. Explicit **New workspace** is in
**Workspace options**. To merge into the current workspace, use **Add files/folder**
there. The list shows `.md` files, including uppercase `.MD`; new imports skip
other file types and folders named `.git` or `node_modules`.

Folder opening shows scanning and reading progress. **Cancel opening** stops the
pending import and keeps your current notes. The file list initially shows up to
100 matching Markdown notes; **Show more** reveals the next group. Use **Search notes…** to filter filenames. Filtering and showing more keep the current
note and its unsaved changes open.

AIC checks selected file sizes and aggregate limits before reading contents.
Metadata and content reads each run at most four at a time; scanning and reading
yield periodically so the browser can respond. An individual directory or file
read has a 30-second timeout; the file picker waits for your selection or dismissal.
Cancellation discards the partial import. The browser may finish an underlying
file operation separately, but AIC ignores late results.

Local workspaces autosave through the existing save owner. **Saved**, **Saving…**, **Unsaved**, or **Save failed** with **Retry** reports the
current state. The status tooltip and accessible label give the full destination:
**Saved on this device** for local workspaces.
Ctrl/Cmd+S and leaving the editor also request a save.
Its notes, paths and labels remain readable after a browser restart. Opening a
folder imports a snapshot: editing or saving locally does not update the source
folder. Use **Export Markdown** for the selected file or **Export all notes** to
write readable files to disk. Put exported files in a folder synchronized by
Google Drive or another service you manage; AIC does not connect to that service.

**Save encrypted copy** makes a separate protected copy with a passphrase of at
least 12 characters. The original unencrypted workspace remains in local storage
until you confirm **Remove local workspace**. Removing it from the app does not
delete original files, exported files or the encrypted copy. Names are optional
display labels and never determine keys; spaces and Unicode in passphrases remain
exact. Separate encrypted entities can use different passphrases.

On a phone, **Browse notes** opens a modal Notes drawer containing the existing
list. Choosing a note closes the drawer; Escape or browser Back returns to the
same editor with text, selection and Undo history preserved. Search and menus
also preserve that editor. The header provides Browse notes, New note and More.
**New note** creates a unique editable draft immediately; select its title to
rename it, or use **More → Rename note**. **Change relative path** remains available
for an advanced folder path. More also contains **Export Markdown** and details.
**Workspace options** contains rename, additions, full export, protection and
**Close workspace** (or **Lock workspace** for protected data). **Remove from
this device…** is a separate confirmed action. App **Help** contains Terms,
Releases and How to. Built-in AI appears only when available and remains optional.

The same `.aicnotes` file opens in the PWA, Chrome/Edge file-notes view and the
VS Code encrypted-file editor. **Save encrypted file** selects the durable file
in your own sync folder; **Open encrypted file** opens it on another device with
its original passphrase. A connected save compares the encrypted contents with
the last read version and refuses an observed external change. Reopen after your
sync service changes it. AIC does not merge concurrent edits across devices.

Encrypted entities keep ciphertext in the browser cache and keys and unlocked
content in memory. A restart locks those entities; five minutes without interaction
locks saved encrypted entities. Unsaved encrypted drafts remain unlocked until
saved or closed. Local unencrypted workspaces do not auto-lock. Browser storage
can be cleared or evicted, so keep exported backups of either kind.

**Export encrypted** downloads a protected copy. **Export Markdown**,
**Export all notes** and **Restore folder** produce readable files. Desktop Chromium
browsers support writable files and folders after permission; other browsers use
file selection and downloads. Folder export refuses existing files. ZIP fallback
keeps paths. Markdown imports keep the hierarchy in each note's full path and
omit separate empty-folder records. Folder export reconstructs parent directories;
interrupted export can leave newly created files.

Existing `.aicnotes` bundles retain every file type as bytes; non-Markdown files
are hidden from the file list and remain included in folder export. Editable UTF-8
text is limited to 512 KiB. A Markdown import allows up to 2,000 selected `.md`
files; their parent directories do not consume that note quota. Existing bundles
retain a combined limit of 2,000 stored records, counting files and explicitly
recorded folders, including empty folders. Imports also allow 4 MiB per file and 6 MiB of total JSON
payload including base64 and metadata. A separate scan limit allows 10,000
inspected entries, including non-Markdown files and visited folders. Larger
imports are rejected before storage writes.

Folder export has a separate limit of 60,000 physical files and folders, including
reconstructed parents. ZIP fallback also has a 12 MiB archive-size limit. These
export limits do not reduce the Markdown import quota.

Chrome/Edge's page-notes library remains encrypted. Its existing encrypted
backups also open here: page notes can be edited, while domain, Global and history
records are preserved. Library export uses its existing backup format and
passphrase. File bundles use the same authenticated envelope with a versioned
file payload; the older page-library view cannot import them. Use **Open file
notes** in the updated extension for those files. The VS Code encrypted-file host
continues to require a passphrase.

Install the PWA through your browser. Its interface is cached for offline use.
**Install app update** saves the current draft before applying an update. The app
sends no notes, keys or passwords to a server.

Build with `npm run build:pwa`; serve `dist-pwa/` over HTTPS at `aic.dzyha.com`.
Serve `sw.js`, `index.html` and the manifest with revalidation, and hashed assets
with immutable caching. `pwa/_headers` provides headers for hosts that support
that convention. Configure equivalent headers on another host. Domain/DNS and
deployment credentials must be supplied by the domain owner; no deployment is
implied by a local build.

Extension update automation is described in [EXTENSION_UPDATES.md](EXTENSION_UPDATES.md).

## Document authoring

[How to create a document](https://aic.dzyha.com/how-to).

## Firebase Hosting deployment

The PWA and public documents use the separate `aic-dzyha-com` site in the
`dzyha-com` Firebase project. Build the app, then deploy only that site:

```sh
npm run build:pwa
firebase deploy --only hosting --project dzyha-com --config firebase.pwa.json --non-interactive
```

The build generates the complete offline precache inventory; `firebase.pwa.json`
selects only this Hosting site and supplies its response headers. The default
site address is [aic-dzyha-com.web.app](https://aic-dzyha-com.web.app/).

DNS for `aic.dzyha.com` is managed through Squarespace Domains. Add the records
returned by Firebase custom-domain setup, then wait for domain verification and
HTTPS provisioning. The default site address works independently while the
custom domain is being connected.

## Focused note scopes

**Current**, **Shared**, and **Global** show one note scope at a time. Switching
waits for the active draft to save; a failed save keeps that scope open. The
shared tab control supports arrow keys, Home/End and Enter/Space, and hides
inactive panels from focus and assistive technology. Switching scopes never
copies inherited text into the Current note.

In the browser, Current belongs to the exact URL, Shared to its origin, and
Global to the browser profile. In VS Code, Current stays anchored to the
original file, Shared opens its nearest existing folder note, and Global opens
the existing project note. Native TextDocument ownership and Undo remain in
VS Code; scope navigation reuses the owning editor. Missing sidecars are
disabled and selecting a tab never creates a file.

The PWA explores imported Markdown files as folders. For `app/src/page.md`,
Shared resolves `app/src.note.md` (or the nearest existing ancestor sidecar),
and Global resolves `app/app.note.md`. These paths follow the VS Code sidecar
convention. Loose files without an identifiable project folder have no Global
file scope. Workspace labels do not determine note identity or encryption.
Browser-library bundles use their existing URL, origin and Global records,
including orphan Shared records and Global without a page note. Scope editors
retain independent Undo until the selected context closes or changes.

PWA saves still update the local workspace or its explicitly connected encrypted
file. Importing a folder does not grant write-back or background synchronization;
export copies to your own sync folder when needed.
