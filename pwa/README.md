# AIC Notes: Markdown files on your devices

[Українська](README.uk.md)

[Terms and privacy](https://aic.dzyha.com/terms) ·
[Releases and installation](https://aic.dzyha.com/releases) ·
[How to write documents](https://aic.dzyha.com/how-to)

AIC Notes is one note: one Markdown file split into pages by `---` lines. You
choose the file once; every launch opens the same file. There is no encryption
setup, password, Lock or encrypted export. File protection and synchronization
belong to your device and storage service.

## Choosing the note

The first launch shows **Choose your note file** with two actions:

- **Open note file** - opens an existing Markdown file.
- **Create new note** - creates a new file; the suggested name is `aic.md`.

**Note options** (the ⋯ button) holds **Download note**, **Open note file…**
(or **Replace from file…**, see below) and the help links.

## Editing and saving

Where the browser can write files (File System Access: Chrome, Edge and other
Chromium browsers on desktop), edits save directly to the note file. The header
shows **Saved to aic.md**, **Saving…**, **Unsaved** or **Save failed**.
Autosave, Ctrl/Cmd+S and editor Save share one owner. A save writes only when
the file still holds the text AIC last read or wrote:

- **The file changed elsewhere** - the save stops and keeps your draft. Use
  **Download note** to keep it, then **Reload note file** to open the file's
  text.
- **Access must be granted again** - the app shows the last copy stored in the
  browser, read-only, with one **Reconnect note file** button.
- **The file was moved or deleted** - it is never recreated. The app shows the
  choose screen again; a new file starts with the last saved text.

Other browsers (Firefox, Safari, and browsers on iOS and Android) keep the note
in the browser's own storage. The header shows **Saved in this browser**. Use
**Download note** to keep a copy as a file and **Replace from file…** to load a
file's text into the note. Browser storage can be cleared or evicted; downloaded
files are the copies you control.

Workspaces of earlier versions are no longer shown. Their files stay on disk and
their browser data is not deleted. Secret-field syntax masks values on screen;
it does not encrypt the Markdown file.

## Pages

A `---` line after a blank line splits the note into page cards;
`--- <path-or-url>` heads the card with that target. For a web URL, **Open
target** opens it in a new tab. A file path (written in full, for example
`--- /home/me/src/app.ts`) is shown as text only: a browser cannot open it.

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
