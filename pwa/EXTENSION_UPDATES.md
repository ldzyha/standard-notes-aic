# Extension updates

[Українська](EXTENSION_UPDATES.uk.md)

The source pipelines prepare release assets, submit existing store listings, and
propose shared editor updates. Publisher credentials and account settings have
not been activated by this change. A successful local test or verification run
does not establish a published store version.

## Browser release and submission

The tag release workflow verifies the source, builds one Chromium ZIP, and uploads
that ZIP with its SHA-256 sidecar to the stable GitHub release. Browser and
Standard Notes versions are independent.

`browser-marketplace.yml` downloads the exact existing release assets. Its verifier
checks the stable release metadata, unique asset names, checksum, deterministic
ZIP structure, CRCs, extension identity, and browser manifest version. Publisher
jobs submit these bytes without rebuilding. Manual runs default to
`verification_only = true`, which makes no store API requests.

To enable future tag submissions, configure publisher access first, then set the
repository variable `BROWSER_MARKETPLACE_ENABLED` to `true`. Set
`BROWSER_PUBLISH_TARGET` to `chrome`, `edge`, or `both`. Each selected store also
requires its own enable variable:

| Store  | Repository variables                                                        | Actions secrets                                                    |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Chrome | `CHROME_PUBLISH_ENABLED=true`, `CHROME_PUBLISHER_ID`, `CHROME_EXTENSION_ID` | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Edge   | `EDGE_PUBLISH_ENABLED=true`, `EDGE_PRODUCT_ID`                              | `EDGE_CLIENT_ID`, `EDGE_API_KEY`                                   |

The Chrome account must have two-step verification and access to the existing
listing. Enable the Chrome Web Store API and obtain authorized OAuth credentials
through Google. The client uses the current v2 upload, status, and publish
endpoints. It stops for a different active submission, policy warnings, failed
processing, or a version that does not increase. Identical published or pending
versions are left alone. New submissions request review and publication after
approval. [Chrome API setup](https://developer.chrome.com/docs/webstore/using-api),
[publish contract](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

Edge requires an existing published product and Publish API access configured in
Partner Center. The client uses the current API-key authentication, polls package
processing, then submits certification notes and polls the submission operation.
An accepted operation means the review submission was created; store approval
still follows. The API cannot create a new listing or edit listing metadata.
[Edge API setup](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api),
[endpoint reference](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference).

Requests time out after 30 seconds; processing polls are bounded to 30 attempts
with ten-second intervals. Provider response bodies and credentials are excluded
from publisher logs. On a timeout or failed submission, inspect the store
dashboard before rerunning; a timed-out request may already have been accepted.
No automatic mutation retries or cancellation of another submission are made.

## VS Code publication

The VS Code pipeline continues to verify the exact stable GitHub release VSIX,
checksum, publisher `ldzyha`, extension `aic-notes`, and universal XML identity.
It verifies publisher authorization before submitting those bytes and skips an
already-existing version. Manual `verification_only` remains available without
authentication.

The prepared Entra route uses `VSCE_AUTH_MODE=entra`,
`VSCE_AZURE_CLIENT_ID`, and `VSCE_AZURE_TENANT_ID` repository variables.
Authorize that identity as a contributor to the Marketplace publisher and
configure Entra workload federation for this GitHub repository's publishing
refs. The workflow uses Azure Login's GitHub federation, then the supported
`vsce --azure-credential` route. It allows login without an Azure subscription.
Publisher membership and federation still require owner account setup.
[Microsoft publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace),
[Azure Login federation](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended).

Existing `VSCE_PAT` publication remains compatible when `VSCE_AUTH_MODE` is `pat`
or unset. Treat it as temporary: Microsoft retires global Azure DevOps PATs on
December 1, 2026. Never place credentials in source, notes, chat, or release
archives. [PAT retirement](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/).

## Shared editor updates

`sync-core.yml` is enabled by `AIC_CORE_SYNC_ENABLED=true` on the canonical
repository. Configure `AIC_CORE_SYNC_APP_ID` and the secret
`AIC_CORE_SYNC_APP_PRIVATE_KEY` for a GitHub App installed on `ldzyha/aic-notes`
with contents and pull-request write access. The token is scoped to that one
repository. [GitHub App token action](https://github.com/actions/create-github-app-token).

Committed changes on canonical `main` build the PWA, mechanically copy only
`CORE_FILES.json` entries into the VS Code core mirror, and synchronize the exact
portable editor build into `vendor/portable-runtime`. `CORE_SNAPSHOT.json` and
`PORTABLE_SNAPSHOT.json` record the source commit and exact hashes; `aicEditorCore`
is aligned. The VS Code host builds independently from these committed generated
files. Its VSIX includes the exact portable runtime and its snapshot.

For a local distribution, run `npm run build:pwa`, then `npm run portable:sync`
in the canonical repository. `--target <AIC-Notes-repository>` selects another
checkout; `npm run portable:check` compares without writing. Changed or untracked
build inputs produce an honest `sourceState: working-tree` snapshot. Such snapshots
support local builds, while release verification requires committed provenance.
Synchronization refuses to replace unowned or modified generated directories.

The VS Code release gate verifies both distributions before the workflow opens
or refreshes `codex/sync-editor-core`. Review and merge that PR, then choose the
host release version and tag. The workflow does not merge or publish releases.

## Installed applications

Store-installed Chrome and Edge extensions use their browser's normal extension
update delivery. Unpacked developer extensions require Reload on the existing
extension card. Preserve an encrypted backup before an update when rollback
matters; lock, reload, or update ends the extension's unlocked session.
[Chrome updates](https://developer.chrome.com/docs/webstore/update),
[Edge updates](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

VS Code Marketplace installations follow VS Code's automatic-update settings.
An earlier VSIX installation can enable **Auto Update** for AIC Notes to receive
Marketplace updates. Open VSX distribution remains separate.
[VS Code updates](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#extension-auto-update).

The PWA caches its interface for offline use and keeps notes on the device.
Publisher access belongs to CI; users do not configure store credentials in the
notes interface. Deployment of a new PWA build and release of an extension are
separate operations.
