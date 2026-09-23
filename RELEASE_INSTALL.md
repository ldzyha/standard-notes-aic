# AIC — unified release and installation / єдиний випуск та встановлення

[English](#english) · [Українська](#українська)

## English

### Release overview — September 22, 2026

This release coordinates **AIC Notes for VS Code 49.1.2**, **AIC for Standard
Notes 41.1.2**, and the **experimental Chrome/Edge extension 0.6.1**. Mermaid
now follows the same simple workflow in all three editors: **source code and a
live preview**. The preview provides **Copy**, one shared **Edit** icon, and zoom
controls. The visual builder, drag-and-drop, and rotation have been removed.
Flowcharts no longer depend on internal SVG identifiers for editing. Changes
are made directly in Markdown; the preview refreshes while you edit, and the
editor keeps an explicit save boundary. Other Markdown content is not rewritten.
In VS Code, unpinning Linked Note immediately resumes following the active main
file without a window reload. First-party product and release documents are
available in English and Ukrainian and ship with their corresponding packages.

### VS Code / code-server

1. Download [AIC Notes 49.1.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v49.1.2/aic-notes-49.1.2.vsix)
   and [its SHA-256 file](https://github.com/ldzyha/aic-notes/releases/download/v49.1.2/aic-notes-49.1.2.vsix.sha256).
2. In VS Code, open the Command Palette and run **Extensions: Install from
   VSIX…**. Select the downloaded file and reload the window. For code-server,
   run `code-server --install-extension ./aic-notes-49.1.2.vsix --force`.
3. Confirm that **AIC Notes 49.1.2** appears in Extensions.

The [VS Code release page](https://github.com/ldzyha/aic-notes/releases/tag/v49.1.2)
contains the VSIX and checksum. This local extension does not require an account
or Standard Notes synchronization.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. If AIC is already installed, you do
   not need to import it again: the client checks for updates through the same
   manifest. Restart Standard Notes if the previous version remains visible.

The desktop package is also available as [AIC 41.1.2 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/standard-notes-aic-41.1.2.zip)
with [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/standard-notes-aic-41.1.2.zip.sha256).
The hosted manifest above is the normal installation method.

### Chrome / Microsoft Edge — experimental

1. Download the [shared Chromium ZIP 0.6.1](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/aic-browser-chromium-0.6.1.zip)
   and [its SHA-256 file](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/aic-browser-chromium-0.6.1.zip.sha256).
2. Extract the ZIP to a permanent folder. `manifest.json` must be at its root.
3. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   select **Load unpacked**, and choose the extracted folder rather than the ZIP.
   Pin AIC to the toolbar and select its icon.

Before updating an extension that contains data, wait for **Note saved**, export
an encrypted backup, and keep its password. Replace the files in the same folder
and select **Reload** on the existing extension card. Removing a populated
extension can remove its local data. This browser package is still undergoing
[separate verification](https://github.com/ldzyha/standard-notes-aic/blob/v41.1.2/browser/VERIFICATION.md);
use synthetic data for now.

### File verification and store status

Each archive or VSIX has a neighboring `.sha256` file. On Linux, run
`sha256sum -c FILE.sha256` in the download directory. On macOS, compare
`shasum -a 256 FILE` with the value in the checksum file. On Windows PowerShell,
use `(Get-FileHash .\FILE -Algorithm SHA256).Hash`.

These are **GitHub releases**. Submission to VS Code Marketplace, Chrome Web
Store, and Microsoft Edge Add-ons is planned for later. Until then, install the
files and Standard Notes component using the methods above.

[AIC website](https://dzyha.com/)

---

## Українська

### Огляд випуску — 22 вересня 2026

Цей випуск об’єднує **AIC Notes для VS Code 49.1.2**, **AIC для Standard Notes
41.1.2** і **експериментальне розширення Chrome/Edge 0.6.1**. У всіх трьох
редакторах Mermaid тепер має простий потік: **код і живе прев’ю**. У прев’ю є
**Копіювати**, однакова іконка **Редагувати** та кнопки масштабу. Візуальний
конструктор, перетягування і поворот прибрані. Flowchart не залежить від
внутрішніх SVG-ідентифікаторів для редагування. Зміни набираються прямо у
Markdown; прев’ю оновлюється під час редагування, а збереження лишається явною
дією редактора. Інші Markdown-дані цього випуску не переписуються.
У VS Code розпінювання Linked Note одразу відновлює слідування за активним
головним файлом без перезавантаження вікна. Документація продукту й випуску
доступна англійською та українською і входить до відповідних пакетів.

### VS Code / code-server

1. Завантажте [AIC Notes 49.1.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v49.1.2/aic-notes-49.1.2.vsix)
   і [його SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v49.1.2/aic-notes-49.1.2.vsix.sha256).
2. У VS Code відкрийте палітру команд і виконайте **Extensions: Install from
   VSIX…**, виберіть завантажений файл, потім перезавантажте вікно. Для
   code-server виконайте
   `code-server --install-extension ./aic-notes-49.1.2.vsix --force`.
3. У списку Extensions перевірте **AIC Notes 49.1.2**.

[Сторінка випуску VS Code](https://github.com/ldzyha/aic-notes/releases/tag/v49.1.2)
містить VSIX та контрольну суму. Обліковий запис чи синхронізація зі Standard
Notes цьому локальному розширенню не потрібні.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте адресу `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. У меню редактора нотатки виберіть **AIC**. Якщо AIC вже встановлений,
   повторний імпорт не потрібний: клієнт перевіряє оновлення за тим самим
   маніфестом. Якщо версія лишилася старою, перезапустіть Standard Notes.

Для настільного клієнта також доступний [архів AIC 41.1.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/standard-notes-aic-41.1.2.zip)
та [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/standard-notes-aic-41.1.2.zip.sha256).
Звичайний спосіб встановлення — адреса маніфесту вище.

### Chrome / Microsoft Edge — експериментально

1. Завантажте [спільний Chromium ZIP 0.6.1](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/aic-browser-chromium-0.6.1.zip)
   і [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.2/aic-browser-chromium-0.6.1.zip.sha256).
2. Розпакуйте ZIP в окрему постійну папку. У її корені має бути `manifest.json`.
3. Відкрийте `chrome://extensions` або `edge://extensions`, увімкніть
   **Developer mode**, натисніть **Load unpacked** і виберіть розпаковану папку,
   а не ZIP. Закріпіть AIC на панелі та натисніть його значок.

Для оновлення заповненого розширення спочатку дочекайтеся **Note saved**,
експортуйте зашифровану резервну копію й збережіть пароль до неї. Замініть вміст
тієї самої папки новими файлами та натисніть **Reload** на наявній картці
розширення. Не видаляйте заповнене розширення перед оновленням: локальні дані
можуть зникнути. Цей браузерний пакет ще проходить
[окремі перевірки](https://github.com/ldzyha/standard-notes-aic/blob/v41.1.2/browser/VERIFICATION.md);
поки що використовуйте синтетичні дані.

### Перевірка файлів і статус магазинів

Файл `.sha256` поруч із кожним архівом або VSIX містить очікувану контрольну
суму. У Linux виконайте `sha256sum -c ФАЙЛ.sha256` з папки завантажень; у macOS
порівняйте результат `shasum -a 256 ФАЙЛ` із сумою у файлі; у Windows
PowerShell — `(Get-FileHash .\ФАЙЛ -Algorithm SHA256).Hash`.

Це випуски **на GitHub**. Подання до VS Code Marketplace, Chrome Web Store і
Microsoft Edge Add-ons заплановані пізніше; зараз встановлюйте файли й компонент
способами вище.

[Сайт AIC](https://dzyha.com/)
