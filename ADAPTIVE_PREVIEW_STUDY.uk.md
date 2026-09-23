# Адаптивний preview workspace — архітектурний огляд

[English](ADAPTIVE_PREVIEW_STUDY.md) · [Українська](ADAPTIVE_PREVIEW_STUDY.uk.md)

Це український виклад дослідження. Повні посилання на модулі, line-level evidence
і всі альтернативи містяться в
[`ADAPTIVE_PREVIEW_STUDY.md`](ADAPTIVE_PREVIEW_STUDY.md).

## Поточний стан

AIC вже має parser-backed preview ranges, in-place source reveal, host-owned
persistence та спільні previews для Standard Notes, browser і VS Code. Головний
ризик — створити другу модель документа, другий save owner або окремі host
implementations під виглядом нового workspace.

Виявлені обмеження:

- caret і selection мають лишатися CodeMirror-owned;
- preview replacement мусить бути atomic і disposable;
- nested interactive controls не повинні перехоплювати selection документа;
- heavy previews потребують bounded queue, debounce і stale-result rejection;
- narrow layout має переносити connected content без горизонтального values-only
  scroll;
- source text є єдиним канонічним станом.

## Рекомендована ціль

Адаптивний workspace — це projection поточного Markdown, а не новий file format.
Він може показувати source і preview одночасно, змінювати розміщення за шириною
і зберігати один selection/save/undo contract.

Контракт взаємодії:

- Edit переводить конкретний block range у source;
- preview оновлюється з debounce і last-result-wins;
- pending render зберігає попередній успішний preview;
- focus out завершує тимчасовий edit mode лише там, де це вже дозволено
  Markdown contract;
- zoom належить preview, не document source;
- host отримує mutation intent і вирішує save.

## Дані

Не вводити окрему workspace database. Мінімальний стан — document identity,
revision/generation, selection, transient view mode та bounded preview cache.
Persistence лишається у Standard Notes item, browser encrypted library або VS
Code TextDocument.

## Послідовність переходу

1. Зафіксувати ranges і ownership tests.
2. Винести shared layout tokens/primitives.
3. Додати projection без нового persistence.
4. Перевести один preview тип і перевірити disposal.
5. Перевірити narrow/light/dark/keyboard/coarse pointer.
6. Розширювати лише після реальних вимірювань.

## Бюджети перевірки

- жодного save під час простого render/focus;
- не більше одного актуального heavy render на block;
- stale async result не змінює новий document;
- disposal прибирає timers, observers і listeners;
- source, undo і selection зберігаються при layout switch;
- package regressions запускаються в усіх affected hosts.

## Рішення

Використовувати наявну CodeMirror/source model і shared preview ownership.
Не будувати паралельний canvas/document editor. Mermaid у релізі 41.1.1 вже
реалізує спрощену частину цілі: код, live preview, Copy/Edit і preview-only zoom.
