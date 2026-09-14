# Adaptive preview workspace — architectural review

Date: 2026-09-14.

Browser target scope is approved by the user: **Chrome and Edge only**. Both use
one Chromium package/adapter. This narrows browser delivery and tests; it does not
remove the separately requested VS Code workspace adapter or change the Standard
Notes compatibility boundary below.

**Decision status: implementation proposal, not an implemented feature.** The user
requested an evolving preview with progressive context, scroll-aware actions,
Ctrl+scroll detail levels, and consistent browser/VS Code behavior. The concrete
interaction contract and migration below are the author's recommended path for
technical review. Reviewers should accept it, reject a specific part with evidence,
or amend it before that part is implemented. No standalone notebook application,
storage migration, sync service, or new graph UI has been created in this change.

The browser's compact 0.1.1 panel is implemented separately; its evidence and
remaining runtime gates are in [browser/VERIFICATION.md](browser/VERIFICATION.md).

## 1. Current facts and review coverage

The review inventories production source and follows editor construction, shared
distribution, navigation/indexing, source/preview transitions, save ownership,
capture, encrypted persistence, and disposal across both repositories. This is an
architectural review, not a claim of line-by-line security certification of every
parser, bundled dependency, or every application's runtime behavior.

### Ownership inventory

| Area                                     | Current files                                                                                                                                    | Responsibility and boundary                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical shared behavior                | `src/core/*`, `CORE_FILES.json`                                                                                                                  | 93 distributed JS, declarations and CSS files: field grammar, Security/Properties, diagrams, structured actions, save intents, source mode, formatting, rendering and lifecycle helpers. The inventory is explicit. |
| Browser/SN editor composition            | `src/editor.ts`, `toolbar.ts`, `commands.ts`, `language.ts`, `styles.css`                                                                        | Constructs CodeMirror and its toolbar. This composition is **not** distributed to VS Code.                                                                                                                          |
| Browser/SN preview adapters              | `src/block-views.ts`, `preview.ts`, `markdown-decorations.ts`, `link-actions.ts`, `details-*`, `mermaid-*`                                       | Binds shared models to the browser/SN editor. Existing adapter behavior must be characterized before replacement.                                                                                                   |
| Standard Notes host                      | `src/main.ts`, `standard-notes-host.ts`, `note-draft-registry.ts`                                                                                | Current-note identity, lock state and acknowledged host saves. The standalone development example is not a complete notebook host.                                                                                  |
| Browser presentation                     | `src/browser/main.ts`, `panel.ts`, `panel.css`, `drafts.ts`                                                                                      | Active-window/page context, editor lifetime, menus, local drafts, feedback and recovery.                                                                                                                            |
| Browser platform and trust boundary      | `src/browser/api.ts`, `platform.ts`, `worker.ts`, `service.ts`                                                                                   | One Chromium adapter for Chrome and Edge, trusted sender checks, explicit capture, known-page navigation and private-window exclusion.                                                                              |
| Browser data and imports                 | `src/browser/library.ts`, `vault-store.ts`, `vault-crypto.ts`, `capture-page.ts`, `import-page.ts`                                               | One note per exact URL, encrypted sole-writer queue, backup validation, read-only DOM import.                                                                                                                       |
| VS Code composition                      | `../aic-notes/src/webview/main.js`, `theme.css`, `host-shim.js`, `highlight.js`, `fenced-local.js`, `details*.js`                                | A separate CodeMirror composition. It imports the vendored core but does not construct `AicEditor`.                                                                                                                 |
| VS Code Markdown adapter                 | `../aic-notes/vendor/markdown/*`, including `handlers/*`                                                                                         | Session and Markdown handlers that remain outside the canonical core inventory. Do not delete them merely because the desired endpoint is shared.                                                                   |
| VS Code save/editor hosts                | `../aic-notes/src/editor/*`, `secondary/*`, `webview/primary-save.js`, `webview/secondary-draft.js`, `clipboard.js`, `lifecycle.js`, `errors.js` | Primary TextDocument edits/undo, secondary drafts, acknowledgments, clipboard requests, cancellation and scope disposal.                                                                                            |
| VS Code note context                     | `../aic-notes/src/notes/*`                                                                                                                       | Tree, sidecar/parent resolution, structural relationships, navigation, selection references, note operations and edit ownership. These are not a function dependency graph.                                         |
| VS Code activation and agent integration | `../aic-notes/src/extension.js`, `agents/*`, `retired-auth-cleanup.js`                                                                           | Registers managers and commands, agent contracts, and retired integration cleanup. No new authentication or synchronization is needed.                                                                              |
| Distribution and evidence                | `scripts/sync-editor-core.mjs`, `../aic-notes/scripts/verify-core.mjs`, build/package scripts and both `test/` trees                             | Canonical byte parity, snapshot hashes, host tests and separate artifact/release gates.                                                                                                                             |

### Findings that affect the direction

1. **Shared blocks do not yet mean a shared workspace.** Browser construction is in
   `src/editor.ts:153`; VS Code creates its own `EditorView` in
   `../aic-notes/src/webview/main.js:355`. Browser `compactToolbar` therefore does
   not automatically reach VS Code. Adding semantic zoom independently to those
   two entry points would create another behavior fork. Use canonical `src/core`
   for its controller, view model and UI; keep thin host bindings.

2. **Existing trees describe different facts.** `src/browser/library.ts:2` requires
   a URL and stores a stable note ID, Markdown, dates and revision; it has no
   explicit note-edge collection. `buildDomainTree` at line 427 groups URL paths,
   not Confluence ancestry. VS Code `src/notes/relationships.js:54` derives project,
   parent, current, component and sibling sidecars; it does not analyze imports or
   function calls. Do not label those different groupings as verified dependencies.

3. **VS Code rescans before delivering context.** `relationships.js:71` searches
   notes per request and then resolves candidates; `tree.js:50` separately searches
   Markdown, and `tree.js:45` invalidates all badge entries on each refresh.
   `secondary/provider.js:739` awaits relationships before posting editor init.
   This is a concrete scale risk, not a measured UI stall in this review. Adding
   a graph that repeats those scans on scroll would multiply the cost. A single
   host-owned incremental index should supply both tree and context snapshots.

4. **UI state cannot safely ride on today's remount paths.** Browser context
   refresh drops/recreates its editor (`panel.ts:670`); VS Code `init` does the same
   (`main.js:604`). VS Code selection updates also replace the entire webview state
   (`main.js:513`). A newly persisted activity/depth field would be overwritten.
   Adaptation must preserve the live editor; actual document switches need explicit
   attach/detach and identity-scoped restoration. New VS state writes must merge.

5. **Context is currently coupled to a block.** VS Code passes relationships into
   Properties and updates `setPropertyRelationships` (`main.js:393,685`). Workspace
   context should not require frontmatter or a visible Properties block. Move its
   presentation to the shared workspace shell only after both main/secondary host
   paths supply the same typed context; then remove the redundant block injection.

6. **Page-bound navigation is an existing product contract.** Browser panel mounts
   the active URL's note (`panel.ts:670–776`); `service.ts:183` navigates only known
   library/history URLs. The user previously asked not to display a different note
   while its page is absent. An independent presentation layer does not authorize
   silently changing that rule, loosening URL validation or adding unbound notes.

7. **Save, privacy and gesture ownership already exist.** Keep host writers rather
   than introducing a universal writer inside the new shell. `source-mode.js:97`
   already manages preview reconfiguration and scroll restoration; Mermaid has a
   separate local viewport (`mermaid-viewport.js:64`). It currently has zoom buttons,
   not a Ctrl+wheel handler. Browser vault writes remain serialized and encrypted
   (`vault-store.ts:166`); capture rechecks current page and lock state
   (`service.ts:148`). UI adaptation must not bypass any of these owners.

8. **Scroll/render work needs measurement before adding more.** VS Code
   `vendor/markdown/mermaid.js:376` schedules a decoration refresh on viewport
   changes; its builder walks the parsed syntax tree for fences. The shared
   `render-queue.js:24` correctly retains an active slot until the engine finishes,
   even when its caller aborts; `mermaid-runtime.js:4` uses a single slot. A slow
   superseded render can delay the next diagram. These are current scale risks,
   not evidence of a measured leak or a reason to release the slot unsafely.

9. **Keeping the editor mounted also keeps some work alive.** Security TOTP refresh
   checks document visibility/connection, not a future shell's covered region
   (`security-block.js:2148`). A table cell popup lives under `document.body`
   (`structured-preview.js:435`), so merely covering the editor leaves it active.
   Add explicit presentation suspend/resume and popup exit hooks; do not confuse
   visual hiding with disposal. VS `main.js:645` also schedules focus through the
   mutable global view; a future context transition must guard/cancel that frame.
   The reviewed owners have cleanup paths; no unbounded current listener leak was
   established by this read-only review.

## 2. Recommended target

Use one **host-neutral adaptive preview layer** in the canonical core, with one
controller per live editor. This extends the existing preview; it does not add a
second editor, replace CodeMirror on scrolling, or resurrect the removed sphere.
Keeping the core in the current repository avoids an unnecessary repository/package
migration during stabilization. Its host independence matters more than its folder name.

```text
Shared preview blocks + source-mode controller
                     │
Shared activity/depth state + context view + command presentation
                     │
           narrow capability adapters
             ├─ Browser: page context / vault / explicit import
             ├─ VS Code: workspace index / TextDocument / secondary drafts
             └─ Standard Notes: current-note editor, workspace capability off
```

The shared layer receives immutable snapshots and reports user intents. Adapters
provide document identity, availability, navigation, save state, host theme and
visibility. They do not hand the layer browser APIs, the vault key, a filesystem
writer or unrestricted `postMessage`. Unsupported capabilities stay absent, not
fake empty controls.

### Interaction contract proposed for review

Depth and activity are separate UI state; neither is serialized into Markdown.

| Depth     | Visible context                                                                                                 | How to return                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Note      | Existing preview; current block actions only when relevant. One compact permanent status/source/control anchor. | Default level.                                                |
| Context   | Current note stays anchored; show its outline and actual related items, with relation type/provenance.          | Zoom in or Escape to Note without losing selection/scroll.    |
| Workspace | Main navigation tree and current-item location; filter known items and inspect available links.                 | Zoom in to Context; explicit Open uses host navigation rules. |

- Ctrl+wheel down zooms out one semantic level; up zooms in. Clamp at three levels;
  accumulated wheel deltas and a short gesture latch avoid skipping levels on a
  trackpad burst. A visible level control and keyboard-accessible buttons provide
  the same operation. This is semantic detail, not a CSS transform or font-size zoom.
- Handle that gesture only in the opted-in workspace surface. Nested Mermaid
  viewport, text inputs, menus and source-edit controls keep their own input.
  For the first slice, exempt Mermaid rather than silently inventing local wheel
  behavior. Outside the surface, browser/VS Code zoom remains unchanged. If an
  event cannot be canceled, do not apply semantic zoom as well as native zoom.
- Ordinary scrolling never changes activity, depth, source mode or Markdown.
  Scrolling down collapses secondary chrome after a threshold; scrolling up or
  reaching a document boundary reveals useful navigation/add actions. Use a stable
  overlay/allocated control area so chrome changes do not move the text under the
  cursor. Focused, hovered or expanded controls cannot disappear mid-interaction.
- Work is the default balanced state. Review emphasizes preview and inspection;
  Write emphasizes the current editing/formatting actions; Investigate emphasizes
  outline, provenance and connections. A compact explicit selector provides a
  persistent manual override for the current document. Auto adaptation responds to
  explicit actions (Edit, Inspect), never guesses that scrolling means consent to
  edit. Read-only/locked state always takes priority.
- Save errors, pending/dirty state, browser Lock and an exit path remain accessible.
  Never hide unsaved content by switching notes automatically. Opening context does
  not create a document mutation or an extra save path. Existing blur-save behavior
  continues through the host's save-boundary contract; do not duplicate requests
  from an activity/depth listener or mark the note saved before acknowledgment.
- Escape priority: active popover/nested edit first, existing source-to-preview
  behavior next, semantic context last. Returning from context restores the same
  document selection, scroll and focus, then requests editor measurement.
- Light/dark use shared tokens; no opacity-based dimming of necessary text. Respect
  reduced motion and keyboard/touch alternatives. Meaning must not rely on color.

The implementation must observe actual `scrollTop` changes, not infer scrolling
from wheel deltas: keyboard, scrollbar and script can scroll without wheel, and
Ctrl+wheel can represent zoom. Use passive ordinary scroll observation with one
scheduled measurement; only the narrowly owned zoom gesture may need a non-passive
wheel handler. [MDN wheel event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event)

### Data model without a premature storage rewrite

First introduce a **derived** context projection: host-scoped opaque note key,
title, source descriptor, availability, and typed edges. Preserve the browser's
stable ID and VS Code's URI identity behind adapters; never use a basename as a
globally unique key. Initially retain exactly today's page/sidecar navigation rules.

Distinguish `parent` (verified owner/ancestor), `source` (page/file), `reference`
(authored resolvable link), and `unresolved` (missing/unsupported destination).
Keep ordinary web links separate from internal note references. Label inferred URL
grouping as grouping, not ancestry. Do not infer function dependencies from proximity
or similar names. Do not index secret field values, TOTP seeds, recovery codes,
masked Properties or plaintext contents of Security fences into link/search UI.

This first projection needs **no browser schema migration**. If later work adds
authored relationships or notes without a source URL, make a separate versioned
library migration inside the existing encrypted sole-writer boundary: validate old
backups, retain IDs and exact text, preserve rollback/export, and explicitly settle
the active-page rule first. No plaintext navigation cache outside the unlocked
lifetime, no new server and no cross-app synchronization.

VS Code must continue to synchronize its custom text editor through the host's
TextDocument rather than giving the UI an independent save/undo implementation.
[VS Code custom editor guide](https://code.visualstudio.com/api/extension-guides/custom-editors)

Standard Notes can render a richer **internal** preview; saying it cannot is too
broad. Its supplied adapter does not own the external application's sidebar,
workspace tree or navigation chrome. Keep the workspace capability disabled there
for this rollout while preserving the same block and source-edit behavior.

## 3. Dependency-ordered transition

All steps below are proposed; compact browser 0.1.1 is not evidence they are complete.

| Step                              | Required change and owner                                                                                                                                                                                                                                               | Prerequisite                                      | Verifiable completion                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contract and baseline          | Record depth/activity/gesture/Escape rules above as fixture-driven scenarios; document host capabilities and source/secret exclusions.                                                                                                                                  | Technical review accepts or amends this proposal. | Same scenario table covers browser and both VS surfaces; SN opt-out and existing page binding are explicit. Capture baseline latency/layout/lifecycle evidence.                                                                        |
| 2. Shared UI state                | Add canonical `src/core/workspace-state.js` plus declarations and pure transition tests. Keep document/save identity external.                                                                                                                                          | Step 1.                                           | All mode/depth/lock/remount transitions deterministic; no Markdown changes, network/storage calls or timers in reducer.                                                                                                                |
| 3. Shared projection + host index | Add canonical immutable outline/typed-context model. Add one VS `NoteContextIndex` manager registered at extension activation; feed tree and relationships from revisioned snapshots with targeted invalidation. Browser adapts current unlocked library; no migration. | Step 2 and existing path/navigation tests.        | No filesystem scan on scroll/zoom; one index per workspace owner; simultaneous consumers share a scan; stale results ignored; create/rename/delete updates correct. Preserve current exclude/sidecar semantics through explicit tests. |
| 4. Shared controller/view         | Add canonical shell/controller/CSS using existing source-mode and action helpers. Observe viewport, scope gestures, render only changed context, dispose listeners/observers/frames.                                                                                    | Steps 2–3.                                        | Live EditorView identity, selection, scroll, undo and dirty state survive every UI transition. No hidden focused control; nested diagrams/source inputs retain keys. No retained controller after destroy.                             |
| 5. Bind both hosts                | Browser panel delegates adaptive UI while retaining permissions, lock, capture and drafts. VS main/secondary bind the same controller, merge webview state and pass identity-scoped context. Keep SN disabled by capability.                                            | Step 4.                                           | Browser and both VS surfaces pass identical interaction fixtures plus host-specific save/lock/navigation checks. No text/URL/key persisted in unencrypted browser UI state.                                                            |
| 6. Retire redundant paths         | Replace browser-only navigation disclosure and VS Properties relationship presentation with the shared context view where enabled; retire duplicate index scans. Do not remove older Markdown handlers yet.                                                             | Step 5 passes with replacement routes available.  | No consumer still calls the removed presentation/scan path; context works without Properties; no duplicate buttons/tree or alternate save/source controller. Delete old code and tests only with equivalent replacement coverage.      |
| 7. Parity and release gate        | Add reviewed core files to `CORE_FILES.json`, sync exact vendor bytes/snapshot, build both artifacts; run unit, renderer, lifecycle and real-host smoke matrices.                                                                                                       | Steps 1–6; cleanly identified releasable changes. | Integrity hashes pass; target artifacts match tested source; known remaining gates documented. Only then publish/install an explicitly selected version.                                                                               |

The intended removal is duplicate **presentation and scanning**, not established
host managers, browser encryption, or all of `vendor/markdown`. A later editor
composition consolidation needs handler-by-handler parity tests and an independent
migration plan; deleting it now would remove working behavior.

## 4. Verification and performance budgets

These are acceptance targets, **not measured results of an adaptive implementation**:

- Normal scroll: no Markdown parse, full-tree rebuild, filesystem scan, encryption or
  save; at most one scheduled geometry update per animation frame. Idle shell has no
  polling timer or animation loop. Index work is revision-driven and bounded/cancelable.
- Gesture/menu operations: immediate visible feedback, no shell-attributable long
  task over 50 ms in the measured fixtures; report document/graph size and browser
  hardware rather than making an unqualified maximum-performance claim.
- Large fixtures: a near-512 KiB note, 500 browser notes, and a synthetic VS workspace
  with 10,000 note paths. Virtualize/filter broad lists; defer nonvisible details.
  Record cold index time separately from warm navigation and typing latency.
- Lifecycle: repeated 200 attach/context/source/depth/hide/show/destroy cycles;
  stable live listener/observer/DOM counts, canceled pending frames, collectible
  retired roots. Heap evidence is a bounded regression check, not a universal
  absence-of-leaks proof. Lock must clear the new context cache as well as the editor.
  A hidden-but-mounted editor pauses optional TOTP/render work; returning resumes
  it without a second timer. Active cell popups close before context takes focus.
- Browser: tab/window switch during import, pending save and context loading; private
  consent; encrypted backups; stale responses; CSP/no-network; no page mutation.
- VS Code: main + secondary + source editor, native undo/redo and save failures,
  external edits, lease changes, project parent fallback, rename/delete and webview
  restoration. Synthetic webview messages are not a live VS Code smoke test.
- Layout: 320/600/900 px, light/dark, zoom and high contrast, keyboard-only and touch,
  reduced motion, long labels, RTL text, IME composition and screen-reader labels.
- Input: real wheel/trackpad, scrollbar, keyboard and programmatic scroll, native
  browser zoom outside the owned surface, Mermaid local controls and nested inputs.
  No handler double-consumes Escape, Ctrl+S, selection or a zoom gesture.

Current baseline checks rerun by the main agent: 989 canonical tests/77 files,
231 VS Code tests, canonical production build, canonical/vendor byte parity and
VS snapshot validation (core 5.1.0, 93 files). They validate the **existing** code,
not the future architecture. Full new behavior requires the gates above.

The extended isolated Edge lifecycle regression also passed for both default and
compact toolbars: 200 cycles each, zero retained editor roots and unchanged DOM
node/listener counts after collection. It does not yet exercise semantic depth,
workspace indexing or hidden-but-mounted adaptive views, which do not exist yet.

## 5. Review disposition

Recommended: accept the shared derived-view/controller path, keep today's data/save
boundaries, and implement browser and VS Code bindings together. Do not start with
a new notebook store, a graph library, CSS zoom of the editor or duplicated host
implementations. The next executable slice is steps 1–2 followed by the index and
controller; it is not a public notebook launch.

Two independent GPT-5.6 Sol (high) agents reviewed browser data/navigation and
cross-repository sharing/lifecycle boundaries. The main agent inspected the ownership
paths, reconciled the recommendations, verified the core checks and reran both test
suites. Delegated review and passing baseline tests do not certify future compatibility.
