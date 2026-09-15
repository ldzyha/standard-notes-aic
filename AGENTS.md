# Shared functionality and design ownership

These rules implement the owner's direction: one shared functional/design system,
compact interfaces, BEM blocks/elements/modifiers, and explicit host boundaries.

- Before adding a feature or UI component, check `FEATURES.json`, `COMPONENTS.json`
  and `FUNCTIONAL_INDEX.md`. Extend an existing owner instead of introducing a
  parallel parser, controller, button system or visual variant in a host.
- Canonical cross-host behavior and UI primitives belong in `src/core`. Standard
  Notes and the browser import them directly; VS Code consumes the exact files in
  `CORE_FILES.json` through the existing synchronization script. Never hand-edit
  the VS Code mirror or treat mirrored files as independent implementations.
- Use the shared `ui-system` component/variant contract, semantic `--aic-*` tokens
  and BEM (`aic-block__element--modifier`). Host CSS maps platform colors and
  handles placement, not copies of component appearance or business behavior.
- Legacy `cm-*` classes and `data-*` hooks may remain for CodeMirror, selectors and
  compatibility. Do not duplicate visual rules under two names. Register a
  migration explicitly before removing a hook; migrate its consumers and tests
  together. Do not claim the legacy migration complete until the checks prove it.
- Keep one owner for saves, disposal, clipboard actions and mutations. UI elements
  emit intent to that owner; they do not add independent timers or storage writes.
- Empty states should not add ornamental headers, repeated identity/URLs or tall
  explanation panels. Keep the relevant action, then reveal details when useful.
- Check light/dark, narrow layouts, keyboard focus, coarse-pointer target sizes,
  popover bounds and disposal. Preserve masking and independent copy semantics;
  previews and registries must never include secret fixture/customer values.
- A change to a registered feature updates its implementation, registry and tests.
  Run registry checks, core parity, affected host tests and builds. Report actual
  checks and incomplete migrations; a passing source test is not a store release.

Host differences are intentional when required by storage, permissions, document
ownership or platform UI. Share the mechanism; do not erase those boundaries to
make the source files look alike.
