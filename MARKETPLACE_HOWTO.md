# Publishing AIC in extension stores / Як опублікувати AIC у магазинах

[English](#english) · [Українська](#українська)

## English

**Release targets — October 1, 2026:** AIC Notes 57.1.2, Standard Notes AIC
49.1.2 and browser 0.11.1. GitHub releases and Standard Notes Pages deployment
are separate from store submission. The repository currently has no `VSCE_PAT`
secret, so automatic VS Code Marketplace publication requires publisher access.
See the [publishing guide](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).

The last recorded Chrome submission was 0.9.3 on September 24, 2026, pending
review at that time. That record does not establish approval or submission of
0.11.1. Chrome/Edge dashboard access and final runtime verification are still
needed for this candidate. Older store submissions and GitHub assets are unchanged.

| Destination            | Submission file                                          | Target version          |
| ---------------------- | -------------------------------------------------------- | ----------------------- |
| VS Code Marketplace    | `aic-notes-57.1.2.vsix`                                  | AIC Notes 57.1.2        |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.11.1.zip` | AIC — Page notes 0.11.1 |
| Microsoft Edge Add-ons | **the same** Chromium ZIP                                | AIC — Page notes 0.11.1 |

These are **expected names**, not proof that a file is ready. Standard Notes AIC **49.1.2**
and shared core **7.5.1** are coordinated with this release; Standard Notes is
not submitted to these stores. That release fixes accordion membership and compact
headers, and keeps unsaved editor backgrounds unchanged while Save indicates
pending changes. The 0.9.3 submission candidate additionally removes redundant
`activeTab` permission; Markdown and storage are unchanged.

Every managed preview block also has the shared **Cut** scissors action. It
copies the complete Markdown block before removing it; a failed clipboard write
leaves the source unchanged.

### Before starting

- **Complete the release gates.** Compare versions in `../aic-notes/package.json`
  and [`browser/manifest.json`](browser/manifest.json), verify SHA-256 values, and
  inspect the final archives. `manifest.json` must be at the ZIP root, and
  `THIRD_PARTY_NOTICES.md` must contain all required dependency notices. A stale
  ZIP is not automatically the final package. The owner-reported Chrome 0.9.3
  manual check and its limits are recorded in [VERIFICATION](browser/VERIFICATION.md).
  Earlier Edge smoke does not establish current Edge acceptance; each target
  and future package still requires its own release gates. [Chrome package preparation](https://developer.chrome.com/docs/webstore/prepare),
  [Edge ZIP package](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Prepare public policy and store pages.** Update
  [`browser/PRIVACY.md`](browser/PRIVACY.md) and
  [`browser/README.md`](browser/README.md) so they describe the released version.
  Deploy the [terms and public privacy policy](https://aic.dzyha.com/terms),
  [product homepage](https://aic.dzyha.com/) and
  [releases and installation](https://aic.dzyha.com/releases). Check public access
  without authentication, then replace the existing Chrome/Edge listing's
  homepage and privacy-policy URLs. The September 24 Chrome draft used GitHub
  URLs; this source change has not updated its dashboard fields.
  The draft's screenshots, description, support contact
  and reviewer instructions are saved; see [their scope](browser/STORE_LISTING.md).
  Descriptions of tab access, deliberate import, clipboard use, local encryption,
  and the absence of synchronization must match the product.
  [Chrome privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
  [Edge privacy](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Prepare three developer accounts.** For VS Code, verify access to publisher
  `ldzyha` through Microsoft/Azure DevOps; do not create another publisher ID for
  the same extension. Chrome Web Store requires a one-time registration fee and
  two-step verification; confirm the current fee before payment. Edge uses a
  Partner Center program account and Microsoft currently describes registration
  as free. Never store passwords, tokens, or recovery codes in the repository.
  [VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
  [Chrome](https://developer.chrome.com/docs/webstore/register),
  [Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account).

Creating a **new Azure DevOps organization** requires an active Azure subscription;
existing organizations and free-tier limits are unaffected.
[Microsoft prerequisites](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops).
This requirement does not apply to every publisher or authentication route.
Existing manual Marketplace uploads and VS Code client updates do not require
this organization setup.

### Manual updates and first browser submissions

#### VS Code Marketplace

1. Take the **verified** `aic-notes-57.1.2.vsix` and checksum from
   [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. On the [Marketplace publisher page](https://marketplace.visualstudio.com/manage/publishers/),
   select `ldzyha`, open the existing `aic-notes` extension, and upload the VSIX
   as an update. Do not create a duplicate extension.
3. Review the description and links, then complete the portal workflow.
4. After publication, verify version **57.1.2** on `ldzyha.aic-notes` and install
   it from Extensions in a clean VS Code profile. A VSIX on GitHub supports manual
   installation but does **not** publish the extension to Marketplace.
   [Official guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

#### Chrome Web Store

1. The final **0.9.3** ZIP is uploaded; the manual Chrome owner report is recorded
   in [VERIFICATION](browser/VERIFICATION.md).
2. Follow the [existing item's status](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status);
   do not create a duplicate item or repeat the pending submission.
3. The submission is **Pending review**. Automatic publication after approval is
   enabled; no approval or publication is confirmed yet.
4. After approval, verify **0.11.1** and install it from the store in a clean Chrome
   profile. Verify updates separately. Submission alone is not publication.
   [Official guide](https://developer.chrome.com/docs/webstore/publish/).

#### Microsoft Edge Add-ons

1. Use the **same** final ZIP after a separate Edge verification.
2. In [Partner Center](https://partner.microsoft.com/dashboard), open Edge →
   **Create new extension** and upload the ZIP.
3. Complete **Availability**, **Properties**, **Privacy**, **Store listings**, and
   certification notes. Verify markets, visibility, permissions, and policy URL.
4. Submit for review. When the status becomes **In the store**, verify **0.11.1**
   and install it from Edge Add-ons in a clean profile. Chrome submission does
   **not** publish to Edge.
   [Official guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

### After submission and later updates

Record the actual store links, product IDs, versions, and reviewer feedback. Add
store links to README only after approval and an installation test. If rejected,
fix the cause, verify the package again, and resubmit.

For an update, raise the relevant manifest version, build a new package, and update
the **existing** store entry. Chrome and Edge require a higher version for a new
ZIP; VS Code and browser versions remain independent. Make the first publication
through the store dashboard. The prepared CI pipeline verifies an existing stable
GitHub release's exact ZIP and checksum, then submits updates to the configured
existing Chrome or Edge listing. Manual pipeline runs default to verification
only. Store credentials, per-store enable variables, and publisher access still
need owner activation; no authenticated publication was performed by this change.
See [extension update automation](pwa/EXTENSION_UPDATES.md) for setup and status.
[Chrome updates](https://developer.chrome.com/docs/webstore/update),
[Edge updates](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Before updating or moving from an unpacked installation, wait for save confirmation,
export an **encrypted backup**, and keep its password. Do not remove a populated
extension because its local data can disappear. Automatic transfer between unpacked
and store installations is **not proven**; test restore separately. Libraries v1/v2
are read without rewriting; the next write uses v3, which older builds cannot read.
During merge, an existing local Global Shared record is preserved and the skipped
imported record is reported; the original encrypted backup remains available.
See [Local data](browser/README.md).

---

## Українська

**Цільові версії — 1 жовтня 2026:** AIC Notes 57.1.2, Standard Notes AIC
49.1.2 та браузер 0.11.1. Випуски GitHub і розгортання Pages відокремлені від
подання до магазинів. У репозиторії немає `VSCE_PAT`, тому автоматична публікація
у VS Code Marketplace потребує доступу видавця.

Останній запис про Chrome стосується подання 0.9.3 від 24 вересня 2026, яке тоді
очікувало перевірки. Він не підтверджує подання чи схвалення 0.11.1. Для нового
кандидата потрібні доступ до панелей Chrome/Edge та перевірка в цих браузерах.
Попередні подання та файли GitHub залишаються незмінними.

| Куди                   | Файл для подання                                         | Цільова версія          |
| ---------------------- | -------------------------------------------------------- | ----------------------- |
| VS Code Marketplace    | `aic-notes-57.1.2.vsix`                                  | AIC Notes 57.1.2        |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.11.1.zip` | AIC — Page notes 0.11.1 |
| Microsoft Edge Add-ons | **той самий** Chromium ZIP                               | AIC — Page notes 0.11.1 |

Це **очікувані назви**, не доказ готовності файлів. Standard Notes AIC **49.1.2**
і спільне ядро **7.5.1** узгоджені з цим випуском; Standard Notes не подається
до цих магазинів. Той випуск виправляє належність вмісту до акордеона й компактність
заголовків; незбережені зміни не змінюють фон редактора, а Save показує потребу
збереження. Кандидат 0.9.3 додатково прибирає зайвий дозвіл `activeTab`;
Markdown і сховище не змінено.

Усі керовані preview-блоки також мають спільну кнопку **Вирізати** з іконкою
ножиць. Вона копіює повний Markdown-блок перед видаленням; помилка запису в
clipboard лишає source без змін.

## Перед початком

- **Завершіть випускні перевірки.** Звірте версії у `../aic-notes/package.json` і [`browser/manifest.json`](browser/manifest.json), SHA-256 та вміст фінальних архівів. У ZIP `manifest.json` має лежати в корені; `THIRD_PARTY_NOTICES.md` має містити всі потрібні повідомлення про залежності. Старий ZIP, що залишився в папці, не є фінальним автоматично. Ручну перевірку Chrome 0.9.3 зі слів власника та її межі записано у [VERIFICATION](browser/VERIFICATION.uk.md). Попередній Edge smoke не підтверджує приймання поточної версії Edge; кожен браузер і майбутній пакет потребують власних релізних перевірок. [Chrome: підготовка пакета](https://developer.chrome.com/docs/webstore/prepare), [Edge: пакет ZIP](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте публічну політику й сторінки.** Оновіть [`browser/PRIVACY.md`](browser/PRIVACY.md) та [`browser/README.md`](browser/README.md): вони мають описувати випущену версію, а не лише development build. Розгорніть [умови й політику приватності](https://aic.dzyha.com/terms), [домашню сторінку](https://aic.dzyha.com/) та [випуски й встановлення](https://aic.dzyha.com/releases). Перевірте доступ без авторизації, потім замініть адресу домашньої сторінки й політики в наявному записі Chrome/Edge. Чернетка Chrome від 24 вересня використовувала GitHub; ця зміна джерела не оновлює поля dashboard. Скриншоти, опис, контакт підтримки та інструкції рецензентам збережені; [межі цих матеріалів](browser/STORE_LISTING.md#українська) описано окремо. Пояснення доступу до вкладки, ручного імпорту, буфера обміну, локального шифрування й відсутності синхронізації мають збігатися з поведінкою продукту. [Chrome: privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Edge: privacy](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте три облікові записи.** Для VS Code перевірте право керувати видавцем `ldzyha` через Microsoft/Azure DevOps; не створюйте іншого ID для того самого розширення. Chrome Web Store вимагає одноразову реєстраційну плату та двоетапну перевірку; суму перевірте перед оплатою. Для Edge потрібен акаунт програми в Partner Center; Microsoft вказує, що реєстрація безкоштовна. Не записуйте паролі, токени чи коди відновлення в репозиторій. [VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Chrome](https://developer.chrome.com/docs/webstore/register), [Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account).

Створення **нової організації Azure DevOps** потребує активної Azure subscription;
наявні організації та ліміти безкоштовного рівня не змінюються.
[Вимоги Microsoft](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops).
Це не вимога для всіх видавців чи способів авторизації. Наявна ручна публікація
в Marketplace та оновлення у клієнті VS Code не потребують створення цієї організації.

## Ручні оновлення та перше подання до магазинів браузера

### VS Code Marketplace

1. Візьміть **перевірений** `aic-notes-57.1.2.vsix` і його контрольну суму з [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. На [сторінці видавців Marketplace](https://marketplace.visualstudio.com/manage/publishers/) виберіть `ldzyha`, відкрийте наявне розширення `aic-notes` і завантажте VSIX як оновлення. Не створюйте дублікат розширення.
3. Перегляньте опис і посилання, завершіть подання за підказками порталу.
4. Після публікації перевірте версію **57.1.2** на сторінці `ldzyha.aic-notes` та встановіть її з розділу Extensions у чистому профілі VS Code. Файл VSIX на GitHub дає ручне встановлення, але **не** публікує розширення в Marketplace. [Офіційна інструкція](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

### Chrome Web Store

1. Фінальний ZIP **0.9.3** завантажено; ручну перевірку Chrome зі слів власника записано у [VERIFICATION](browser/VERIFICATION.uk.md).
2. Стежте за [станом наявного запису](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status); не створюйте дублікат і не повторюйте подання, що очікує перевірки.
3. Стан подання — **Pending review, очікує перевірки**. Автоматичну публікацію після схвалення ввімкнено; схвалення й публікацію ще не підтверджено.
4. Після схвалення звірте версію **0.9.3** і встановіть із магазину в чистому профілі Chrome. Оновлення перевірте окремо. Саме подання не означає публікації. [Офіційна інструкція](https://developer.chrome.com/docs/webstore/publish/).

### Microsoft Edge Add-ons

1. Використайте **той самий** фінальний ZIP після окремої перевірки в Edge.
2. У [Partner Center](https://partner.microsoft.com/dashboard) відкрийте Edge → **Create new extension** і завантажте ZIP.
3. Заповніть **Availability**, **Properties**, **Privacy**, **Store listings** та нотатки для сертифікації; перевірте ринки, видимість, дозволи й URL політики.
4. Надішліть на перевірку. Коли статус стане **In the store**, звірте версію **0.9.3** і встановіть із Edge Add-ons у чистому профілі. Подання до Chrome **не** публікує продукт в Edge. [Офіційна інструкція](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Після подання й наступні оновлення

Збережіть фактичні посилання, ID продуктів, версії та зауваження рецензентів. Додавайте магазинні посилання до README лише після схвалення й тесту встановлення. Якщо отримано відмову, виправте причину, повторно перевірте пакет і подайте знову.

Для оновлення підвищте версію відповідного маніфесту, зберіть новий пакет та оновіть **наявний** запис магазину. Chrome й Edge вимагають більшу версію для нового ZIP; версії VS Code і браузерного розширення незалежні. Перше подання зробіть через dashboard магазину. Підготовлений CI pipeline звіряє точний ZIP і checksum стабільного GitHub release та подає update налаштованого запису Chrome чи Edge. Ручний запуск за замовчуванням лише перевіряє архів. Credentials, enable variables і права видавця ще потребують активації власником; ця зміна не виконувала публікацію з авторизацією. [Налаштування автоматизації](pwa/EXTENSION_UPDATES.uk.md), [Chrome: оновлення](https://developer.chrome.com/docs/webstore/update), [Edge: оновлення](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Перед оновленням або переходом з unpacked-інсталяції дочекайтеся підтвердження збереження, експортуйте **зашифровану резервну копію** й збережіть пароль. Не видаляйте заповнене розширення: його локальні дані можуть зникнути. Автоматичне перенесення між unpacked і магазинним встановленням **не доведене**; перевіряйте відновлення з копії окремо. Бібліотеки v1/v2 читаються без зміни вмісту; наступний запис використовує v3, яку старі збірки не прочитають. При злитті копії наявний локальний Global Shared зберігається, а пропущений імпортований запис явно позначається; оригінальна зашифрована копія лишається доступною. [Локальні дані](browser/README.md).
