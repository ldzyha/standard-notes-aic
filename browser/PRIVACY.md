# AIC page notes: local data handling

> **Public AIC terms and privacy:** <https://aic.dzyha.com/terms>

[English](PRIVACY.md) · [Українська](PRIVACY.uk.md)

This policy describes the plain-file Chrome and Edge component. See the
[README](README.md) and [verification record](VERIFICATION.md) for release status.

AIC has no account, sync server, telemetry or analytics. Runtime resources are
bundled, and the extension content policy blocks outgoing connections and remote
embedded resources. AIC reads page content only after your explicit import action
and site-access approval. It does not edit, autofill or insert into websites.
Opening a source link uses ordinary browser navigation.

## Files and browser-local data

You choose a Markdown file or folder and grant access through the browser picker.
Note content is plain Markdown on disk. In a folder, `.aic/links.json` stores URL,
scope, note identifier, relative path and revision metadata, without duplicating
Markdown content. File handles and connection metadata are remembered locally in
IndexedDB. Browser-local storage can also hold cached metadata, preferences and
plain draft recovery checkpoints. AIC does not use `storage.sync`.

Current links to an exact URL, including its query and fragment; Shared belongs
to an exact origin, and Global to the selected collection. Those associations do
not copy shared text into other notes or insert it into websites. Active-tab
navigation is limited to the panel's browser window. AIC does not read the
browser history database or collect background browsing history. The navigation
tree shows saved files and their explicit links; opening a page alone creates
no note.

There is no app password, encrypted workspace or legacy-file converter. AIC does
not open or migrate old `.aicnotes` files, and does not delete existing old files
or unused legacy storage. Secret fields are masked in the editor; their source,
clipboard copies and recovery checkpoints are plain text. Filesystem encryption,
backups and external sync services are controlled by the user.

## Saving, recovery and removal

A save is confirmed only after the selected file write is acknowledged. If the
original changed, disappeared or lost permission, the draft remains unsaved for
retry or export. AIC does not automatically recreate a deleted note or overwrite
an externally changed source.

Each edit requests a separate local recovery checkpoint containing draft text
and context, with file/panel identifiers, sequence numbers and dates. Acknowledged
checkpoints can survive Reload or a browser restart. They are not disk-save
confirmations. Closing before checkpoint acknowledgement can lose the latest
edit. A checkpoint failure leaves a notice to keep the panel open and save or
export the draft.

Recovered drafts are reviewed explicitly and may be saved as separate Markdown
copies. Recovery does not automatically replace originals or recreate deleted
files. The current checkpoint is cleared after a confirmed file save or explicit
discard. Older recovered copies remain until their removal is confirmed;
exporting a copy alone does not delete them.

Removing or updating the extension does not delete selected external files.
Uninstalling removes browser-local caches, recovery checkpoints and remembered
access. After reinstalling, select the same files again. Reload may require
reconnecting permission but does not erase saved file contents. There is no
server-side recovery. Chrome Incognito and Edge InPrivate are excluded by the
manifest; private browsing is not a way to clear notes.

Markdown export and Copy deliberately include the selected source, including
masked secrets and filter-hidden rows when copying a whole section. Other
applications, clipboard history or sync, and destination websites after pasting
may receive that text. AIC's network restrictions do not control those systems,
user-selected filesystem sync or normal browser update services.

## Permissions

- `storage`: local connection metadata, preferences, caches and plain draft
  recovery checkpoints. File access is granted separately through the picker.
- `tabs`: identify the active page in the panel's window and open or activate
  explicitly linked URLs; no browser history database permission.
- `sidePanel`: display the notes panel in Chrome and Edge.
- `scripting`: explicit, read-only page or selection capture after site approval.
- Optional HTTP(S) site access: requested for the chosen origin during import,
  rather than every website on installation. Revoke it in extension settings.
- `clipboardRead`: an explicit Paste action on an empty typed field reads the
  latest clipboard text after your click. Ordinary editor paste stays native;
  there is no background clipboard reading, monitoring or history collection.
- `clipboardWrite`: explicit copy actions, including hidden field values.

Visible page content, titles and URLs may contain confidential information.
Excluding form fields is not universal secret detection. Masking is a display
feature, not file encryption; this build is not an audited password manager.

## Chrome Web Store Limited Use

AIC's handling of user data complies with the [Chrome Web Store User Data Policy,
including its Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

Permissions support only the local notes, page import and navigation described
above. The developer does not receive or remotely access notes or captured page
content. AIC does not sell user data or use it for advertising, unrelated
profiling, creditworthiness assessments or lending. Export and clipboard copy
happen through your explicit actions.

## Changes to this policy

Product releases may update this policy. Changes to data handling will be
prominently disclosed, including affected data, recipients and purpose. Where
required, AIC will obtain affirmative, informed consent before new collection,
use or sharing begins. Updating the policy alone does not authorize a new use of
previously stored data or provide advance consent to future processing.
