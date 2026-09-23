# Журнал змін

[English](CHANGELOG.md) · [Українська](CHANGELOG.uk.md)

Ця українська версія ведеться для поточних і майбутніх випусків. Повний
історичний журнал ранніх версій збережено в
[`CHANGELOG.md`](CHANGELOG.md); номери версій, дати й Git history є спільними для
обох мов.

## Не випущено

### Можливість

- Таблиці, code fences, Mermaid, AIC/Properties і details отримали одну спільну
  кнопку **Вирізати** з іконкою ножиць. Вона копіює весь Markdown-блок перед
  видаленням точного source range як однієї operation. Помилка clipboard,
  застарілий source або read-only режим не видаляють блок. Shared core — 7.1.0.

## 41.1.2 — 2026-09-23

- Основна, браузерна, privacy, verification, architecture, functional index і
  changelog документація доступна англійською та українською.
- Єдина інструкція встановлення/релізу й план магазинів повністю двомовні.
- Локалізовані документи входять до release packages; згенеровані third-party
  notices зберігають точний upstream text.

## 41.1.1 — 2026-09-22

### Можливість

- Mermaid спрощено до Markdown-коду й живого прев’ю. Прев’ю має Copy, одну
  спільну іконку Edit та zoom. Visual builder, drag-and-drop і rotate видалені.
- Standard Notes, AIC Notes і browser використовують однаковий shared core 7.0.0.

### Виправлення

- Flowchart editing більше не залежить від нестабільних внутрішніх SVG IDs.
- Render debounce і last-result-wins не дозволяють повільному старому результату
  замінити нове джерело.

## 40.0.1 — 2026-09-22

- `>` — інформаційна цитата, `!>` — warning, `!>>` — error із різними акцентами
  та легким фоном; `>>> … <<<` лишається details.
- Quote та italic мають менший шрифт і більші відступи між блоками.
- Незавершений три-backtick fence лишається редагованим до завершення/focus out.

## 39.0.1 — 2026-09-22

- Збільшено простір між headings, quotes і lists.
- Thematic break відображається як центрована лінія 50–100 px із вертикальними
  відступами без зміни висоти при source reveal.

## 38.1.1 — 2026-09-22

- Account preset замінено порожнім text row для email/username.
- Password і TOTP є окремими необов’язковими полями.
- На вузьких екранах label та values переносяться разом; fixed min-width і
  values-only scroll видалені.
- Password generation приховано на ширині 600 px або менше.

## 37.2.0 — 2026-09-15

- Copy section копіює одну AIC section як окремий fenced block без зміни source.
- Browser 0.4.0 додав зашифрований Global Shared і library v3.
- Збережено чітку межу між Standard Notes, VS Code та browser storage.

## Раніші випуски

Повний список 3.2.0–36.0.1, технічні деталі, тести й migration notes дивіться у
[англійському журналі](CHANGELOG.md). Нові записи додаються обома мовами в межах
однієї зміни.
