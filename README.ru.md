[English](README.md) | **Русский**

# Минификация Blazor WebAssembly на .NET 11

**Живое демо** (GitHub Pages, только gzip): [главная](https://toloymak.github.io/blazor-min-poc/) ·
[приложение `Honest`](https://toloymak.github.io/blazor-min-poc/honest/) · [приложение `Extreme`](https://toloymak.github.io/blazor-min-poc/extreme/) ·
[подробный отчёт](https://toloymak.github.io/blazor-min-poc/report.html). Исходный код: [github.com/Toloymak/blazor-min-poc](https://github.com/Toloymak/blazor-min-poc).

Результат этого проекта — измеренный список способов уменьшить размер загрузки приложения Blazor WebAssembly (Blazor WASM)
на .NET 11 со стандартным рантаймом. Для каждого способа указана экономия в байтах.
В списке есть IL trimming через ILLink, feature switches вроде `InvariantGlobalization`,
нативная перелинковка с workload `wasm-tools`, Bit.Minifier, `wasm-opt`, terser и один бандл для всех сборок.
Каждый размер дан без сжатия, в brotli и в gzip, поэтому видно реальный размер бандла, который скачивает браузер.

Одно и то же приложение из трёх страниц (Home, Counter, Fetch) собрано и измерено более чем в 160 конфигурациях (161 прогон в журнале).
Оставлены два итоговых варианта: `Honest` и `Extreme`.

**Содержание**

- [Как уменьшить размер загрузки Blazor WebAssembly](#как-уменьшить-размер-загрузки-blazor-webassembly)
  - [1. Установите workload `wasm-tools` и используйте нативную перелинковку](#1-установите-workload-wasm-tools-и-используйте-нативную-перелинковку)
  - [2. Настройки trimming и feature switches, которые экономят больше всего](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего)
  - [3. Постобработка после публикации](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки)
  - [4. Изменения кода, которые делает `Extreme`](#4-изменения-кода-которые-делает-extreme)
  - [5. Отдавайте файлы brotli, сжатые заранее](#5-отдавайте-файлы-brotli-сжатые-заранее-brotli-и-gzip)
  - [Настройки, которые ничего не дали](#настройки-которые-ничего-не-дали)
  - [Настройки, которые сломали приложение или сборку](#настройки-которые-сломали-приложение-или-сборку)
- [Насколько маленьким может быть приложение Blazor WebAssembly на .NET 11?](#насколько-маленьким-может-быть-приложение-blazor-webassembly-на-net-11)
- [Два итоговых варианта: Honest и Extreme](#два-итоговых-варианта-honest-и-extreme)
- [Как измерялся размер загрузки](#как-измерялся-размер-загрузки)
- [Как получить эти числа самому](#как-получить-эти-числа-самому)
- [Чем жертвует Extreme](#чем-жертвует-extreme)
- [Что мешает приложению Blazor WebAssembly стать ещё меньше](#что-мешает-приложению-blazor-webassembly-стать-ещё-меньше)
- [FAQ: размер Blazor WebAssembly](#faq-размер-blazor-webassembly)
- [Структура репозитория](#структура-репозитория)
- [Полный журнал и страница отчёта](#полный-журнал-и-страница-отчёта)

## Как уменьшить размер загрузки Blazor WebAssembly

Самая большая измеренная экономия, в байтах brotli. Каждая экономия измерена отдельно или как шаг поверх предыдущих
(базовый прогон назван в разделе по ссылке), поэтому числа не складываются точно.

| Способ уменьшить загрузку | Экономия brotli | Подробно |
|---|---:|---|
| Нативная перелинковка с workload `wasm-tools` и настройки, которым она нужна | примерно 800–850k | [Шаг 1](#1-установите-workload-wasm-tools-и-используйте-нативную-перелинковку) |
| `InvariantGlobalization=true` | 657 823 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| Изменения кода `Extreme`: свой роутер, HTTP через JS `fetch` | 137 828 | [Шаг 4](#4-изменения-кода-которые-делает-extreme) |
| `EventSourceSupport=false` | 98 849 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| Bit.Minifier | 91 369 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| Один файл-бандл для всех сборок | 75 030 | [Шаг 3](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки) |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | 64 384 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| `MetricsSupport=false` | 50 418 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| `DynamicCodeSupport=false` | 30 502 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| `WasmEnableSIMD=false` | 27 385 | [Шаг 2](#2-настройки-trimming-и-feature-switches-которые-экономят-больше-всего) |
| Нативные заглушки | 23 337 | [Шаг 3](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки) |
| terser для JS-файлов | 21 916 | [Шаг 3](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки) |
| Проход по метаданным через Mono.Cecil | 20 134 | [Шаг 3](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки) |
| `wasm-opt -Oz` | 18 608 | [Шаг 3](#3-постобработка-после-публикации-бандл-wasm-opt-terser-нативные-заглушки) |

Цена каждой строки (что ломается или становится медленнее) описана в разделе по ссылке.

Все числа — измеренные разницы brotli из [`results/experiments.jsonl`](results/experiments.jsonl).
«Прогон» — id измерения в этом файле. Если в строке не сказано иное, разница — это одна настройка отдельно
на исходном приложении `Honest` (прогон `h00-default`, 2 563 523 байт brotli).

### 1. Установите workload `wasm-tools` и используйте нативную перелинковку

С workload `wasm-tools` команда `dotnet publish` заново линкует `dotnet.native.wasm` под ваше приложение.
Одна только перелинковка экономит 36 377 на шаблоне (`baseline-norelink` против `baseline`).
Важнее другое: несколько крупных настроек работают только с ней. Без перелинковки `InvariantGlobalization`, `InvariantTimezone`
и `WasmEnableSIMD=false` останавливают сборку (`WasmBuildNative is required ...`), а `EmccLinkOptimizationFlag` молча игнорируется.
Без перелинковки лучшие результаты были `Honest` 2 320 504 и `Extreme` 2 186 970 brotli.
С ней итоговые сборки раунда 1 весили 1 519 331 и 1 333 578 — примерно на 800–850k меньше.

```bash
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

В Linux для перелинковки нужен ещё `libatomic1` (его использует Node внутри workload):

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

Полная установка (SDK, workload, инструменты Node) описана в разделе [Как получить эти числа самому](#как-получить-эти-числа-самому).

### 2. Настройки trimming и feature switches, которые экономят больше всего

Это безопасные настройки, их использует `Honest`. Оставленные свойства MSBuild лежат в [`Directory.Build.props`](Directory.Build.props) (`SizeProfile=final`).

| Настройка | Δ brotli | Прогон | Цена или примечание |
|---|---:|---|---|
| `InvariantGlobalization=true` | −657 823 | `s-invglob` | Только инвариантная культура. Нужна перелинковка (ICU уходит из нативного файла). |
| `EventSourceSupport=false` | −98 849 | `s-noeventsource` | Нет диагностики EventSource. |
| Bit.Minifier 11.0.0-pre-20 (`UseBitMinifier=true`) | −91 369 | `s-bitmin` | Пакет времени сборки; переименовывает непубличные имена фреймворка. |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | −64 384 | `s-invtz` | Только UTC. Нужна перелинковка. |
| `MetricsSupport=false` | −50 418 | `s-nometrics` | Нет метрик. |
| `DynamicCodeSupport=false` | −30 502 | `c-honest-dyncode` (поверх настроек выше) | DI и деревья выражений идут медленным путём через рефлексию. |
| `WasmEnableSIMD=false` | −27 385 | `s-nosimd` | Рантайм медленнее. Нужна перелинковка. |
| `WasmEnableExceptionHandling=false` | −27 329 | `s-noeh` | Запасной вариант emscripten на JS. Поверх выключенного SIMD всего −199 (`x-noeh`). |
| `BitMinifyAggressive=true` | −17 176 | `c-honest-bitmin-aggr` (поверх) | Публичные имена фреймворка тоже переименованы (логи читать труднее). |
| `EmccLinkOptimizationFlag=-Oz` | −7 598 | `s-linkOz` | Без перелинковки игнорируется. |
| `HttpActivityPropagationSupport=false` | −6 477 | `s-nohttpactivity` | Нет передачи HTTP activity. |
| `EmccExtraLDFlags=-sMALLOC=emmalloc` | −2 089 | `x-emmalloc` (на `Extreme`) | Меньший и более простой аллокатор. |
| `TrimMode=full` + `TrimmerRootAssembly` для приложения | −1 699 | `s-trimfull` | Без корня приложение ломается (см. ниже). |
| `StackTraceSupport=false` | −432 | `s-nostacktrace` | Нет стека вызовов в исключениях. |
| `TrimmerRemoveSymbols=true`, `DebugType=none`, `GenerateDocumentationFile=false` | −145 | `s-nosymbols` | Нет отладочных символов. |
| `WasmEnableWebcil=false` | +498 | `s-nowebcil` | Отдельно больше, в полной цепочке −278 (`h24-nowebcil`), поэтому оставлено. |
| `WasmFingerprintDotnetJs=false`, `BlazorFingerprintBlazorJs=false` | +33 | `s-nofingerprint` | Около нуля (шум). |

Сама нативная перелинковка (по умолчанию при наличии workload) экономит 36 377 на шаблоне (`baseline-norelink` против `baseline`).

Те же настройки в виде блока для файла проекта, взятые из [`Directory.Build.props`](Directory.Build.props).
В этом репозитории Bit.Minifier включается свойствами `UseBitMinifier` и `BitMinifierVersion`, которые добавляют ссылку на пакет из конца блока.
`TrimMode=full` требует ещё корня для сборки приложения, как в [`Honest/Honest.csproj`](Honest/Honest.csproj).

```xml
<PropertyGroup>
  <!-- trimming -->
  <TrimMode>full</TrimMode>
  <TrimmerRemoveSymbols>true</TrimmerRemoveSymbols>
  <DebugType>none</DebugType>
  <GenerateDocumentationFile>false</GenerateDocumentationFile>
  <!-- feature switches -->
  <InvariantGlobalization>true</InvariantGlobalization>
  <InvariantTimezone>true</InvariantTimezone>
  <BlazorEnableTimeZoneSupport>false</BlazorEnableTimeZoneSupport>
  <EventSourceSupport>false</EventSourceSupport>
  <HttpActivityPropagationSupport>false</HttpActivityPropagationSupport>
  <MetricsSupport>false</MetricsSupport>
  <StackTraceSupport>false</StackTraceSupport>
  <DynamicCodeSupport>false</DynamicCodeSupport>
  <!-- native relink (needs the wasm-tools workload) -->
  <WasmEnableSIMD>false</WasmEnableSIMD>
  <WasmEnableExceptionHandling>false</WasmEnableExceptionHandling>
  <EmccLinkOptimizationFlag>-Oz</EmccLinkOptimizationFlag>
  <EmccExtraLDFlags>-sMALLOC=emmalloc</EmccExtraLDFlags>
  <!-- publish output -->
  <WasmEnableWebcil>false</WasmEnableWebcil>
  <WasmFingerprintDotnetJs>false</WasmFingerprintDotnetJs>
  <BlazorFingerprintBlazorJs>false</BlazorFingerprintBlazorJs>
  <!-- Bit.Minifier -->
  <BitMinifyAggressive>true</BitMinifyAggressive>
</PropertyGroup>
<ItemGroup>
  <TrimmerRootAssembly Include="$(AssemblyName)" />
  <PackageReference Include="Bit.Minifier" Version="11.0.0-pre-20" PrivateAssets="all" />
</ItemGroup>
```

### 3. Постобработка после публикации: бандл, wasm-opt, terser, нативные заглушки

Эти шаги идут после `dotnet publish`. Их делает `build.sh` скриптами из [`tools/`](tools). Измерено на `Extreme`.

| Шаг | Δ brotli | Прогон | Цена или примечание |
|---|---:|---|---|
| Один файл-бандл для всех 32 сборок (`tools/bundle.mjs`) | −75 030 | `r2-base-br` → `r2-b-group` | Одно значение целостности на всё; нет кеша по отдельным сборкам. В gzip тоже −32k. |
| Нативные заглушки по имени (`tools/wasmstub.mjs`) | −23 337 | `r2-x-names` → `f2-extreme` | Код-заглушка падает, если его вызвать (PDB/zlib, поиск AOT, SIMD интерпретатора, дамп потоков). |
| terser для JS-файлов (раунд 1) | −21 916 | `e04-minify` | Файлы нужно пересобирать через `build.sh` (значения целостности переписываются). |
| Проход по метаданным через Mono.Cecil (`tools/MetaStrip`) | −20 134 | `r2-c1-slim-aggr` → `r2-m-props-notasks` | Рефлексия по служебным атрибутам компилятора, свойствам/событиям и константам фреймворка ничего не находит. |
| `wasm-opt -Oz` для `dotnet.native.wasm` (раунд 1) | −18 608 | `e03-wasmopt` | |
| Агрессивный terser + урезанный boot config | −2 572 | `r2-c1-slim-aggr` | |
| `wasm-opt -tnh --gufa` | −1 509 | `r2-b-group` → `r2-n-tnh-gufa` | `-tnh` считает, что trap никогда не случается. |
| `wasm-opt --converge` | −822 | `x-wasmopt-converge` | |

`Honest` с постобработкой раунда 2 (без бандла, без изменений кода) стал меньше: с 1 519 331 до 1 424 673 (`f2-honest`, −94 658).

Для этих шагов нет настройки в проекте. Запускайте их так же, как [`build.sh`](build.sh): проход Cecil, нативные заглушки,
`wasm-opt` и terser — в [`tools/postprocess.mjs`](tools/postprocess.mjs) (он же записывает новые значения целостности),
бандл — в [`tools/bundle.mjs`](tools/bundle.mjs). Список нативных функций-заглушек — `STUBS_DEFAULT` в `build.sh`.

```bash
./build.sh extreme
```

### 4. Изменения кода, которые делает `Extreme`

| Изменение | Δ brotli | Прогон | Цена или примечание |
|---|---:|---|---|
| Свой роутер + HTTP через JS `fetch` (в коде приложения нет `HttpClient` и System.Text.Json) | −137 828 | `e00-extreme` (против `Honest` с теми же настройками) | Нет маршрутизации `@page`, нет `HttpClient`. |
| Заглушки ILLink: `Console.get_Error`, `JsonStreamConfigurationSource.Build` | −16 682 | `x-subst2a` | `Console.Error` равен null; `appsettings.json` игнорируется. |
| Заглушка ILLink: `DomainNameHelper.TryGetUnicodeEquivalent` | −2 645 | `x-subst2c` | Юникодные (IDN) имена хостов не преобразуются. |
| Заглушки ILLink: `AddEnvironmentVariables`, проверки провайдера культур | −2 034 | `x-subst` | Переменных окружения нет в `IConfiguration`. |

Код лежит в [`Extreme/`](Extreme): роутер в `App.razor`, страницы в `Pages/`, заглушки ILLink в `ILLink.Substitutions*.xml`,
они включаются в [`Extreme/Extreme.csproj`](Extreme/Extreme.csproj).

### 5. Отдавайте файлы brotli, сжатые заранее (brotli и gzip)

Здесь brotli примерно на 20 % меньше gzip: `Extreme` весит 1 211 018 байт в brotli и 1 507 342 в gzip,
`Honest` — 1 424 673 и 1 706 941.

`build.sh` заранее сжимает каждый файл через [`tools/compress.mjs`](tools/compress.mjs): рядом с каждым файлом появляется `.br`
(brotli, качество 11, окно 24) и `.gz` (gzip, уровень 9). Сервер должен отдавать файл `.br` с `Content-Encoding: br`,
если браузер принимает brotli. Сервер, который сжимает gzip на лету, отдаёт примерно колонку gzip
(его собственный уровень gzip может дать чуть больше). Живое демо отдаётся в gzip, поэтому показывает размер gzip.

Как проверить самому в DevTools Chrome или Edge:

1. Откройте демо, нажмите F12 и перейдите на вкладку **Network**.
2. Включите **Disable cache**.
3. Перезагрузите страницу. Затем нажмите Counter и Fetch.
4. Посмотрите на строку внизу: «**transferred**» — сколько пришло по сети, «**resources**» — размер после распаковки.
5. Сравните «transferred» с колонкой gzip (сервер отдаёт gzip) или brotli (сервер отдаёт файлы `.br`).
   «Resources» должно быть близко к колонке «без сжатия».

В «transferred» входят и HTTP-заголовки, поэтому число немного больше суммы файлов.
На живом демо сборка сайта ещё немного меняет `index.html` (`<base href>`, маленький скрипт для глубоких ссылок
и мета-тег robots), так что небольшая разница будет и поэтому.

### Настройки, которые ничего не дали

Каждая дала около нуля байт, поэтому их откатили.

| Настройка | Δ brotli | Прогон |
|---|---:|---|
| `DebuggerSupport=false` | +17 | `s-nodebugger` |
| `UseSystemResourceKeys=true` | +52 | `s-sysreskeys` |
| `MetadataUpdaterSupport=false` | +25 | `s-nometadataupd` |
| `NullabilityInfoContextSupport=false` | −25 | `s-nonullability` |
| `_AggressiveAttributeTrimming=true` | +4 | `s-aggrattr` |
| `UseSizeOptimizedLinq=true` | +46 | `s-sizelinq` |
| `Http3Support=false`, `UseNativeHttpHandler=true` | −57 | `s-nohttp3` |
| `StartupHookSupport=false` | 0 | `x-startuphook` |
| `WasmNativeStrip=true`, `WasmEmitSymbolMap=false`, `WasmEnableThreads=false` | 0 | `h23-strip` |
| `SatelliteResourceLanguages=en` | 0 | `h19-satellite` |
| `-sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0` | 0 | `x-noassert` |
| `WasmInitialHeapSize=16777216` | +295 | `x-heap` |
| Заглушки ILLink для `AppContext.OnProcessExit`, `Environment.StackTrace` и ещё трёх методов | +86 | `r2-u-all` |
| `Microsoft.Extensions.DependencyInjection.DisableDynamicEngine=true` | +13 | `r2-s-didynamic` |
| `System.Globalization.PredefinedCulturesOnly=true` | +5 | `r2-s-cultures` |

Код под заглушками остаётся достижимым из других корней, поэтому заглушки ничего не меняют.

### Настройки, которые сломали приложение или сборку

Всё это откатили.

| Настройка | Что произошло |
|---|---|
| `JsonSerializerIsReflectionEnabledByDefault=false` | Ломается JS interop: `NoMetadataForType` в `DotNetDispatcher.ParseArguments` (`h11-jsonnoreflect`). |
| `TrimMode=full` без корня для сборки приложения | `CtorNotLocated, Honest.Layout.MainLayout` (`h01-trimfull-noroot`). |
| ILLink `--ignore-descriptors true` | Приложение не запускается (`x-ignoredesc`). |
| `WasmBuildNative=false` вместе с `InvariantGlobalization`, `InvariantTimezone` или `WasmEnableSIMD=false` | Ошибка сборки: `WasmBuildNative is required ...`. |
| `EmccExtraLDFlags=-sFILESYSTEM=0` | Ошибка сборки: `-sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0` (`x-nofs`). |
| `EmccExtraLDFlags=--closure=1` | `google-closure-compiler was not found`; после установки не хватает файла в пакете workload (`x-closure`, `x-closure2`). |
| Заглушка ILLink для `EnumConverter` из STJ | Падение ILLink `IL1012` (`x-subst2b`). |
| Cecil: удалены метаданные свойств во всём CoreLib | Assertion в Mono `object.c:146` (`r2-m-props`). |
| Заглушки на все функции AOT в рантайме | `RuntimeError: unreachable` при старте (`r2-x-aot`). |
| Удалены экспорты jiterpreter (`wasm-metadce`) | Проверка падает: JS рантайма нужны эти экспорты (`r2-n-jiterp-dce`). |
| `UseMonoRuntime=false` вместе с `WasmEnableExceptionHandling=false` | Ошибка сборки: CoreCLR нужна обработка исключений wasm (`h28-coreclr`). |

Работало, но хуже:

| Настройка | Δ brotli | Почему откачено |
|---|---:|---|
| `UseMonoRuntime=false` (CoreCLR на wasm) | +422 347 | Работает, но намного больше, чем Mono (`c-honest-coreclr`). |
| `WasmRunWasmOpt=false` | +1 395 714 | Без прохода SDK нативный файл сохраняет имена и отладочные данные (`r2-n-norunopt`). |
| Бандл вместе с `dotnet.native.wasm` | −79 082 | На 4k меньше оставленного бандла, но нет потоковой компиляции: первая отрисовка 381 мс (`r2-b-group-wasm`). |

## Насколько маленьким может быть приложение Blazor WebAssembly на .NET 11?

Шаблон `dotnet new blazorwasm` скачивает **2 589 350** байт в brotli.
`Honest` на стандартных API Blazor скачивает **1 424 673** байт: на 1 164 677 меньше, то есть на 45,0 % меньше.
`Extreme` скачивает **1 211 018** байт: на 1 378 332 меньше, то есть на 53,2 % меньше.

| Сборка | Без сжатия, байт | Brotli | gzip -9 | Файлов | Разница с шаблоном (brotli) |
|---|---:|---:|---:|---:|---:|
| Шаблон (`dotnet new blazorwasm`) | 8 447 649 | 2 589 350 | — | 50 | — |
| Рецепт из issue #86601 на .NET 11 | 5 404 848 | 1 735 678 | 2 091 866 | 43 | −853 672 |
| `Honest`, раунд 1 | 4 616 080 | 1 519 331 | 1 823 357 | 43 | −1 070 019 |
| `Extreme`, раунд 1 | 4 013 671 | 1 333 578 | 1 599 659 | 39 | −1 255 772 |
| **`Honest`, итог** | **4 243 612** | **1 424 673** | **1 706 941** | 43 | **−1 164 677** |
| `Honest` + бандл (эксперимент, не по умолчанию) | 4 240 357 | 1 344 434 | 1 675 892 | 8 | −1 244 916 |
| **`Extreme`, итог** | **3 851 361** | **1 211 018** | **1 507 342** | 8 | **−1 378 332** |

Строка issue #86601 — публичный рецепт из dotnet/runtime, измеренный здесь на .NET 11.
«—» значит, что значение не измерялось или не нужно.

## Два итоговых варианта: Honest и Extreme

В обоих приложениях одни и те же три страницы: Home, Counter (кнопка-счётчик) и Fetch (загружает `data.json`).

- **`Honest`** использует только стандартные API Blazor: `WebAssemblyHostBuilder`, `Router`, `NavLink`, `HttpClient` с System.Text.Json.
  Вся экономия — от свойств MSBuild, нативной перелинковки, Bit.Minifier и постобработки готовых файлов.
  Код ради размера не менялся.
- **`Extreme`** — по-прежнему настоящий Blazor: стандартный host builder, стандартный рендерер и стандартный пакет рантайма Mono.
  Но `Router` заменён маленьким самописным роутером, HTTP идёт через JS `fetch`, часть методов фреймворка заменена заглушками
  через ILLink substitutions, все сборки упакованы в один файл, а нативные функции, которые это приложение не вызывает, заменены заглушками.
  См. [Чем жертвует Extreme](#чем-жертвует-extreme).

Работа шла в два раунда. В раунде 1 пробовались свойства MSBuild, перелинковка и простая постобработка.
Раунд 2 касался только `Extreme` (`Honest` получил ту же постобработку, но без бандла и без изменений кода).
Ограничения раунда 2: никакого форка или собственной сборки рантайма, стандартные хост и рендерер Blazor остаются.

## Как измерялся размер загрузки

**Метрика.** Сумма байт ровно тех файлов, которые браузер скачивает при первой загрузке `/` с пустым кешем
и при переходе на каждую страницу (Counter и Fetch, внутри приложения). Каждый файл сжат brotli с качеством 11 и окном 24.
gzip — уровень 9. «Без сжатия» — исходный размер.

- **Список файлов.** Headless Chromium (Playwright 1.65.1) открывает приложение с пустым кешем.
  Список файлов берётся из сетевого журнала браузера, а не из содержимого папки.
- **Отдаваемые байты (раунд 2).** Приложение отдаётся из готовых файлов `.br` с `Content-Encoding: br`
  (режим `SERVE_ENCODED=br` в `tools/serve.mjs`). Переданные байты из сетевого журнала равны сумме файлов `.br`.
  Итог `Extreme` раунда 1 даёт 1 333 578 байт обоими способами (прогон `r2-base-br`), поэтому раунды можно сравнивать.
- **Сжатие** делает zlib из Node. Он даёт те же байты, что `brotli -q 11`.

**Окружение.**

- .NET SDK 11.0.100 (`global.json`, roll-forward выключен), `Microsoft.AspNetCore.Components.WebAssembly` 11.0.0.
- Workload `wasm-tools`, стандартный пакет рантайма Mono, публикация в Release.
- binaryen 125.0.0 (`wasm-opt`, npm-пакет, зафиксированный в `tools/package-lock.json`), terser 5.51.2, Playwright 1.65.1, Bit.Minifier 11.0.0-pre-20, Node.js v24.21.0.
- Эксперименты шли на Ubuntu 22.04 в WSL2 (12 ядер, 39 ГБ памяти). Сборка в CI идёт на `ubuntu-24.04`.
  На macOS измерена только строка шаблона без workload.

**Функциональная проверка** (`tools/check.mjs`). Сборка остаётся, только если проходит всё это:

- Home отрисовывается.
- Ссылка на Counter работает без полной перезагрузки страницы.
- Два клика показывают `Current count: 2`.
- Fetch показывает текст из `data.json`, и `data.json` есть в сетевом журнале.
- Кнопки «назад» и «вперёд» работают.
- Прямая загрузка `/counter` в новом контексте браузера работает и считает (глубокая ссылка).
- Ноль ошибок в консоли, ошибок страницы и неудачных запросов.
- Если задан `SERVE_ENCODED`: каждый скачанный файл отдан из своего заранее сжатого файла.

**Страница нагрузки и «канарейка» (нативные заглушки).** Нативная функция-заглушка при вызове падает (trap).
Чтобы доказать, что такое падение ловится, прогон `r2-x-canary` заменяет заглушкой `mono_wasm_load_runtime` — функцию, которая
действительно вызывается: проверка громко падает. Каждая оставленная группа заглушек также должна была пройти страницу нагрузки
(`tools/stress/Stress.razor`). Она собирается только в тестовую копию приложения (`ExtremeStress`) и никогда не публикуется.
Она проверяет исключения, try/finally, GC под нагрузкой, форматирование и разбор чисел и дат, `Guid`, LINQ, `Dictionary`,
строки, делегаты, `Task.Delay` и неудачный HTTP-запрос (404). Нужно 15 из 15.

## Как получить эти числа самому

Шаги для чистой машины Linux x64 (эксперименты шли на Ubuntu 22.04). Они повторяют раздел «Build machine tooling»
в [`RESULTS.md`](RESULTS.md), [`build.sh`](build.sh) и [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

**1. .NET SDK 11.0.100 и workload `wasm-tools`** (в домашнюю папку, без sudo):

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --version 11.0.100 --install-dir "$HOME/.dotnet-wasm" --no-path
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

**2. `libatomic1`.** Он нужен Node, который идёт вместе с emscripten в workload. Без него любая нативная перелинковка падает.

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

**3. binaryen (`wasm-opt`)** отдельно ставить не нужно: `build.sh` берёт зафиксированный npm-пакет `binaryen` 125.0.0 из
`tools/` (ставится на шаге 5). Он даёт те же байты, что релиз binaryen `version_125` (тот же sha256 итогового `dotnet.native.wasm`).

**4. Node.js 24.** В репозитории этот шаг не автоматизирован. В экспериментах был v24.21.0 — он уже стоял на машине сборки
(команда установки не запускалась); в CI Node 24 ставит `actions/setup-node`.

**5. Склонируйте репозиторий**, затем поставьте инструменты Node и headless-браузер:

```bash
cd tools && npm ci && npx playwright install --with-deps chromium-headless-shell
```

`--with-deps` ставит системные библиотеки браузера через `sudo apt-get`. Без прав root используйте
`npx playwright install chromium-headless-shell` (этого хватит, если библиотеки уже есть).

**6. Соберите оба варианта** из корня репозитория (`cd ..` после шага 5). `build.sh` всегда подключает
[`scripts/build-env.sh`](scripts/build-env.sh). Если `dotnet` и `node` уже в `PATH`, скрипт ничего не меняет; он только добавляет SDK из `~/.dotnet-wasm` (и похожих папок), если они есть.

```bash
./build.sh honest            # -> artifacts/honest/wwwroot
./build.sh extreme           # -> artifacts/extreme/wwwroot
```

**7. Проверьте и измерьте.** Сначала идёт функциональная проверка, затем считаются размеры скачанных браузером файлов:

```bash
./measure.sh artifacts/honest honest
./measure.sh artifacts/extreme extreme
```

Строка `COLD-LOAD` должна показать:

| Вариант | files | raw | brotli | gzip9 |
|---|---:|---:|---:|---:|
| `honest` | 43 | 4 243 612 | 1 424 673 | 1 706 941 |
| `extreme` | 8 | 3 851 361 | 1 211 018 | 1 507 342 |

**Важно: итоговые размеры немного зависят от того, где идёт сборка** (путь к папке и расположение SDK).
SDK добавляет отпечаток (fingerprint) в имена некоторых файлов (например `dotnet.native.<fingerprint>.wasm`).
Отпечаток считается до того, как убирается секция имён функций, а эта секция зависит от путей сборки.
Имена файлов записаны в boot config внутри `dotnet.js`, поэтому итоги немного сдвигаются.

- Вторая папка на той же машине: `Honest` 1 424 691 brotli (+18), `Extreme` 1 211 016 (−2).
  Размеры без сжатия и sha256 итогового `dotnet.native.wasm` совпали.
- Первая сборка в CI на раннере GitHub: `Honest` без сжатия 4 243 654, brotli 1 425 104, gzip 1 707 048, 43 файла (+431 brotli, +42 без сжатия);
  `Extreme` без сжатия 3 851 404, brotli 1 211 189, gzip 1 507 487, 8 файлов (+171 brotli, +43 без сжатия). Это примерно 0,03 % и 0,01 %.

Живое демо показывает числа своей собственной сборки в CI, поэтому они отличаются от этого README примерно на столько же.
В таблицах этого README остаются измеренные локальные итоги.

Чтобы во время проверки отдавать файлы `.br` с `Content-Encoding: br` (проверка раунда 2), задайте `SERVE_ENCODED=br`:

```bash
SERVE_ENCODED=br ./measure.sh artifacts/extreme extreme
```

Тогда появится ещё строка `SERVED`. `equal=true` значит, что переданные байты равны сумме файлов `.br`.

**8. По желанию: страница нагрузки** для нативных заглушек:

```bash
./build.sh extreme-stress
node tools/stress.mjs artifacts/extreme-stress/wwwroot
```

**Известные подводные камни**

- **Workload `wasm-tools` обязателен.** Без нативной перелинковки `InvariantGlobalization`, `InvariantTimezone`
  и `WasmEnableSIMD=false` останавливают сборку (`WasmBuildNative is required ...`), а `EmccLinkOptimizationFlag` молча игнорируется.
  Лучшее без перелинковки: `Honest` 2 320 504 и `Extreme` 2 186 970 байт brotli.
- **`libatomic1`.** Без него перелинковка падает с `libatomic.so.1: cannot open shared object file` и `... failed (returned 127)`.
- **Путь к репозиторию.** Пока не было `PathMap`, сборка из другой папки отличалась на 3 байта brotli (путь попадал в сборку приложения).
  `PathMap` в [`Directory.Build.props`](Directory.Build.props) убирает это для сборки приложения.
  Несколько байт всё равно могут сдвинуться из-за отпечатков в именах файлов (см. примечание после ожидаемых чисел).
- **macOS не проверялся** для полной сборки. `dotnet workload install wasm-tools` там упал с «Inadequate permissions».
- **SDK в другой папке.** `build.sh` и `tools/step.sh` оба подключают `scripts/build-env.sh`. Он добавляет `~/.dotnet-wasm`,
  только если такая папка есть, так что SDK в любом другом месте работает, если `dotnet` есть в `PATH`.
- **Небольшие расхождения.** Если числа не совпали, проверьте версию SDK (`dotnet --version`), workload и версии инструментов выше.
  У бандла одно значение целостности, поэтому любой изменённый байт в нём меняет весь файл.

## Чем жертвует Extreme

Это всё ещё настоящий Blazor: Razor-компоненты рисует стандартный `WebAssemblyRenderer`, запускает стандартный
`WebAssemblyHostBuilder`, всё работает на стандартном пакете рантайма Mono. binaryen и terser только переписывают готовые файлы.

Что `Extreme` теряет сверх `Honest`:

- Нет маршрутизации `@page`: нет шаблонов маршрутов, параметров и ограничений, нет страницы `NotFound`, нет `FocusOnNavigate`,
  нет активного класса у `NavLink`, нет ленивой загрузки сборок по маршруту.
- Нет сервиса `HttpClient` и нет `System.Net.Http`. HTTP только через JS interop.
- Переменных окружения нет в `IConfiguration`. `appsettings.json` и `appsettings.{env}.json` игнорируются.
- `Console.Error` равен null: если обновление корневого компонента падает, запись ошибки сама бросает исключение.
- Юникодные (IDN) имена хостов в `Uri` не преобразуются.
- Раунд 2: загрузка сборки с PDB и всё, что требует zlib внутри рантайма, падает (trap).
  Сборки, скомпилированные AOT, использовать нельзя. Пути SIMD в интерпретаторе и дамп потоков рантайма падают.
- Раунд 2: рефлексия по служебным атрибутам компилятора (например `[CompilerGenerated]`, `[Nullable]`) ничего не возвращает.
  Рефлексия по свойствам и событиям типов фреймворка (кроме `System`, `System.Threading*`, `System.Runtime*` в CoreLib)
  ничего не находит. Константы (`const`) фреймворка не видны рефлексии.
- Бандл ломается целиком, если изменится хоть один байт. Кеша по отдельным сборкам нет.
- Файлы после постобработки нужно пересобирать через `build.sh`. Ручная правка ломает загрузку.

Что теряют оба варианта (из-за настроек): форматирование по культуре, часовые пояса (только UTC), EventSource, метрики и диагностику,
стек вызовов в исключениях, пути динамического кода, SIMD (рантайм медленнее), обработку исключений wasm (запасной вариант на JS),
отладчик и читаемые имена фреймворка в логах.

## Что мешает приложению Blazor WebAssembly стать ещё меньше

Итог `Extreme` в brotli: нативная часть 359 489 · JS 98 729 · управляемый код 752 074 (бандл) · HTML и данные 726.
Чтобы уменьшить любую из этих частей, нужны изменения, которые в этом проекте не делались:
никакого форка или собственной сборки рантайма, стандартные хост и рендерер Blazor остаются.

| Часть | Brotli | Что осталось | Что нужно, чтобы уйти ниже |
|---|---:|---|---|
| Нативная (`dotnet.native.wasm`) | 359 489 | Интерпретатор Mono, GC, загрузчик метаданных, маршалинг, emmalloc, libc | Собственная сборка рантайма |
| JS | 98 729 | `dotnet.runtime.js` 47 048 (вместе с jiterpreter), `blazor.webassembly.js` 22 808, `dotnet.native.js` 17 573, `dotnet.js` 11 300 | Изменения логики JS рантайма или Blazor |
| Управляемый код (`b.bin`) | 752 074 | CoreLib 408 929 и System.Text.Json 120 906 (каждая сжата отдельно) | Свой хост или рендерер, чтобы JS interop перестал использовать JSON через рефлексию |

Одни только нативная часть, JS, CoreLib и System.Text.Json дают 988 053 байт. Эти части становятся меньше только
при изменениях в самом рантайме, в его JS или в хосте Blazor.

**Если бы форк рантайма был разрешён (оценки по исследованию, не измерения).**
Нативная часть: примерно на 22–27K brotli меньше при других флагах сборки на стандартных исходниках, примерно 42–57K с небольшими патчами,
примерно 60–95K с глубокими изменениями. Вместе с JS и CoreLib: примерно от 95–160K (небольшие патчи) до 140–250K (глубокие изменения).
Цена: свой пакет рантайма, который нужно пересобирать на каждый ежемесячный сервисный релиз, запоздалые исправления безопасности
и отсутствие поддержки от вендора.

## FAQ: размер Blazor WebAssembly

**Насколько маленьким может быть приложение Blazor WebAssembly на .NET 11?**
В этом проекте — 1 211 018 байт brotli у `Extreme` (8 файлов) и 1 424 673 у `Honest` на стандартных API Blazor.
Шаблон `dotnet new blazorwasm` весит 2 589 350.

**Важен ли workload `wasm-tools`?**
Да, очень. Без нативной перелинковки лучшие результаты были `Honest` 2 320 504 и `Extreme` 2 186 970 brotli.
С перелинковкой итоговые сборки раунда 1 (им доступны и настройки, которым нужна перелинковка) весили 1 519 331 и 1 333 578 — примерно на 800–850k меньше.

**Какая одна настройка экономит больше всего?**
`InvariantGlobalization=true`: −657 823 brotli отдельно, −661 194 в последовательной цепочке. Данные ICU больше не скачиваются,
а перелинковка убирает ICU из нативного файла.

**Стоит ли выключать SIMD?**
`WasmEnableSIMD=false` даёт −27 385 отдельно (−28 098 в цепочке). Рантайм становится медленнее; для этого демо это приемлемо.

**Насколько brotli меньше gzip?**
Примерно на 20 % для `Extreme`: 1 211 018 в brotli против 1 507 342 в gzip.
Живое демо отдаётся в gzip, поэтому показывает размер gzip.

**Можно ли уйти ниже без форка рантайма?**
Со стандартным рантаймом и стандартным хостом Blazor других способов не нашлось. Одни только нативная часть, JS, CoreLib
и System.Text.Json уже дают 988 053 байт, и чтобы их уменьшить, нужны изменения в рантайме или в хосте.
См. [Что мешает приложению Blazor WebAssembly стать ещё меньше](#что-мешает-приложению-blazor-webassembly-стать-ещё-меньше).

**CoreCLR на wasm меньше, чем Mono?**
Нет. `UseMonoRuntime=false` работает, но на +422 347 brotli больше, чем Mono.

## Структура репозитория

| Путь | Что это |
|---|---|
| `Baseline/` | Шаблон `dotnet new blazorwasm`, исходная точка. |
| `Issue86601/` | Рецепт из issue dotnet/runtime #86601 (пустой шаблон, инвариантная глобализация). Со своим `Directory.Build.props`. |
| `Honest/` | Приложение `Honest` (стандартные `Router`, `NavLink`, `HttpClient`). |
| `Extreme/` | Приложение `Extreme` и его файлы ILLink substitutions (`ILLink.Substitutions*.xml`). |
| `Directory.Build.props` | Общие настройки `Honest` и `Extreme`: оставленные свойства MSBuild (`SizeProfile=final`), `PathMap`, `NativeNames`. |
| `global.json` | Фиксирует SDK 11.0.100. |
| `build.sh` | Итоговый рецепт: публикация, проход Cecil, нативные заглушки, `wasm-opt`, terser, бандл (`Extreme`), файлы `.br`/`.gz`. |
| `measure.sh` | Функциональная проверка, затем размеры скачанных браузером файлов. |
| `scripts/build-env.sh` | Необязательные `PATH` / `DOTNET_ROOT` для SDK в домашней папке; ничего не делает, если инструменты уже в `PATH`. |
| `tools/check.mjs` | Функциональная проверка (Playwright) и сетевой журнал. |
| `tools/measure.mjs` | Размеры без сжатия, brotli и gzip по скачанным файлам. |
| `tools/serve.mjs` | Статический сервер для проверки (режим SPA, режим как у Pages, `SERVE_ENCODED`). |
| `tools/postprocess.mjs`, `tools/MetaStrip/`, `tools/wasmstub.mjs`, `tools/bundle.mjs`, `tools/compress.mjs` | Шаги постобработки, которые вызывает `build.sh`. |
| `tools/stress/`, `tools/make-stress.sh`, `tools/stress.mjs` | Страница нагрузки для нативных заглушек (только тестовая копия, не публикуется). |
| `tools/step.sh`, `tools/matrix.sh`, `tools/run-steps.sh`, `steps/` | Один измеряемый эксперимент, много параллельно и списки экспериментов. |
| `tools/collect.mjs`, `tools/result.mjs` | Записывают измеренные прогоны в `results/experiments.jsonl`. |
| `tools/assemble-site.mjs`, `tools/pages-deeplink.mjs`, `tools/final.sh` | Сборка демо-сайта и его проверка под подпутём. |
| `tools/build-report.mjs` | Подробная страница отчёта, собирается из журнала. |
| `tools/AsmSize/`, `tools/why.py`, `tools/grep-props.sh`, `tools/native-symbols.sh`, `tools/native-stub-estimate.sh` | Инструменты анализа (размер IL, почему ILLink оставил тип, какие свойства читает SDK, размеры нативных функций). |
| `RESULTS.md` | Полный текстовый журнал обоих раундов. |
| `results/` | `experiments.jsonl` (одна строка на прогон). Небольшие входные файлы `meta-*.json`, из которых он собран, папки трассировки прогонов (`runs/<id>/`) и сборка нативного файла с именами функций (`native-symbols/`) хранятся локально и не публикуются. |
| `.github/workflows/pages.yml` | Сборка и публикация на GitHub Pages. |
| `Host/` | Хост для App Service: маленькое приложение ASP.NET Core, которое отдаёт файлы `.br`/`.gz` (`Program.cs`), его `web.config` для Windows и `iis-static/web.config` (вариант только с IIS, не проверен). |
| `docs/hosting.md`, `docs/hosting.ru.md` | Как размещено демо: GitHub Pages и Azure App Service. |
| `.github/workflows/azure.yml` | Ручная сборка и деплой на Azure App Service (хост Native AOT). |
| `tools/host-gate.sh`, `tools/site-check.mjs`, `tools/aot-toolchain.sh` | Проверка хоста (оба приложения через хост, проверки curl и безопасности, ресурсы в простое) и clang в домашней папке для Native AOT на машине без компилятора C. |

`artifacts/` и `out/` — результаты сборки, их нет в git. Часть скриптов в `tools/` (параллельные прогоны, проверки) использовалась
в экспериментах на Linux-машине сборки; им нужны только перечисленные выше инструменты.

## Полный журнал и страница отчёта

- [`RESULTS.md`](RESULTS.md): текстовый журнал обоих раундов со всеми текстами ошибок.
- [`results/experiments.jsonl`](results/experiments.jsonl): одна строка JSON на каждый измеренный прогон (больше 160 прогонов) — настройки, размеры,
  размеры по файлам, результат проверки, решение и причина. Сырые файлы трассировки каждого прогона хранились локально и не публикуются.

Подробная страница отчёта (графики, все прогоны с фильтрами, таблицы по файлам) собирается из журнала:

```bash
node tools/build-report.mjs report.html
```

На демо-сайте эта страница лежит как `report.html` рядом с главной (`tools/assemble-site.mjs` вызывает тот же скрипт).
Флаг `--standalone` по-прежнему принимается и ничего не делает.
