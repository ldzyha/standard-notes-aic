# UI-архітектура AIC і правила реєстрів

[English](UI_ARCHITECTURE.md) · [Українська](UI_ARCHITECTURE.uk.md)

## Статус рішення

AIC використовує одну shared functional/design system. Канонічні механізми й
візуальні primitives належать `src/core`; host додає лише platform placement,
кольори, storage, permissions і document lifecycle.

## Поточні факти

- `FEATURES.json` визначає owner кожної поведінки й потрібні перевірки.
- `COMPONENTS.json` визначає component IDs, BEM blocks/elements/modifiers і
  legacy migration mapping.
- `FUNCTIONAL_INDEX.md` пояснює поведінку для людини.
- Standard Notes та browser споживають core напряму; VS Code синхронізує
  дозволений список файлів і byte-verifies snapshot.
- Legacy `cm-*` hooks можуть існувати для CodeMirror і тестів, але не повинні
  дублювати visual rules.

## Цільова архітектура

1. **Tokens:** semantic `--aic-*` values задають spacing, typography, color,
   borders, focus і geometry.
2. **Primitives:** button, icon button, menu, field, notice, overlay, toolbar.
3. **Structured components:** security/AIC cards, previews, navigation, editor.
4. **Host adapters:** Standard Notes bridge, browser vault/panel, VS Code
   TextDocument/webview.
5. **Owners:** одна точка для save, clipboard, disposal і mutations.

## BEM і modifiers

Новий shared component використовує `aic-block`, `aic-block__element` і
`aic-block--modifier`. Modifier описує реальну variant/state, а не випадковий
host. `data-*` і legacy classes лишаються лише як behavior/test hooks до
завершеної migration. Не можна оголошувати migration завершеною, доки consumers
і tests не переведені разом.

## Правила реєстрів

### Feature

Запис має містити purpose, owner, hosts, dependencies, state/persistence
boundaries, security/accessibility constraints і verification. Нова поведінка
розширює наявного owner, а не створює паралельний parser/controller.

### Component

Запис має визначити canonical class, elements, modifiers, semantic tokens,
legacy hooks, host placement та acceptance. Shared appearance не копіюється у
host CSS.

## Порядок міграції

1. Зафіксувати реєстри та owner boundaries.
2. Стабілізувати tokens, focus, coarse-pointer і narrow geometry.
3. Переводити leaf controls малими additive змінами.
4. Перевести notices, menus й overlays.
5. Перевести structured cards і previews.
6. Перевести navigation/context.
7. Перевести composite toolbars.
8. Видаляти legacy ownership лише після tests і registry update.
9. Синхронізувати VS Code core та перевірити parity.
10. Провести live acceptance у кожному host.

## Критерії завершення

- одна canonical реалізація shared behavior;
- один visual owner і semantic tokens;
- коректні light/dark, narrow, keyboard, coarse pointer і popover bounds;
- secrets не потрапляють у fixtures, registries чи diagnostics;
- host storage/save contracts збережені;
- registry, tests, build і package verification пройдені.
