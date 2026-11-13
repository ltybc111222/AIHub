# Разведка, часть 2: живая структура интерфейсов

Задача: issue #2. Продолжение [части 1](01-recon-desk.md).

## Условия проверки

| Параметр | Значение |
| --- | --- |
| Дата | 13.11.2026 |
| Браузер | Google Chrome 157.0.8103.51, macOS |
| Язык браузера | `ru` |
| Языки интерфейса | Каждый сервис проверен на русском и английском |
| ChatGPT | Тариф Free |
| Посторонние расширения в профиле | LanguageTool: добавляет в поля ввода `data-lt-tmp-id`, `data-gramm` и элементы `lt-toolbar`, `lt-div`, `lt-span` |

### Метод

Структуру снимал скрипт [`recon/snapshot.js`](recon/snapshot.js), запущенный через Claude in Chrome в залогиненном профиле.

- **Что делает скрипт.** Только читает DOM: не кликает, не вводит текст, не делает сетевых запросов. Записывает теги, роли, атрибуты из белого списка, счётчики, геометрию и таймлайн состояний с шагом 250 мс. Текст страницы не сохраняет. Значения, похожие на идентификаторы, заменяет на `…`.
- **Что делал пользователь.** Вводил и отправлял тестовые запросы, переключал язык интерфейса, открывал меню модели.
- **Запросы:**
  - короткий: «Напиши функцию сложения двух чисел на Python и таблицу из двух строк»;
  - длинный, для проверки фоновой вкладки: «Подробно объясни алгоритм быстрой сортировки с примером кода на Python».

Фрагменты разметки ниже передают только структуру. Значения `aria-label` приведены там, где важно показать локализацию.

## Главное

1. **Из 12 гипотез части 1 подтвердились две:** поле ввода Claude и контейнер ответа DeepSeek. Ещё пять изменились, пять устарели. Большая часть якорей аналога уже не работает в том виде, в каком записана.
2. **Атрибуты `data-testid` и атрибуты состояния ни разу не зависели от языка.** Локализованы все `aria-label`, `aria-placeholder` и `placeholder`. Якорь по `aria-label` без пометки языка годится только как последний сигнал.
3. **Признак конца генерации нельзя брать из одного сигнала.** У Claude `data-state=done` наступает примерно на 24 с раньше конца стриминга. У ChatGPT текст в момент завершения укорачивается при финальной перерисовке. У DeepSeek кнопка возвращается в исходное состояние, а текст в скрытой вкладке ещё не дописан.
4. **Фоновая вкладка:** ChatGPT и Claude дописали ответ, пока вкладка была скрыта. DeepSeek нет: текст замер на середине и появился целиком только после возврата на вкладку.
5. **В ответах ChatGPT блоки кода сами являются редакторами** с `contenteditable` и `role=textbox`. Поиск поля ввода «по первому textbox» на странице с ответом найдёт не то.
6. **Флаг `i` в CSS-селекторах сворачивает регистр только для ASCII.** `[aria-label*="останов" i]` не находит «Остановить». Это касается любых якорей с кириллицей.

## ChatGPT

| № | Пункт | Наблюдение |
| --- | --- | --- |
| 1 | Поле ввода | `div[contenteditable="true"][role="textbox"][aria-multiline="true"][data-composer-markdown][data-virtualkeyboard]` с классом `ProseMirror`, `translate="no"`, `dir="auto"`. `id` нет. Лежит внутри `form` > … > `fieldset` > … > `div[role="presentation"]`, форма внутри `main`. `aria-label` локализован: «Спросить ChatGPT» / «Ask ChatGPT». |
| 2 | Кнопка отправки | Отдельной постоянной кнопки нет: одна позиция в `form`, где по очереди появляются три разных `button`. Пусто: голосовой режим `[type="button"][data-composer-voice-start="true"]`. С первым непробельным символом: `button[type="submit"]` без `data-testid`, «Отправить» / «Send». Во время генерации: `button[type="button"]` «Остановить» / «Stop» без других атрибутов. Пробелы кнопку отправки не включают. Остальные кнопки композера: `[data-composer-navigation-target="add-context"]`, переключатель «Размышление» с `aria-pressed`, диктовка `[data-dictation-button="idle"][aria-busy="false"]`. |
| 3 | Признак генерации | На реплике `[data-talvt-turn-state]`: `in_progress` во время ответа, `complete` после. Переход совпадает со сменой кнопки «Стоп» на голосовую. Пока идёт вывод, есть атрибут `data-d-streaming-reveal`, он снимается примерно через 250 мс после `complete`. Счётчик `[data-d-stream-run]` растёт с каждым фрагментом. `aria-busy` и `aria-live` во время ответа не меняются. В момент завершения длина текста уменьшилась на ~5% (финальная перерисовка). |
| 4 | Контейнер ответа | Реплика: `div[data-turn-key][data-content-search-turn-key]`. Роль задаёт скрытый заголовок `h4[data-conversation-role="user|assistant"]`. Обёртка сообщения: `[data-content-search-unit-key="…:user|:assistant"]`. Пузырь пользователя: `[data-user-message-bubble="true"]`. Тело ответа: `[data-markdown-text-style]` > `[data-markdown-copy="contents"]` > `[data-dil-response]`. Заголовки: `h3[data-d-component="title"]`. Таблица: `[data-d-component="table"]` > `[data-d-table-viewport]` > `table`. Код: `[data-client-defined-widget="code_block"]` > `[data-code-block="true"]` > редактор `div[contenteditable][role="textbox"][data-language="python"]`, «Редактировать код» / кнопка «Запустить код». **Тега `pre` нет.** Атрибут `data-chatgpt-copy-code` хранит текст кода целиком. Отличие пользователя от ассистента видно на уровне атрибутов. |
| 5 | Переключатель модели | На тарифе Free в шапке его нет. Режим выбирается кнопкой «Размышление» с `aria-pressed` в композере. Меню платных тарифов не проверено. |
| 6 | Исчерпание лимита | Не наблюдалось. |
| 7 | Ландмарки | `aside`, `nav[role="navigation"]`, скрытый `nav`, `header`, `main` (со случайным `id`), `div[role="main"]`, `form`. Регионы `role="status"`: два `[aria-live="assertive"]` от drag-and-drop и один `span[aria-live="polite"]`. |
| 8 | Язык | После смены языка страница перезагрузилась. Изменились только `aria-label`. Роли, `data-*`, состав кнопок и атрибуты состояния одинаковы. |
| 9 | Фоновая вкладка | Вкладка скрыта 54 с с момента отправки. Текст рос в фоне, `complete` наступил на 22-й секунде, после возврата длина не изменилась. **Ответ дописан в фоне полностью.** Таймер страницы в скрытой вкладке срабатывал примерно раз в 1,2 с. |

## Claude

| № | Пункт | Наблюдение |
| --- | --- | --- |
| 1 | Поле ввода | `div[contenteditable="true"][role="textbox"][aria-multiline="true"][data-testid="chat-input"][data-composer-editor][data-cds="Editor"][enterkeyhint="enter"]`, класс `ProseMirror`. Признак пустого поля: `data-doc-empty="true|false"`. `form` нет: цепочка из ~20 `div` с `fieldset` и `div[role="presentation"]` внутри `main`. Локализованы `aria-label` («Напишите запрос для Claude» / «Write your prompt to Claude») и `aria-placeholder`. |
| 2 | Кнопка отправки | `button[data-testid="chat-input-send"]` есть в DOM даже при пустом поле, в той же позиции, что голосовой режим. Пусто: `disabled`. Есть текст: активна. Сразу после отправки: `disabled` и `aria-keyshortcuts="Enter"`. Во время генерации её место занимает `button[data-testid="chat-input-stop"]` («Остановить ответ» / «Stop response»). У всех кнопок есть `data-cds="Button"`. Вложения: `button[data-testid="chat-input-attach"][aria-haspopup="menu"]`. |
| 3 | Признак генерации | `div[data-testid="assistant-message"][data-is-streaming]`: `true` во время вывода, `false` после. На строке ленты `[data-perf-row-streaming="true|false"]`. Последовательность `data-state`: `pending` → `busy` → `done` → `idle`. Пока идёт работа, есть `data-busy="true"`. **`data-state="done"` пришёл примерно на 24 с раньше, чем `data-is-streaming="false"`.** |
| 4 | Контейнер ответа | Лента: `[data-testid="transcript-list"]` > `div[role="feed"]` > `[data-testid="transcript-row"]` > `div[role="article"][aria-posinset][aria-setsize]`. `aria-label` строки: «Message N» / «Сообщение N». Пользователь: `[data-user-scope]` … `[data-testid="user-message"]`. Ассистент: `[data-reply-scope]` > `[data-testid="assistant-message"]` > `.prose[data-prose-tables]` > `.standard-markdown[data-perf-reply-text]`. Код: `div[data-not-prose]` > `div[role="group"]` с локализованным `aria-label` («Код на языке python» / «python code») > `pre.code-block__code`, кнопка `[data-testid="code-block-copy"]`. Таблица: `.prose-scroll` > `table`. Заголовки: `h3[aria-level]`. Панель действий: `[data-testid="message-actions"][role="toolbar"]` и `time[datetime]`. Отличие пользователя от ассистента видно на уровне атрибутов. |
| 5 | Переключатель модели | `button[data-testid="model-selector-dropdown"][aria-haspopup="menu"]`. `aria-label` содержит название модели и уровень усилия, при открытом меню `aria-expanded="true"`. Меню: `div[role="menu"]` (Base UI, `data-side`, `data-align`, `data-open`) > `div[role="group"]` > `div[role="menuitemradio"][data-model-id][aria-checked]`. Значения `data-model-id` — публичные идентификаторы моделей. После разделителей идут два подменю `div[role="menuitem"][aria-haspopup="menu"]`. Список моделей и текущая модель читаются без текста интерфейса. |
| 6 | Исчерпание лимита | Не наблюдалось. |
| 7 | Ландмарки | `aside`, `main`, `header`, `div[role="toolbar"]`, `div[role="feed"]`, много регионов `role="status"` с `aria-live="polite"`, `div[role="region"][aria-live="polite"]`. |
| 8 | Язык | Язык интерфейса меняется в меню профиля (пункт «Language»), не в настройках: там только язык голоса. Без перезагрузки меняются `lang` документа и все `aria-label`. `data-testid`, `data-is-streaming`, `data-state`, `data-model-id` и области `data-*-scope` одинаковы. Гипотеза `[aria-label="Send message"]` работает только в английском интерфейсе. |
| 9 | Фоновая вкладка | Вкладка скрыта ~75 с с момента отправки. Все переходы (`busy` → `done` → `is-streaming=false`) прошли в фоне. Пока ответ стримился, текст рос медленно, а при `data-is-streaming="false"` догрузился скачком, всё ещё в скрытой вкладке. **Ответ дописан в фоне.** Таймер страницы в скрытой вкладке троттлился до 8 с между срабатываниями, это самое сильное замедление из трёх сервисов. |

## DeepSeek

| № | Пункт | Наблюдение |
| --- | --- | --- |
| 1 | Поле ввода | `textarea[name="search"]`, без `id`, `autocomplete="off"`, `spellcheck="false"`, `rows="2"`. Локализован только `placeholder` («Message DeepSeek» / «Сообщение для DeepSeek»). Предки — 11 безымянных `div` до `div#root`. Нет ни `form`, ни ландмарков. |
| 2 | Кнопка отправки | `div[role="button"]` без `aria-label` и без `aria-disabled`. Внешний вид задают классы `ds-button--primary ds-button--filled ds-button--circle`. Пусто: класс `ds-button--disabled`, `tabindex` нет. Есть текст: `tabindex` есть, класса disabled нет. Отправка (~250 мс): другая иконка и `ds-button--disabled`. Генерация: иконка «стоп», активна. Готово: снова стрелка и `ds-button--disabled`. Это всё время один и тот же элемент, меняется только SVG-иконка. Вложения: `div[role="button"]` и `input[type="file"]`. |
| 3 | Признак генерации | ARIA-признаков нет: `aria-busy`, `aria-live` и подписанной кнопки «Стоп» не было ни разу. Остаются смена иконки в кнопке отправки и рост текста в последнем `.ds-markdown`. |
| 4 | Контейнер ответа | Реплики лежат в виртуальном списке `[data-virtual-list-item-key]` > `div.ds-message`. Пользователь: `.ds-message` > … > `.ds-collapsible-text`. Ассистент: `.ds-message` > `.ds-markdown.ds-assistant-message-main-content`. **Отличие только по классам, атрибутов нет.** Код: `div.md-code-block` > `.md-code-block-banner-wrap` (язык, копирование) и `pre` (строки размечены `span`). Таблица: `div.ds-scroll-area` > `table`. Абзацы: `p.ds-markdown-paragraph`. Заголовки, списки и цитаты — нативные теги. Под ответом ряд `div.ds-flex` из `div[role="button"]`, у части есть `aria-disabled="false"`. |
| 5 | Переключатель модели | Выпадающего меню нет. Режимы DeepThink и Search — переключатели `div[tabindex][aria-pressed]` с классом `ds-toggle-button` (`--selected` у включённого), **без `role`**. |
| 6 | Исчерпание лимита | Не наблюдалось. |
| 7 | Ландмарки | Нет ни одного. На всей странице из ролей встречается только `button`, из ARIA-атрибутов — только `aria-pressed`, `aria-hidden` и (под ответом) `aria-disabled`. Корень `div#root`, на `body` атрибут `data-ds-dark-theme`. |
| 8 | Язык | Переключается без перезагрузки, `lang` документа меняется с `en-US` на `ru`. Изменились только `placeholder` и единственный `aria-label` на странице («Читать вслух» у кнопки под ответом). Классы, атрибуты и отпечатки иконок одинаковы. |
| 9 | Фоновая вкладка | Вкладка скрыта через 0,3 с после отправки, на 28 с. В фоне текст дошёл до 2 889 знаков, после чего кнопка вернулась в состояние «готово». Пока вкладка была скрыта, текст больше не менялся. Финальные 5 462 знака появились меньше чем через секунду после возврата. **Ответ в фоне не дописывается**, хотя сигнал завершения уже пришёл. Таймер страницы в скрытой вкладке срабатывал примерно раз в секунду. |

## Сверка с гипотезами части 1

| Элемент | Сервис | Гипотеза | Статус | Что сейчас |
| --- | --- | --- | --- | --- |
| Поле ввода | ChatGPT | `#prompt-textarea`, `contenteditable` с классом `ProseMirror` | Изменилось | `id` нет. ProseMirror остался, якорь: `[data-composer-markdown]` внутри `form` |
| Поле ввода | Claude | `div[contenteditable="true"].ProseMirror` | Подтверждено | Надёжнее `[data-testid="chat-input"]` |
| Поле ввода | DeepSeek | `textarea#chat-input` | Изменилось | `textarea[name="search"]` без `id` |
| Отправка | ChatGPT | `button[data-testid="send-button"]`, `aria-label*="Send"` | Изменилось | `data-testid` нет. `form button[type="submit"]`. `aria-label*="Send"` работает только в английском интерфейсе и только при непустом поле |
| Отправка | Claude | `button[aria-label="Send message"]` | Изменилось | Только в английском интерфейсе. Без привязки к языку: `[data-testid="chat-input-send"]` |
| Отправка | DeepSeek | `div[role="button"][aria-label*="Send"]` | Устарело | `aria-label` нет. Кнопка находится по классам `ds-button--primary` и положению |
| Идёт генерация | ChatGPT | `button[data-testid="stop-button"]` | Устарело | `[data-talvt-turn-state="in_progress"]`, кнопка «Стоп» только с локализованным `aria-label` |
| Идёт генерация | Claude | `button[aria-label*="Stop"]` | Изменилось | Только в английском интерфейсе. Без привязки к языку: `[data-testid="chat-input-stop"]`, `[data-is-streaming="true"]` |
| Идёт генерация | DeepSeek | `button[aria-label*="Stop"]` | Устарело | Отдельной кнопки нет. Меняется иконка на кнопке отправки |
| Ответ | ChatGPT | `div[data-message-author-role="assistant"]` | Устарело | `h4[data-conversation-role="assistant"]` и тело `[data-markdown-text-style]` рядом с ним |
| Ответ | Claude | `div.font-claude-message` | Устарело | `[data-testid="assistant-message"]` |
| Ответ | DeepSeek | `div.ds-markdown` | Подтверждено | Вместе с ним стоит `.ds-assistant-message-main-content` |

Наблюдение 5 части 1 («конец генерации определяется только исчезновением кнопки "Стоп"») для ChatGPT и Claude **устарело**: у обоих есть явные атрибуты состояния. Для DeepSeek оно остаётся в силе, только «кнопка» здесь — иконка на кнопке отправки.

## Устойчивость признаков

### Выглядят устойчивыми

- **ChatGPT:**
  - `data-composer-*` у композера и его кнопок;
  - `form button[type="submit"]`;
  - `data-turn-key`, `data-talvt-turn-state`, `data-conversation-role`;
  - ландмарки `main` и `form`.
- **Claude:**
  - весь набор `data-testid` (`chat-input`, `chat-input-send`, `chat-input-stop`, `assistant-message`, `user-message`, `transcript-row`, `model-selector-dropdown`);
  - `data-is-streaming`, `data-doc-empty`, `data-model-id` с `aria-checked`;
  - `role="feed"` и `role="article"`;
  - области `data-user-scope` / `data-reply-scope`.
- **DeepSeek:**
  - `textarea` как единственное поле ввода;
  - `.ds-markdown` для ответа;
  - `aria-pressed` у переключателей режимов;
  - префикс `ds-` у классов дизайн-системы. Это читаемые имена, а не хеши; хешированные классы вроде `_52c986b` встречаются рядом, и их использовать нельзя.

### Выглядят хрупкими

- Любой `aria-label`, `aria-placeholder` и `placeholder`: все локализованы.
- ChatGPT:
  - внутренние названия вроде `data-talvt-*` и `data-dil-*` похожи на имена экспериментов и могут исчезнуть при следующем релизе;
  - разметка `data-d-*` нового рендерера.
- Claude: последовательность `data-state` (`done` наступает раньше конца стриминга).
- DeepSeek:
  - у ответа и реплик нет ни одного атрибута, только классы;
  - кнопки отличаются только классами и SVG-иконкой;
  - нет ландмарков и форм, на которые можно опереться при поиске областей.
- Порядок и положение кнопок в композере у всех трёх: на одной позиции меняются разные элементы.

## Что это значит для прототипа и архитектуры

1. **Конец генерации — составной сигнал:** атрибут состояния (где он есть), плюс исчезновение кнопки «Стоп», плюс стабильность длины текста в течение заданного окна. Читать ответ можно только после того, как сошлись все три.
2. **Чтение в фоне по сервисам:**
   - ChatGPT и Claude можно читать из скрытой вкладки;
   - DeepSeek перед чтением нужно сделать видимым: отдельное окно или кратковременная активация вкладки. Выбор варианта — задача прототипа;
   - у Claude в фоне таймеры замедляются до 8 с, поэтому опрос по таймеру надо заменить на `MutationObserver` плюс проверку при возврате видимости.
3. **Поиск поля ввода:** сначала сервисный якорь (`data-composer-markdown`, `data-testid="chat-input"`, единственный `textarea`), затем положение внутри `form` или нижней части `main`. Редактируемые блоки кода в ответах ChatGPT кандидатами не считаются.
4. **Локализованные строки в адаптерах** допустимы только как дополнительный сигнал с явной картой языков. Сравнения с кириллицей выполняются в JS после `toLowerCase()`, а не CSS-флагом `i`.
5. **Чужие расширения меняют DOM поля ввода:** LanguageTool оборачивает `textarea` у DeepSeek. Ввод нужно проверять по результату, а не по факту вызова.
6. **Выбор DeepSeek для прототипа стоит пересмотреть.** Ввод в `textarea` у него действительно самый простой. Но по чтению ответа, признаку генерации и работе в фоне он самый слабый из трёх. У Claude семантика самая полная, а у ChatGPT в фоне всё работает и состояние видно явно. Решение принимается в issue прототипа.

## Что проверить не удалось

- **Пункт 6 (исчерпание лимита)** ни у одного сервиса: лимит не достигнут. Нужна отдельная проверка, когда лимит закончится естественным образом.
- **Меню моделей ChatGPT** на платном тарифе: на Free его нет.
- **Формулы** (KaTeX, MathML): тестовые запросы их не содержали, во всех ответах счётчики `.katex`, `math`, `mjx-container` равны нулю.
- **Фоновая вкладка** проверена на одном языке интерфейса для каждого сервиса: ChatGPT на английском, Claude и DeepSeek на русском. Первый прогон ChatGPT на русском длился 12,5 с и закончился раньше ответа, поэтому в выводы не вошёл.
- **Подписи кнопок под ответом DeepSeek** в английском интерфейсе не сверялись. Видно только, что в русском встречается единственный `aria-label` на странице.
