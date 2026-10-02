# AIC — release and installation / випуск та встановлення

[English](#english) · [Українська](#українська)

Public [releases and installation](https://aic.dzyha.com/releases) and
[terms and privacy](https://aic.dzyha.com/terms) are hosted on aic.dzyha.com.

## English

### Prepared release — October 2, 2026

**Standard Notes AIC 51.0.1**, **AIC Notes 60.0.2**, and experimental
**Chrome/Edge 0.11.3** use shared core **7.5.3**. These are prepared versions;
verify the GitHub assets and checksums before installation. PWA deployment,
store submission and approval are separate steps.

Vertical scrolling over a code preview continues through the document instead
of stopping inside the block. Previews use their full content height and retain
horizontal scrolling for long lines across Standard Notes, PWA, browser notes,
and VS Code main and linked-note editors. Markdown, editing, encryption, local
storage and Save/Undo ownership remain compatible.

VS Code also restores scrolling through long linked notes in the sidebar. The
active Current, Shared or Global pane constrains the editor to the available
height, so content below the visible area remains reachable.

### VS Code desktop, Web and code-server

1. After publication, download [AIC Notes 60.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix)
   and [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix.sha256).
2. In VS Code or vscode.dev, run **Extensions: Install from VSIX…**, select the
   file and reload. In code-server use `code-server --install-extension ./aic-notes-60.0.2.vsix --force`.
3. Confirm **60.0.2** in Extensions. Read-only repositories support viewing;
   saves require a writable filesystem provider.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
publicly provides **59.0.2**, confirmed October 2. Submission and public
availability of 60.0.2 must be verified separately.
Marketplace installs follow VS Code's automatic-update settings;
VSIX installations can enable **Auto Update**. Open VSX publishing is separate;
the GitHub VSIX supports manual code-server installation.

### Standard Notes

1. Open **Preferences → Plugins → Install Custom Plugin**.
2. Paste `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Select **AIC** from the note editor menu. Existing installations check the
   same manifest for updates; restart the client if an old version persists.

After publication, the versioned package is [AIC 51.0.1 ZIP](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/standard-notes-aic-51.0.1.zip)
with [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/standard-notes-aic-51.0.1.zip.sha256).
The hosted manifest is the normal installation method.

### Chrome / Microsoft Edge — experimental

After publication, download [Chromium ZIP 0.11.3](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip)
and [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip.sha256).
Extract it to a permanent folder with `manifest.json` at its root. Open
`chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select that folder.

The October 2 check confirmed Chrome 0.9.3 public and 0.11.1 pending
review, with new uploads disabled. The October 1 Edge Partner Center check
exposed no Edge workspace.
Recheck these conditions before submitting 0.11.3; no new submission or approval
is claimed by this prepared release.

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

### Підготовлений випуск — 2 жовтня 2026 року

**Standard Notes AIC 51.0.1**, **AIC Notes 60.0.2** та
експериментальне розширення Chrome/Edge **0.11.3** використовують спільне ядро
**7.5.3**. Версії підготовлено;
перед встановленням перевірте появу файлів і контрольних сум GitHub.
Розгортання PWA, подання до магазинів та схвалення перевіряються окремо.

Вертикальне прокручування над прев’ю коду продовжує рух документа, замість
блокування всередині блока. Прев’ю займає повну висоту вмісту та зберігає
горизонтальне прокручування довгих рядків у Standard Notes, PWA, браузерних
нотатках, основному редакторі й пов’язаних нотатках VS Code. Markdown,
редагування, шифрування, локальне зберігання та Save/Undo лишаються сумісними.

VS Code також відновлює прокручування довгих пов’язаних нотаток у бічній
панелі. Активне подання Current, Shared або Global обмежує редактор доступною
висотою, щоб вміст нижче видимої області залишався доступним.

### VS Code desktop, Web та code-server

1. Після публікації завантажте [AIC Notes 60.0.2 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix)
   і [SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v60.0.2/aic-notes-60.0.2.vsix.sha256).
2. У VS Code або vscode.dev виконайте **Extensions: Install from VSIX…**,
   виберіть файл і перезавантажте вікно. Для code-server:
   `code-server --install-extension ./aic-notes-60.0.2.vsix --force`.
3. Перевірте **60.0.2** у списку Extensions. Репозиторії лише для читання можна
   переглядати; збереження потребує провайдера з підтримкою запису.

[Marketplace](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
публічно надає **59.0.2**, що підтверджено 2 жовтня. Подання й публічну
доступність 60.0.2 ще потрібно перевірити. Автооновлення залежать від
налаштувань VS Code; для VSIX можна увімкнути **Auto Update**. Open VSX — окремий
канал; GitHub VSIX залишається способом ручного встановлення в code-server.

### Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. Виберіть **AIC** у меню редактора. Наявні інсталяції перевіряють той самий
   маніфест; якщо лишилася стара версія, перезапустіть клієнт.

Після публікації доступний [архів AIC 51.0.1](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/standard-notes-aic-51.0.1.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/standard-notes-aic-51.0.1.zip.sha256).
Звичайний спосіб встановлення — опублікований маніфест.

### Chrome / Microsoft Edge — експериментально

Після публікації завантажте [Chromium ZIP 0.11.3](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip)
та [SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v51.0.1/aic-browser-chromium-0.11.3.zip.sha256).
Розпакуйте в постійну папку з `manifest.json` у корені. У `chrome://extensions`
або `edge://extensions` увімкніть **Developer mode**, натисніть **Load unpacked**
та виберіть папку.

Перевірка 2 жовтня підтвердила Chrome 0.9.3 у публічному доступі й 0.11.1 на
перевірці, з вимкненим новим завантаженням. Перевірка Partner Center 1 жовтня
не виявила доступного простору Edge. Перед поданням 0.11.3 перевірте цей стан знову; підготовлений випуск
не означає нового подання чи схвалення.

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
