# Terms and privacy

> **Public terms and privacy:** <https://aic.dzyha.com/terms>

[Українська](/terms/uk/) · [Open AIC Notes](/) · [Releases and installation](/releases)

This page describes AIC's data handling and the limits of local storage. The
software license shipped with each installed package governs its use; this page
does not add a separate contractual agreement. The VS Code host's source license
is available in [AIC Notes](https://github.com/ldzyha/aic-notes/blob/main/LICENSE).

## Your files and devices

AIC Notes edits one Markdown note file, which you open or create once. AIC
provides no app-level encryption, passphrase setup, Lock or encrypted export.
Protection and synchronization are owned by your storage provider, device or
host application. Standard Notes continues to handle its own storage and
encryption.

On browsers with writable-file support, Save, Ctrl/Cmd+S and autosave write
directly to the note file; a copy is also kept in browser storage. The file
handle and its name are remembered locally; browsers do not expose absolute
operating-system paths. AIC checks for external changes and stops when the file
is missing or access is denied. The draft remains available for retry or
download; autosave never recreates a deleted file. Text typed but not yet saved
is also kept in browser storage until it is saved or discarded. AIC does not merge
concurrent edits or guarantee that another program cannot change a file during
a save.

Other browsers keep the note in browser storage, with **Download note** and
**Replace from file…**. Browser storage may be cleared or evicted. Keep files
you need in your filesystem or chosen storage service. Workspaces of earlier
versions are not migrated or shown; nothing was deleted. Their files stay where
they were, and a workspace that lived only in the browser stays in its storage
until the site data is cleared.

Markdown files, browser drafts and exports are readable data. Secret-field syntax
masks values in the interface and supports explicit copying; masking does not
encrypt files. Export and copy include authored secret values. Other applications,
clipboard history and services receiving the files may read them.

AIC provides no server storage, account or synchronization service. You can place
files in Google Drive or another folder you manage. Its permissions, protection,
privacy policy and conflict handling belong to that service. AIC writes the note
file and does not connect to or manage your sync account.

## Offline use and connections

After its first successful online load and installation of the application cache,
the PWA interface and local files work offline. The first visit and application
updates need a connection to this website. Browser or operating-system services
may handle extension updates, clipboard synchronization or your chosen file sync
separately. AIC's offline storage does not control those services.

The website host receives ordinary requests for the application and documentation
assets, including the connection's IP address. AIC's application does not send
your notes to that host.

## Built-in AI

The **Grammar** and **Improve** actions use Chrome's on-device `LanguageModel`
Prompt API, as in the Core playground. The chosen note text is processed locally;
AIC has no cloud AI fallback, provider token or AI account connection. AI runs
only after you select an action. Review the proposed text before choosing
**Apply**; applied changes can be undone in the editor.

Chrome may download its model after your explicit AI action. This browser-managed
download needs a connection. Once the model is available, supported devices can
run AI offline. Availability depends on the browser API, device, storage and
supported language. Browsers without it still edit notes offline. AI suggestions
can change meaning or be incorrect; review them before saving or sharing.
[Chrome's Prompt API and requirements](https://developer.chrome.com/docs/ai/prompt-api).

## Chrome and Edge page-notes policy

The following policy covers the existing browser page-notes host, including its
permissions, plain Markdown files and Chrome Web Store Limited Use statement.
Its network restrictions apply to that host. Opening a public documentation or
source link uses ordinary browser navigation.

<!-- AIC_BROWSER_PRIVACY -->
