# AIC Notes: Markdown files on your devices

[Українська](README.uk.md)

[Terms and privacy](https://aic.dzyha.com/terms) ·
[Releases and installation](https://aic.dzyha.com/releases) ·
[How to write documents](https://aic.dzyha.com/how-to)

AIC is an editor and viewer for your files. **New note** creates a blank `.md`
file at a chosen destination. **Open files** and **Open folder** open existing
Markdown in separate workspaces; **Add files/folder** adds to the current one.
There is no encryption setup, password, Lock, encrypted export or legacy bundle
import. File protection and synchronization belong to your device and storage
service. Standard Notes continues to own its own storage and encryption.

## Editing and saving

On browsers with writable-file support, edits save directly to the selected
original files. The location strip shows the relative path and **Saved to file**,
**Saving…**, **Unsaved**, or the failed operation. Autosave, Ctrl/Cmd+S and editor
Save share one owner. Acknowledgement follows the file commit; a secondary browser
cache failure does not undo that commit.

Handles are remembered locally outside file content. Reopening reads originals
again and may need renewed browser permission. Observed external changes, missing
files and denied access stop the save while preserving the draft. Autosave never
recreates a deleted original. **Save a copy** chooses another destination and
leaves the old file untouched; rename original files in your filesystem.

Browsers without writable-file support edit browser drafts and download Markdown
copies. The status says **Browser draft · download to save**, never **Saved to
file**. Choose **Save a copy** or **Export Markdown** to download the current
text. Browser storage can be cleared or evicted; downloaded files are the copies
you control. Existing cache-only workspaces on writable-file browsers remain
readable until **Save to file** chooses a destination.

**Remove from this device…** disconnects the workspace and removes its app cache,
not original files. Closing a workspace keeps its remembered entry. Existing
unsupported data stores and files are not automatically deleted or converted.
Secret-field syntax still masks values on screen and supports explicit copying;
it does not encrypt the Markdown file.

## Folders and navigation

The explorer shows `.md` files case-insensitively. Native scanning skips `.git`
and `node_modules` and applies `.gitignore` and `.ignore` within each selected
folder; `.ignore` wins in the same directory. A negation cannot revive an excluded
parent. The chosen root stays eligible; global Git configuration is not read.
Fallback folder pickers enumerate before the app can filter their results.

Scanning continues in batches of at most 1,000 inspected entries or 64 notes,
with progress, cooperative yielding and **Cancel opening**. Committed batches
remain available when scanning stops. The cursor lives for that opening operation
and does not resume after the app closes. At most four metadata/content reads
run together; each read has a 30-second timeout.

Only retained notes count toward the 2,000-file import limit. Files are limited to
4 MiB each and the cached JSON workspace to 6 MiB; editable UTF-8 text is limited
to 512 KiB. The initial list shows 100 matching notes; **Show more** and **Search
notes…** preserve the editor and its draft. Ignore files are limited to 64 KiB
each, 1 MiB total, 256 applicable files and 10,000 lines. Unreadable rules stop
that folder instead of silently importing excluded data.

On mobile, **Browse notes** opens a drawer. Selecting a note, Escape or browser
Back returns to the editor without replacing its selection or Undo history.
Compact SVG actions and the shared scope tabs leave room for content.

**Current**, **Shared** and **Global** each show one existing file. For
`app/src/page.md`, Shared resolves the nearest existing `app/src.note.md` ancestor
sidecar, and Global resolves `app/app.note.md`. Loose files have no project Global.
Switching waits for saving; a failure keeps the current editor open. Missing
sidecars stay disabled and selecting a tab never creates them.

**Export all notes** writes a selected folder or downloads a ZIP preserving paths.
Folder export refuses existing destination files. An interrupted export may leave
newly written files. Export has a separate 60,000-file/folder physical limit;
ZIP fallback has a 12 MiB archive limit.

## Offline use and updates

The interface works offline after its first successful load and cache installation.
**Update app** appears when a downloaded update is ready, saves the current draft
and reloads. Failed saves or new edits keep the draft open. **Install AIC Notes**
is the separate browser install action. Built-in on-device AI is optional; normal
editing works without it. AIC sends no notes to a server and performs no file sync.
Place your files in a Google Drive or other folder you manage when you want sync.

Build with `npm run build:pwa` and serve `dist-pwa/` over HTTPS at `aic.dzyha.com`.
Serve `sw.js`, `index.html` and the manifest with revalidation, and hashed assets
with immutable caching. `pwa/_headers` and `firebase.pwa.json` document this setup.
The latter targets the separate `aic-dzyha-com` Firebase Hosting site:

```sh
npm run build:pwa
firebase deploy --only hosting --project dzyha-com --config firebase.pwa.json --non-interactive
```

A local build does not deploy. DNS belongs to Squarespace Domains and the site's
Firebase custom-domain configuration. Extension update automation is documented
in [EXTENSION_UPDATES.md](EXTENSION_UPDATES.md).
