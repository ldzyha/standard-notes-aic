# AIC — unified release and installation / єдиний випуск та встановлення

[English](#english) · [Українська](#українська)

## English

### Release overview — September 24, 2026

This release coordinates **AIC Notes for VS Code 54.0.2**, **AIC for Standard
Notes 46.0.2**, and the **experimental Chrome/Edge extension 0.9.2** on shared
core **7.3.2**. It fixes accordion layout and unsaved-state feedback.

1. Keep linked-code comments inside their details accordion, with compact headers
   and readable nested content.
2. Keep the editor background unchanged for unsaved drafts. The Save button pulses
   while changes need saving; reduced motion uses a static indicator. Only the
   host's acknowledgement marks a draft saved, and failures retain its changes.

These fixes retain ordinary Markdown and the existing save lifecycle. Product
and release documents ship in English and Ukrainian.

### VS Code / code-server

1. Download [AIC Notes 54.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v54.0.2/aic-notes-54.0.2.vsix)
   and [its SHA-256 file](https://github.com/ldzyha/aic-notes/releases/download/v54.0.2/aic-notes-54.0.2.vsix.sha256).
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX…**. Select the downloaded file and reload the window. For code-server,
   run `code-server --install-extension ./aic-notes-54.0.2.vsix --force`.
3. Confirm that **AIC Notes 54.0.2** appears in Extensions.

The [VS Code release page](https://github.com/ldzyha/aic-notes/releases/tag/v54.0.2)
contains the VSIX and checksum. This local extension does not require an account
or Standard Notes synchronization.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. If AIC is already installed, you do
   not need to import it again: the client checks for updates through the same
   manifest. Restart Standard Notes if the previous version remains visible.

The desktop package is also available as [AIC 46.0.2 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/standard-notes-aic-46.0.2.zip)
with [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/standard-notes-aic-46.0.2.zip.sha256).
The hosted manifest above is the normal installation method.

### Chrome / Microsoft Edge — experimental

1. Download the [shared Chromium ZIP 0.9.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/aic-browser-chromium-0.9.2.zip)
   and [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/aic-browser-chromium-0.9.2.zip.sha256).
2. Extract the ZIP to a permanent folder. `manifest.json` must be at its root.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   select **Load unpacked**, and choose the extracted folder rather than the ZIP.
   Pin AIC to the toolbar and select its icon.

Before updating an extension that contains data, wait for **Note saved**, export
an encrypted backup, and keep its password. Replace the files in the same folder
and select **Reload** on the existing extension card. Removing a populated
extension can remove its local data. This browser package is still undergoing
[separate verification](https://github.com/ldzyha/standard-notes-aic/blob/v46.0.2/browser/VERIFICATION.md);
use synthetic data for now.

### File verification and store status

Each archive or VSIX has a neighboring `.sha256` file. On Linux, run
`sha256sum -c FILE.sha256` in the download directory. On macOS, compare
`shasum -a 256 FILE` with the value in the checksum file. On Windows PowerShell,
use `(Get-FileHash .\FILE -Algorithm SHA256).Hash`.

[AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
is already public in VS Code Marketplace; **53.0.1** is the last confirmed store
version. The 54.0.2 update requires a successful publication run. Automatic
publication is prepared but awaits repository publishing access; see the
[bilingual publishing guide](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).
Marketplace installations follow VS Code's update settings; VSIX installations
can opt in through the extension's **Auto Update** setting. code-server uses
Open VSX separately and can install the VSIX above.

Chrome Web Store and Microsoft Edge Add-ons publication remains a later step.

[AIC website](https://dzyha.com/)

---

## Українська

### Огляд випуску — 24 вересня 2026

Цей випуск об’єднує **AIC Notes для VS Code 54.0.2**, **AIC для Standard Notes
46.0.2** і **експериментальне розширення Chrome/Edge 0.9.2** на спільному ядрі
**7.3.2**. Виправлено розміщення акордеонів та індикацію незбережених змін.

1. Коментарі до пов’язаного коду лишаються всередині свого акордеона; заголовки
   компактні, а вкладений вміст читабельний.
2. Незбережені зміни не змінюють фон редактора. Кнопка Save пульсує, доки зміни
   потребують збереження; за налаштування reduced motion індикатор статичний.
   Лише підтвердження хоста позначає чернетку збереженою; помилка не стирає зміни.

Зберігаються звичайний Markdown та наявні правила збереження. Документація
продукту й випуску доступна англійською та українською.

### VS Code / code-server

1. Завантажте [AIC Notes 54.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v54.0.2/aic-notes-54.0.2.vsix)
   і [його SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v54.0.2/aic-notes-54.0.2.vsix.sha256).
2. У VS Code відкрийте палітру команд і виконайте **Extensions: Install from
   VSIX…**, виберіть завантажений файл, потім перезавантажте вікно. Для
   code-server виконайте
   `code-server --install-extension ./aic-notes-54.0.2.vsix --force`.
3. У списку Extensions перевірте **AIC Notes 54.0.2**.

[Сторінка випуску VS Code](https://github.com/ldzyha/aic-notes/releases/tag/v54.0.2)
містить VSIX та контрольну суму. Обліковий запис чи синхронізація зі Standard
Notes цьому локальному розширенню не потрібні.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте адресу `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. У меню редактора нотатки виберіть **AIC**. Якщо AIC вже встановлений,
   повторний імпорт не потрібний: клієнт перевіряє оновлення за тим самим
   маніфестом. Якщо версія лишилася старою, перезапустіть Standard Notes.

Для настільного клієнта також доступний [архів AIC 46.0.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/standard-notes-aic-46.0.2.zip)
та [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/standard-notes-aic-46.0.2.zip.sha256).
Звичайний спосіб встановлення — адреса маніфесту вище.

### Chrome / Microsoft Edge — експериментально

1. Завантажте [спільний Chromium ZIP 0.9.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/aic-browser-chromium-0.9.2.zip)
   і [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v46.0.2/aic-browser-chromium-0.9.2.zip.sha256).
2. Розпакуйте ZIP в окрему постійну папку. У її корені має бути `manifest.json`.
3. Відкрийте `chrome://extensions` або `edge://extensions`, увімкніть
   **Developer mode**, натисніть **Load unpacked** і виберіть розпаковану папку,
   а не ZIP. Закріпіть AIC на панелі та натисніть його значок.

Для оновлення заповненого розширення спочатку дочекайтеся **Note saved**,
експортуйте зашифровану резервну копію й збережіть пароль до неї. Замініть вміст
тієї самої папки новими файлами та натисніть **Reload** на наявній картці
розширення. Не видаляйте заповнене розширення перед оновленням: локальні дані
можуть зникнути. Цей браузерний пакет ще проходить
[окремі перевірки](https://github.com/ldzyha/standard-notes-aic/blob/v46.0.2/browser/VERIFICATION.md);
поки що використовуйте синтетичні дані.

### Перевірка файлів і статус магазинів

Файл `.sha256` поруч із кожним архівом або VSIX містить очікувану контрольну
суму. У Linux виконайте `sha256sum -c ФАЙЛ.sha256` з папки завантажень; у macOS
порівняйте результат `shasum -a 256 ФАЙЛ` із сумою у файлі; у Windows
PowerShell — `(Get-FileHash .\ФАЙЛ -Algorithm SHA256).Hash`.

[AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
вже опубліковано у VS Code Marketplace; **53.0.1** — остання підтверджена версія
магазину. Оновлення 54.0.2 потребує успішного запуску публікації. Автопублікацію
підготовлено, але вона очікує доступу на публікацію для репозиторію; дивіться
[двомовну інструкцію](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md#українська).
Встановлення з Marketplace оновлюються за налаштуваннями VS Code; для VSIX можна
увімкнути **Auto Update** у налаштуваннях розширення. code-server використовує
Open VSX окремо й може встановити VSIX вище.

Публікація у Chrome Web Store та Microsoft Edge Add-ons лишається наступним етапом.

[Сайт AIC](https://dzyha.com/)
