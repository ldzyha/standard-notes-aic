# Publishing AIC in extension stores / Як опублікувати AIC у магазинах

[English](#english) · [Українська](#українська)

## English

**Status:** this is a plan for the first manual submissions, not a publication
announcement. GitHub is the current release channel. Submission to VS Code
Marketplace, Chrome Web Store, and Microsoft Edge Add-ons has not been confirmed.
Browser release **0.7.0 is experimental**. Firefox and Mullvad are outside this
plan. Complete verification and store materials first, submit to each store
separately, and verify installation after approval.

| Destination            | Submission file                                         | Target version         |
| ---------------------- | ------------------------------------------------------- | ---------------------- |
| VS Code Marketplace    | `aic-notes-50.1.0.vsix`                                 | AIC Notes 50.1.0       |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.7.0.zip` | AIC — Page notes 0.7.0 |
| Microsoft Edge Add-ons | **the same** Chromium ZIP                               | AIC — Page notes 0.7.0 |

These are **expected names**, not proof that a file is ready. Standard Notes AIC
**42.1.0** and shared core **7.1.0** are coordinated with this release, but
Standard Notes is not submitted to these stores. AIC Notes **50.1.0** and browser
**0.7.0** use direct Mermaid Markdown editing with a live preview, one shared Edit
button, and preview-only zoom. The visual builder, drag-and-drop, and rotation are
removed. Quote accents, the short centered thematic break, and the blank text row
that replaced the Account preset arrived in earlier versions. Browser 0.4.0 added
Global Shared inside the current profile's encrypted vault. It does not synchronize
applications and does not implement the future key architecture or VS Code
`global.aic`.

Every managed preview block also has the shared **Cut** scissors action. It
copies the complete Markdown block before removing it; a failed clipboard write
leaves the source unchanged.

### Before starting

- **Complete the release gates.** Compare versions in `../aic-notes/package.json`
  and [`browser/manifest.json`](browser/manifest.json), verify SHA-256 values, and
  inspect the final archives. `manifest.json` must be at the ZIP root, and
  `THIRD_PARTY_NOTICES.md` must contain all required dependency notices. A stale
  ZIP is not automatically the final package. The existing Edge packaged smoke
  does not replace the outstanding **installed Chrome package** verification. Do
  not submit the browser extension until that verification and the release gates
  are complete. [Chrome package preparation](https://developer.chrome.com/docs/webstore/prepare),
  [Edge ZIP package](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Prepare public policy and store pages.** Update
  [`browser/PRIVACY.md`](browser/PRIVACY.md) and
  [`browser/README.md`](browser/README.md) so they describe the released version.
  Host the privacy policy at a stable public HTTPS URL. The URL is not listed here
  because it still must be published and verified. Prepare real screenshots, a
  short description, support contact, and reviewer instructions when necessary.
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

### First manual submission

#### VS Code Marketplace

1. Take the **verified** `aic-notes-50.1.0.vsix` and checksum from
   [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. On the [Marketplace publisher page](https://marketplace.visualstudio.com/manage/publishers/),
   select `ldzyha` and upload the VSIX manually.
3. Review the description and links, then complete the portal workflow.
4. After publication, verify version **50.1.0** on `ldzyha.aic-notes` and install
   it from Extensions in a clean VS Code profile. A VSIX on GitHub supports manual
   installation but does **not** publish the extension to Marketplace.
   [Official guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

#### Chrome Web Store

1. Use the final Chromium ZIP after Chrome verification. **Load unpacked** from
   `dist-browser/chromium/` is only a development test method.
2. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   select **Add new item** and upload the ZIP.
3. Complete **Store listing**, **Privacy practices**, and **Distribution**. Explain
   manifest permissions and provide only the verified privacy-policy URL.
4. Select **Submit for Review**. After approval, verify **0.7.0** and install it
   from the store in a clean Chrome profile. Upload alone is not publication.
   [Official guide](https://developer.chrome.com/docs/webstore/publish/).

#### Microsoft Edge Add-ons

1. Use the **same** final ZIP after a separate Edge verification.
2. In [Partner Center](https://partner.microsoft.com/dashboard), open Edge →
   **Create new extension** and upload the ZIP.
3. Complete **Availability**, **Properties**, **Privacy**, **Store listings**, and
   certification notes. Verify markets, visibility, permissions, and policy URL.
4. Submit for review. When the status becomes **In the store**, verify **0.7.0**
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

**Статус:** це план першого ручного подання, а не повідомлення про публікацію. Зараз канал випуску — GitHub; у VS Code Marketplace, Chrome Web Store та Microsoft Edge Add-ons подання ще не підтверджені. Браузерний випуск **0.7.0 експериментальний**. Firefox і Mullvad не входять у цей план. Рекомендація: спершу завершити перевірки та матеріали, потім подати кожен магазин окремо й перевірити встановлення після схвалення.

| Куди                   | Файл для подання                                        | Цільова версія         |
| ---------------------- | ------------------------------------------------------- | ---------------------- |
| VS Code Marketplace    | `aic-notes-50.1.0.vsix`                                 | AIC Notes 50.1.0       |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.7.0.zip` | AIC — Page notes 0.7.0 |
| Microsoft Edge Add-ons | **той самий** Chromium ZIP                              | AIC — Page notes 0.7.0 |

Це **очікувані назви**, не доказ готовності файлів. Standard Notes AIC **42.1.0** і спільне ядро **7.1.0** координуються з цим випуском, але Standard Notes не подається до цих магазинів. AIC Notes **50.1.0** та браузер **0.7.0** мають просте редагування Mermaid як Markdown-коду з живим прев’ю, однаковою кнопкою Edit і масштабуванням лише у прев’ю. Візуальний конструктор, drag-and-drop і поворот прибрані. Акценти цитат, коротка центрована горизонтальна лінія та порожній текстовий рядок замість шаблону Account з’явилися у попередніх версіях. Попередній випуск браузера 0.4.0 додав Global Shared у зашифрованому сховищі поточного профілю. Це не синхронізація між застосунками й не реалізація майбутньої архітектури ключів або VS Code `global.aic`.

Усі керовані preview-блоки також мають спільну кнопку **Вирізати** з іконкою
ножиць. Вона копіює повний Markdown-блок перед видаленням; помилка запису в
clipboard лишає source без змін.

## Перед початком

- **Завершіть випускні перевірки.** Звірте версії у `../aic-notes/package.json` і [`browser/manifest.json`](browser/manifest.json), SHA-256 та вміст фінальних архівів. У ZIP `manifest.json` має лежати в корені; `THIRD_PARTY_NOTICES.md` має містити всі потрібні повідомлення про залежності. Старий ZIP, що залишився в папці, не є фінальним автоматично. Наявний Edge packaged smoke не замінює ще не підтверджену перевірку **встановленого Chrome-пакета**. Не подавайте браузерне розширення, доки ця перевірка й релізні умови не виконані. [Chrome: підготовка пакета](https://developer.chrome.com/docs/webstore/prepare), [Edge: пакет ZIP](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте публічну політику й сторінки.** Оновіть [`browser/PRIVACY.md`](browser/PRIVACY.md) та [`browser/README.md`](browser/README.md): вони мають описувати випущену версію, а не лише development build. Розмістіть політику за стабільною HTTPS-адресою та відкрийте її без входу в акаунт. Адресу не зазначено тут, бо її ще треба опублікувати й перевірити. Зробіть справжні скриншоти, короткий опис, контакт підтримки та, за потреби, тестові інструкції для рецензентів. Пояснення доступу до вкладки, ручного імпорту, буфера обміну, локального шифрування й відсутності синхронізації мають збігатися з поведінкою продукту. [Chrome: privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Edge: privacy](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте три облікові записи.** Для VS Code перевірте право керувати видавцем `ldzyha` через Microsoft/Azure DevOps; не створюйте іншого ID для того самого розширення. Chrome Web Store вимагає одноразову реєстраційну плату та двоетапну перевірку; суму перевірте перед оплатою. Для Edge потрібен акаунт програми в Partner Center; Microsoft вказує, що реєстрація безкоштовна. Не записуйте паролі, токени чи коди відновлення в репозиторій. [VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Chrome](https://developer.chrome.com/docs/webstore/register), [Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account).

## Перше ручне подання

### VS Code Marketplace

1. Візьміть **перевірений** `aic-notes-50.1.0.vsix` і його контрольну суму з [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. На [сторінці видавців Marketplace](https://marketplace.visualstudio.com/manage/publishers/) виберіть `ldzyha` та завантажте VSIX вручну.
3. Перегляньте опис і посилання, завершіть подання за підказками порталу.
4. Після публікації перевірте версію **50.1.0** на сторінці `ldzyha.aic-notes` та встановіть її з розділу Extensions у чистому профілі VS Code. Файл VSIX на GitHub дає ручне встановлення, але **не** публікує розширення в Marketplace. [Офіційна інструкція](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

### Chrome Web Store

1. Візьміть фінальний Chromium ZIP після перевірки в Chrome; **Load unpacked** із `dist-browser/chromium/` — лише спосіб розробницького тестування.
2. У [Developer Dashboard](https://chrome.google.com/webstore/devconsole) виберіть **Add new item** і завантажте ZIP.
3. Заповніть **Store listing**, **Privacy practices**, **Distribution**; обґрунтуйте дозволи маніфесту та вставте тільки перевірений URL політики.
4. Натисніть **Submit for Review**. Після схвалення звірте версію **0.7.0** і встановіть із магазину в чистому профілі Chrome. Завантаження файлу саме по собі ще не означає публікації. [Офіційна інструкція](https://developer.chrome.com/docs/webstore/publish/).

### Microsoft Edge Add-ons

1. Використайте **той самий** фінальний ZIP після окремої перевірки в Edge.
2. У [Partner Center](https://partner.microsoft.com/dashboard) відкрийте Edge → **Create new extension** і завантажте ZIP.
3. Заповніть **Availability**, **Properties**, **Privacy**, **Store listings** та нотатки для сертифікації; перевірте ринки, видимість, дозволи й URL політики.
4. Надішліть на перевірку. Коли статус стане **In the store**, звірте версію **0.7.0** і встановіть із Edge Add-ons у чистому профілі. Подання до Chrome **не** публікує продукт в Edge. [Офіційна інструкція](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Після подання й наступні оновлення

Збережіть фактичні посилання, ID продуктів, версії та зауваження рецензентів. Додавайте магазинні посилання до README лише після схвалення й тесту встановлення. Якщо отримано відмову, виправте причину, повторно перевірте пакет і подайте знову.

Для оновлення підвищте версію відповідного маніфесту, зберіть новий пакет та оновіть **наявний** запис магазину. Chrome й Edge вимагають більшу версію для нового ZIP; версії VS Code і браузерного розширення незалежні. Першу публікацію зробіть вручну; автоматизація й секрети CI — окрема майбутня робота. [Chrome: оновлення](https://developer.chrome.com/docs/webstore/update), [Edge: оновлення](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Перед оновленням або переходом з unpacked-інсталяції дочекайтеся підтвердження збереження, експортуйте **зашифровану резервну копію** й збережіть пароль. Не видаляйте заповнене розширення: його локальні дані можуть зникнути. Автоматичне перенесення між unpacked і магазинним встановленням **не доведене**; перевіряйте відновлення з копії окремо. Бібліотеки v1/v2 читаються без зміни вмісту; наступний запис використовує v3, яку старі збірки не прочитають. При злитті копії наявний локальний Global Shared зберігається, а пропущений імпортований запис явно позначається; оригінальна зашифрована копія лишається доступною. [Локальні дані](browser/README.md).
