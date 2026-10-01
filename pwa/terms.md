# Terms and privacy

[Українська](/terms/uk/) · [Open AIC Notes](/) · [Releases and installation](/releases)

This page describes AIC's data handling and the limits of local storage. The
software license shipped with each installed package governs its use; this page
does not add a separate contractual agreement. The VS Code host's source license
is available in [AIC Notes](https://github.com/ldzyha/aic-notes/blob/main/LICENSE).

## Your files and devices

From the start screen, **New workspace**, **Open files** and **Open folder** create
a local Markdown workspace without a password. Inside an open workspace, **Open
files** and **Open folder** add files using its current local or encrypted storage
mode. **Save** or Ctrl/Cmd+S stores a local workspace's notes, paths and labels as
**unencrypted data on this device**. Local
workspaces remain readable after restarting and do not auto-lock. Browser storage
can be cleared or evicted; keep exported copies of important work.

The file list shows `.md` files, case-insensitively. New file and folder imports
include only those files and skip `.git` and `node_modules` folders. Opening a
folder imports a snapshot; editing and saving locally do not write changes back
to the original folder. Use **Save plaintext copy** or **Export folder** to write
readable files explicitly. Existing encrypted bundles retain other file types as
bytes even when the Markdown list hides them; folder export includes those
retained files.

**Encrypt workspace** creates a separate passphrase-protected copy. The original
unencrypted workspace remains in device storage until you remove it with
**Remove local workspace**. That action removes only the app's local copy; it
does not delete original files, exported files or the encrypted copy. Creating
an encrypted copy does not encrypt or erase an earlier plaintext copy.

The PWA, Chrome/Edge file-notes editor and VS Code encrypted-file editor open the
same `.aicnotes` files. Each encrypted entity has its own passphrase and can hold
notes, individual files or project folders. Optional names never determine a key;
local workspace labels are unencrypted, and encrypted entity labels are inside
the protected payload. Chrome/Edge's page-notes library and the VS Code encrypted
file host still require their encryption passphrase.

Protected files use the existing AIC envelope on the device: PBKDF2-HMAC-SHA256
with 600,000 iterations and a random salt, followed by authenticated AES-256-GCM.
Passphrases are not saved. Unlocked content and keys exist in memory; locking or
restarting ends the encrypted entity's unlocked session. Saved encrypted entities
lock after five minutes without interaction; unsaved encrypted drafts remain
unlocked until saved or closed. Encryption cannot protect a compromised device
or an already unlocked editor. AIC is not an independently audited password manager.

For an encrypted entity, the selected `.aicnotes` file is the durable copy and
the browser cache contains ciphertext. AIC checks for observed external changes
before saving that connected file. It does not merge concurrent edits or guarantee
that an external writer cannot change the file during a save. Reopen a file after
your sync service updates it. Failed or conflicting changes remain in memory for
retry or export; they are not crash-safe backups. Closing can discard unsaved changes.

AIC provides no server storage, account recovery or synchronization service. You
can synchronize exported Markdown files or `.aicnotes` files through Google Drive
or another service you manage. A locally saved browser workspace is not a synced
folder. The service has its own privacy policy and conflict handling; AIC does
not authorize or control its access. Keep encrypted backups and their passphrases:
the developer cannot recover a forgotten passphrase.

**Save plaintext copy**, **Export folder**, **Restore folder**, Markdown exports
and copy actions deliberately produce readable data, including secret values.
Destination apps, clipboard history or synchronization, and services receiving
files you share may access it. Folder export/restoration refuses observed existing
files, but an interrupted operation can leave new files behind.

## Offline use and connections

After its first successful online load and installation of the application cache,
the PWA interface and local files work offline. The first visit and application
updates need a connection to this website. Browser or operating-system services
may handle extension updates, clipboard synchronization or your chosen file sync
separately. AIC's offline storage does not control those services.

The website host receives ordinary requests for the application and documentation
assets, including the connection's IP address. AIC's application does not send
your notes, passphrases or encryption keys to that host.

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
permissions, encrypted page library and Chrome Web Store Limited Use statement.
Its network restrictions apply to that host. Opening a public documentation or
source link uses ordinary browser navigation.

<!-- AIC_BROWSER_PRIVACY -->
