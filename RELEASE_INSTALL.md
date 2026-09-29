# AIC — unified release and installation / єдиний випуск та встановлення

[English](#english) · [Українська](#українська)

## English

### Release overview — September 29, 2026

This release coordinates **AIC Notes for VS Code 55.1.0**, **AIC for Standard
Notes 47.1.0**, and the **experimental Chrome/Edge extension 0.10.0** on shared
core **7.4.0**.

- Every extension bundles the same instructions for coding agents. No separate
  AIC command, server or config folder is required. VS Code offers **Copy Agent
  Instructions** and explicit workspace setup; all editors expose the guide locally.
- Browser notes can stay pinned while switching tabs. Typing adds the active
  page once under **Related links**, with the same save and Undo operation.
- Browser page capture, file import and export use consistent outline icons.
- Documentation uses direct statements for simple answers.

The existing Markdown, encryption and save boundaries remain in place. Product
and release documents ship in English and Ukrainian. The browser package remains
experimental; automated tests do not replace Chrome/Edge runtime verification.

### VS Code / code-server

1. Download [AIC Notes 55.1.0 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v55.1.0/aic-notes-55.1.0.vsix)
   and [its SHA-256 file](https://github.com/ldzyha/aic-notes/releases/download/v55.1.0/aic-notes-55.1.0.vsix.sha256).
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX…**. Select the downloaded file and reload the window. For code-server,
   run `code-server --install-extension ./aic-notes-55.1.0.vsix --force`.
3. Confirm that **AIC Notes 55.1.0** appears in Extensions.

The [VS Code release page](https://github.com/ldzyha/aic-notes/releases/tag/v55.1.0)
contains the VSIX and checksum. This local extension does not require an account
or Standard Notes synchronization.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. If AIC is already installed, you do
   not need to import it again: the client checks for updates through the same
   manifest. Restart Standard Notes if the previous version remains visible.

The desktop package is also available as [AIC 47.1.0 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/standard-notes-aic-47.1.0.zip)
with [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/standard-notes-aic-47.1.0.zip.sha256).
The hosted manifest above is the normal installation method.

### Chrome / Microsoft Edge — experimental

1. Download the [shared Chromium ZIP 0.10.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/aic-browser-chromium-0.10.0.zip)
   and [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/aic-browser-chromium-0.10.0.zip.sha256).
2. Extract the ZIP to a permanent folder. `manifest.json` must be at its root.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   select **Load unpacked**, and choose the extracted folder rather than the ZIP.
   Pin AIC to the toolbar and select its icon.

Before updating an extension that contains data, wait for **Note saved**, export
an encrypted backup, and keep its password. Replace the files in the same folder
and select **Reload** on the existing extension card. Removing a populated
extension can remove its local data. This browser package is still undergoing
[separate verification](https://github.com/ldzyha/standard-notes-aic/blob/v47.1.0/browser/VERIFICATION.md);
use synthetic data for now.

### File verification and store status

Each archive or VSIX has a neighboring `.sha256` file. On Linux, run
`sha256sum -c FILE.sha256` in the download directory. On macOS, compare
`shasum -a 256 FILE` with the value in the checksum file. On Windows PowerShell,
use `(Get-FileHash .\FILE -Algorithm SHA256).Hash`.

[AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
is already public in VS Code Marketplace; **53.0.1** is the last confirmed store
version. The 55.1.0 update requires a successful publication run. Automatic
publication is prepared but awaits repository publishing access; see the
[bilingual publishing guide](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).
Marketplace installations follow VS Code's update settings; VSIX installations
can opt in through the extension's **Auto Update** setting. code-server uses
Open VSX separately and can install the VSIX above.

Chrome Web Store and Microsoft Edge Add-ons publication remains a later step.

[AIC website](https://dzyha.com/)

---

## Українська

### Огляд випуску — 29 вересня 2026

Цей випуск об’єднує **AIC Notes для VS Code 55.1.0**, **AIC для Standard Notes
47.1.0** і **експериментальне розширення Chrome/Edge 0.10.0** на спільному ядрі
**7.4.0**.

- Кожне розширення містить однакові інструкції для агентів без окремого AIC,
  сервера чи каталогу конфігурації. VS Code має **Copy Agent Instructions** та
  явне налаштування робочого простору; локальна довідка доступна в усіх редакторах.
- Закріплена браузерна нотатка лишається відкритою під час перемикання вкладок.
  Ввід додає активну сторінку один раз до **Related links** разом із тією самою
  операцією збереження та Undo.
- Імпорт сторінки, імпорт файла й експорт мають узгоджені контурні іконки.
- Прості відповіді в документації подаються прямими твердженнями.

Markdown, шифрування та правила збереження лишаються сумісними. Документація
доступна англійською та українською. Браузерний пакет експериментальний:
автоматичні тести не замінюють перевірку в Chrome та Edge.

### VS Code / code-server

1. Завантажте [AIC Notes 55.1.0 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v55.1.0/aic-notes-55.1.0.vsix)
   і [його SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v55.1.0/aic-notes-55.1.0.vsix.sha256).
2. У VS Code відкрийте палітру команд і виконайте **Extensions: Install from
   VSIX…**, виберіть завантажений файл, потім перезавантажте вікно. Для
   code-server виконайте
   `code-server --install-extension ./aic-notes-55.1.0.vsix --force`.
3. У списку Extensions перевірте **AIC Notes 55.1.0**.

[Сторінка випуску VS Code](https://github.com/ldzyha/aic-notes/releases/tag/v55.1.0)
містить VSIX та контрольну суму. Обліковий запис чи синхронізація зі Standard
Notes цьому локальному розширенню не потрібні.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте адресу `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. У меню редактора нотатки виберіть **AIC**. Якщо AIC вже встановлений,
   повторний імпорт не потрібний: клієнт перевіряє оновлення за тим самим
   маніфестом. Якщо версія лишилася старою, перезапустіть Standard Notes.

Для настільного клієнта також доступний [архів AIC 47.1.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/standard-notes-aic-47.1.0.zip)
та [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/standard-notes-aic-47.1.0.zip.sha256).
Звичайний спосіб встановлення — адреса маніфесту вище.

### Chrome / Microsoft Edge — експериментально

1. Завантажте [спільний Chromium ZIP 0.10.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/aic-browser-chromium-0.10.0.zip)
   і [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v47.1.0/aic-browser-chromium-0.10.0.zip.sha256).
2. Розпакуйте ZIP в окрему постійну папку. У її корені має бути `manifest.json`.
3. Відкрийте `chrome://extensions` або `edge://extensions`, увімкніть
   **Developer mode**, натисніть **Load unpacked** і виберіть розпаковану папку,
   а не ZIP. Закріпіть AIC на панелі та натисніть його значок.

Для оновлення заповненого розширення спочатку дочекайтеся **Note saved**,
експортуйте зашифровану резервну копію й збережіть пароль до неї. Замініть вміст
тієї самої папки новими файлами та натисніть **Reload** на наявній картці
розширення. Не видаляйте заповнене розширення перед оновленням: локальні дані
можуть зникнути. Цей браузерний пакет ще проходить
[окремі перевірки](https://github.com/ldzyha/standard-notes-aic/blob/v47.1.0/browser/VERIFICATION.md);
поки що використовуйте синтетичні дані.

### Перевірка файлів і статус магазинів

Файл `.sha256` поруч із кожним архівом або VSIX містить очікувану контрольну
суму. У Linux виконайте `sha256sum -c ФАЙЛ.sha256` з папки завантажень; у macOS
порівняйте результат `shasum -a 256 ФАЙЛ` із сумою у файлі; у Windows
PowerShell — `(Get-FileHash .\ФАЙЛ -Algorithm SHA256).Hash`.

[AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
вже опубліковано у VS Code Marketplace; **53.0.1** — остання підтверджена версія
магазину. Оновлення 55.1.0 потребує успішного запуску публікації. Автопублікацію
підготовлено, але вона очікує доступу на публікацію для репозиторію; дивіться
[двомовну інструкцію](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md#українська).
Встановлення з Marketplace оновлюються за налаштуваннями VS Code; для VSIX можна
увімкнути **Auto Update** у налаштуваннях розширення. code-server використовує
Open VSX окремо й може встановити VSIX вище.

Публікація у Chrome Web Store та Microsoft Edge Add-ons лишається наступним етапом.

[Сайт AIC](https://dzyha.com/)
