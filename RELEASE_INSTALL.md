# AIC — release and installation / випуск та встановлення

[English](#english) · [Українська](#українська)

Public [releases and installation](https://aic.dzyha.com/releases) and
[terms and privacy](https://aic.dzyha.com/terms) are hosted on aic.dzyha.com.

## English

### Prepared release — October 1, 2026

**Standard Notes AIC 50.0.1**, **AIC Notes 59.0.2**, and experimental
**Chrome/Edge 0.11.2** use shared core **7.5.2**. These are prepared versions;
verify the GitHub assets and checksums before installation. PWA deployment,
store submission and approval are separate steps.

Mermaid previews use a full-width canvas, a centered natural-size diagram,
bounded flowchart labels and content-driven height without internal scrollbars.
Wide diagrams shrink to fit mobile screens. Copy and Edit remain; zoom controls
are removed. Rendering avoids repeated layout work and loads Mermaid on demand.
VS Code also refreshes diagram colors when its theme changes without reopening.
Markdown, encryption, local storage and Save/Undo ownership remain compatible.

### VS Code desktop, Web and code-server

1. After publication, download [AIC Notes 59.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix)
   and [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix.sha256).
2. In VS Code or vscode.dev, run **Extensions: Install from VSIX…**, select the
   file and reload. In code-server use `code-server --install-extension ./aic-notes-59.0.2.vsix --force`.
3. Confirm **59.0.2** in Extensions. Read-only repositories support viewing;
   saves require a writable filesystem provider.

The confirmed [Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
version is **58.1.1**. Publication of 59.0.2 requires a separately verified
submission. Marketplace installs follow VS Code's automatic-update settings;
VSIX installations can enable **Auto Update**. Open VSX publishing is separate;
the GitHub VSIX supports manual code-server installation.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. Existing installations check the
   same manifest for updates; restart the client if an old version persists.

After publication, the versioned package is [AIC 50.0.1 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/standard-notes-aic-50.0.1.zip)
with [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/standard-notes-aic-50.0.1.zip.sha256).
The hosted manifest is the normal installation method.

### Chrome / Microsoft Edge — experimental

After publication, download [Chromium ZIP 0.11.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip)
and [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip.sha256).
Extract it to a permanent folder with `manifest.json` at its root. Open
`chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select that folder.

Chrome's published version is **0.9.3**, with **0.11.1 pending review**. The
current dashboard disables a new upload; 0.11.2 is not submitted. Edge Partner
Center exposes no Edge workspace, so no Edge submission is confirmed.

For an existing unpacked installation, wait for **Note saved**, export a backup,
keep its password, replace files in the same folder, then choose **Reload** on
its existing card. Removing a populated extension can remove local data.
Installed-store updates and account configuration are described in the
[publishing guide](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.md).

### Verify downloaded files

Every ZIP/VSIX has a `.sha256` sidecar. Run `sha256sum -c FILE.sha256` on Linux,
compare `shasum -a 256 FILE` on macOS, or use `(Get-FileHash .\FILE -Algorithm SHA256).Hash`
in PowerShell. Test an installed package separately from its build and checksum.

## Українська

### Підготовлений випуск — 1 жовтня 2026 року

**Standard Notes AIC 50.0.1**, **AIC Notes 59.0.2** та
експериментальне розширення Chrome/Edge **0.11.2** використовують спільне ядро
**7.5.2**. Версії підготовлено;
перед встановленням перевірте появу файлів і контрольних сум GitHub.
Розгортання PWA, подання до магазинів та схвалення перевіряються окремо.

Полотно Mermaid займає всю ширину, а діаграма має природний розмір по центру,
обмежені підписи flowchart та висоту за вмістом без внутрішніх скролів.
Широкі діаграми зменшуються до мобільного екрана. Copy та Edit залишаються;
кнопки масштабу прибрано. Рендеринг уникає повторної роботи й завантажує Mermaid
лише за потреби. VS Code оновлює кольори діаграм при зміні теми без повторного
відкриття нотатки. Markdown, шифрування, зберігання та Save/Undo лишаються сумісними.

### VS Code desktop, Web та code-server

1. Після публікації завантажте [AIC Notes 59.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix)
   і [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v59.0.2/aic-notes-59.0.2.vsix.sha256).
2. У VS Code або vscode.dev виконайте **Extensions: Install from VSIX…**,
   виберіть файл і перезавантажте вікно. Для code-server:
   `code-server --install-extension ./aic-notes-59.0.2.vsix --force`.
3. Перевірте **59.0.2** у списку Extensions. Репозиторії лише для читання можна
   переглядати; збереження потребує провайдера з підтримкою запису.

Підтверджена версія [Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
— **58.1.1**. Подання 59.0.2 ще потрібно перевірити. Автооновлення залежать від
налаштувань VS Code; для VSIX можна увімкнути **Auto Update**. Open VSX — окремий
канал; GitHub VSIX залишається способом ручного встановлення в code-server.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Виберіть **AIC** у меню редактора. Наявні інсталяції перевіряють той самий
   маніфест; якщо лишилася стара версія, перезапустіть клієнт.

Після публікації доступний [архів AIC 50.0.1](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/standard-notes-aic-50.0.1.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/standard-notes-aic-50.0.1.zip.sha256).
Звичайний спосіб встановлення — опублікований маніфест.

### Chrome / Microsoft Edge — експериментально

Після публікації завантажте [Chromium ZIP 0.11.2](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v50.0.1/aic-browser-chromium-0.11.2.zip.sha256).
Розпакуйте в постійну папку з `manifest.json` у корені. У `chrome://extensions`
або `edge://extensions` увімкніть **Developer mode**, натисніть **Load unpacked**
та виберіть папку.

Chrome публікує **0.9.3**, а **0.11.1 ще перевіряється**. Нове завантаження
вимкнено; 0.11.2 не подано. У Partner Center немає доступного робочого простору
Edge, тому подання до Edge не підтверджено.

Для наявної unpacked-інсталяції дочекайтеся **Note saved**, експортуйте резервну
копію та збережіть пароль, замініть файли в тій самій папці й натисніть **Reload**
на наявній картці. Видалення заповненого розширення може видалити локальні дані.
[Інструкція публікації](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.uk.md).

### Перевірка файлів

Кожен ZIP/VSIX має `.sha256`. У Linux виконайте `sha256sum -c FILE.sha256`,
у macOS порівняйте `shasum -a 256 FILE`, у PowerShell —
`(Get-FileHash .\FILE -Algorithm SHA256).Hash`. Встановлений пакет перевіряється
окремо від збірки та контрольної суми. Історію попередніх випусків збережено
у двомовних changelog і на [сторінці випусків](https://aic.dzyha.com/releases).
