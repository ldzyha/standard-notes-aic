# AIC page notes — experimental Chrome / Edge component

Status: **0.1.4 experimental component**, packaged alongside the AIC 33.2.4 GitHub release. It is not a browser-store release or an independently audited password manager. Use synthetic data until the packaged-runtime gates in VERIFICATION.md are resolved. The shared editor fixes also ship in AIC Notes 42.0.3.

## Supported design

Supported browser targets are desktop **Google Chrome and Microsoft Edge only**, using Chromium 140 or newer. Both use one Manifest V3 package, one side-panel adapter and the **same canonical AIC editor**, without forks of Properties, Security or Mermaid behavior. Build and release gates cover these two browsers only.

- Create a note for the exact active URL, or explicitly import visible page content, a selection, or a Markdown file. Imports append; they never edit the website or replace an existing note.
- Use the shared Preview / Markdown switch, slash snippets and block controls. Copy a note, selected block or individual value, then paste manually. No autofill, destination-field tracking or insertion into websites.
- The panel follows its own browser window. It only shows the active URL's note; otherwise it shows domain/path navigation and recent pages. Navigation opens or activates the source page. URL paths are not a claim about a site's real content hierarchy.
- Notes persist locally across restarts. There is one note per exact URL, including query and fragment. AIC records at most 100 recent URLs while its panel is active and unlocked; it never queries browser history.
- No account, server, telemetry or synchronization. Whole-library transfer uses encrypted backups; Markdown import/export and clipboard transfer are deliberate plaintext actions.

## Compact panel and importing content

- A page without a note opens an editable **Properties placeholder** immediately. Merely opening it, moving focus or leaving does not create a note. The first edit creates the encrypted local note without resetting the editor, selection or undo history.
- **Add content** in the header offers **Import page**, **Import selection**, **Paste from clipboard**, and **Import Markdown**. An untouched placeholder is replaced by the exact imported Markdown; imports otherwise append and save. They never replace authored note text or write to the website. Failed saves remain editable/exportable drafts.
- Properties and Security field menus stay inside the visible editor, choose space above or below the button, and scroll internally when space is limited.
- The writing cursor uses the active text color and a 2 px stroke in both preview and source mode. It follows focus and light/dark theme changes; reduced-motion mode disables blinking.
- Pipe-style Properties/Security fields use one compact row: label, masked/visible value and description, without visible technical subheaders. Parts keep separate copy actions and accessible hints; overflow stays inside the row.
- For **Import selection**, select readable text on the source page first. Page/selection import requests access to that site only after your click. Browser-protected pages, forms, editable controls, hidden content and inaccessible frames are not imported. If a site prevents capture, copy its text yourself and use **Paste from clipboard**.
- **Paste from clipboard** reads the latest text only after an explicit click. Empty/denied clipboard access and save failures show an actionable message. Clipboard history is not read. A tab switch or Lock cancels a pending import into the old context without blocking imports in the new tab.
- **Notes and history** opens navigation without rebuilding the editor. **More options** contains note copying, plaintext Markdown export, and encrypted backup import/export. The plaintext warning appears beside the relevant menu actions, not above every note.
- Navigation shows page titles under their domain. It omits single-page path ladders and shows a common path only where it groups several pages. Full URLs remain available on hover; duplicate titles get a short distinguishing path.
- The shared editor keeps Save and Preview/Markdown controls visible; **Formatting** reveals the existing formatting tools on demand. Menus, navigation and formatting disclosure preserve the editor and its selection. Escape closes a panel menu and returns focus to its trigger.
- Save failures remain visible until dismissed; routine confirmations disappear after five seconds. Notifications float above the lower edge rather than pushing the editor down.

## Shared site properties

- **Edit shared properties** above the page note opens one site-level Properties document. Store a username, masked password or other common fields there once; every page at that same origin shows its readonly preview and individual copy actions. Editing it does not replace the page editor or its draft.
- Merely visiting a page or opening the shared editor creates no Properties record. The first valid edit creates the record in the encrypted library. Shared fields do not inherit from, override or get copied into page fields; existing homepage notes stay unchanged.
- The boundary is the exact **scheme + host + port**: HTTPS and HTTP, different subdomains and non-default ports have separate shared records. A URL path never widens that boundary.
- Page Markdown copying/export includes the page only. The encrypted library backup includes shared Properties once. There is no autofill, cross-site sharing or network synchronization.
- Save failures and conflicts retain the local draft for retry or explicit plaintext export. Invalid unfinished Properties remain in the shared editor, never in a child page's readonly preview.

## Encryption and limits

Before the first note, choose a unique master passphrase of at least 12 Unicode characters, at most 1,024 UTF-8 bytes. Spaces and Unicode normalization are preserved exactly. Length alone does not guarantee strength. **There is no recovery without the passphrase.**

Native WebCrypto derives an AES-256-GCM key using PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 32-byte salt. Every write uses a fresh random 96-bit IV and a 128-bit authentication tag. The complete library—Markdown, titles, URLs, dates and navigation index—is encrypted before persistent writes. The bounded, versioned envelope authenticates its parameters and rejects tampering.

The passphrase is never persisted or embedded in code. The derived key stays in trusted, memory-only `storage.session`, allowing background-worker suspension without another unlock. Lock, browser restart, extension reload or update ends that session. Both local and session storage access are explicitly restricted to trusted extension contexts. Local storage contains **ciphertext only**, never a key. Missing session storage or failed access restrictions fail closed; there is no disk fallback.

Limits: 500 notes, 500 shared-origin records, 512 KiB UTF-8 per document, 6 MiB UTF-8 for the decrypted library, 100 recent URLs, 8 KiB per URL. Shared Properties additionally follow the canonical Properties parser's field and text limits. Backups merge new URLs and origins without overwriting existing records. Simultaneous first imports into one URL append atomically. Conflicting ordinary edits retain the losing panel's draft for export instead of overwriting the other revision.

The decrypted library format is now version 2; the encryption envelope is unchanged. Version 1 notes/history migrate without changing their Markdown and without creating shared records. Existing encrypted backups remain importable. Older extension builds cannot read the new version after a persistent write: retain a pre-update encrypted backup if you may need to downgrade.

Encryption protects stored data from simple file inspection, not an unlocked extension, compromised device/browser, or clipboard history/synchronization. Plaintext exists in the editor and undo history while unlocked. JavaScript cannot guarantee forensic erasure of every memory copy. Masking a field is a display feature, not encryption.

## Saving and locking

Typing autosaves after a short pause. Save, Ctrl+S, shared-editor blur and block actions also request saving. Only a successful background storage acknowledgment marks the note saved; acknowledgments do not rebuild the editor or reset its cursor.

Failed writes, conflicts and failed first imports keep an in-memory draft with retry/export actions. Wait for **Note saved** before closing the browser. Uncommitted drafts are not crash-safe storage.

Hidden panels pause page tracking and discard late context replies. Showing the panel reloads the current page's context. Draft content survives a retained panel's hide/show cycle, but the recreated editor does not retain its cursor or undo stack.

Lock clears editor/undo state, navigation, filters, import buffers and pending responses in every panel. The initiating panel offers export/discard when its own save fails. Save work in other panels first: global lock prioritizes clearing plaintext and cannot recover another panel's uncommitted draft. Downloaded files and the OS clipboard are not erased by Lock.

## Private windows

Chrome Incognito and Edge InPrivate are not supported in this build. The manifest disables private-window installation/use. Do not change browser privacy settings to work around that restriction. Use AIC in a normal browser window; its encrypted local notes persist across restarts.

## Build and local testing

To test a GitHub release without building, download `aic-browser-chromium-0.1.4.zip`
and its `.sha256` from [AIC Releases](https://github.com/ldzyha/standard-notes-aic/releases),
verify the checksum, and extract into a permanent folder. Use that folder for
**Load unpacked** below. The ZIP is not a Chrome/Edge store installation package.

Run `npm run build:browser` from the canonical repository. No additional runtime dependencies or external services are needed. It produces one unpacked directory, `dist-browser/chromium/`, and one archive, `dist-browser/artifacts/aic-browser-chromium-0.1.4.zip`, for both Chrome and Edge. Other browser build modes are rejected.

The archive uses deterministic ordering and timestamps and includes the `>_` icon, worker, editor assets and privacy notices. Previously generated development files are not current targets; the build does not delete older archives or browser profiles. The command never installs into a user's profile or submits to a store.

For local testing, open `chrome://extensions` in Chrome or `edge://extensions` in Edge, enable **Developer mode**, choose **Load unpacked**, and select `dist-browser/chromium/` (the folder containing `manifest.json`, not the ZIP). Pin AIC and click its toolbar icon to open the side panel. The same directory works in both browsers; their notes remain separate unless you explicitly transfer them. See the official [Chrome instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) and [Edge instructions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

Before an update, wait for **Note saved**, export an encrypted backup from **More options**, and retain its passphrase. Keep the unpacked extension at the same path and use **Reload** on its existing extension card after rebuilding. Do not uninstall a populated extension to update it. Unpacked developer installation does not establish store-distributed update behavior.

## Ownership

- `library.ts`: versioned schemas, quotas, revisions, note/history and shared-origin records; `navigation.ts`: compact display projection without changing stored URLs.
- `vault-crypto.ts` / `vault-store.ts`: cryptography and serialized encrypted persistence/backup lifecycle.
- `service.ts` / `worker.ts`: sole storage writer, active-page checks, capture/navigation authorization and sender isolation.
- `api.ts` / `platform.ts`: one narrow Chromium adapter for Chrome and Edge; no shared-editor duplication.
- `capture-page.ts` / `import-page.ts`: bounded read-only DOM capture and inert Markdown conversion. Forms, editable controls, hidden content and inaccessible frames are excluded. Visible text and URLs can contain confidential information; this is not a secret scanner or OCR tool.
- `draft-coordinator.ts`: common acknowledged-save, conflict and recovery lifecycle; `drafts.ts` / `domain-drafts.ts`: page and origin adapters.
- `panel.ts` / `domain-properties.ts`: own-window context, lock cleanup, recovery and readonly/editable shared Properties using the canonical editor.

All runtime assets are bundled. Extension CSP denies outgoing connections and remote embeds. Following a link is ordinary browser navigation, not synchronization. These restrictions do not control browser updates, other extensions or OS clipboard services.

## Remaining release gates

1. **Verify the package in Chrome and Edge.** Prerequisite: Chromium build and isolated synthetic profiles. Check startup, own-window sidebar context, private-window exclusion, capture permissions, save/reopen, session/restart, encrypted disk state, lock and network denial. Record each browser's versions and limitations in VERIFICATION.md.
2. **Resolve runtime findings and rebuild.** Prerequisite: evidence from step 1. Every required fix needs a regression check; rerun type/lint/unit/visual checks and inspect final package contents.
3. **Arrange store distribution.** Prerequisite: working package plus publisher account/credentials. Chrome Web Store and Microsoft Edge Add-ons are separate publication actions. No store approval or end-user installation is implied by a development ZIP.
4. **Release with explicit boundaries.** Prerequisite: reviewed evidence and approved distribution artifacts. Publish the tested versions, recovery/export instructions and known limitations without claiming an audited password manager.

## References

- [WebCrypto AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
- [OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
