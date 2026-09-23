# AIC UI architecture and registry rules

[English](UI_ARCHITECTURE.md) · [Українська](UI_ARCHITECTURE.uk.md)

This document is the human contract for shared UI ownership across the Standard
Notes component, Chromium side panel, and AIC Notes for VS Code. It complements
the release-oriented `FUNCTIONAL_INDEX.md`:

- `FEATURES.json` maps stable feature IDs to canonical source, host entrypoints,
  and verification.
- `COMPONENTS.json` maps the shared component IDs to BEM names and the legacy
  hooks that still implement or style them.
- `src/core/ui-system.js`, `ui-system.d.ts`, and `ui-system.css` are the compiled
  runtime contract. Runtime code imports modules; it does not load either JSON
  registry dynamically.

## Decision status

| Subject                                                                                             | Status                                                  | Meaning                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| One feature and component registry                                                                  | User-approved direction                                 | New work must update the registries when it changes their scope.                                            |
| Shared BEM blocks, elements, and modifiers                                                          | User-approved direction                                 | Standard Notes, browser, and VS Code webviews converge on the same component names.                         |
| Eight base component IDs: `button`, `toolbar`, `menu`, `notice`, `field`, `card`, `tree`, `context` | Implemented technical baseline, accepted in root review | The IDs operationalize the approved BEM direction; the user did not prescribe these exact names separately. |
| Exact legacy-selector-to-BEM mappings in `COMPONENTS.json`                                          | Author recommendation, technical review pending         | Reviewers accept, amend with reasons, or split a mapping before destructive cleanup.                        |
| Migration order below                                                                               | Author recommendation, technical review pending         | It is dependency-ordered and must not be treated as completed work.                                         |

## Current facts

1. `standard-notes-aic/src/core` is the canonical owner of the shared editor
   core. `aic-notes/vendor/aic-editor-core` is a verified distribution snapshot,
   not another owner and not a second feature registry.
2. Standard Notes and the Chromium panel construct `AicEditor` from
   `standard-notes-aic/src/editor.ts`. VS Code constructs its webview editor in
   `aic-notes/src/webview/main.js` and consumes the distributed shared core plus
   its Markdown adapter under `aic-notes/vendor/markdown`.
3. Host adapters own storage, navigation, platform permissions, clipboard
   bridges, save acknowledgement, and lifecycle. Shared visual primitives must
   not acquire those responsibilities.
4. `src/core/preview-layout.css` now owns shared editor-shell, preview-header,
   and code-preview layout that was previously duplicated between the Standard
   Notes stylesheet and VS Code theme. Compatibility selectors remain while
   producers migrate.
5. Standard Notes and the browser page and Shared Properties editors use one
   always-compact toolbar composition: strike, link, bullet/ordered/task lists,
   source mode, and a local `?` guide where the host enables its trigger. No Format
   disclosure, Style/Insert selector or Bold/Italic/Inline-code button is mounted;
   Markdown, slash commands and keymaps remain those command owners. The shared
   editor enables its guide by default, while the browser suppresses that trigger
   because its panel owns the local guide entry point. The toolbar wraps rather
   than scrolling horizontally and retains 44 px targets for coarse pointers.
   Domain identity and actions remain part of the compact shared surface.
6. `src/core/ui-system.*` now defines the eight IDs, allowed elements and
   modifiers, additive class application, a native button factory, and common
   geometry. Adoption is partial: legacy `.cm-*`, `.browser-*`, `.aic-*`,
   `.aic-db-*`, and `.aicn-*` hooks remain active.
7. CodeMirror's `.cm-*` classes and VS Code's native workbench views, editor
   associations and commands are integration boundaries. They cannot all be
   renamed or styled as ordinary AIC DOM. The retired Notes & Documents
   `TreeDataProvider` is not a current surface.
8. The existing release feature descriptions remain in `FUNCTIONAL_INDEX.md`.
   The machine-readable registries index them; they do not prove live host or
   cross-platform behavior that the listed tests do not exercise.

## Target architecture

```text
FEATURES.json                         COMPONENTS.json
      |                                     |
      | source/test ownership               | BEM vocabulary/migration map
      v                                     v
canonical shared modules  <------  src/core/ui-system.{js,d.ts,css}
      |
      +---- Standard Notes adapter: context, lock, transport save
      +---- Chromium adapter: vault, tabs, capture, local navigation
      +---- VS Code adapter: workspace.fs, editor protocol, workbench views, commands
```

The shared layer owns visual semantics and reusable DOM construction. Each host
adds only the integration classes needed for layout or platform APIs. A shared
component can therefore carry both its canonical BEM class and a legacy hook
during migration; the legacy hook is removed only after every producer, style,
test, and query has moved.

## BEM and modifier rules

The canonical forms are:

- block: `.aic-{component-id}`
- element: `.aic-{component-id}__{element}`
- block modifier: `.aic-{component-id}--{modifier}`
- element modifier, only when the state belongs to that element:
  `.aic-{component-id}__{element}--{modifier}`

Rules:

1. Use only IDs, elements, and modifiers declared in `UI_COMPONENTS` and
   `COMPONENTS.json`. Add both registry and runtime declarations in the same
   reviewed change when vocabulary must grow.
2. A modifier changes a component's supported visual or semantic variant; it is
   not a feature name, page URL, note identity, or arbitrary JavaScript state.
3. Prefer native state for native semantics: `disabled`, `aria-disabled`,
   `aria-busy`, `aria-current`, `hidden`, and `inert` remain authoritative.
   A BEM modifier may style a declared variant but cannot replace accessible
   state.
4. `data-*` attributes may carry ephemeral identity, geometry, or editor state
   used by behavior. Do not turn unbounded values into class names.
5. Hosts may retain integration hooks such as `.browser-panel`,
   `.aic-secondary-surface`, or CodeMirror's `.cm-editor`. New reusable visual
   rules must target the BEM component, not clone a host prefix three times.
6. Do not rename CodeMirror-owned `.cm-*` classes. Add BEM classes to AIC-owned
   nodes produced inside CodeMirror widgets, and retain `.cm-*` only where the
   editor framework or an unmigrated query requires it.
7. VS Code native views and commands remain native. `aic-tree` applies only to
   AIC-owned DOM trees inside webviews; the extension-specific native Notes &
   Documents tree has been retired.
8. Component factories create DOM and baseline semantics only. They do not read
   storage, navigate, request permissions, save notes, or retain host secrets.
9. Labels and error messages use `textContent`; URL and note metadata stay
   bounded and validated by their owning host. BEM migration must not widen
   secret exposure or copy inherited content into another note.
10. Theme differences flow through existing `--aic-*` tokens and host-provided
    values. Shared CSS owns geometry, focus, forced-colors, and reduced-motion
    behavior; host CSS owns placement in its shell.

## Registry maintenance rules

### Features

- Every shipped capability or adapter has one stable lowercase dotted ID.
- `canonicalOwners` names the modules responsible for the behavior.
- `sourceFiles` assigns every canonical `.ts`, `.js`, and `.css` source and every
  VS Code adapter/Markdown-vendor source to at least one feature.
- `entrypoints` shows how a host reaches the capability; it does not create a
  second owner.
- `verification` lists focused tests or release checks. A path is evidence of
  intended coverage, not proof that the test exercises every branch.
- Distributed files in `aic-notes/vendor/aic-editor-core` never receive their own
  feature ID. Their source feature points to `standard-notes-aic/src/core`.

### Components

- Each component ID must exactly match a key in the frozen runtime
  `UI_COMPONENTS` object.
- `bem.elements` and `bem.modifiers` must match the runtime arrays exactly.
- `legacyHooks` records selectors or native integration identities that must be
  considered before cleanup. It is a migration index, not a promise to preserve
  every selector forever.
- `adoption` remains `partial` while any listed host relies on a legacy hook for
  component identity or baseline visual behavior.

## Dependency-ordered migration plan

This is the recommended implementation path, not a statement that the migration
has completed.

### 1. Freeze registry contracts

- Necessary change: validate unique feature/component IDs, required fields,
  existing paths, exact `UI_COMPONENTS` parity, and source-file coverage.
- Prerequisites: the three registry documents and runtime UI registry exist.
- Verifiable result: registry contract tests fail on duplicate IDs, missing
  source ownership, unknown BEM vocabulary, missing paths, or an unregistered
  runtime component.

### 2. Stabilize tokens and accessibility primitives

- Necessary change: audit control sizes, spacing, radii, focus rings,
  forced-colors, reduced-motion, disabled/busy/current semantics, and theme token
  fallbacks in all three host themes.
- Prerequisites: step 1 and agreement on token meanings; no selector removal.
- Verifiable result: focused unit/style contract tests pass and browser/VS/SN
  screenshots show equivalent geometry without changing host storage or save
  behavior.

### 3. Migrate leaf controls additively

- Necessary change: apply `button`, then `field`, to AIC-owned nodes while
  retaining their legacy classes and event wiring. Replace ad-hoc button
  construction with the shared factory only where native semantics match.
- Prerequisites: stable tokens and a selector inventory for each touched control.
- Verifiable result: old selectors and new BEM selectors address the same live
  nodes; pointer, keyboard, copy, paste, masking, save, and stale-control tests
  remain green in each host.

### 4. Migrate feedback and overlays

- Necessary change: add `notice` to status/error surfaces and `menu` to popovers,
  autocomplete/add menus, and bounded dialogs without merging their lifecycle
  owners.
- Prerequisites: migrated buttons/fields and explicit focus/dismissal owners.
- Verifiable result: live regions keep correct roles; Escape/outside-click/focus
  behavior remains bounded; disposed menus cannot act on replacement documents.

### 5. Migrate structured surfaces

- Necessary change: add `card` to Security, Properties, code, diagram, and error
  surfaces; use elements for header/body/actions while retaining specialized
  behavior classes.
- Prerequisites: leaf controls, notices, and menus are stable; secret masking and
  source-mode boundaries have focused tests.
- Verifiable result: card variants share geometry and theme behavior, but raw
  Markdown, masked values, copy targets, and exact-source transactions are
  unchanged.

### 6. Migrate navigation context

- Necessary change: apply `tree` and `context` to browser history/ancestors and
  VS webview relationship trees; keep native VS Code workbench commands and views
  outside the CSS contract.
- Prerequisites: navigation metadata is separated from note Markdown and source
  callbacks remain host-owned.
- Verifiable result: ordering, current/placeholder state, exact-origin/path
  boundaries, source links, edit-save barriers, and lock teardown pass without
  inheriting or copying related-note contents.

### 7. Migrate composite toolbars

- Necessary change: apply `toolbar` elements/modifiers to editor, preview,
  Mermaid, diagram, browser, and save toolbars after their leaf actions use the
  common button geometry.
- Prerequisites: steps 2–6; responsive wrapping and touch targets are specified.
- Verifiable result: compact, wrapped, coarse-pointer, narrow-panel, and
  forced-colors checks pass in all owned DOM hosts.

### 8. Remove legacy visual ownership in small slices

- Necessary change: for one component and host at a time, move baseline visual
  declarations to shared BEM CSS, update DOM queries/tests to semantic or BEM
  hooks, then remove only proven-dead legacy declarations.
- Prerequisites: additive migration for that slice, selector-usage search, and
  before/after visual evidence.
- Verifiable result: no producer/query/test references the removed hook; shared
  and host suites plus production builds pass; the component's registry entry
  records the reduced hook set. Do not mark adoption complete while another host
  still depends on a listed legacy hook.

### 9. Distribute and verify each completed shared slice

- Necessary change: after each reviewed canonical migration, synchronize
  `aic-notes/vendor/aic-editor-core` and update integrity metadata through the
  existing scripts rather than manual copies. The initial `ui-system` files are
  already registered and distributed; later changes must keep them synchronized.
- Prerequisites: reviewed canonical implementation and passing canonical tests.
- Verifiable result: core check reports byte-identical distributed files; VS Code
  build/package and Standard Notes/browser builds pass from clean inputs.

### 10. Perform live host acceptance before declaring completion

- Necessary change: verify Standard Notes authenticated desktop/mobile where
  available, Chromium side panel in supported Chrome/Edge, and VS Code desktop
  plus representative remote/virtual workspaces.
- Prerequisites: automated tests, builds, synchronized distribution, and a
  release candidate.
- Verifiable result: keyboard, pointer/touch, screen-reader names, theme,
  forced-colors, lock/disposal, save acknowledgement, and responsive layouts are
  recorded. Expected compatibility is not reported as verified until this step
  supplies evidence.

## Completion criteria

The BEM migration is complete only when:

1. registry validation and source coverage pass;
2. all eight runtime definitions and JSON definitions are identical;
3. each AIC-owned instance carries its intended BEM block/element/modifier;
4. remaining host selectors are documented integration hooks rather than cloned
   component implementations;
5. legacy removals have no producers, queries, or tests left;
6. shared-core distribution is synchronized through the canonical scripts;
7. automated suites and production builds pass; and
8. live host evidence exists for the environments claimed by the release.

## Known coverage gaps

The registries were derived from current source entrypoints, tests, package
metadata, and existing functional indexes. They do not provide runtime call-graph
proof. Generated CodeMirror widget variants, transient failure branches, browser
permission combinations, native VS Code workbench rendering, authenticated
Standard Notes clients, remote/virtual filesystems, assistive technologies, and
every operating system still require focused or live verification. These gaps
must remain visible rather than being converted into compatibility claims.
