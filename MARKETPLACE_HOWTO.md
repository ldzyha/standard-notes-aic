# Publishing AIC in extension stores / Як опублікувати AIC у магазинах

[English](#english) · [Українська](#українська)

## English

**Status:** [AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
is public in VS Code Marketplace; **53.0.1** is the last confirmed store version.
The **54.0.2** GitHub release is available; its manual Marketplace upload still
awaits CAPTCHA completion and is not confirmed published. Automatic publishing
is prepared, but `VSCE_PAT` is absent. The attempted Azure DevOps credential setup
is blocked because no Azure subscription is accessible for a new organization. See
[the bilingual automation guide](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).
Chrome Web Store **0.9.3** was submitted on **September 24, 2026 at 14:38 UTC**;
its [status is Pending review](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status).
Automatic publication after approval is enabled. It is **not published**.
The owner reported a manual Chrome checklist pass, explicitly confirming
Lock across two panels and import/export; see the [record and limits](browser/VERIFICATION.md).
Edge submission is unconfirmed.
The experimental public GitHub baseline remains **0.9.2**
(`aic-browser-chromium-0.9.2.zip` in release **46.0.2**); those assets are unchanged.
Firefox and Mullvad are outside this plan.

| Destination            | Submission file                                         | Target version         |
| ---------------------- | ------------------------------------------------------- | ---------------------- |
| VS Code Marketplace    | `aic-notes-54.0.2.vsix`                                 | AIC Notes 54.0.2       |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.9.3.zip` | AIC — Page notes 0.9.3 |
| Microsoft Edge Add-ons | **the same** Chromium ZIP                               | AIC — Page notes 0.9.3 |

These are **expected names**, not proof that a file is ready. Standard Notes AIC **46.0.2**
and shared core **7.3.2** are coordinated with this release; Standard Notes is
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
  The [public privacy policy](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/PRIVACY.md)
  was verified without authentication on September 24, 2026 and is saved in the
  Chrome draft. The [GitHub product homepage](https://github.com/ldzyha/standard-notes-aic/tree/main/browser)
  links to both policy languages directly in its README. The draft's screenshots, description, support contact
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

1. Take the **verified** `aic-notes-54.0.2.vsix` and checksum from
   [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. On the [Marketplace publisher page](https://marketplace.visualstudio.com/manage/publishers/),
   select `ldzyha`, open the existing `aic-notes` extension, and upload the VSIX
   as an update. Do not create a duplicate extension.
3. Review the description and links, then complete the portal workflow.
4. After publication, verify version **54.0.2** on `ldzyha.aic-notes` and install
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
4. After approval, verify **0.9.3** and install it from the store in a clean Chrome
   profile. Verify updates separately. Submission alone is not publication.
   [Official guide](https://developer.chrome.com/docs/webstore/publish/).

#### Microsoft Edge Add-ons

1. Use the **same** final ZIP after a separate Edge verification.
2. In [Partner Center](https://partner.microsoft.com/dashboard), open Edge →
   **Create new extension** and upload the ZIP.
3. Complete **Availability**, **Properties**, **Privacy**, **Store listings**, and
   certification notes. Verify markets, visibility, permissions, and policy URL.
4. Submit for review. When the status becomes **In the store**, verify **0.9.3**
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
manually. CI automation and secrets are separate future work.
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

**Статус:** [AIC Notes](https://marketplace.visualstudio.com/items?itemName=ldzyha.aic-notes)
вже опубліковано у VS Code Marketplace; **53.0.1** — остання підтверджена версія
магазину. GitHub-випуск **54.0.2** доступний; ручне завантаження до Marketplace
ще очікує завершення CAPTCHA, публікацію не підтверджено. Автопублікацію
підготовлено, але `VSCE_PAT` відсутній. Налаштування доступу через Azure DevOps
зупинилося: акаунт не має доступної Azure subscription для нової організації. Дивіться
[двомовну інструкцію](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md#українська).
До Chrome Web Store подано **0.9.3** **24 вересня 2026 року о 14:38 UTC**;
[стан — Pending review, очікує перевірки](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status).
Автоматичну публікацію після схвалення ввімкнено. Розширення **не опубліковано**.
Власник повідомив про успішну ручну перевірку Chrome, явно підтвердивши Lock
двох панелей та імпорт/експорт; [запис і межі перевірки](browser/VERIFICATION.uk.md).
Подання до Edge не підтверджено. Публічна експериментальна версія GitHub лишається
**0.9.2** (`aic-browser-chromium-0.9.2.zip` у випуску **46.0.2**); ці файли не змінено.
Firefox і Mullvad не входять у цей план.

| Куди                   | Файл для подання                                        | Цільова версія         |
| ---------------------- | ------------------------------------------------------- | ---------------------- |
| VS Code Marketplace    | `aic-notes-54.0.2.vsix`                                 | AIC Notes 54.0.2       |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.9.3.zip` | AIC — Page notes 0.9.3 |
| Microsoft Edge Add-ons | **той самий** Chromium ZIP                              | AIC — Page notes 0.9.3 |

Це **очікувані назви**, не доказ готовності файлів. Standard Notes AIC **46.0.2**
і спільне ядро **7.3.2** узгоджені з цим випуском; Standard Notes не подається
до цих магазинів. Той випуск виправляє належність вмісту до акордеона й компактність
заголовків; незбережені зміни не змінюють фон редактора, а Save показує потребу
збереження. Кандидат 0.9.3 додатково прибирає зайвий дозвіл `activeTab`;
Markdown і сховище не змінено.

Усі керовані preview-блоки також мають спільну кнопку **Вирізати** з іконкою
ножиць. Вона копіює повний Markdown-блок перед видаленням; помилка запису в
clipboard лишає source без змін.

## Перед початком

- **Завершіть випускні перевірки.** Звірте версії у `../aic-notes/package.json` і [`browser/manifest.json`](browser/manifest.json), SHA-256 та вміст фінальних архівів. У ZIP `manifest.json` має лежати в корені; `THIRD_PARTY_NOTICES.md` має містити всі потрібні повідомлення про залежності. Старий ZIP, що залишився в папці, не є фінальним автоматично. Ручну перевірку Chrome 0.9.3 зі слів власника та її межі записано у [VERIFICATION](browser/VERIFICATION.uk.md). Попередній Edge smoke не підтверджує приймання поточної версії Edge; кожен браузер і майбутній пакет потребують власних релізних перевірок. [Chrome: підготовка пакета](https://developer.chrome.com/docs/webstore/prepare), [Edge: пакет ZIP](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте публічну політику й сторінки.** Оновіть [`browser/PRIVACY.md`](browser/PRIVACY.md) та [`browser/README.md`](browser/README.md): вони мають описувати випущену версію, а не лише development build. [Публічну політику](https://github.com/ldzyha/standard-notes-aic/blob/main/browser/PRIVACY.md) перевірено без входу в акаунт 24 вересня 2026 року; адресу збережено в чернетці Chrome. [GitHub-сторінка продукту](https://github.com/ldzyha/standard-notes-aic/tree/main/browser) має прямі посилання на обидві мовні версії політики в README. Скриншоти, опис, контакт підтримки та інструкції рецензентам збережені; [межі цих матеріалів](browser/STORE_LISTING.md#українська) описано окремо. Пояснення доступу до вкладки, ручного імпорту, буфера обміну, локального шифрування й відсутності синхронізації мають збігатися з поведінкою продукту. [Chrome: privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Edge: privacy](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте три облікові записи.** Для VS Code перевірте право керувати видавцем `ldzyha` через Microsoft/Azure DevOps; не створюйте іншого ID для того самого розширення. Chrome Web Store вимагає одноразову реєстраційну плату та двоетапну перевірку; суму перевірте перед оплатою. Для Edge потрібен акаунт програми в Partner Center; Microsoft вказує, що реєстрація безкоштовна. Не записуйте паролі, токени чи коди відновлення в репозиторій. [VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Chrome](https://developer.chrome.com/docs/webstore/register), [Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account).

Створення **нової організації Azure DevOps** потребує активної Azure subscription;
наявні організації та ліміти безкоштовного рівня не змінюються.
[Вимоги Microsoft](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops).
Це не вимога для всіх видавців чи способів авторизації. Наявна ручна публікація
в Marketplace та оновлення у клієнті VS Code не потребують створення цієї організації.

## Ручні оновлення та перше подання до магазинів браузера

### VS Code Marketplace

1. Візьміть **перевірений** `aic-notes-54.0.2.vsix` і його контрольну суму з [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. На [сторінці видавців Marketplace](https://marketplace.visualstudio.com/manage/publishers/) виберіть `ldzyha`, відкрийте наявне розширення `aic-notes` і завантажте VSIX як оновлення. Не створюйте дублікат розширення.
3. Перегляньте опис і посилання, завершіть подання за підказками порталу.
4. Після публікації перевірте версію **54.0.2** на сторінці `ldzyha.aic-notes` та встановіть її з розділу Extensions у чистому профілі VS Code. Файл VSIX на GitHub дає ручне встановлення, але **не** публікує розширення в Marketplace. [Офіційна інструкція](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

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

Для оновлення підвищте версію відповідного маніфесту, зберіть новий пакет та оновіть **наявний** запис магазину. Chrome й Edge вимагають більшу версію для нового ZIP; версії VS Code і браузерного розширення незалежні. Першу публікацію зробіть вручну; автоматизація й секрети CI — окрема майбутня робота. [Chrome: оновлення](https://developer.chrome.com/docs/webstore/update), [Edge: оновлення](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Перед оновленням або переходом з unpacked-інсталяції дочекайтеся підтвердження збереження, експортуйте **зашифровану резервну копію** й збережіть пароль. Не видаляйте заповнене розширення: його локальні дані можуть зникнути. Автоматичне перенесення між unpacked і магазинним встановленням **не доведене**; перевіряйте відновлення з копії окремо. Бібліотеки v1/v2 читаються без зміни вмісту; наступний запис використовує v3, яку старі збірки не прочитають. При злитті копії наявний локальний Global Shared зберігається, а пропущений імпортований запис явно позначається; оригінальна зашифрована копія лишається доступною. [Локальні дані](browser/README.md).
