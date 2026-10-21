# AIC — release and installation / випуск та встановлення

[English](#english) · [Українська](#українська)

Public [releases and installation](https://aic.dzyha.com/releases) and
[terms and privacy](https://aic.dzyha.com/terms) are hosted on aic.dzyha.com.

## English

### Current usage guide

The [complete getting-started guide](https://aic.dzyha.com/releases) keeps file
opening, direct saving, note pages, AIC blocks, copy controls, offline use,
external sync and extension installation together. AIC uses plain `.md` files in
the PWA, browser extension and VS Code, without an app password or `.aicnotes`
support. VS Code and the aic code editor keep one note per project at the
project root, `<project folder>/<project folder name>.note.md`; pages bind by
the path inside the project (`--- src/index.js`). The PWA and the browser
extension use the one note file you choose there (suggested name `aic.md`);
pages bind by URL. A `<project>.note.md` from older versions is adopted as is;
the `<folder>/aic.md` used by VS Code 61.6.5 is no longer followed, so copy its
pages into the project note and write each target as the path inside the
project (`src/a.js`, not `./src/a.js`). Nothing is migrated or deleted. Standard Notes keeps its own
storage and sync. The version entry below is a release record; publication is
verified separately.

### Prepared release — October 21, 2026

**Standard Notes AIC 53.6.3**, **AIC Notes 62.3.1**, and experimental
**Chrome/Edge 0.13.0** use shared core **8.1.0**. These are prepared versions;
verify the GitHub assets and checksums before installation. PWA deployment,
store submission and approval are separate steps.

One note splits into pages: a `---` line after a blank line starts a page, and
`--- <path-or-url>` binds the next page to a file path or web address, matched
exactly as written. Pages show as cards; **Open target** opens a web address, or
a project file in VS Code. The Current, Shared and Global tabs are removed. The
PWA edits the one note file you choose and keeps unsaved text in the browser; its
workspaces, folders and file tree are removed. The browser panel connects one
note file and shows the page of the active tab; per-URL note files, the notes
tree, history and pin are removed. VS Code's Linked Note shows the page of the
project note `<folder>/<folder name>.note.md` bound to the active file's path;
sidecar notes, pin and Trash are removed. Existing files are never deleted or
converted. Coding agents read the project note through guide version 4, and
slash templates follow DDK with `/aic` for an AIC block.

### VS Code desktop, Web and code-server

1. After publication, download [AIC Notes 62.3.1 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v62.3.1/aic-notes-62.3.1.vsix)
   and [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v62.3.1/aic-notes-62.3.1.vsix.sha256).
2. In VS Code or vscode.dev, run **Extensions: Install from VSIX…**, select the
   file and reload. In code-server use `code-server --install-extension ./aic-notes-62.3.1.vsix --force`.
3. Confirm **62.3.1** in Extensions. Read-only repositories support viewing;
   saves require a writable filesystem provider.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
publicly provides **59.0.2**, confirmed October 2. Submission and public
availability of 62.3.1 must be verified separately.
Marketplace installs follow VS Code's automatic-update settings;
VSIX installations can enable **Auto Update**. Open VSX publishing is separate;
the GitHub VSIX supports manual code-server installation.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. Existing installations check the
   same manifest for updates; restart the client if an old version persists.

After publication, the versioned package is [AIC 53.6.3 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/standard-notes-aic-53.6.3.zip)
with [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/standard-notes-aic-53.6.3.zip.sha256).
The hosted manifest is the normal installation method.

### Chrome / Microsoft Edge — experimental

After publication, download [Chromium ZIP 0.13.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/aic-browser-chromium-0.13.0.zip)
and [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/aic-browser-chromium-0.13.0.zip.sha256).
Extract it to a permanent folder with `manifest.json` at its root. Open
`chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select that folder.

The October 2 check confirmed Chrome 0.9.3 public and 0.11.1 pending
review, with new uploads disabled. The October 1 Edge Partner Center check
exposed no Edge workspace.
Recheck these conditions before submitting 0.13.0; no new submission or approval
is claimed by this prepared release.

For an existing unpacked installation, wait for the disk-save confirmation, keep
a file backup, replace the extension files in the same folder, then choose
**Reload** on its existing card. Uninstalling clears browser-local recovery data
and remembered access, but not saved external files.
Installed-store updates and account configuration are described in the
[publishing guide](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.md).

### Verify downloaded files

Every ZIP/VSIX has a `.sha256` sidecar. Run `sha256sum -c FILE.sha256` on Linux,
compare `shasum -a 256 FILE` on macOS, or use `(Get-FileHash .\FILE -Algorithm SHA256).Hash`
in PowerShell. Test an installed package separately from its build and checksum.

## Українська

### Поточна інструкція використання

[Повна інструкція](https://aic.dzyha.com/releases/uk/) збирає в одному місці
відкриття й запис файлів, сторінки нотатки, блоки AIC, копіювання, офлайн-роботу,
зовнішню синхронізацію та встановлення. AIC використовує звичайні `.md` у PWA,
браузері й VS Code без пароля застосунку та підтримки `.aicnotes`. VS Code і
редактор коду aic ведуть одну нотатку на проєкт у корені проєкту,
`<папка проєкту>/<назва папки проєкту>.note.md`; сторінки прив’язуються за
шляхом усередині проєкту (`--- src/index.js`). PWA і браузерне розширення
використовують один файл нотатки, який ви там вибираєте (запропонована назва
`aic.md`); сторінки прив’язуються за URL. `<project>.note.md` зі старіших версій
використовується як є; `<папка>/aic.md`, який використовував VS Code 61.6.5,
більше не відстежується, тож скопіюйте його сторінки в нотатку проєкту й запишіть
кожну ціль як шлях усередині проєкту (`src/a.js`, а не `./src/a.js`). Нічого
не переноситься й не видаляється. Standard Notes зберігає власне сховище й синхронізацію.
Запис версії нижче є історією релізу; публікація перевіряється окремо.

### Підготовлений випуск — 21 жовтня 2026 року

**Standard Notes AIC 53.6.3**, **AIC Notes 62.3.1** та
експериментальне розширення Chrome/Edge **0.13.0** використовують спільне ядро
**8.1.0**. Версії підготовлено;
перед встановленням перевірте появу файлів і контрольних сум GitHub.
Розгортання PWA, подання до магазинів та схвалення перевіряються окремо.

Одна нотатка ділиться на сторінки: рядок `---` після порожнього рядка починає
сторінку, а `--- <шлях-або-url>` прив’язує наступну сторінку до шляху файла чи
вебадреси, які зіставляються точно як записані. Сторінки показуються картками;
**Open target** відкриває вебадресу або, у VS Code, файл проєкту. Вкладки
Current, Shared і Global вилучено. PWA редагує один файл нотатки, який ви
вибрали, і зберігає незбережений текст у браузері; його робочі простори, папки й
дерево файлів вилучено. Браузерна панель підключає один файл нотатки й показує
сторінку активної вкладки; окремі файли нотаток для URL, дерево нотаток, історію
та закріплення вилучено. Linked Note у VS Code показує сторінку нотатки проєкту
`<папка>/<назва папки>.note.md`, прив’язану до шляху активного файла;
sidecar-нотатки, закріплення й Trash вилучено. Наявні файли ніколи не
видаляються й не конвертуються. Агенти читають нотатку проєкту за
інструкцією версії 4, а шаблони `/` відповідають DDK, де `/aic` вставляє блок AIC.

### VS Code desktop, Web та code-server

1. Після публікації завантажте [AIC Notes 62.3.1 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v62.3.1/aic-notes-62.3.1.vsix)
   і [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v62.3.1/aic-notes-62.3.1.vsix.sha256).
2. У VS Code або vscode.dev виконайте **Extensions: Install from VSIX…**,
   виберіть файл і перезавантажте вікно. Для code-server:
   `code-server --install-extension ./aic-notes-62.3.1.vsix --force`.
3. Перевірте **62.3.1** у списку Extensions. Репозиторії лише для читання можна
   переглядати; збереження потребує провайдера з підтримкою запису.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
публічно надає **59.0.2**, що підтверджено 2 жовтня. Подання й публічну
доступність 62.3.1 ще потрібно перевірити. Автооновлення залежать від
налаштувань VS Code; для VSIX можна увімкнути **Auto Update**. Open VSX — окремий
канал; GitHub VSIX залишається способом ручного встановлення в code-server.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Виберіть **AIC** у меню редактора. Наявні інсталяції перевіряють той самий
   маніфест; якщо лишилася стара версія, перезапустіть клієнт.

Після публікації доступний [архів AIC 53.6.3](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/standard-notes-aic-53.6.3.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/standard-notes-aic-53.6.3.zip.sha256).
Звичайний спосіб встановлення — опублікований маніфест.

### Chrome / Microsoft Edge — експериментально

Після публікації завантажте [Chromium ZIP 0.13.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/aic-browser-chromium-0.13.0.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v53.6.3/aic-browser-chromium-0.13.0.zip.sha256).
Розпакуйте в постійну папку з `manifest.json` у корені. У `chrome://extensions`
або `edge://extensions` увімкніть **Developer mode**, натисніть **Load unpacked**
та виберіть папку.

Перевірка 2 жовтня підтвердила Chrome 0.9.3 у публічному доступі й 0.11.1 на
перевірці, з вимкненим новим завантаженням. Перевірка Partner Center 1 жовтня
не виявила доступного простору Edge. Перед поданням 0.13.0 перевірте цей стан знову; підготовлений випуск
не означає нового подання чи схвалення.

Для наявної unpacked-інсталяції дочекайтеся підтвердження запису на диск,
збережіть резервну копію файлів, замініть файли розширення в тій самій папці й
натисніть **Reload** на наявній картці. Видалення розширення очищує локальні
копії відновлення та запам’ятований доступ, але не збережені зовнішні файли.
[Інструкція публікації](https://github.com/ldzyha/standard-notes-aic/blob/main/pwa/EXTENSION_UPDATES.uk.md).

### Перевірка файлів

Кожен ZIP/VSIX має `.sha256`. У Linux виконайте `sha256sum -c FILE.sha256`,
у macOS порівняйте `shasum -a 256 FILE`, у PowerShell —
`(Get-FileHash .\FILE -Algorithm SHA256).Hash`. Встановлений пакет перевіряється
окремо від збірки та контрольної суми. Історію попередніх випусків збережено
у двомовних changelog і на [сторінці випусків](https://aic.dzyha.com/releases).
