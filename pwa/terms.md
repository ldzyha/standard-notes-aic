# Terms and privacy

> **Public terms and privacy:** <https://aic.dzyha.com/terms>

[Українська](/terms/uk/) · [Open AIC Notes](/) · [Releases and installation](/releases)

This page describes AIC's data handling and the limits of local storage. The
software license shipped with each installed package governs its use; this page
does not add a separate contractual agreement. The VS Code host's source license
is available in [AIC Notes](https://github.com/ldzyha/aic-notes/blob/main/LICENSE).

## Your files and devices

AIC is a file editor and viewer. **New note** chooses a Markdown destination;
**Open files** and **Open folder** open existing notes. **Add files/folder** adds
to the current workspace. AIC provides no app-level encryption, passphrase setup,
Lock, encrypted export or legacy bundle import. Protection and synchronization
are owned by your storage provider, device or host application. Standard Notes
continues to handle its own storage and encryption.

On browsers with writable-file support, Save, Ctrl/Cmd+S and autosave write directly
to the selected originals. The browser cache is secondary. File handles and
relative display names are remembered locally; browsers do not expose absolute
operating-system paths. AIC checks observed external changes and stops when an
original is missing or access is denied. Failed drafts remain available for retry
or export; autosave never recreates a deleted file. AIC does not merge concurrent
edits or guarantee that another program cannot change a file during a save.

Browsers without native writes can edit browser drafts and download Markdown
copies. **Browser draft · download to save** does not claim that an original file
was updated. Browser storage may be cleared or evicted. Keep files you need in
your filesystem or chosen storage service; drafts are not guaranteed crash backups.

The explorer shows `.md` files case-insensitively, skipping `.git`, `node_modules`
and paths excluded by supported `.gitignore` or `.ignore` rules. Removing a
workspace disconnects it and removes its app cache; it does not delete original
or exported files. Existing unsupported stores and files are not automatically
deleted or converted.

Markdown files, browser drafts and exports are readable data. Secret-field syntax
masks values in the interface and supports explicit copying; masking does not
encrypt files. Export and copy include authored secret values. Other applications,
clipboard history and services receiving the files may read them. Folder export
refuses existing destinations; interrupted operations can leave new files behind.

AIC provides no server storage, account or synchronization service. You can place
files in Google Drive or another folder you manage. Its permissions, protection,
privacy policy and conflict handling belong to that service. AIC writes selected
files and does not connect to or manage your sync account.

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
