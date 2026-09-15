# AIC page notes: local data handling

This describes the Chrome and Edge experimental component 0.3.0. See README.md and VERIFICATION.md for release status and testing boundaries.

AIC has no server, account, telemetry or synchronization. All runtime resources are bundled. Its extension content policy blocks outgoing connections and remote embedded resources. It reads page content only after you request an import; it does not edit, autofill or insert into source websites. Opening a source link is ordinary browser navigation.

Notes, shared site AIC documents, titles, URLs, dates and the navigation index are encrypted together in local extension storage. Shared values are displayed only for the same exact scheme, host and port, and are not copied into page Markdown. Your master passphrase is not persisted. The derived key remains only in trusted browser session memory after unlock; Lock, browser restart, extension reload or update removes it. There is no embedded key or disk fallback. Both local and session storage require explicit trusted-context access restrictions; local storage contains only encrypted data.

The panel maintains its bounded recent-pages list only while active and unlocked. It does not read the browser's history database or collect browsing in the background. Notes follow the active page in the panel's own window. Its ancestor chain contains only saved-note titles and source URLs for exact-origin path-segment ancestors; it does not expose ancestor Markdown or secret fields.

The manifest excludes Chrome Incognito and Edge InPrivate windows. AIC does not change browser privacy settings. Notes in normal windows persist locally until removed by the user or browser. Confirmed deletion removes the selected local note and its AIC recent-history entry while preserving other notes and exact-origin shared AIC data; restoration requires an earlier encrypted backup. Private browsing is not a way to clear notes.

Whole-library exports are encrypted and need the backup's original passphrase. Markdown exports and Copy intentionally produce plaintext, including secret values. Other software, clipboard history/synchronization and destination websites after you paste may access that plaintext. AIC network restrictions do not control those systems or the browser's normal update services.

Removing an extension removes its local data, but not downloaded backups. Keep an unpacked development installation at the same path and reload it instead of uninstalling it for updates. There is no server-side recovery. Keep backups and remember your passphrase. Failed or conflicting drafts remain in memory for retry/export, not crash-safe persistent storage.

## Permissions

- `storage`: encrypted local data and a session-only unlock key; no `storage.sync`.
- `tabs`: identify the active page in the panel's window and open/activate saved source URLs. No history-database permission.
- `sidePanel`: display the notes panel in Chrome and Edge.
- `activeTab` and `scripting`: deliberate, read-only page/selection capture.
- Optional HTTP(S) site access: requested for the selected origin on import, not granted to every site at installation. You can revoke site access in browser extension settings.
- `clipboardRead`: an explicit Paste action on an empty typed field reads the latest clipboard text after the user's click. General editor paste stays native; there is no top-level clipboard-import button, monitoring, history collection or background read.
- `clipboardWrite`: deliberate copy actions, including hidden field values.

Encryption does not protect an unlocked extension or a compromised device/browser. Plaintext exists in memory while editing. Visible webpage text, titles and URLs can contain confidential information; excluding form values is not universal secret detection. This build is not an independently audited password manager.
