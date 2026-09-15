# Як опублікувати AIC у магазинах

**Статус:** це план першого ручного подання, а не повідомлення про публікацію. Зараз канал випуску — GitHub; у VS Code Marketplace, Chrome Web Store та Microsoft Edge Add-ons подання ще не підтверджені. Браузерний випуск **0.4.0 експериментальний**. Firefox і Mullvad не входять у цей план. Рекомендація: спершу завершити перевірки та матеріали, потім подати кожен магазин окремо й перевірити встановлення після схвалення.

| Куди                   | Файл для подання                                        | Цільова версія         |
| ---------------------- | ------------------------------------------------------- | ---------------------- |
| VS Code Marketplace    | `aic-notes-45.1.0.vsix`                                 | AIC Notes 45.1.0       |
| Chrome Web Store       | `dist-browser/artifacts/aic-browser-chromium-0.4.0.zip` | AIC — Page notes 0.4.0 |
| Microsoft Edge Add-ons | **той самий** Chromium ZIP                              | AIC — Page notes 0.4.0 |

Це **очікувані назви**, не доказ готовності файлів. Standard Notes AIC **37.2.0** і спільне ядро **6.1.0** координуються з цим випуском, але Standard Notes не подається до цих магазинів. AIC Notes **45.1.0** додає копіювання окремої секції. Браузер **0.4.0** також додає Global Shared — один зашифрований запис у сховищі поточного профілю, доступний без активної вебсторінки. Це не синхронізація між застосунками й не реалізація майбутньої архітектури ключів або VS Code `global.aic`.

## Перед початком

- **Завершіть випускні перевірки.** Звірте версії у `../aic-notes/package.json` і [`browser/manifest.json`](browser/manifest.json), SHA-256 та вміст фінальних архівів. У ZIP `manifest.json` має лежати в корені; `THIRD_PARTY_NOTICES.md` має містити всі потрібні повідомлення про залежності. Старий ZIP, що залишився в папці, не є фінальним автоматично. Наявний Edge packaged smoke не замінює ще не підтверджену перевірку **встановленого Chrome-пакета**. Не подавайте браузерне розширення, доки ця перевірка й релізні умови не виконані. [Chrome: підготовка пакета](https://developer.chrome.com/docs/webstore/prepare), [Edge: пакет ZIP](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте публічну політику й сторінки.** Оновіть [`browser/PRIVACY.md`](browser/PRIVACY.md) та [`browser/README.md`](browser/README.md): вони мають описувати випущену версію, а не лише development build. Розмістіть політику за стабільною HTTPS-адресою та відкрийте її без входу в акаунт. Адресу не зазначено тут, бо її ще треба опублікувати й перевірити. Зробіть справжні скриншоти, короткий опис, контакт підтримки та, за потреби, тестові інструкції для рецензентів. Пояснення доступу до вкладки, ручного імпорту, буфера обміну, локального шифрування й відсутності синхронізації мають збігатися з поведінкою продукту. [Chrome: privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [Edge: privacy](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).
- **Підготуйте три облікові записи.** Для VS Code перевірте право керувати видавцем `ldzyha` через Microsoft/Azure DevOps; не створюйте іншого ID для того самого розширення. Chrome Web Store вимагає одноразову реєстраційну плату та двоетапну перевірку; суму перевірте перед оплатою. Для Edge потрібен акаунт програми в Partner Center; Microsoft вказує, що реєстрація безкоштовна. Не записуйте паролі, токени чи коди відновлення в репозиторій. [VS Code](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Chrome](https://developer.chrome.com/docs/webstore/register), [Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/create-dev-account).

## Перше ручне подання

### VS Code Marketplace

1. Візьміть **перевірений** `aic-notes-45.1.0.vsix` і його контрольну суму з [AIC Notes Releases](https://github.com/ldzyha/aic-notes/releases).
2. На [сторінці видавців Marketplace](https://marketplace.visualstudio.com/manage/publishers/) виберіть `ldzyha` та завантажте VSIX вручну.
3. Перегляньте опис і посилання, завершіть подання за підказками порталу.
4. Після публікації перевірте версію **45.1.0** на сторінці `ldzyha.aic-notes` та встановіть її з розділу Extensions у чистому профілі VS Code. Файл VSIX на GitHub дає ручне встановлення, але **не** публікує розширення в Marketplace. [Офіційна інструкція](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

### Chrome Web Store

1. Візьміть фінальний Chromium ZIP після перевірки в Chrome; **Load unpacked** із `dist-browser/chromium/` — лише спосіб розробницького тестування.
2. У [Developer Dashboard](https://chrome.google.com/webstore/devconsole) виберіть **Add new item** і завантажте ZIP.
3. Заповніть **Store listing**, **Privacy practices**, **Distribution**; обґрунтуйте дозволи маніфесту та вставте тільки перевірений URL політики.
4. Натисніть **Submit for Review**. Після схвалення звірте версію **0.4.0** і встановіть із магазину в чистому профілі Chrome. Завантаження файлу саме по собі ще не означає публікації. [Офіційна інструкція](https://developer.chrome.com/docs/webstore/publish/).

### Microsoft Edge Add-ons

1. Використайте **той самий** фінальний ZIP після окремої перевірки в Edge.
2. У [Partner Center](https://partner.microsoft.com/dashboard) відкрийте Edge → **Create new extension** і завантажте ZIP.
3. Заповніть **Availability**, **Properties**, **Privacy**, **Store listings** та нотатки для сертифікації; перевірте ринки, видимість, дозволи й URL політики.
4. Надішліть на перевірку. Коли статус стане **In the store**, звірте версію **0.4.0** і встановіть із Edge Add-ons у чистому профілі. Подання до Chrome **не** публікує продукт в Edge. [Офіційна інструкція](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Після подання й наступні оновлення

Збережіть фактичні посилання, ID продуктів, версії та зауваження рецензентів. Додавайте магазинні посилання до README лише після схвалення й тесту встановлення. Якщо отримано відмову, виправте причину, повторно перевірте пакет і подайте знову.

Для оновлення підвищте версію відповідного маніфесту, зберіть новий пакет та оновіть **наявний** запис магазину. Chrome й Edge вимагають більшу версію для нового ZIP; версії VS Code і браузерного розширення незалежні. Першу публікацію зробіть вручну; автоматизація й секрети CI — окрема майбутня робота. [Chrome: оновлення](https://developer.chrome.com/docs/webstore/update), [Edge: оновлення](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension).

Перед оновленням або переходом з unpacked-інсталяції дочекайтеся підтвердження збереження, експортуйте **зашифровану резервну копію** й збережіть пароль. Не видаляйте заповнене розширення: його локальні дані можуть зникнути. Автоматичне перенесення між unpacked і магазинним встановленням **не доведене**; перевіряйте відновлення з копії окремо. Бібліотеки v1/v2 читаються без зміни вмісту; наступний запис використовує v3, яку старі збірки не прочитають. При злитті копії наявний локальний Global Shared зберігається, а пропущений імпортований запис явно позначається; оригінальна зашифрована копія лишається доступною. [Локальні дані](browser/README.md).
