# Documentation conventions / Правила документації

## English

All maintained first-party product and release documents are available in English
and Ukrainian. A document either contains both languages or links directly to its
`.uk.md` companion at the top. Release packages include the localized documents
that describe the packaged product.

Generated `THIRD_PARTY_NOTICES.md` files remain verbatim so license and attribution
text is not altered. `AGENTS.md` is an execution contract for repository tools,
not product documentation, and remains one canonical instruction file. Generated
copies under `dist*` are rebuilt from the bilingual source documents.

### Choose the format from the answer

Write the answer first. If one fact or a yes/no answer resolves the reader's need,
use a complete statement with its subject and necessary conditions. Do not turn it
into a question heading followed by “Yes,” “No,” or a repeated answer. A simple
answer is a format-selection signal, not proof that a question is bad or a claim is true.

For example, write “Pinned notes stay open when you switch tabs” instead of “Do
pinned notes stay open?” Write “Install AIC Notes in code-server from its VSIX”
instead of “Can code-server install AIC Notes? Yes.”

Use a short paragraph for a necessary explanation, a list for facts or steps, a
table for comparable attributes, and a diagram when relationships need a visual.
Put exact copyable commands in code blocks. Keep a question heading only when it
helps the reader navigate a more complex answer; give the direct answer first.
This rule overrides templates that require a question or diagram in every section.

An answer is complete when its subject, result or action, and material conditions
are clear and supported by the implementation or evidence. If one sentence meets
that test, stop there. Apply the same rule to English and Ukrainian documentation.

### Compose reader-facing documents with DDK

[Document Design Kit](https://ddk.dzyha.com/prompt.html) supplies the shared
composition method: establish the reader and next action, answer the smallest set
of necessary questions, choose a format by meaning, distinguish facts from
proposals and unknowns, then stop at the first sufficient document. Markdown is
the default AIC deliverable. DDK JSON is only an explicitly requested DDK exchange
format; it neither replaces AIC Markdown nor authorizes conversion of notes.
Preserve AIC's richer Markdown syntax and typed fields.

## Українська

Уся підтримувана документація продукту й випуску доступна англійською та
українською. Документ або містить обидві мови, або на початку прямо посилається
на відповідний файл `.uk.md`. Релізні пакети містять локалізовані документи, що
описують запакований продукт.

Згенеровані `THIRD_PARTY_NOTICES.md` лишаються дослівними, щоб не змінювати текст
ліцензій і attribution. `AGENTS.md` є виконавчим контрактом для інструментів
репозиторію, а не документацією продукту, тому існує як один канонічний файл.
Згенеровані копії в `dist*` перебудовуються з двомовних джерел.

### Обирайте формат за складністю відповіді

Спочатку сформулюйте відповідь. Якщо потребу читача задовольняє один факт або
відповідь «так/ні», напишіть повне стверджувальне речення з предметом і необхідними
умовами. Не перетворюйте його на заголовок-питання та окрему відповідь «Так», «Ні»
або повтор того самого змісту. Простота відповіді підказує формат, але не доводить,
що питання погане чи твердження правдиве.

Наприклад, напишіть «Закріплена нотатка залишається відкритою під час перемикання
вкладок» замість «Чи залишається закріплена нотатка відкритою?». Напишіть
«Встановіть AIC Notes у code-server із VSIX» замість «Чи можна встановити AIC Notes
у code-server? Так».

Використовуйте короткий абзац для необхідного пояснення, список для фактів чи
кроків, таблицю для порівнюваних характеристик, а діаграму — коли вона пояснює
зв’язки краще за текст. Точні команди для копіювання подавайте в блоках коду.
Залишайте заголовок-питання лише тоді, коли він допомагає орієнтуватися в складнішій
відповіді; саму відповідь подавайте першою. Це правило має пріоритет над шаблонами,
що вимагають питання або діаграму в кожному розділі.

Відповідь є повною, коли зрозумілі її предмет, результат або дія та суттєві умови,
а твердження підтверджене реалізацією чи доказами. Якщо для цього достатньо одного
речення, зупиніться на ньому. Правило однакове для англійської та української документації.

### Створюйте документи для читача за DDK

[Document Design Kit](https://ddk.dzyha.com/prompt.html) дає спільний спосіб
композиції: визначте читача й наступну дію, дайте відповіді на найменший набір
потрібних питань, оберіть формат за змістом, відокремте факти від пропозицій і
невідомого та зупиніться на першому достатньому документі. Markdown є типовим
форматом AIC. DDK JSON застосовується лише як явно запитуваний формат обміну DDK:
він не замінює Markdown AIC і не дозволяє перетворювати нотатки. Зберігайте
розширений синтаксис Markdown і типізовані поля AIC.
