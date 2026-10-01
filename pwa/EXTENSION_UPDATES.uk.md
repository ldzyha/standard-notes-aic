# Оновлення розширень

[English](EXTENSION_UPDATES.md)

Pipeline у коді готують релізні архіви, подають оновлення наявних записів
магазинів і створюють PR зі спільним редактором. Ця зміна не активує credentials
чи налаштування акаунтів видавця. Успішний локальний тест або перевірка архіву
не підтверджує опубліковану версію магазину.

## Реліз і подання браузерного розширення

Workflow релізного тегу перевіряє код, збирає один Chromium ZIP і додає його
разом із SHA-256 до стабільного GitHub release. Версії браузерного розширення
та Standard Notes незалежні.

`browser-marketplace.yml` завантажує точні архіви наявного релізу. Перевіряє
стабільний реліз, однозначні назви файлів, checksum, структуру детермінованого
ZIP, CRC, назву розширення та версію маніфесту. Ці байти подаються без повторної
збірки. Ручний запуск за замовчуванням має `verification_only = true` і не
звертається до API магазинів.

Спочатку налаштуйте доступ видавця. Для майбутніх подань із тегів задайте
repository variable `BROWSER_MARKETPLACE_ENABLED=true`, а
`BROWSER_PUBLISH_TARGET` — `chrome`, `edge` або `both`. Для вибраного магазину
потрібен також власний перемикач:

| Магазин | Repository variables                                                        | Actions secrets                                                    |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Chrome  | `CHROME_PUBLISH_ENABLED=true`, `CHROME_PUBLISHER_ID`, `CHROME_EXTENSION_ID` | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Edge    | `EDGE_PUBLISH_ENABLED=true`, `EDGE_PRODUCT_ID`                              | `EDGE_CLIENT_ID`, `EDGE_API_KEY`                                   |

Google-акаунт має мати двоетапну перевірку та доступ до наявного запису.
Увімкніть Chrome Web Store API й отримайте дозволені OAuth credentials через
Google. Клієнт використовує v2 upload, status і publish. Він зупиняється за
іншого активного подання, попереджень політики, помилки обробки або версії,
яка не більша за опубліковану. Ту саму опубліковану чи вже подану версію
залишає без змін. Нове подання проходить review і публікується після схвалення.
[Налаштування Chrome API](https://developer.chrome.com/docs/webstore/using-api),
[контракт publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

Для Edge потрібен опублікований продукт і Publish API у Partner Center.
Клієнт використовує актуальну автентифікацію API key, чекає обробки пакета,
подає certification notes і перевіряє операцію подання. Прийнята операція
підтверджує створення подання на review; схвалення магазину відбувається далі.
API не створює нових записів і не редагує їхні описи.
[Налаштування Edge API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api),
[довідник endpoints](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference).

Запит обмежено 30 секундами, polling — 30 спробами з інтервалом десять секунд.
Вміст відповідей провайдера та credentials не потрапляють до publisher logs.
Після timeout чи помилки перевірте dashboard перед повтором: попередній запит
міг уже бути прийнятий. Автоматичних повторів мутацій і скасування чужого
активного подання немає.

## Публікація VS Code

Pipeline перевіряє точний VSIX стабільного GitHub release, checksum, видавця
`ldzyha`, розширення `aic-notes` і universal XML identity. Перед поданням тих
самих байтів перевіряє права видавця; уже наявну версію пропускає. Ручний
`verification_only` доступний без автентифікації.

Підготовлений Entra route використовує repository variables
`VSCE_AUTH_MODE=entra`, `VSCE_AZURE_CLIENT_ID` і `VSCE_AZURE_TENANT_ID`.
Додайте identity до Marketplace publisher із роллю Contributor і налаштуйте
Entra workload federation для publishing refs цього GitHub repository.
Workflow використовує GitHub federation через Azure Login, потім підтримуваний
`vsce --azure-credential`. Login дозволений без Azure subscription. Доступ
до publisher і federation все ще потребують налаштування власником акаунта.
[Інструкція Microsoft](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace),
[Azure Login federation](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended).

Попередній `VSCE_PAT` лишається сумісним, якщо `VSCE_AUTH_MODE=pat` або змінну
не задано. Це тимчасовий варіант: Microsoft припиняє global Azure DevOps PAT
1 грудня 2026 року. Не додавайте credentials у код, нотатки, чат чи архіви.
[Припинення PAT](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/).

## Оновлення спільного редактора

Для `sync-core.yml` задайте `AIC_CORE_SYNC_ENABLED=true` у canonical repository.
Налаштуйте `AIC_CORE_SYNC_APP_ID` та secret `AIC_CORE_SYNC_APP_PRIVATE_KEY`
для GitHub App, встановленого на `ldzyha/aic-notes`, із правом запису contents
та pull requests. Token обмежений цим repository.
[GitHub App token action](https://github.com/actions/create-github-app-token).

Committed зміни canonical `main` збирають PWA, механічно копіюють лише записи
`CORE_FILES.json` до VS Code core mirror та точну portable editor build до
`vendor/portable-runtime`. `CORE_SNAPSHOT.json` і `PORTABLE_SNAPSHOT.json`
зберігають source commit та точні hashes; `aicEditorCore` узгоджується.
VS Code host збирається самостійно з цих committed generated files.
VSIX містить точний portable runtime і його snapshot.

Для локального distribution запустіть `npm run build:pwa`, потім
`npm run portable:sync` у canonical repository. `--target <AIC-Notes-repository>`
вибирає інший checkout, а `npm run portable:check` порівнює без запису.
Changed або untracked build inputs дають чесний snapshot
`sourceState: working-tree`. Він підтримує local build; release verification
потребує committed provenance. Sync не замінює unowned чи modified generated
directory.

VS Code release gate перевіряє обидва distribution перед створенням чи оновленням
`codex/sync-editor-core`. Перегляньте та merge цей PR, потім виберіть версію
host і релізний тег. Workflow не робить merge чи публікацію релізу.

## Встановлені застосунки

Chrome та Edge із магазину використовують звичайне доставлення оновлень
браузером. Для unpacked development extension потрібен Reload на наявній
картці. Якщо важливий rollback, збережіть encrypted backup перед update;
Lock, Reload і update завершують unlocked session.
[Оновлення Chrome](https://developer.chrome.com/docs/webstore/update),
[оновлення Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Marketplace installation VS Code використовує налаштування automatic updates.
Після старої VSIX installation можна увімкнути **Auto Update** для AIC Notes,
щоб отримувати Marketplace updates. Доставлення через Open VSX налаштовується
окремо. [Оновлення VS Code](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#extension-auto-update).

PWA кешує інтерфейс для offline use і зберігає нотатки на пристрої. Доступ
видавця належить CI; credentials магазину не налаштовуються в інтерфейсі
нотаток. Deploy нової PWA build та реліз розширення — окремі операції.
