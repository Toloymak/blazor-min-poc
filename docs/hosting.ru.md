[English](hosting.md) | **Русский**

# Размещение демо: GitHub Pages и Azure App Service

Эта страница — часть [README](../README.ru.md). Здесь описано, как собирается и отдаётся демо-сайт.

## Хостинг на GitHub Pages

Workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) («Blazor WebAssembly minification demo - GitHub Pages») запускается при каждом push в
`main`, его можно запустить и вручную. Он ставит те же инструменты, что и в разделе [Как получить эти числа самому](../README.ru.md#как-получить-эти-числа-самому), выполняет `./build.sh honest` и `./build.sh extreme`,
измеряет обе сборки, собирает сайт через `tools/assemble-site.mjs` под базовым путём Pages, проверяет там оба приложения сервером,
похожим на Pages, и публикует.

Что сделать один раз:

1. Сделайте репозиторий публичным. Бесплатный GitHub Pages работает только для публичных репозиториев; для приватного нужен платный план.
2. Сделайте push в `main`.
3. В **Settings → Pages** выберите **Source** = **GitHub Actions**.

На сайте есть небольшая главная страница с измеренными размерами и два приложения в `honest/` и `extreme/`.
У Pages нет SPA fallback, поэтому глубокие ссылки работают через копии маршрутов (`counter.html`, `fetch.html`) и корневой `404.html` с перенаправлением.
Ещё на сайте есть `robots.txt` и мета-тег robots.

GitHub Pages отдаёт только gzip, поэтому передаётся примерно столько, сколько в колонке gzip (см. [Отдавайте файлы brotli, сжатые заранее](../README.ru.md#5-отдавайте-файлы-brotli-сжатые-заранее-brotli-и-gzip)).

<!-- APP-SERVICE:START -->

## Хостинг на Azure App Service (brotli)

GitHub Pages отдаёт только gzip. Чтобы браузер получал наши собственные файлы brotli, в репозитории есть маленькое
приложение-хост [`Host/`](../Host/) и ручной workflow [`.github/workflows/azure.yml`](../.github/workflows/azure.yml) для уже
существующего плана App Service (по размеру проверялся B1). Работает и на Windows-, и на Linux-плане.

**Что делает хост.** На запрос `X` он отдаёт `X.br` с `Content-Encoding: br`, если браузер принимает brotli, иначе `X.gz`
с gzip, иначе обычный файл. Сам он ничего не сжимает. Таблица файлов строится один раз при старте: нет обхода диска на каждый
запрос, и файлы не держатся в памяти (`SendFileAsync`). Неизвестные пути внутри `/honest/` и `/extreme/` получают `index.html`
своего приложения (статус 200), всё остальное — 404. Файлы с отпечатком в имени кэшируются на год; `index.html`, `dotnet.js`,
`blazor.webassembly.js`, `data.json` и бандл `b.bin` — с `no-cache` (значение integrity бандла записано в самой странице).
У каждого ответа есть `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` и Content-Security-Policy с хешами встроенных скриптов каждой страницы (без `'unsafe-inline'` для
скриптов). `/robots.txt` запрещает всё. Только GET и HEAD.

**Ресурсы в простое** (измерено на Linux-машине сборки, linux-x64; Windows не измерялась):

| Сборка | Диск | Первый ответ после старта | RSS после старта | после холодной загрузки обоих приложений | после 5 минут простоя | Потоки (простой) | CPU за минуту простоя |
|---|---:|---:|---:|---:|---:|---:|---:|
| Зависит от фреймворка, `net10.0` | 0,1 МБ (+ рантайм) | 127 мс | 53,5 МБ | 61,9 МБ | 63,5 МБ | 15 | 0,017 % |
| Автономная, с обрезкой | 26,5 МБ | 295 мс | 31,9 МБ | 37,0 МБ | 38,2 МБ | 13 | 0 % |
| **Native AOT (используется)** | 6,1 МБ | **20 мс** | **12,5 МБ** | **17,0 МБ** | **15,4 МБ** | 10 | 0 % |

Workflow разворачивает сборку Native AOT. Все три прошли одну и ту же проверку: оба приложения через хост, ноль ошибок
в консоли, каждый ответ из `_framework` пришёл в brotli, переданные байты равны сумме файлов `.br`
(honest 1 424 683, extreme 1 211 025 — на несколько байт больше измеренной сборки, потому что `<base href>` у каждого приложения свой).

**Что проверено, а что нет.** Проверено только на Linux (сам хост, сайт и все проверки на машине сборки).
Не проверено: настоящий деплой в Azure, Windows-план (ASP.NET Core Module, out-of-process) и вариант «только IIS» ниже.

**Однократная настройка**

1. Создайте веб-приложение в существующем плане.
   - Портал: **App Services → Create → Web App**, выберите группу ресурсов и **существующий план** (его ОС и определяет
     Windows или Linux). **Publish: Code**, **Runtime stack: .NET 10 (LTS)**. Хост — автономный исполняемый файл, стек нужен
     только для образа платформы.
   - CLI (Linux-план): `az webapp create -g <resource-group> -p <plan-name> -n <app-name> --runtime "DOTNETCORE:10.0"`
   - CLI (Windows-план): `az webapp create -g <resource-group> -p <plan-name> -n <app-name> --runtime "dotnet:10"`
   - Точные имена рантаймов меняются: их показывает `az webapp list-runtimes --os linux` / `--os windows`.
2. Только для Linux: задайте команду запуска (**Configuration → General settings → Startup Command**):
   `chmod +x /home/site/wwwroot/Host && /home/site/wwwroot/Host`
   (CLI: `az webapp config set -g <resource-group> -n <app-name> --startup-file "chmod +x /home/site/wwwroot/Host && /home/site/wwwroot/Host"`).
   Для Windows ничего не нужно: workflow сам кладёт `web.config`, который запускает `Host.exe` out-of-process и выключает сжатие IIS.
3. Получите профиль публикации: **Overview → Download publish profile** (CLI:
   `az webapp deployment list-publishing-profiles -g <resource-group> -n <app-name> --xml`). Если скачивание недоступно,
   включите **Configuration → General settings → SCM Basic Auth Publishing Credentials**.
4. В GitHub: **Settings → Environments → New environment `azure-demo`**, добавьте правило ветки развёртывания `main`
   и секрет окружения `AZURE_WEBAPP_PUBLISH_PROFILE` (весь XML-файл). Затем **Settings → Secrets and variables → Actions → Variables**:
   `AZURE_WEBAPP_NAME` — имя приложения, `AZURE_WEBAPP_OS` — `linux` или `windows`. Необязательно: `AZURE_WEBAPP_HOST` = `iis` (см. ниже).
5. Запуск: **Actions → «Blazor WebAssembly minification demo - Azure App Service» → Run workflow** на ветке `main`.
   Последний шаг по HTTPS проверяет, что wasm и бандл приходят с `content-encoding: br` и ровно с длиной файла `.br`.

**Как проверить brotli самому.** Откройте сайт, DevTools → **Network**, включите **Disable cache**, перезагрузите страницу.
Добавьте колонку **Content-Encoding** (правый клик по заголовку таблицы): у файлов `_framework` будет `br`. Итог **Transferred**
должен быть близок к колонке brotli.

**Настройки, которые снижают расход в простое** (названия как в портале / CLI; ставьте сами):
- **Always On** выключено (`az webapp config set --always-on false`): после 20 минут без запросов приложение выгружается,
  в простое расход нулевой. Следующий посетитель ждёт холодный старт платформы плюс старт самого хоста (20 мс у AOT-хоста, измерено).
- **Session affinity (ARR affinity)** выключено (`az webapp update --client-affinity-enabled false`): сессий у приложения нет.
- **Application Insights**, **App Service logs** и **Health check** выключены: каждый добавляет запросы или агента.
- **Platform: 64 Bit** на Windows (`--use-32bit-worker-process false`): AOT-хост — 64-битный исполняемый файл.
- **HTTP version 2.0** (`--http20-enabled true`): меньше соединений для множества мелких файлов.

**Windows без процесса приложения (не проверено).** С `AZURE_WEBAPP_HOST=iis` на Windows-плане workflow разворачивает только
файлы и [`Host/iis-static/web.config`](../Host/iis-static/web.config): правила URL Rewrite заставляют сам IIS отдавать `X.br`
с `Content-Encoding: br`. Файл сделан по образцу Microsoft для Blazor WebAssembly на IIS, но на IIS он не запускался.

**Может ли App Service изменить наши сжатые ответы?** На Windows сжатие IIS выключено в созданном `web.config`
(`urlCompression`), так что IIS добавлять нечего. На Linux платформа передаёт ответ приложения как есть. На настоящем
App Service это ещё не проверялось; последний шаг workflow и есть эта проверка.
<!-- APP-SERVICE:END -->
