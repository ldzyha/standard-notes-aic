# Функціональний індекс AIC для Standard Notes

[English](FUNCTIONAL_INDEX.md) · [Українська](FUNCTIONAL_INDEX.uk.md)

Цей документ є українською навігаційною картою. Точні імена модулів, повна
матриця тестів та історичні записи залишаються в канонічному
[`FUNCTIONAL_INDEX.md`](FUNCTIONAL_INDEX.md). Реєстри `FEATURES.json` і
`COMPONENTS.json` є машинними контрактами й не дублюються перекладом.

## Межі продуктів

- `src/core` — єдине джерело поведінки редактора, parser, previews, AIC fields,
  clipboard intent, Mermaid та UI primitives.
- Standard Notes і browser імпортують core напряму.
- VS Code отримує точну копію файлів через `CORE_FILES.json` та sync script;
  vendor-копію не редагують вручну.
- Host відповідає за storage, save, document identity, permissions, navigation
  та platform theme.

## Поточний контракт

- Markdown лишається джерелом даних; previews не переписують його самостійно.
- Один persistence owner обробляє save, disposal і mutations.
- Поля з маскуванням мають окремі copy targets; raw source, exports та clipboard
  можуть містити відкриті значення.
- Вузькі layouts переносять label і його values разом, без values-only scroll.
- Toolbar переноситься рядками і зберігає 44 px targets для coarse pointer.
- Source/Preview є локальним режимом поточної нотатки й не зберігається в текст.

Випуск 45.0.1 на спільному ядрі 7.3.1 повертає генерацію пароля на вузькі екрани.

Порожні редаговані секретні частини (`*|`) показують **Generate password** на
будь-якій ширині панелі незалежно від назви. Параметри переносяться на вузьких
екранах. Генерація працює локально, не перезаписує заповнені значення й недоступна
в режимі читання.

Кнопка копіювання ненадовго показує галочку після успіху або хрестик після
помилки, зберігає доступну назву дії та повідомляє стан для читача екрана.
Більші заголовки секцій, окремий нейтральний фон груп і
легке чергування сірих рядків допомагають швидше знаходити записи.

Перенесення AIC-рядків та сортування після редагування зберігаються.

Назви, email та логіни займають природну ширину. Спочатку ціле значення
переходить на наступний рядок; текст переноситься всередині лише тоді, коли
не вміщується на повній доступній ширині. Пароль має компактну кнопку копіювання
із замком, а короткі дані картки й TOTP-коди залишаються читабельними. Меню `+`
йде після останнього значення, записи розділяють легкі лінії. Сенсорні кнопки
зберігають область натискання 44 px.

Після виходу з редагування джерела AIC-блоку або перемикання всієї нотатки з
джерела у прев’ю рядки кожної секції сортуються за назвою: без урахування регістру
та з природним порядком чисел. Рядки без назви зберігають свій порядок наприкінці.
Порядок секцій, порядок значень і точний текст значень не змінюються. Відкриття
прев’ю, копіювання й ручне переставлення не запускають сортування.

## Актуальні випуски

### 45.0.1 / core 7.3.1

Генерація для порожніх парольних полів доступна на будь-якій ширині. Панель
переносить параметри в межах доступного місця. Генерація лишається локальною та
явною; заповнені поля й документи в режимі читання не змінюються.

### 44.1.0 / core 7.3.0

Спільний renderer відповідає за перенесення цілих значень, копіювання пароля
кнопкою із замком і меню після останнього значення. Сортування при виході з
джерела зберігає точні значення й підтримує звичайний Undo; некоректні блоки не
змінюються. Контракт перевіряє `test/security-source-sort.test.ts` разом із
тестами прев’ю та дій полів.

### 43.1.0 / core 7.2.0

Credential row лишається одним connected layout на вузькому екрані. Label
займає ширину свого тексту, values отримують решту місця, protected copy показує
замок і шість крапок, а одне меню `+` додає Field, Row або Section у кінці
останнього значення. Записи розділяє легка лінія без строкатого фону.

### 42.1.0 / core 7.1.0

Усі керовані preview-блоки мають однакову кнопку **Вирізати** з іконкою ножиць.
Вона спочатку копіює повний Markdown блоку разом із delimiters, а потім прибирає
саме цей source range як одну undoable operation.

### 41.1.2 / core 7.0.0

Основні product, privacy, verification, architecture, provenance, functional
index і changelog documents мають English/Ukrainian navigation та входять до
release packages. Generated third-party notices не перекладаються, щоб зберегти
точний upstream attribution text.

### 41.1.1 / core 7.0.0

Mermaid має код і live preview. У preview лишилися Copy, одна shared Edit icon і
zoom. Visual builder, drag-and-drop та rotate видалені. Рендер має debounce,
last-result-wins і не прибирає попередній SVG під час очікування нового.

### 40.0.1 / core 6.2.2

`>` — info, `!>` — warning, `!>>` — error із різними side accents і легким
фоном. `>>> … <<<` — details. Quote й italic менші. Незавершений code fence
лишається source до завершення й focus out.

### 39.0.1 / core 6.2.1

Заголовки, цитати й списки мають відступи. Thematic break — центрована лінія
50–100 px із вертикальним простором; source reveal не змінює висоту рядка.

### 38.1.1 / core 6.2.0

Account preset замінений порожнім text row. Password і TOTP окремі. На вузьких
екранах label та values переносяться як одна connected row; генерація пароля
прихована на ширині 600 px або менше.

## AIC fields

Один top-level fenced `aic` document володіє structured UI. Типи:

| Separator | Значення |
| --------- | -------- |
| `         | `        | текст           |
| `*        | `        | секрет          |
| `#        | `        | TOTP seed       |
| `_        | `        | card            |
| `1        | `        | unused one-time |
| `0        | `        | used one-time   |

Blank/Card/One-time — presets цих типів. Межі: 16 sections, 64 rows у section,
64 parts у row, 65 536 UTF-16 units на block, 16 384 encoded units на row.
Invalid preview показує source line/column і безпечну repair advice без секрету.

## Основні можливості редактора

- headings, lists, task checkbox, tables, details, links, code fences;
- task controls, slash templates та local guide;
- source/preview ranges із безпечним caret navigation;
- parser-backed Markdown links;
- AIC field copy/paste, one-time state, password generation, recovery codes;
- Authenticator JSON conversion із all-or-nothing validation;
- bounded Mermaid queue й sanitized strict SVG;
- light/dark, keyboard focus, narrow/coarse-pointer layouts;
- clipboard requests, які host звіряє з identity, generation і surface state.

## Browser host

Browser зберігає encrypted library локально. Page належить exact URL, Domain —
exact origin, Global — одному профілю. CSP блокує outbound runtime connections.
Capture виконується лише після explicit action. Синхронізації, telemetry,
autofill та account немає.

## Перевірка випуску

Зміна shared feature потребує:

1. оновити implementation, registries і tests;
2. перевірити core parity із VS Code;
3. запустити format, lint, typecheck, unit та production builds;
4. перевірити affected hosts, narrow/light/dark/keyboard states;
5. зібрати release artifacts і звірити checksums;
6. не називати успішний source test магазинною публікацією.
