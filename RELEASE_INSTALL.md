# AIC — єдиний випуск та встановлення · 22 вересня 2026

Цей випуск об’єднує **AIC Notes для VS Code 49.1.1**, **AIC для Standard Notes
41.1.1** і **експериментальне розширення Chrome/Edge 0.6.0**. У всіх трьох редакторах Mermaid тепер має простий потік: **код і живе прев’ю**.
У прев’ю є **Копіювати**, однакова іконка **Редагувати** та кнопки масштабу.
Візуальний конструктор, перетягування і поворот прибрані. Flowchart не залежить
від внутрішніх SVG-ідентифікаторів для редагування. Зміни набираються прямо у
Markdown; прев’ю оновлюється під час редагування, а збереження лишається явною
дією редактора. Інші Markdown-дані цього випуску не переписуються.

## VS Code / code-server

1. Завантажте [AIC Notes 49.1.1 VSIX](https://github.com/ldzyha/aic-notes/releases/download/v49.1.1/aic-notes-49.1.1.vsix) і [його SHA-256](https://github.com/ldzyha/aic-notes/releases/download/v49.1.1/aic-notes-49.1.1.vsix.sha256).
2. У VS Code відкрийте палітру команд і виконайте **Extensions: Install from VSIX…**,
   виберіть завантажений файл, потім перезавантажте вікно. Для code-server можна
   виконати `code-server --install-extension ./aic-notes-49.1.1.vsix --force`.
3. У списку Extensions перевірте **AIC Notes 49.1.1**.

[Сторінка випуску VS Code](https://github.com/ldzyha/aic-notes/releases/tag/v49.1.1)
містить VSIX та контрольну суму. Обліковий запис чи синхронізація зі Standard
Notes цьому локальному розширенню не потрібні.

## Standard Notes

1. Відкрийте **Preferences → Plugins → Install Custom Plugin**.
2. Вставте адресу `https://ldzyha.github.io/standard-notes-aic/ext.json`.
3. У меню редактора нотатки виберіть **AIC**. Якщо AIC вже встановлений,
   повторний імпорт не потрібний: клієнт перевіряє оновлення за тим самим
   маніфестом. Якщо версія лишилася старою, перезапустіть Standard Notes.

Для настільного клієнта також доступний [архів AIC 41.1.1](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.1/standard-notes-aic-41.1.1.zip)
та [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.1/standard-notes-aic-41.1.1.zip.sha256).
Звичайний спосіб встановлення — адреса маніфесту вище.

## Chrome / Microsoft Edge · експериментально

1. Завантажте [спільний Chromium ZIP 0.6.0](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.1/aic-browser-chromium-0.6.0.zip)
   і [його SHA-256](https://github.com/ldzyha/standard-notes-aic/releases/download/v41.1.1/aic-browser-chromium-0.6.0.zip.sha256).
2. Розпакуйте ZIP в окрему постійну папку. У її корені має бути `manifest.json`.
3. Відкрийте `chrome://extensions` або `edge://extensions`, увімкніть
   **Developer mode**, натисніть **Load unpacked** і виберіть саме розпаковану
   папку, а не ZIP. Закріпіть AIC на панелі та натисніть його значок.

Для оновлення заповненого розширення спочатку дочекайтеся **Note saved**,
експортуйте зашифровану резервну копію й збережіть пароль до неї. Замініть
вміст тієї самої папки новими файлами та натисніть **Reload** на наявній
картці розширення. Не видаляйте заповнене розширення перед оновленням:
локальні дані можуть зникнути. Цей браузерний пакет ще проходить
[окремі перевірки](https://github.com/ldzyha/standard-notes-aic/blob/v41.1.1/browser/VERIFICATION.md);
поки що використовуйте синтетичні дані.

## Перевірка файлів і статус магазинів

Файл `.sha256` поруч із кожним архівом або VSIX містить очікувану контрольну
суму. У Linux виконайте `sha256sum -c НАЗВА_ФАЙЛУ.sha256` з папки завантажень;
у macOS порівняйте результат `shasum -a 256 НАЗВА_ФАЙЛУ` із сумою у файлі;
у Windows PowerShell — `(Get-FileHash .\НАЗВА_ФАЙЛУ -Algorithm SHA256).Hash`.

Це випуски **на GitHub**. Подання до VS Code Marketplace, Chrome Web Store і
Microsoft Edge Add-ons заплановані пізніше; зараз встановлюйте файли й
компонент способами вище.

[Сайт AIC](https://dzyha.com/)
