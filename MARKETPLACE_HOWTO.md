# Publishing AIC in extension stores / Як опублікувати AIC у магазинах

[English](#english) · [Українська](#українська)

## English

### Prepared release — October 2, 2026

[AIC Notes 60.0.2](https://github.com/ldzyha/aic-notes/releases/tag/v60.0.2)
and [Standard Notes AIC 51.0.1](https://github.com/ldzyha/standard-notes-aic/releases/tag/v51.0.1)
are prepared with browser 0.11.3 and core 7.5.3. Verify final GitHub assets,
SHA-256 values and installation before claiming a release or store approval.

| Destination            | Latest checked state                                     | Prepared update                     |
| ---------------------- | -------------------------------------------------------- | ----------------------------------- |
| VS Code Marketplace    | 59.0.2 public (October 2)                                | 60.0.2, submission not yet verified |
| Chrome Web Store       | 0.9.3 public; 0.11.1 pending review; new upload disabled | `aic-browser-chromium-0.11.3.zip`   |
| Microsoft Edge Add-ons | No Edge workspace at the October 1 check                 | No confirmed submission             |

The October 2 checks confirm Marketplace **59.0.2** public and Chrome **0.9.3**
public, with **0.11.1 pending review** and new uploads disabled. A pending
Chrome review is not publication. Do not claim a store install,
update, or runtime acceptance until the relevant store exposes the released
version and it has been installed and checked in a clean profile.

The Chrome dashboard saved the product homepage as [AIC](https://aic.dzyha.com/)
and the privacy-policy field as [Terms and privacy](https://aic.dzyha.com/terms).
The bilingual listing points to the English Terms page and the Ukrainian
[Terms page](https://aic.dzyha.com/terms/uk/). These are the canonical public
links; GitHub source files are not the policy destination. The dashboard evidence,
including the 0.11.1 package SHA-256 and six required permissions, is recorded in
[browser/STORE_LISTING.md](browser/STORE_LISTING.md).

The PWA shipped with Standard Notes AIC 49.1.2 provides the compact mobile
interface: direct **New note**, **Files**, and **Folder** actions; a Notes drawer
that retains the editor; and canonical Terms redirects. It does not change the
local Markdown, optional encryption, or explicit export model.

### Release gates

- Compare the intended versions in `../aic-notes/package.json` and
  [`browser/manifest.json`](browser/manifest.json); inspect the final archives and
  verify their SHA-256 values. `manifest.json` must be at the ZIP root and
  `THIRD_PARTY_NOTICES.md` must include required dependency notices.
- Keep the store listing's description, permissions, deliberate import, clipboard
  behavior, local encryption, and absence of synchronization accurate. Never put
  credentials, passwords, tokens, or recovery codes in the repository.
- Check public canonical links without authentication:
  [homepage](https://aic.dzyha.com/), [Terms and privacy](https://aic.dzyha.com/terms),
  [Ukrainian Terms](https://aic.dzyha.com/terms/uk/), and
  [releases and installation](https://aic.dzyha.com/releases).
- A stale archive, a successful GitHub workflow, or an earlier browser smoke test
  is not evidence that a new store package was accepted. Keep the existing item;
  do not create duplicate store entries.

[Chrome package preparation](https://developer.chrome.com/docs/webstore/prepare) ·
[Chrome privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) ·
[VS Code publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### Manual dashboard steps

#### VS Code Marketplace

1. Verify the 60.0.2 GitHub VSIX and checksum, then upload those exact bytes to
   the existing listing after checking its current version.
2. Wait for Microsoft verification, confirm `ldzyha.aic-notes` publicly shows
   **60.0.2**, then install it in a clean VS Code profile.
3. A GitHub VSIX supports manual installation but does not publish the extension.
   See the [Marketplace publishing guide](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).

#### Chrome Web Store

1. Follow the [existing item's status](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status).
   The October 2 check confirmed 0.11.1 **Pending review**. Recheck its status;
   do not create a second item or upload another package while review is active.
2. Keep automatic publication after approval enabled only if that remains the
   intended release policy. Approval is still a separate event.
3. After approval, verify the store displays **0.11.1** and perform a clean-profile
   install and update check. Record the actual store URL and reviewer feedback.

#### Microsoft Edge Add-ons

The October 1 Partner Center check exposed no Edge workspace, and no Edge
submission was made. Do not infer an Edge listing from the Chrome submission.
Resume Edge instructions only after the owning workspace is available and a
separately verified ZIP is ready.

### Later updates and local data

Raise the relevant manifest version, build a new package, and update the existing
store item. Chrome and Edge require a higher browser version for a new ZIP; VS
Code and browser versions are independent.

The configured update workflow first verifies the exact stable release artifact
and checksum. The known Chrome publisher ID, item ID and target store are configured
as GitHub variables, but publisher credentials and store-enabling flags are not
configured. Manual browser workflow runs default to verification without contacting
store APIs. See
[extension update automation](pwa/EXTENSION_UPDATES.md). The verification-only
[browser run for 49.1.2](https://github.com/ldzyha/standard-notes-aic/actions/runs/36847205166)
and [VS run for 57.1.2](https://github.com/ldzyha/aic-notes/actions/runs/36847214736)
succeeded; store submissions and credential checks were skipped. A verified GitHub
asset is not an authenticated store submission.

Before updating or moving from an unpacked installation, wait for save confirmation,
export an **encrypted backup**, and keep its password. Do not remove a populated
extension because local data can disappear. Automatic transfer between unpacked and
store installations is not proven; test restoration separately. Libraries v1 and
v2 are read without rewriting; the next write uses v3, which older builds cannot
read. During merge, an existing local Global Shared record is preserved, a skipped
imported record is reported, and the original encrypted backup remains available.
See [Local data](browser/README.md).

---

## Українська

### Підготовлений випуск — 2 жовтня 2026

Підготовлено [AIC Notes 60.0.2](https://github.com/ldzyha/aic-notes/releases/tag/v60.0.2)
і [Standard Notes AIC 51.0.1](https://github.com/ldzyha/standard-notes-aic/releases/tag/v51.0.1)
із браузерним пакетом 0.11.3 та ядром 7.5.3. Перед заявою про випуск або схвалення
перевірте остаточні файли GitHub, SHA-256 та встановлення.

| Призначення            | Останній перевірений стан                                        | Підготовлене оновлення             |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| VS Code Marketplace    | 59.0.2 доступна (2 жовтня)                                       | 60.0.2, подання ще не підтверджене |
| Chrome Web Store       | 0.9.3 доступна; 0.11.1 перевіряється; нове завантаження вимкнено | `aic-browser-chromium-0.11.3.zip`  |
| Microsoft Edge Add-ons | Простір Edge недоступний під час перевірки 1 жовтня              | Подання не підтверджене            |

Перевірки 2 жовтня підтвердили публічні Marketplace **59.0.2** і Chrome **0.9.3**,
Chrome **0.11.1 на перевірці** та вимкнені нові завантаження. Стан Pending review
у Chrome ще не є публікацією. Не заявляйте про встановлення,
оновлення чи перевірену працездатність, доки відповідний магазин не покаже
випущену версію і її не буде встановлено та перевірено в чистому профілі.

У Chrome dashboard збережено домашню сторінку [AIC](https://aic.dzyha.com/) та
адресу політики [Terms and privacy](https://aic.dzyha.com/terms). Двомовний опис
посилається на англійську сторінку Terms і українську
[сторінку Terms](https://aic.dzyha.com/terms/uk/). Це канонічні публічні посилання;
вихідні файли GitHub не є адресою політики. Докази з панелі, включно з SHA-256
пакета 0.11.1 і шістьма потрібними дозволами, зафіксовано у
[browser/STORE_LISTING.md](browser/STORE_LISTING.md).

PWA, що входить до Standard Notes AIC 49.1.2, має компактний мобільний інтерфейс:
прямі дії **New note**, **Files** і **Folder**, панель нотаток зі збереженням
редактора та канонічні переспрямування для Terms. Локальна Markdown-модель,
необов'язкове шифрування й явний експорт не змінилися.

### Випускні перевірки

- Звірте заплановані версії у `../aic-notes/package.json` і
  [`browser/manifest.json`](browser/manifest.json), перегляньте фінальні архіви
  та перевірте SHA-256. `manifest.json` має бути в корені ZIP, а
  `THIRD_PARTY_NOTICES.md` — містити потрібні повідомлення про залежності.
- Опис магазину, дозволи, явний імпорт, поведінка буфера обміну, локальне шифрування
  та відсутність синхронізації мають відповідати продукту. Не зберігайте в
  репозиторії облікові дані, паролі, токени чи коди відновлення.
- Перевірте без авторизації канонічні публічні посилання:
  [домашня сторінка](https://aic.dzyha.com/),
  [Terms і privacy](https://aic.dzyha.com/terms),
  [українські Terms](https://aic.dzyha.com/terms/uk/) і
  [випуски та встановлення](https://aic.dzyha.com/releases).
- Старий архів, успішна перевірка в GitHub або попередня швидка перевірка браузера не
  доводять прийняття нового пакета магазином. Використовуйте наявний запис і не
  створюйте дублікати.

[Підготовка пакета Chrome](https://developer.chrome.com/docs/webstore/prepare) ·
[Практики приватності Chrome](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) ·
[Публікація VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### Ручні кроки в dashboard

#### VS Code Marketplace

1. Перевірте VSIX 60.0.2 із GitHub та контрольну суму, потім завантажте ті самі
   байти до наявного запису після перевірки поточної версії.
2. Дочекайтеся перевірки Microsoft, підтвердьте публічну **60.0.2** у
   `ldzyha.aic-notes` і встановіть її у чистому профілі VS Code.
3. VSIX на GitHub дозволяє ручне встановлення, але не публікує розширення.
   Див. [інструкцію публікації Marketplace](https://github.com/ldzyha/aic-notes/blob/main/MARKETPLACE_PUBLISHING.md).

#### Chrome Web Store

1. Стежте за [станом наявного запису](https://chrome.google.com/webstore/devconsole/23222565-bf28-4fbe-a259-3009399e6677/mokndlkbkhnemhhcahddhdgihgdckbhp/edit/status).
   Перевірка 2 жовтня підтвердила 0.11.1 у стані **Pending review**. Перевірте
   стан знову; не створюйте другий запис і не завантажуйте інший пакет під час перевірки.
2. Залишайте автоматичну публікацію після схвалення ввімкненою, лише якщо це й
   надалі відповідає політиці релізу. Схвалення все одно є окремою подією.
3. Після схвалення переконайтеся, що магазин показує **0.11.1**, і виконайте
   чисте встановлення та перевірку оновлення. Зафіксуйте фактичне посилання
   магазину та відгук рецензента.

#### Microsoft Edge Add-ons

Під час перевірки 1 жовтня автентифікований Partner Center не показав робочого простору Edge, і
подання до Edge не робили. Не робіть висновок про наявність запису Edge з подання
до Chrome. Поверніться до кроків Edge лише після появи робочого простору власника
й окремої перевірки ZIP.

### Наступні оновлення та локальні дані

Підвищте відповідну версію manifest, зберіть новий пакет і оновіть наявний запис
магазину. Chrome і Edge потребують вищої версії браузерного розширення для нового
ZIP; версії VS Code і браузера незалежні.

Налаштований процес оновлення спочатку перевіряє точний стабільний артефакт
релізу та контрольну суму. Відомі ID видавця й запису Chrome та цільовий магазин
задано змінними GitHub, але облікові дані видавця й прапорці увімкнення публікації
не налаштовано. Ручний запуск процесу для браузера типово лише перевіряє пакет,
без звернення до API магазинів. Див.
[автоматизацію оновлень розширення](pwa/EXTENSION_UPDATES.uk.md). Перевірки без
подання [для браузера 49.1.2](https://github.com/ldzyha/standard-notes-aic/actions/runs/36847205166)
і [для VS 57.1.2](https://github.com/ldzyha/aic-notes/actions/runs/36847214736)
успішні; подання до магазинів і перевірки облікових даних пропущено. Перевірений
артефакт GitHub не є автентифікованим поданням до магазину.

Перед оновленням або переходом з unpacked-інсталяції дочекайтеся підтвердження
збереження, експортуйте **зашифровану резервну копію** і збережіть пароль. Не
видаляйте заповнене розширення, бо локальні дані можуть зникнути. Автоматичне
перенесення між розпакованим і магазинним встановленням не доведене; окремо
перевірте відновлення. Бібліотеки v1 і v2 читаються без переписування; наступне
збереження використовує v3, яку старі збірки не прочитають. Під час злиття
зберігається наявний локальний запис Global Shared, про пропущений імпортований
запис повідомляється, а оригінальна зашифрована копія лишається доступною. Див.
[Локальні дані](browser/README.md).
