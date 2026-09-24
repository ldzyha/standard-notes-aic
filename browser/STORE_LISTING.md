# Chrome Web Store listing draft / Чернетка сторінки Chrome Web Store

[English](#english) · [Українська](#українська)

## English

### Saved dashboard status — September 24, 2026

[Chrome Web Store draft](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/listing)
ID: `mokndlkbkhnemhhcahddhdgihgdckbhp`. **Not submitted for review.**

- Developer registration is complete; the one-time **US$5** fee was paid.
  Public publisher: **AIC**. The owner declared **Non-trader**.
- Contact: **leonid@dzyha.com**. A verification email was sent; verification is
  **not confirmed**. Homepage: **https://dzyha.com/**; support: the repository's
  Issues page below.
- Package UI confirms **Draft 0.9.3**, six permissions and no `activeTab`; the
  extension is not published. The **0.9.3 ZIP** was uploaded. A combined English/Ukrainian description of
  **3,026 characters** was saved. Category: **Workflow & Planning**; interface
  language: **English**. The icon and promo tile were uploaded and saved.
- Privacy settings were saved: six permission explanations, **no remote code**,
  five data categories (**personally identifiable**, **financial/payment**,
  **authentication**, **web history**, **website content**), all three Limited
  Use certification checkboxes, and the public privacy-policy URL below.
- Distribution is **free**, **public** and available in **all regions**; the
  dashboard defaults were confirmed. English/Ukrainian reviewer steps were saved.

The dashboard's **Why can't I submit?** lists exactly two remaining requirements:

1. At least one screenshot or video.
2. A verified contact email.

Installed-Chrome acceptance remains a separate internal check. The current
automation environment blocks `chrome://extensions` by URL policy; native
installation, panel screenshots and acceptance checks require an ordinary
user-controlled Chrome session. This tooling restriction leaves those checks
unverified. The selected
homepage currently lacks a direct AIC privacy link; its authoritative source is
unresolved, and no website deployment has been performed. These are not reported
as additional dashboard validation messages. Existing 0.9.2 release assets remain
unchanged.

### Release and links

Draft for candidate **AIC — Page notes 0.9.3**. The published baseline is
0.9.2 in the [46.0.2 release](https://github.com/ldzyha/standard-notes-aic/releases/tag/v46.0.2).
The uploaded 0.9.3 candidate removes redundant `activeTab` permission. Its ZIP
checksum, manifest and bundled files were checked locally; installed-Chrome
acceptance remains outstanding. This document does not confirm store approval.

- Candidate package: `aic-browser-chromium-0.9.3.zip` and its matching `.sha256`.
- [Public privacy policy](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/PRIVACY.md).
  Its URL returned HTTP 200 without authentication on September 24, 2026; the
  policy links to Ukrainian. A dedicated GitHub Pages privacy page is not configured.
- [Product homepage](https://dzyha.com/).
- [Support](https://github.com/ldzyha/standard-notes-aic/issues).
- Saved category: **Workflow & Planning**. The package's interface is English;
  bilingual listing text and documentation do not make the interface localized.

### Short description

Local Markdown notes for web pages. Import read-only content, navigate by domain, and export your own backups.

### Detailed description reference

Keep notes beside the web page you are reading. AIC opens a Markdown editor in
Chrome's side panel and connects each note to its exact page URL.

- Write notes with headings, lists, tasks, tables, code blocks, collapsible
  sections and Mermaid diagrams. Switch between Markdown and preview.
- Import readable selected text or page content when you choose. AIC requests
  access to the selected site and does not edit the website or fill its forms.
- Organize page notes by domain, with optional notes shared within one domain
  or across this browser profile.
- Keep structured text, masked values, card fields and one-time codes in your
  notes. Copy values manually; generate a password only for an empty field.
- Export Markdown or a password-protected backup of your local library.

In version 0.9.3, AIC stores its library encrypted in this browser profile. It has no AIC account,
cloud service, telemetry or synchronization. The panel keeps up to 100 recent
page URLs while active and unlocked; it does not query Chrome's history database.
Clipboard reads happen only after an explicit Paste action. Notes and imported
content are not sent to the developer.

This is an experimental desktop extension for Chrome 140 or newer. Incognito is
not supported. Keep an encrypted backup and its passphrase: there is no server
recovery. Markdown exports and copied values are plaintext. Encryption does not
protect an unlocked extension or a compromised device; AIC is not an independently
audited password manager.

### Single purpose

Create, read and organize local Markdown notes associated with web pages in
Chrome's side panel, including deliberate page-content import and local backup.

### Permission explanations

| Manifest entry                       | Candidate 0.9.3 explanation                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel`                          | Displays the editor and page-note navigation beside the active website.                                                                                                                                               |
| `storage`                            | Persists the encrypted local library and a session-only unlock key in trusted extension contexts. No `storage.sync` is used.                                                                                          |
| `tabs`                               | Reads the active tab's URL and title in the panel's own window to select the correct note and maintain its local recent-pages list. Explicit navigation opens a saved source URL or activates its existing tab.       |
| `scripting`                          | Runs the bundled read-only capture function after the user requests page or selection import. It excludes forms, editable controls, hidden content and inaccessible frames; it does not insert data into the website. |
| Optional `http://*/*`, `https://*/*` | Allows import from a user-selected HTTP(S) site. The panel requests only the current origin when Import is clicked; broad access is not granted at installation.                                                      |
| `clipboardRead`                      | Reads current clipboard text only when the user presses Paste on an empty typed field. There is no background polling or clipboard history.                                                                           |
| `clipboardWrite`                     | Copies the note, selected block or explicitly selected field value after a user action. Masked values are intentionally copied as plaintext.                                                                          |

Remote code: **No**. Runtime JavaScript and editor resources are bundled; the
manifest blocks outgoing extension connections and remote frames.

### Data-use draft

AIC processes user data locally. Do not mark “no user data” solely because the
extension has no server: Chrome explicitly requires disclosure for local
processing and storage. [Chrome user-data guidance](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

| Data category to disclose           | Actual handling                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website content                     | Markdown typed or imported by the user, readable page/selection content and source links.                                                                           |
| Web history / browsing activity     | Exact URLs and titles needed for page-note association and the bounded local recent-pages list; no history-database access.                                         |
| Authentication information          | A local vault passphrase during setup/unlock, session key, and passwords, TOTP seeds or recovery codes deliberately placed in typed fields or notes.                |
| Personally identifiable information | Usernames, email addresses and other identifying text when the user writes, pastes or imports them into notes. No AIC account or registration profile is collected. |
| Financial/payment information       | Card-type fields and other financial text only when the user deliberately supplies it. AIC does not perform payments or read website form fields.                   |

Arbitrary user notes and selected website content may also contain health,
communications or location information. The extension does not independently
request those services, detect those categories or build profiles. Match the
live dashboard's category definitions to this actual handling; do not describe
user-chosen sensitive content as impossible to process.

Data stays in the encrypted local library; plaintext exists in the editor while
unlocked and in deliberate Markdown exports/clipboard operations. There is no
developer server, advertising use, sale, data transfer to third parties or
creditworthiness/lending use. Users delete local notes or remove the extension;
downloaded exports remain under their control. The developer does not receive
or read note contents. The privacy policy must make these uses and limited-use
commitments explicit. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

### Reviewer instructions and remaining inputs

Use synthetic data in a normal Chrome 140+ window. Open AIC, create a local
passphrase, write a page note, and wait for **Note saved**. Reopen the panel and
unlock it to check persistence. Try Import on a public text page, granting access
only to that site; try explicit Copy/Paste and Lock. No reviewer account or server
credentials are needed.

Record installed-Chrome acceptance in [VERIFICATION.md](VERIFICATION.md). Existing
renderer checks do not establish real permission-prompt, clipboard, worker,
restart and Lock behavior in an installed Chrome package.

The [440 × 280 promo tile](store-assets/small-promo-440x280.png) and extension
icon are uploaded and saved; an [editable SVG](store-assets/small-promo-440x280.svg)
is retained. Native screenshots are **not ready**. Capture the real installed
build with synthetic notes; do not substitute fabricated interface screenshots.
The package has no `_locales` directories. Both languages were saved together in
one description without claiming a Ukrainian interface.
[Store listing guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).

## Українська

### Збережений стан панелі — 24 вересня 2026

[Чернетка Chrome Web Store](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/listing)
ID: `mokndlkbkhnemhhcahddhdgihgdckbhp`. **На перевірку не подано.**

- Реєстрацію розробника завершено; одноразовий внесок **5 доларів США** сплачено.
  Публічне ім’я видавця: **AIC**. Власник заявив статус **Non-trader**.
- Контакт: **leonid@dzyha.com**. Лист перевірки надіслано; адресу **ще не
  підтверджено**. Домашня сторінка: **https://dzyha.com/**; підтримка — Issues
  репозиторію за посиланням нижче.
- Панель пакета підтверджує **Draft 0.9.3**, шість дозволів і відсутність
  `activeTab`; розширення не опубліковано. **ZIP 0.9.3** завантажено. Збережено спільний англійський/український опис на
  **3 026 символів**. Категорія: **Workflow & Planning**; мова інтерфейсу:
  **English**. Іконку та промоплитку завантажено й збережено.
- Збережено налаштування приватності: шість пояснень дозволів, **без віддаленого
  коду**, п’ять категорій даних (**персональні ідентифікаційні**, **фінансові /
  платіжні**, **автентифікаційні**, **історія перегляду**, **вміст сайтів**),
  усі три декларації Limited Use та публічну адресу політики нижче.
- Розповсюдження **безкоштовне**, **публічне**, в **усіх регіонах**; типові
  налаштування панелі підтверджено. Двомовні кроки для рецензента збережено.

Панель **Why can't I submit?** показує рівно дві невиконані вимоги:

1. Щонайменше один скриншот або відео.
2. Підтверджена контактна email-адреса.

Приймання встановленого Chrome-пакета залишається окремою внутрішньою перевіркою.
Поточне середовище автоматизації блокує `chrome://extensions` політикою URL;
встановлення, справжні скриншоти панелі та приймання потрібно виконати у звичайній
сесії Chrome під керуванням користувача. Через це обмеження інструмента ці
перевірки залишаються невиконаними.
На вибраній домашній сторінці немає прямого посилання на приватність AIC;
актуальне джерело сайту не визначено, публікацію змін сайту не виконували.
Це не додаткові повідомлення валідації панелі. Наявні файли випуску 0.9.2 не змінено.

### Випуск і посилання

Чернетка для кандидата **AIC — Page notes 0.9.3**. Опублікована базова версія —
0.9.2 у [випуску 46.0.2](https://github.com/ldzyha/standard-notes-aic/releases/tag/v46.0.2).
Завантажений кандидат 0.9.3 прибирає зайвий дозвіл `activeTab`. Контрольну суму,
маніфест і файли ZIP перевірено локально; приймання встановленого Chrome-пакета
ще не завершено. Це не підтвердження схвалення.

- Пакет кандидата: `aic-browser-chromium-0.9.3.zip` та відповідний `.sha256`.
- [Публічна політика приватності](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/PRIVACY.md).
  24 вересня 2026 року адреса повернула HTTP 200 без авторизації. Політика має
  посилання на українську версію; окрему сторінку приватності GitHub Pages не налаштовано.
- [Сторінка продукту](https://dzyha.com/).
- [Підтримка](https://github.com/ldzyha/standard-notes-aic/issues).
- Збережена категорія: **Workflow & Planning**. Інтерфейс пакета англійський;
  двомовний опис і документація не означають локалізованого інтерфейсу.

### Короткий опис

Локальні Markdown-нотатки для вебсторінок. Імпортуйте текст, знаходьте нотатки за доменом і зберігайте власні резервні копії.

### Довідковий докладний опис

Тримайте нотатки поруч зі сторінкою, яку читаєте. AIC відкриває Markdown-редактор
у бічній панелі Chrome та прив’язує кожну нотатку до точної URL сторінки.

- Пишіть нотатки із заголовками, списками, завданнями, таблицями, кодом,
  акордеонами й Mermaid-діаграмами. Перемикайте Markdown і прев’ю.
- За власною дією імпортуйте читабельний виділений текст або вміст сторінки.
  AIC запитує доступ до вибраного сайту, не редагує його й не заповнює форми.
- Знаходьте нотатки за доменом; за потреби створюйте спільні нотатки для одного
  домену або всього поточного профілю браузера.
- Зберігайте в нотатках текст, масковані значення, поля карток та одноразові
  коди. Копіюйте значення вручну; генеруйте пароль лише в порожньому полі.
- Експортуйте Markdown або захищену паролем резервну копію всієї бібліотеки.

У версії 0.9.3 AIC зберігає бібліотеку зашифрованою в поточному профілі браузера. Облікового
запису AIC, хмарного сервісу, телеметрії та синхронізації немає. Активна й
розблокована панель пам’ятає до 100 останніх URL, не читаючи базу історії Chrome.
Буфер обміну читається лише після явного натискання Paste. Нотатки й імпортований
вміст не передаються розробнику.

Це експериментальне настільне розширення для Chrome 140 або новішого. Incognito
не підтримується. Зберігайте зашифровану копію та її пароль: серверного
відновлення немає. Markdown-експорт і скопійовані значення є відкритим текстом.
Шифрування не захищає розблоковане розширення чи скомпрометований пристрій;
AIC не є незалежно аудитованим менеджером паролів.

### Єдине призначення

Створення, читання й упорядкування локальних Markdown-нотаток до вебсторінок у
бічній панелі Chrome, з явним імпортом вмісту та локальними резервними копіями.

### Пояснення дозволів

| Дозвіл маніфесту                          | Використання в кандидатові 0.9.3                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel`                               | Показує редактор і навігацію нотаток поруч з активним сайтом.                                                                                                                      |
| `storage`                                 | Зберігає зашифровану локальну бібліотеку та ключ лише поточної сесії в довірених контекстах розширення. `storage.sync` не використовується.                                        |
| `tabs`                                    | Читає URL і назву активної вкладки у вікні панелі для вибору нотатки та локального списку останніх сторінок. Явна навігація відкриває збережену адресу або активує наявну вкладку. |
| `scripting`                               | Запускає вбудоване читання сторінки після запиту імпорту. Форми, редаговані елементи, прихований вміст і недоступні frames виключені; запису на сайт немає.                        |
| Необов’язкові `http://*/*`, `https://*/*` | Дають змогу імпортувати з обраного HTTP(S)-сайту. Панель запитує лише поточний origin після натискання Import; загальний доступ не надається під час встановлення.                 |
| `clipboardRead`                           | Читає поточний буфер лише після Paste у порожньому типізованому полі. Фонового опитування та історії буфера немає.                                                                 |
| `clipboardWrite`                          | Копіює нотатку, блок або обране значення після дії користувача. Масковані значення явно копіюються відкритим текстом.                                                              |

Віддалений код: **ні**. JavaScript і ресурси редактора входять до пакета;
маніфест блокує вихідні з’єднання розширення та віддалені frames.

### Чернетка декларації даних

AIC обробляє дані локально. Не вибирайте «немає даних користувача» лише через
відсутність сервера: Chrome вимагає описувати локальну обробку й зберігання.
[Вимоги Chrome до даних](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

| Категорія для розкриття          | Фактична обробка                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Вміст сайтів                     | Написаний або імпортований Markdown, читабельний вміст сторінки чи виділення та посилання на джерело.                                                    |
| Історія / перегляд сайтів        | Точні URL і назви для прив’язки нотатки та обмеженого локального списку останніх сторінок; без доступу до бази історії.                                  |
| Автентифікаційні дані            | Пароль локального сховища під час створення/розблокування, ключ сесії, а також паролі, TOTP seeds чи коди відновлення, явно додані до полів або нотаток. |
| Персональні ідентифікаційні дані | Логіни, email та інший ідентифікаційний текст, який користувач пише, вставляє чи імпортує. Профіль реєстрації AIC не збирається.                         |
| Фінансові / платіжні дані        | Поля типу Card та інший фінансовий текст лише за явним введенням користувача. AIC не здійснює платежів і не читає поля форм сайтів.                      |

Довільні нотатки й вибраний вміст можуть також містити відомості про здоров’я,
листування чи місцезнаходження. Розширення окремо не запитує такі сервіси, не
визначає ці категорії й не створює профілів. Зіставте визначення категорій у
поточній панелі магазину з цією поведінкою; не описуйте обрану користувачем
чутливу інформацію як таку, яку програма взагалі не може обробляти.

Дані лишаються в зашифрованій локальній бібліотеці; відкритий текст є в
розблокованому редакторі та під час явного експорту Markdown чи копіювання.
Сервера розробника, реклами, продажу, передавання третім сторонам чи використання
для кредитоспроможності немає. Користувач видаляє локальні нотатки або розширення;
експортовані файли лишаються під його контролем. Розробник не отримує й не читає
вміст нотаток. Політика приватності має явно описувати ці правила й обмежене
використання. [Поля приватності](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

### Перевірка рецензентом і відсутні дані

Використовуйте синтетичні дані у звичайному вікні Chrome 140+. Відкрийте AIC,
задайте локальний пароль, напишіть нотатку й дочекайтеся **Note saved**.
Відкрийте панель повторно та розблокуйте її. На публічній текстовій сторінці
спробуйте Import, надаючи доступ лише цьому сайту; перевірте явні Copy/Paste і
Lock. Тестового акаунта чи серверного пароля не потрібно.

Запишіть приймання встановленого Chrome-пакета у [VERIFICATION.md](VERIFICATION.md).
Перевірки редактора не доводять роботу справжніх запитів дозволу, буфера, worker,
перезапуску та Lock у встановленому розширенні.

[Промоплитку 440 × 280](store-assets/small-promo-440x280.png) та іконку розширення
завантажено й збережено; [редагований SVG](store-assets/small-promo-440x280.svg)
лишився у репозиторії. Справжні скриншоти **ще не готові**. Потрібно зняти
встановлену збірку із синтетичними нотатками, не замінюючи інтерфейс вигаданими
скриншотами. У пакеті немає папок `_locales`. Обидві мови збережено в одному
описі без заяви про український інтерфейс.
[Інструкція сторінки магазину](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).
