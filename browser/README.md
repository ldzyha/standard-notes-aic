# AIC page notes — experimental Chrome / Edge component

Status: **0.3.0 experimental component**, prepared alongside the AIC 35.3.9 GitHub release. It is not a browser-store release or an independently audited password manager. Use synthetic data until the final packaged-runtime gates in VERIFICATION.md are resolved. The shared editor changes also ship in AIC Notes 44.4.7.

## Supported design

Supported browser targets are desktop **Google Chrome and Microsoft Edge only**, using Chromium 140 or newer. Both use one Manifest V3 package, one side-panel adapter and the **same canonical AIC editor**, without forks of AIC fields, Mermaid or Markdown behavior. Build and release gates cover these two browsers only.

- Create a note for the exact active URL, or explicitly import visible page content, a selection, or a Markdown file. Imports append; they never edit the website or replace an existing note.
- Use the shared Preview / Markdown switch, slash snippets and block controls. Copy a note, selected block or individual value, then paste manually. No autofill, destination-field tracking or insertion into websites.
- The panel follows its own browser window. It only shows the active URL's note; otherwise it shows domain/path navigation and recent pages. Navigation opens or activates the source page. URL paths are not a claim about a site's real content hierarchy.
- Notes persist locally across restarts. There is one note per exact URL, including query and fragment. AIC records at most 100 recent URLs while its panel is active and unlocked; it never queries browser history.
- No account, server, telemetry or synchronization. Whole-library transfer uses encrypted backups; Markdown import/export and clipboard transfer are deliberate plaintext actions.

## Compact panel and importing content

- A page without a note opens an editable **AIC placeholder** immediately. Merely opening it, moving focus or leaving does not create a note. The first edit creates the encrypted local note without resetting the editor, selection or undo history.
- The direct content control imports the current readable selection when one exists and otherwise the readable page. The separate **↑ Markdown** control imports a plaintext Markdown file; **↓ Markdown** downloads the current note. An untouched placeholder is replaced by the exact imported Markdown; imports otherwise append and save. They never replace authored note text or write to the website. Failed saves remain editable/exportable drafts.
- AIC field menus stay inside the visible editor, choose space above or below the button, and scroll internally when space is limited.
- The writing cursor uses the active text color and a 2 px stroke in both preview and source mode. It follows focus and light/dark theme changes; reduced-motion mode disables blinking.
- Typed AIC fields use compact rows. Each separator types the next value: `|` text, `*|` secret, `#|` authenticator seed, `_|` card value, `1|` unused one-time value and `0|` used one-time value. Parts keep separate actions and accessible hints; overflow stays inside the row.
- For selection import, select readable text on the source page first. Page/selection import requests access to that site only after your click. Browser-protected pages, forms, editable controls, hidden content and inaccessible frames are not imported. If a site prevents capture, copy its text and paste natively into the editor.
- An explicit Paste action may fill an empty typed field from the current clipboard after a user click. It does not monitor or enumerate clipboard history; ordinary editor paste remains native.
- **Notes and history** opens navigation without rebuilding the editor. **More options** is limited to local note/history deletion and clearly separated encrypted-library backup import/export. Plaintext Markdown transfer stays on the direct ↑/↓ controls.
- Navigation shows bounded page titles under their domain. It omits single-page path ladders and shows a common path only where it groups several pages. Visible labels and tooltips omit query/fragment details; the exact stored URL, note identity and navigation target remain unchanged.
- The compact browser toolbar keeps Save and Preview/Markdown controls visible and exposes five direct strike, link, bullet-list, numbered-list and task-list actions. Menus and navigation preserve the editor and its selection. Escape closes a panel menu and returns focus to its trigger. The local **?** guide explains AIC syntax and current actions without network access.
- Save failures remain visible until dismissed; routine confirmations disappear after five seconds. Notifications float above the lower edge rather than pushing the editor down.

## 0.3.0 AIC-only fields and compact browser actions

- Shared core 6.0.0 recognizes one fenced `aic` document rather than active YAML
  Properties blocks. Each typed separator applies to the next value, so a row can
  combine ordinary, secret, authenticator, card and one-time parts. Account, Card
  and One-time codes are presets made from those parts, not separate data formats.
  Existing source is not automatically rewritten; unsupported old text remains in
  the note for manual repair.
- Copying an unused `1|` value marks it used as `0|`. Activating a used value changes
  it back to `1|` without copying; only used values expose removal. Field adds a
  typed part to the current row, Row inserts below it and Section inserts after the
  current section.
- The shared local **?** guide is available in the compact browser and full Standard
  Notes/VS Code hosts. It renders fixed bundled text and examples; it does not read
  notes, storage or the network.

## 0.2.1 presentation corrections (historical source candidate)

- Card/composite labels and their first values align with adjacent simple fields and
  use the same typography. Cards omit the extra label colon; masking and independent
  copy targets are unchanged.
- Contextual Field, Row and Section actions follow the relevant row. Empty sections
  keep Row and Section inline; no separate New-block or Section footer is mounted.
- Navigation titles are bounded and do not visibly expose a page's full query or
  fragment. This changes display only: exact stored URLs, note identities and source
  navigation targets remain unchanged.
- Plain Markdown preview uses parser-backed link records so a destination with nested
  parentheses or query text does not append its suffix to the visible label. Authored
  Markdown and the link destination remain unchanged.
- The compact browser toolbar exposes five direct strike, link, bullet-list,
  ordered-list and task icons without nested Format/Style/Insert controls. Standard
  Notes retains its full formatting controls and adds the shared local `?` guide.
- Shared field-add menus use compact, left-aligned items instead of oversized
  centered rows while retaining their actions, viewport bounds and keyboard behavior.
- Content and Markdown transfer use direct controls: the content icon imports the
  current selection when one exists and otherwise the visible page; separate up/down
  Markdown icons import and download files. Native paste replaces the general clipboard
  import button, redundant Copy actions are removed, and More is limited to note/history
  deletion plus clearly grouped encrypted backups.
- These corrections do not implement the separately proposed global
  Shared/encryption design and do not change the encrypted-library format.

## Shared site AIC fields

- **Edit shared properties** above the page note opens one site-level AIC document. Store ordinary, secret, authenticator, card or one-time values there once; every page at that same origin shows its readonly preview and individual value actions. Editing it does not replace the page editor or its draft.
- Merely visiting a page or opening the shared editor creates no shared record. The first valid AIC edit creates the record in the encrypted library. Shared fields do not inherit from, override or get copied into page fields; existing homepage notes stay unchanged.
- The boundary is the exact **scheme + host + port**: HTTPS and HTTP, different subdomains and non-default ports have separate shared records. A URL path never widens that boundary.
- Page Markdown export includes the page only. The encrypted library backup includes each shared origin once. There is no autofill, cross-site sharing or network synchronization.
- Save failures and conflicts retain the local draft for retry or explicit plaintext export. Invalid unfinished AIC source remains in the shared editor, never in a child page's readonly preview.

## 0.2.0 compact context, ancestors and deletion

- **Format** opens a compact toolbar popover. When shared Properties are empty, their
  **Edit shared properties** action stays inline in that toolbar instead of adding a
  separate empty section, leaving more space for the page editor.
- Below domain Properties, a compact list links saved parent pages on the current
  URL path, then identifies the current page. Parent content is not inherited or
  copied. Only exact-origin, query/fragment-free, strict path ancestors qualify;
  siblings and similarly named path prefixes do not. This is URL navigation, not
  a reconstruction of Confluence or another site's internal page hierarchy.
- Use **More options → Delete local note**, or the removal button next to a page
  in **Notes and history**. Confirm to delete that note and its AIC history entry.
  The source website, domain Properties and other notes remain unchanged. The
  current page returns to a memory-only AIC placeholder; it creates a new
  note only after an edit. Saved pages appear once, not again under Recent pages.
- Deletion waits for this panel's pending save and checks the stored revision.
  Save failures or concurrent changes stop deletion and keep the draft available.
  There is no undo for a deleted note without an earlier encrypted backup. Removing
  history does not block future tracking: visiting that page again can add a new
  recent entry. It does not recreate its deleted note.

## Encryption and limits

Before the first note, choose a unique master passphrase of at least 12 Unicode characters, at most 1,024 UTF-8 bytes. Spaces and Unicode normalization are preserved exactly. Length alone does not guarantee strength. **There is no recovery without the passphrase.**

Native WebCrypto derives an AES-256-GCM key using PBKDF2-HMAC-SHA256 with 600,000 iterations and a random 32-byte salt. Every write uses a fresh random 96-bit IV and a 128-bit authentication tag. The complete library—Markdown, titles, URLs, dates and navigation index—is encrypted before persistent writes. The bounded, versioned envelope authenticates its parameters and rejects tampering.

The passphrase is never persisted or embedded in code. The derived key stays in trusted, memory-only `storage.session`, allowing background-worker suspension without another unlock. Lock, browser restart, extension reload or update ends that session. Both local and session storage access are explicitly restricted to trusted extension contexts. Local storage contains **ciphertext only**, never a key. Missing session storage or failed access restrictions fail closed; there is no disk fallback.

Limits: 500 notes, 500 shared-origin records, 512 KiB UTF-8 per document, 6 MiB UTF-8 for the decrypted library, 100 recent URLs, 8 KiB per URL. Shared AIC documents additionally follow the canonical parser's row, part and text limits. Backups merge new URLs and origins without overwriting existing records. Simultaneous first imports into one URL append atomically. Conflicting ordinary edits retain the losing panel's draft for export instead of overwriting the other revision.

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

To test a GitHub release without building, download `aic-browser-chromium-0.3.0.zip`
and its `.sha256` from [AIC Releases](https://github.com/ldzyha/standard-notes-aic/releases),
verify the checksum, and extract into a permanent folder. Use that folder for
**Load unpacked** below. The ZIP is not a Chrome/Edge store installation package.

Run `npm run build:browser` from the canonical repository. No additional runtime dependencies or external services are needed. It produces one unpacked directory, `dist-browser/chromium/`, and one archive, `dist-browser/artifacts/aic-browser-chromium-0.3.0.zip`, for both Chrome and Edge. Other browser build modes are rejected.

The archive uses deterministic ordering and timestamps and includes the `>_` icon, worker, editor assets and privacy notices. Previously generated development files are not current targets; the build does not delete older archives or browser profiles. The command never installs into a user's profile or submits to a store.

For local testing, open `chrome://extensions` in Chrome or `edge://extensions` in Edge, enable **Developer mode**, choose **Load unpacked**, and select `dist-browser/chromium/` (the folder containing `manifest.json`, not the ZIP). Pin AIC and click its toolbar icon to open the side panel. The same directory works in both browsers; their notes remain separate unless you explicitly transfer them. See the official [Chrome instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) and [Edge instructions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading).

Before an update, wait for **Note saved**, export an encrypted backup from **More options**, and retain its passphrase. Keep the unpacked extension at the same path and use **Reload** on its existing extension card after rebuilding. Do not uninstall a populated extension to update it. Unpacked developer installation does not establish store-distributed update behavior.

## Ownership

- `library.ts`: versioned schemas, quotas, revisions, note/history and shared-origin records; `navigation.ts`: compact display projection without changing stored URLs; `page-ancestors.ts`: exact-origin path-segment ancestor metadata without note contents.
- `vault-crypto.ts` / `vault-store.ts`: cryptography and serialized encrypted persistence/backup lifecycle.
- `service.ts` / `worker.ts`: sole storage writer, revision-guarded save/delete operations, active-page checks, capture/navigation authorization and sender isolation.
- `api.ts` / `platform.ts`: one narrow Chromium adapter for Chrome and Edge; no shared-editor duplication.
- `capture-page.ts` / `import-page.ts`: bounded read-only DOM capture and inert Markdown conversion. Forms, editable controls, hidden content and inaccessible frames are excluded. Visible text and URLs can contain confidential information; this is not a secret scanner or OCR tool.
- `draft-coordinator.ts`: common acknowledged-save, conflict and recovery lifecycle; `drafts.ts` / `domain-drafts.ts`: page and origin adapters.
- `panel.ts` / `domain-properties.ts`: own-window context, lock cleanup, recovery and readonly/editable exact-origin AIC documents using the canonical editor.

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
