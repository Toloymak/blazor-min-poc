[English](README.md) | [Русский](README.ru.md) | **Français**

# Minification de Blazor WebAssembly sous .NET 11

**Démo en ligne** (GitHub Pages, gzip uniquement) : [accueil](https://toloymak.github.io/blazor-min-poc/) ·
[application `Honest`](https://toloymak.github.io/blazor-min-poc/honest/) · [application `Extreme`](https://toloymak.github.io/blazor-min-poc/extreme/) ·
[rapport détaillé](https://toloymak.github.io/blazor-min-poc/report.html). Code source : [github.com/Toloymak/blazor-min-poc](https://github.com/Toloymak/blazor-min-poc).

Le résultat de ce projet est une liste mesurée de moyens de réduire la taille de téléchargement d'une application Blazor WebAssembly (Blazor WASM)
sous .NET 11 avec le runtime standard. Chaque moyen est donné avec son gain en octets.
La liste couvre le trimming IL avec ILLink, les feature switches comme `InvariantGlobalization`,
le relink natif avec le workload `wasm-tools`, Bit.Minifier, `wasm-opt`, terser et un bundle unique pour tous les assemblys.
Chaque taille est donnée en octets bruts, en brotli et en gzip : vous voyez la vraie taille du bundle que le navigateur télécharge.

La même application de 3 pages (Home, Counter, Fetch) a été construite et mesurée dans plus de 160 configurations (161 exécutions dans le journal).
Deux variantes finales sont conservées : `Honest` et `Extreme`.

## Taille minimale d'une application Blazor WebAssembly sous .NET 11

Le modèle `dotnet new blazorwasm` télécharge **2 589 350** octets en brotli.
`Honest`, qui garde les API Blazor standard, télécharge **1 424 673** octets : 1 164 677 de moins, soit 45,0 % plus petit.
`Extreme` télécharge **1 211 018** octets : 1 378 332 de moins, soit 53,2 % plus petit.

| Build | Octets bruts | Brotli | gzip -9 | Fichiers | Écart avec le modèle (brotli) |
|---|---:|---:|---:|---:|---:|
| Modèle de départ (`dotnet new blazorwasm`) | 8 447 649 | 2 589 350 | — | 50 | — |
| Recette de l'issue #86601 sous .NET 11 | 5 404 848 | 1 735 678 | 2 091 866 | 43 | −853 672 |
| `Honest`, tour 1 | 4 616 080 | 1 519 331 | 1 823 357 | 43 | −1 070 019 |
| `Extreme`, tour 1 | 4 013 671 | 1 333 578 | 1 599 659 | 39 | −1 255 772 |
| **`Honest`, final** | **4 243 612** | **1 424 673** | **1 706 941** | 43 | **−1 164 677** |
| `Honest` + bundle (expérience, pas le réglage par défaut) | 4 240 357 | 1 344 434 | 1 675 892 | 8 | −1 244 916 |
| **`Extreme`, final** | **3 851 361** | **1 211 018** | **1 507 342** | 8 | **−1 378 332** |

La ligne de l'issue #86601 est une recette publique de dotnet/runtime, mesurée ici sous .NET 11.
« — » signifie : non mesuré ou sans objet.

**Sommaire**

- [Comment réduire la taille de téléchargement de Blazor WebAssembly](#comment-réduire-la-taille-de-téléchargement-de-blazor-webassembly)
  - [1. Installer le workload `wasm-tools` et utiliser le relink natif](#1-installer-le-workload-wasm-tools-et-utiliser-le-relink-natif)
  - [2. Les réglages de trimming et de feature switches qui économisent le plus](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus)
  - [3. Post-traitement après publication](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs)
  - [4. Les modifications de code faites par `Extreme`](#4-les-modifications-de-code-faites-par-extreme)
  - [5. Servir des fichiers brotli compressés à l'avance](#5-servir-des-fichiers-brotli-compressés-à-lavance-brotli-et-gzip)
  - [Réglages sans effet](#réglages-sans-effet)
  - [Réglages qui ont cassé l'application ou le build](#réglages-qui-ont-cassé-lapplication-ou-le-build)
- [Deux variantes finales, Honest et Extreme](#deux-variantes-finales-honest-et-extreme)
- [Comment la taille de téléchargement a été mesurée](#comment-la-taille-de-téléchargement-a-été-mesurée)
- [Comment obtenir ces chiffres vous-même](#comment-obtenir-ces-chiffres-vous-même)
- [Ce que sacrifie Extreme](#ce-que-sacrifie-extreme)
- [Ce qui empêche une application Blazor WebAssembly de devenir plus petite](#ce-qui-empêche-une-application-blazor-webassembly-de-devenir-plus-petite)
- [FAQ sur la taille de Blazor WebAssembly](#faq-sur-la-taille-de-blazor-webassembly)
- [Structure du dépôt](#structure-du-dépôt)
- [Journal complet et page de rapport](#journal-complet-et-page-de-rapport)

## Comment réduire la taille de téléchargement de Blazor WebAssembly

Les plus gros gains mesurés, en octets brotli. Chaque gain a été mesuré seul ou comme une étape au-dessus des étapes précédentes
(la section liée donne l'exécution de base) : les gains ne s'additionnent donc pas exactement.

| Moyen de réduire le téléchargement | Gain brotli | Détails |
|---|---:|---|
| Relink natif avec le workload `wasm-tools`, plus les réglages qui en ont besoin | environ 800k à 850k | [Étape 1](#1-installer-le-workload-wasm-tools-et-utiliser-le-relink-natif) |
| `InvariantGlobalization=true` | 657 823 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| Modifications de code d'`Extreme` : routeur maison, HTTP via JS `fetch` | 137 828 | [Étape 4](#4-les-modifications-de-code-faites-par-extreme) |
| `EventSourceSupport=false` | 98 849 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| Bit.Minifier | 91 369 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| Un seul fichier bundle pour tous les assemblys | 75 030 | [Étape 3](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs) |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | 64 384 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| `MetricsSupport=false` | 50 418 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| `DynamicCodeSupport=false` | 30 502 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| `WasmEnableSIMD=false` | 27 385 | [Étape 2](#2-les-réglages-de-trimming-et-de-feature-switches-qui-économisent-le-plus) |
| Stubs de fonctions natives | 23 337 | [Étape 3](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs) |
| terser sur les fichiers JS | 21 916 | [Étape 3](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs) |
| Passe Mono.Cecil sur les métadonnées | 20 134 | [Étape 3](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs) |
| `wasm-opt -Oz` | 18 608 | [Étape 3](#3-post-traitement-après-publication-bundle-wasm-opt-terser-stubs-natifs) |

Le coût de chaque ligne (ce qu'elle casse ou ralentit) est décrit dans la section liée.

Tous les chiffres sont des écarts brotli mesurés, tirés de [`results/experiments.jsonl`](results/experiments.jsonl).
« Exécution » est l'id de la mesure dans ce fichier. Sauf mention contraire, un écart correspond à un seul réglage appliqué
à l'application `Honest` par défaut (exécution `h00-default`, 2 563 523 en brotli).

### 1. Installer le workload `wasm-tools` et utiliser le relink natif

Avec le workload `wasm-tools`, `dotnet publish` refait l'édition de liens de `dotnet.native.wasm` pour votre application.
Le relink seul fait gagner 36 377 sur le modèle (`baseline-norelink` contre `baseline`).
Plus important encore, plusieurs gros réglages ne marchent qu'avec lui : sans relink, `InvariantGlobalization`, `InvariantTimezone`
et `WasmEnableSIMD=false` arrêtent le build (`WasmBuildNative is required ...`), et `EmccLinkOptimizationFlag` est ignoré sans message.
Sans relink, les meilleurs résultats étaient `Honest` 2 320 504 et `Extreme` 2 186 970 en brotli.
Avec lui, les finales du tour 1 pesaient 1 519 331 et 1 333 578 : environ 800k à 850k de moins.

```bash
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

Sous Linux, le relink a aussi besoin de `libatomic1` (le node fourni dans le workload l'utilise) :

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

L'installation complète (SDK, workload, outils node) est décrite dans [Comment obtenir ces chiffres vous-même](#comment-obtenir-ces-chiffres-vous-même).

### 2. Les réglages de trimming et de feature switches qui économisent le plus

Ce sont les réglages sûrs qu'utilise `Honest`. Les propriétés MSBuild retenues sont dans [`Directory.Build.props`](Directory.Build.props) (`SizeProfile=final`).

| Réglage | Δ brotli | Exécution | Coût ou remarque |
|---|---:|---|---|
| `InvariantGlobalization=true` | −657 823 | `s-invglob` | Culture invariante uniquement. Nécessite le relink (ICU sort du fichier natif). |
| `EventSourceSupport=false` | −98 849 | `s-noeventsource` | Pas de diagnostics EventSource. |
| Bit.Minifier 11.0.0-pre-20 (`UseBitMinifier=true`) | −91 369 | `s-bitmin` | Package utilisé au build ; renomme les noms non publics du framework. |
| `InvariantTimezone=true`, `BlazorEnableTimeZoneSupport=false` | −64 384 | `s-invtz` | UTC uniquement. Nécessite le relink. |
| `MetricsSupport=false` | −50 418 | `s-nometrics` | Pas de métriques. |
| `DynamicCodeSupport=false` | −30 502 | `c-honest-dyncode` (en plus des réglages ci-dessus) | L'injection de dépendances et les arbres d'expressions passent par une réflexion plus lente. |
| `WasmEnableSIMD=false` | −27 385 | `s-nosimd` | Runtime plus lent. Nécessite le relink. |
| `WasmEnableExceptionHandling=false` | −27 329 | `s-noeh` | Solution de repli d'Emscripten en JS. Seulement −199 si SIMD est déjà désactivé (`x-noeh`). |
| `BitMinifyAggressive=true` | −17 176 | `c-honest-bitmin-aggr` (en plus) | Les noms publics du framework sont aussi renommés (logs plus difficiles à lire). |
| `EmccLinkOptimizationFlag=-Oz` | −7 598 | `s-linkOz` | Ignoré sans relink. |
| `HttpActivityPropagationSupport=false` | −6 477 | `s-nohttpactivity` | Pas de propagation d'activité HTTP. |
| `EmccExtraLDFlags=-sMALLOC=emmalloc` | −2 089 | `x-emmalloc` (sur `Extreme`) | Allocateur plus petit et plus simple. |
| `TrimMode=full` + `TrimmerRootAssembly` pour l'application | −1 699 | `s-trimfull` | Sans cette racine, l'application casse (voir plus bas). |
| `StackTraceSupport=false` | −432 | `s-nostacktrace` | Pas de pile d'appels dans les exceptions. |
| `TrimmerRemoveSymbols=true`, `DebugType=none`, `GenerateDocumentationFile=false` | −145 | `s-nosymbols` | Pas de symboles de débogage. |
| `WasmEnableWebcil=false` | +498 | `s-nowebcil` | Plus gros seul, −278 dans la chaîne complète (`h24-nowebcil`), donc conservé. |
| `WasmFingerprintDotnetJs=false`, `BlazorFingerprintBlazorJs=false` | +33 | `s-nofingerprint` | Environ zéro (bruit). |

Le relink natif lui-même (par défaut avec le workload) fait gagner 36 377 sur le modèle (`baseline-norelink` contre `baseline`).

Les mêmes réglages sous forme de bloc de fichier projet, repris de [`Directory.Build.props`](Directory.Build.props).
Dans ce dépôt, Bit.Minifier est activé par `UseBitMinifier` et `BitMinifierVersion`, qui ajoutent la référence de package visible à la fin.
`TrimMode=full` a aussi besoin de l'assembly de l'application comme racine, comme dans [`Honest/Honest.csproj`](Honest/Honest.csproj).

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

### 3. Post-traitement après publication (bundle, wasm-opt, terser, stubs natifs)

Ces étapes ont lieu après `dotnet publish`. `build.sh` les exécute avec les scripts de [`tools/`](tools). Mesuré sur `Extreme`.

| Étape | Δ brotli | Exécution | Coût ou remarque |
|---|---:|---|---|
| Un seul fichier bundle pour les 32 assemblys (`tools/bundle.mjs`) | −75 030 | `r2-base-br` → `r2-b-group` | Une seule valeur d'intégrité pour tout ; pas de cache par assembly. Aussi −32k en gzip. |
| Stubs de fonctions natives par nom (`tools/wasmstub.mjs`) | −23 337 | `r2-x-names` → `f2-extreme` | Le code remplacé provoque un trap s'il s'exécute (PDB/zlib, recherches AOT, SIMD de l'interpréteur, dump des threads). |
| terser sur les fichiers JS (tour 1) | −21 916 | `e04-minify` | Les fichiers doivent être reconstruits avec `build.sh` (les valeurs d'intégrité sont réécrites). |
| Passe Mono.Cecil sur les métadonnées (`tools/MetaStrip`) | −20 134 | `r2-c1-slim-aggr` → `r2-m-props-notasks` | La réflexion sur les attributs propres au compilateur, les propriétés/événements et les constantes du framework ne trouve rien. |
| `wasm-opt -Oz` sur `dotnet.native.wasm` (tour 1) | −18 608 | `e03-wasmopt` | |
| terser agressif + boot config réduite | −2 572 | `r2-c1-slim-aggr` | |
| `wasm-opt -tnh --gufa` | −1 509 | `r2-b-group` → `r2-n-tnh-gufa` | `-tnh` suppose qu'aucun trap n'arrive. |
| `wasm-opt --converge` | −822 | `x-wasmopt-converge` | |

`Honest` avec le post-traitement du tour 2 (sans bundle, sans modification de code) est passé de 1 519 331 à 1 424 673 (`f2-honest`, −94 658).

Il n'existe pas de réglage de projet pour ces étapes. Lancez-les comme le fait [`build.sh`](build.sh) : la passe Cecil, les stubs natifs,
`wasm-opt` et terser sont dans [`tools/postprocess.mjs`](tools/postprocess.mjs) (qui écrit aussi les nouvelles valeurs d'intégrité),
le bundle est dans [`tools/bundle.mjs`](tools/bundle.mjs). La liste des fonctions natives remplacées est `STUBS_DEFAULT` dans `build.sh`.

```bash
./build.sh extreme
```

### 4. Les modifications de code faites par `Extreme`

| Modification | Δ brotli | Exécution | Coût ou remarque |
|---|---:|---|---|
| Routeur maison + HTTP via JS `fetch` (ni `HttpClient` ni System.Text.Json dans le code de l'application) | −137 828 | `e00-extreme` (contre `Honest` avec les mêmes réglages) | Pas de routage `@page`, pas de `HttpClient`. |
| Stubs ILLink : `Console.get_Error`, `JsonStreamConfigurationSource.Build` | −16 682 | `x-subst2a` | `Console.Error` vaut null ; `appsettings.json` est ignoré. |
| Stub ILLink : `DomainNameHelper.TryGetUnicodeEquivalent` | −2 645 | `x-subst2c` | Les noms d'hôtes Unicode (IDN) ne sont pas convertis. |
| Stubs ILLink : `AddEnvironmentVariables`, vérifications du fournisseur de cultures | −2 034 | `x-subst` | Les variables d'environnement ne sont pas dans `IConfiguration`. |

Le code est dans [`Extreme/`](Extreme) : le routeur dans `App.razor`, les pages dans `Pages/`, les stubs ILLink dans `ILLink.Substitutions*.xml`,
activés dans [`Extreme/Extreme.csproj`](Extreme/Extreme.csproj).

### 5. Servir des fichiers brotli compressés à l'avance (brotli et gzip)

Ici, brotli est environ 20 % plus petit que gzip : `Extreme` pèse 1 211 018 octets en brotli et 1 507 342 en gzip,
`Honest` pèse 1 424 673 et 1 706 941.

`build.sh` compresse chaque fichier à l'avance avec [`tools/compress.mjs`](tools/compress.mjs) : un fichier `.br`
(brotli qualité 11, fenêtre 24) et un fichier `.gz` (gzip niveau 9) à côté de chaque fichier. Le serveur doit envoyer le fichier `.br`
avec `Content-Encoding: br` quand le navigateur accepte brotli. Un serveur qui compresse en gzip à la volée envoie à peu près
la colonne gzip à la place (son propre niveau gzip peut donner un peu plus). La démo en ligne est servie en gzip : elle montre donc la taille gzip.

Pour le voir vous-même dans les DevTools de Chrome ou d'Edge :

1. Ouvrez la démo, appuyez sur F12 et allez dans l'onglet **Network**.
2. Activez **Disable cache**.
3. Rechargez la page. Cliquez ensuite sur Counter puis Fetch.
4. Lisez la barre d'état en bas : « **transferred** » est ce qui est passé par le réseau, « **resources** » est la taille après décompression.
5. Comparez « transferred » avec la colonne gzip (serveur qui envoie du gzip) ou la colonne brotli (serveur qui envoie les fichiers `.br`).
   « Resources » doit être proche de la colonne des octets bruts.

« Transferred » compte aussi les en-têtes HTTP : la valeur est donc un peu plus élevée que la somme des fichiers.
Sur la démo en ligne, la construction du site modifie aussi un peu `index.html` (le `<base href>`, un petit script pour les liens profonds
et une balise meta robots) : attendez-vous donc aussi à un petit écart.

### Réglages sans effet

Environ zéro octet chacun : ils ont été annulés.

| Réglage | Δ brotli | Exécution |
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
| Stubs ILLink pour `AppContext.OnProcessExit`, `Environment.StackTrace` et trois autres | +86 | `r2-u-all` |
| `Microsoft.Extensions.DependencyInjection.DisableDynamicEngine=true` | +13 | `r2-s-didynamic` |
| `System.Globalization.PredefinedCulturesOnly=true` | +5 | `r2-s-cultures` |

Le code remplacé par des stubs reste accessible depuis d'autres racines : les stubs ne changent donc rien.

### Réglages qui ont cassé l'application ou le build

Tous ont été annulés.

| Réglage | Ce qui s'est passé |
|---|---|
| `JsonSerializerIsReflectionEnabledByDefault=false` | L'interop JS casse : `NoMetadataForType` dans `DotNetDispatcher.ParseArguments` (`h11-jsonnoreflect`). |
| `TrimMode=full` sans racine pour l'assembly de l'application | `CtorNotLocated, Honest.Layout.MainLayout` (`h01-trimfull-noroot`). |
| ILLink `--ignore-descriptors true` | L'application ne démarre pas (`x-ignoredesc`). |
| `WasmBuildNative=false` avec `InvariantGlobalization`, `InvariantTimezone` ou `WasmEnableSIMD=false` | Erreur de build : `WasmBuildNative is required ...`. |
| `EmccExtraLDFlags=-sFILESYSTEM=0` | Erreur de build : `-sFORCE_FILESYSTEM cannot be used with -sFILESYSTEM=0` (`x-nofs`). |
| `EmccExtraLDFlags=--closure=1` | `google-closure-compiler was not found` ; après son installation, un fichier manque dans le pack du workload (`x-closure`, `x-closure2`). |
| Stub ILLink pour l'`EnumConverter` de STJ | Plantage d'ILLink `IL1012` (`x-subst2b`). |
| Cecil : métadonnées de propriétés retirées dans tout CoreLib | Assertion Mono `object.c:146` (`r2-m-props`). |
| Toutes les fonctions AOT du runtime remplacées par des stubs | `RuntimeError: unreachable` au démarrage (`r2-x-aot`). |
| Exports du jiterpreter retirés (`wasm-metadce`) | La vérification échoue : le JS du runtime a besoin de ces exports (`r2-n-jiterp-dce`). |
| `UseMonoRuntime=false` avec `WasmEnableExceptionHandling=false` | Erreur de build : CoreCLR a besoin de la gestion des exceptions wasm (`h28-coreclr`). |

A fonctionné, mais en pire :

| Réglage | Δ brotli | Pourquoi annulé |
|---|---:|---|
| `UseMonoRuntime=false` (CoreCLR sur wasm) | +422 347 | Fonctionne, mais beaucoup plus gros que Mono (`c-honest-coreclr`). |
| `WasmRunWasmOpt=false` | +1 395 714 | Sans la passe du SDK, le fichier natif garde ses noms et ses données de débogage (`r2-n-norunopt`). |
| Bundle incluant `dotnet.native.wasm` | −79 082 | 4k de moins que le bundle retenu, mais pas de compilation en streaming : premier rendu à 381 ms (`r2-b-group-wasm`). |

## Deux variantes finales, Honest et Extreme

Les deux applications ont les trois mêmes pages : Home, Counter (un bouton qui compte) et Fetch (charge `data.json`).

- **`Honest`** n'utilise que les API Blazor standard : `WebAssemblyHostBuilder`, `Router`, `NavLink`, `HttpClient` avec System.Text.Json.
  Tous les gains viennent des propriétés MSBuild, du relink natif, de Bit.Minifier et du post-traitement des fichiers produits.
  Le code n'a pas été modifié pour la taille.
- **`Extreme`** reste du vrai Blazor : le host builder standard, le moteur de rendu standard et le pack du runtime Mono standard.
  Mais il remplace le `Router` par un petit routeur écrit à la main, fait le HTTP via JS `fetch`, remplace certaines méthodes du framework
  par des stubs avec des substitutions ILLink, regroupe tous les assemblys dans un seul fichier et remplace par des stubs les fonctions natives
  que cette application n'appelle jamais. Voir [Ce que sacrifie Extreme](#ce-que-sacrifie-extreme).

Le travail s'est fait en deux tours. Le tour 1 a essayé les propriétés MSBuild, le relink et un post-traitement simple.
Le tour 2 n'a porté que sur `Extreme` (`Honest` a reçu le même post-traitement, sans le bundle et sans modification de code).
Limites du tour 2 : pas de fork ni de build maison du runtime, et l'hôte et le moteur de rendu Blazor standard restent en place.

## Comment la taille de téléchargement a été mesurée

**Métrique.** La somme des octets des fichiers exacts qu'un navigateur télécharge au premier chargement à froid de `/`,
plus une visite de chaque page (Counter et Fetch, dans l'application). Chaque fichier est compressé en brotli qualité 11, fenêtre 24.
gzip utilise le niveau 9. « Brut » est la taille sans compression.

- **Liste des fichiers.** Un Chromium headless (Playwright 1.65.1) charge l'application avec un cache vide.
  La liste des fichiers vient du journal réseau du navigateur, pas du contenu d'un dossier.
- **Octets servis (tour 2).** L'application est servie depuis les fichiers `.br` finaux avec `Content-Encoding: br`
  (mode `SERVE_ENCODED=br` de `tools/serve.mjs`). Les octets transférés, lus dans le journal réseau, sont égaux à la somme des fichiers `.br`.
  La finale `Extreme` du tour 1 donne 1 333 578 octets des deux façons (exécution `r2-base-br`) : les deux tours sont donc comparables.
- **Code de compression.** Le zlib de Node. Il donne les mêmes octets que `brotli -q 11`.

**Environnement.**

- .NET SDK 11.0.100 (`global.json`, roll-forward désactivé), `Microsoft.AspNetCore.Components.WebAssembly` 11.0.0.
- Workload `wasm-tools`, pack du runtime Mono standard, publication en Release.
- binaryen 125.0.0 (`wasm-opt`, le package npm figé dans `tools/package-lock.json`), terser 5.51.2, Playwright 1.65.1, Bit.Minifier 11.0.0-pre-20, Node.js v24.21.0.
- Les expériences ont tourné sous Ubuntu 22.04 dans WSL2 (12 cœurs, 39 Go de RAM). Le build CI tourne sur `ubuntu-24.04`.
  Seule la ligne du modèle sans workload a été mesurée sous macOS.

**Vérification fonctionnelle** (`tools/check.mjs`). Un build n'est conservé que si tout ceci passe :

- Home s'affiche.
- Le lien de navigation vers Counter fonctionne sans rechargement complet de la page.
- Deux clics affichent `Current count: 2`.
- Fetch affiche le texte de `data.json`, et `data.json` est dans le journal réseau.
- Précédent et Suivant fonctionnent.
- Un chargement direct de `/counter` dans un nouveau contexte de navigateur fonctionne et compte (lien profond).
- Zéro erreur de console, zéro erreur de page et zéro requête en échec.
- Avec `SERVE_ENCODED` défini : chaque fichier téléchargé a été servi depuis son fichier précompressé.

**Page de stress et canari (stubs natifs).** Une fonction native remplacée par un stub provoque un trap quand elle est appelée.
Pour prouver qu'un trap est bien détecté, l'exécution `r2-x-canary` remplace par un stub `mono_wasm_load_runtime`, une fonction qui s'exécute vraiment : la vérification échoue bruyamment.
Chaque groupe de stubs conservé a aussi dû passer une page de stress (`tools/stress/Stress.razor`), compilée uniquement dans une copie de test de l'application
(`ExtremeStress`) et jamais publiée. Elle couvre les exceptions, try/finally, le GC sous charge, le formatage et l'analyse de nombres et de dates,
`Guid`, LINQ, `Dictionary`, les chaînes, les délégués, `Task.Delay` et une requête HTTP en échec (404). Il faut 15 sur 15.

## Comment obtenir ces chiffres vous-même

Ces étapes sont prévues pour une machine Linux x64 propre (les expériences ont utilisé Ubuntu 22.04). Elles suivent
la section « Build machine tooling » de [`RESULTS.md`](RESULTS.md), [`build.sh`](build.sh) et [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

**1. .NET SDK 11.0.100 et le workload `wasm-tools`** (dans le dossier de l'utilisateur, sans sudo) :

```bash
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --version 11.0.100 --install-dir "$HOME/.dotnet-wasm" --no-path
DOTNET_ROOT=$HOME/.dotnet-wasm PATH=$HOME/.dotnet-wasm:$PATH dotnet workload install wasm-tools
```

**2. `libatomic1`.** Le node livré avec emscripten dans le workload en a besoin. Sans lui, tout relink natif échoue.

```bash
sudo apt-get update && sudo apt-get install -y libatomic1
```

**3. binaryen (`wasm-opt`)** ne demande pas d'installation séparée : `build.sh` utilise le package npm figé `binaryen` 125.0.0 de
`tools/` (installé à l'étape 5). Il donne les mêmes octets que la version `version_125` de binaryen (même sha256 du `dotnet.native.wasm` final).

**4. Node.js 24.** Le dépôt n'automatise pas cette étape. Les expériences ont utilisé la v24.21.0, déjà installée sur la
machine de build (aucune commande d'installation n'a été lancée) ; la CI utilise `actions/setup-node` avec Node 24.

**5. Clonez ce dépôt**, puis installez les outils node et le navigateur headless :

```bash
cd tools && npm ci && npx playwright install --with-deps chromium-headless-shell
```

`--with-deps` installe les bibliothèques système du navigateur avec `sudo apt-get`. Sans droits root, utilisez
`npx playwright install chromium-headless-shell` (cela suffit si les bibliothèques sont déjà présentes).

**6. Construisez les deux variantes**, depuis la racine du dépôt (`cd ..` après l'étape 5). `build.sh` charge toujours [`scripts/build-env.sh`](scripts/build-env.sh).
Ce script ne fait rien quand `dotnet` et `node` sont dans le `PATH` ; il ajoute seulement un SDK local dans `~/.dotnet-wasm` (et des dossiers similaires) s'ils existent.

```bash
./build.sh honest            # -> artifacts/honest/wwwroot
./build.sh extreme           # -> artifacts/extreme/wwwroot
```

**7. Vérifiez et mesurez.** Cela lance la vérification fonctionnelle, puis additionne les tailles des fichiers téléchargés par le navigateur :

```bash
./measure.sh artifacts/honest honest
./measure.sh artifacts/extreme extreme
```

La ligne `COLD-LOAD` doit afficher :

| Variante | files | raw | brotli | gzip9 |
|---|---:|---:|---:|---:|
| `honest` | 43 | 4 243 612 | 1 424 673 | 1 706 941 |
| `extreme` | 8 | 3 851 361 | 1 211 018 | 1 507 342 |

**Remarque : les totaux dépendent un peu de l'endroit où le build tourne** (chemin du dossier et emplacement du SDK).
Le SDK ajoute une empreinte (fingerprint) dans le nom de certains fichiers (par exemple `dotnet.native.<fingerprint>.wasm`).
Il calcule cette empreinte avant que la section des noms de fonctions soit retirée, et cette section dépend des chemins du build.
Les noms sont écrits dans la boot config à l'intérieur de `dotnet.js` : les totaux bougent donc un peu.

- Un second dossier sur la même machine : `Honest` 1 424 691 en brotli (+18), `Extreme` 1 211 016 (−2).
  Les totaux bruts et le sha256 du `dotnet.native.wasm` final étaient identiques.
- Le premier build CI sur un runner GitHub : `Honest` brut 4 243 654, brotli 1 425 104, gzip 1 707 048, 43 fichiers (+431 en brotli, +42 en brut) ;
  `Extreme` brut 3 851 404, brotli 1 211 189, gzip 1 507 487, 8 fichiers (+171 en brotli, +43 en brut). Soit environ 0,03 % et 0,01 %.

La démo en ligne montre les chiffres de son propre build CI : ils diffèrent donc de ce README d'à peu près autant.
Les tableaux de ce README gardent les finales mesurées en local.

Pour servir les fichiers `.br` avec `Content-Encoding: br` pendant la vérification (le contrôle du tour 2), définissez `SERVE_ENCODED=br` :

```bash
SERVE_ENCODED=br ./measure.sh artifacts/extreme extreme
```

Une ligne `SERVED` s'affiche alors aussi. `equal=true` signifie que le transfert est égal à la somme des fichiers `.br`.

**8. Facultatif : la page de stress** pour les stubs natifs :

```bash
./build.sh extreme-stress
node tools/stress.mjs artifacts/extreme-stress/wwwroot
```

**Pièges connus**

- **Le workload `wasm-tools` est indispensable.** Sans relink natif, `InvariantGlobalization`, `InvariantTimezone`
  et `WasmEnableSIMD=false` arrêtent le build (`WasmBuildNative is required ...`), et `EmccLinkOptimizationFlag` est ignoré sans message.
  Les meilleurs résultats sans relink étaient `Honest` 2 320 504 et `Extreme` 2 186 970 en brotli.
- **`libatomic1`.** Sans lui, le relink échoue avec `libatomic.so.1: cannot open shared object file` et `... failed (returned 127)`.
- **Chemin du dépôt.** Avant l'ajout de `PathMap`, un build depuis un autre dossier différait de 3 octets brotli (le chemin était dans l'assembly de l'application).
  `PathMap` dans [`Directory.Build.props`](Directory.Build.props) règle cela pour l'assembly de l'application.
  Quelques octets peuvent encore bouger à cause des empreintes dans les noms de fichiers (voir la remarque après les chiffres attendus).
- **macOS n'est pas testé** pour le build complet. `dotnet workload install wasm-tools` y a échoué avec « Inadequate permissions ».
- **Autres dossiers d'installation du SDK.** `build.sh` et `tools/step.sh` chargent tous deux `scripts/build-env.sh`. Il n'ajoute `~/.dotnet-wasm`
  que si ce dossier existe : un SDK installé ailleurs fonctionne donc tant que `dotnet` est dans le `PATH`.
- **Petits écarts.** Si vos chiffres diffèrent, vérifiez la version du SDK (`dotnet --version`), le workload et les versions des outils ci-dessus.
  Le bundle a une seule valeur d'intégrité : un octet modifié n'importe où dedans change tout le fichier.

## Ce que sacrifie Extreme

C'est toujours du vrai Blazor : des composants Razor rendus par le `WebAssemblyRenderer` standard, démarrés par le `WebAssemblyHostBuilder` standard,
sur le pack du runtime Mono standard. binaryen et terser ne font que réécrire les fichiers produits.

Ce qu'`Extreme` perd en plus de `Honest` :

- Pas de routage `@page` : pas de modèles de routes, de paramètres ni de contraintes, pas de page `NotFound`, pas de `FocusOnNavigate`,
  pas de classe active sur `NavLink`, pas de chargement différé d'assemblys par route.
- Pas de service `HttpClient` ni de `System.Net.Http`. HTTP uniquement via l'interop JS.
- Les variables d'environnement ne sont pas dans `IConfiguration`. `appsettings.json` et `appsettings.{env}.json` sont ignorés.
- `Console.Error` vaut null : si la mise à jour d'un composant racine échoue, l'écriture de l'erreur lève une exception au lieu de l'afficher.
- Les noms d'hôtes Unicode (IDN) dans `Uri` ne sont pas convertis.
- Tour 2 : charger un assembly avec un PDB, ou tout ce qui a besoin de zlib dans le runtime, provoque un trap.
  Les assemblys compilés en AOT ne sont pas utilisables. Les chemins SIMD de l'interpréteur et le dump des threads du runtime provoquent un trap.
- Tour 2 : la réflexion sur les attributs propres au compilateur (par exemple `[CompilerGenerated]`, `[Nullable]`) ne renvoie rien.
  La réflexion sur les propriétés et les événements des types du framework (hors `System`, `System.Threading*`, `System.Runtime*` dans CoreLib)
  ne trouve rien. Les champs `const` du framework ne sont pas visibles par la réflexion.
- Le bundle échoue en entier si un seul octet change. Il n'y a pas de cache par assembly.
- Les fichiers post-traités doivent être reconstruits avec `build.sh`. Une modification à la main casse le chargement.

Perdu dans les deux variantes (réglages) : le formatage selon la culture, les fuseaux horaires (UTC uniquement), EventSource, les métriques et les diagnostics,
la pile d'appels dans les exceptions, les chemins de code dynamique, SIMD (runtime plus lent), la gestion des exceptions wasm (repli en JS), le débogueur
et des noms de framework lisibles dans les logs.

## Ce qui empêche une application Blazor WebAssembly de devenir plus petite

Finale `Extreme`, en brotli : natif 359 489 · JS 98 729 · managé 752 074 (le bundle) · HTML et données 726.
Descendre plus bas dans l'une de ces parties demande des changements que ce projet a laissés hors de son périmètre :
pas de fork ni de build maison du runtime, et l'hôte et le moteur de rendu Blazor standard restent en place.

| Partie | Brotli | Ce qui reste | Ce qu'il faut pour descendre plus bas |
|---|---:|---|---|
| Natif (`dotnet.native.wasm`) | 359 489 | Interpréteur Mono, GC, chargeur de métadonnées, marshalling, emmalloc, libc | Un build maison du runtime |
| JS | 98 729 | `dotnet.runtime.js` 47 048 (avec le jiterpreter), `blazor.webassembly.js` 22 808, `dotnet.native.js` 17 573, `dotnet.js` 11 300 | Des changements dans la logique JS du runtime ou de Blazor |
| Managé (`b.bin`) | 752 074 | CoreLib 408 929 et System.Text.Json 120 906 (chacun compressé seul) | Un hôte ou un moteur de rendu maison, pour que l'interop JS n'utilise plus de JSON par réflexion |

Le natif, le JS, CoreLib et System.Text.Json pèsent à eux seuls 988 053 octets. Ces parties ne deviennent plus petites qu'avec des changements
dans le runtime lui-même, dans son JS ou dans l'hôte Blazor.

**Si un fork du runtime était permis (estimations issues de recherches, pas des mesures).**
Partie native : environ 22–27K de moins en brotli avec d'autres options de build sur les sources standard, environ 42–57K avec de petits patchs,
environ 60–95K avec des changements profonds. En incluant le JS et CoreLib : d'environ 95–160K (petits patchs) à environ 140–250K (changements profonds).
Le coût : un pack de runtime à soi, à reconstruire à chaque version de maintenance mensuelle, des correctifs de sécurité en retard et aucun support de l'éditeur.

## FAQ sur la taille de Blazor WebAssembly

**Jusqu'où peut-on réduire une application Blazor WebAssembly sous .NET 11 ?**
Dans ce projet, 1 211 018 octets en brotli pour `Extreme` (8 fichiers) et 1 424 673 pour `Honest` avec les API Blazor standard.
Le modèle `dotnet new blazorwasm` pèse 2 589 350.

**Le workload `wasm-tools` compte-t-il ?**
Oui, beaucoup. Sans relink natif, les meilleurs résultats étaient `Honest` 2 320 504 et `Extreme` 2 186 970 en brotli.
Avec le relink, les finales du tour 1 (qui peuvent aussi utiliser les réglages qui en ont besoin) pesaient 1 519 331 et 1 333 578 : environ 800k à 850k de moins.

**Quel réglage seul fait gagner le plus ?**
`InvariantGlobalization=true` : −657 823 en brotli seul, −661 194 dans la chaîne séquentielle. Les données ICU ne sont plus téléchargées, et le relink
retire ICU du fichier natif.

**Désactiver SIMD vaut-il la peine ?**
`WasmEnableSIMD=false` donne −27 385 seul (−28 098 dans la chaîne). Le runtime est plus lent ; cette démo l'accepte.

**De combien brotli est-il plus petit que gzip ?**
D'environ 20 % pour `Extreme` : 1 211 018 en brotli contre 1 507 342 en gzip.
La démo en ligne est servie en gzip : elle montre donc la taille gzip.

**Peut-on descendre plus bas sans fork du runtime ?**
Aucun autre moyen n'a été trouvé avec le runtime standard et l'hôte Blazor standard. Le natif, le JS, CoreLib et System.Text.Json
pèsent déjà 988 053 octets à eux seuls, et ces parties demandent des changements dans le runtime ou l'hôte pour devenir plus petites.
Voir [Ce qui empêche une application Blazor WebAssembly de devenir plus petite](#ce-qui-empêche-une-application-blazor-webassembly-de-devenir-plus-petite).

**CoreCLR sur wasm est-il plus petit que Mono ?**
Non. `UseMonoRuntime=false` fonctionne, mais pèse +422 347 de plus en brotli que Mono.

## Structure du dépôt

| Chemin | Contenu |
|---|---|
| `Baseline/` | Le modèle `dotnet new blazorwasm`, point de départ. |
| `Issue86601/` | La recette de l'issue dotnet/runtime #86601 (modèle vide, globalisation invariante). A son propre `Directory.Build.props`. |
| `Honest/` | L'application `Honest` (`Router`, `NavLink`, `HttpClient` standard). |
| `Extreme/` | L'application `Extreme` et ses fichiers de substitutions ILLink (`ILLink.Substitutions*.xml`). |
| `Directory.Build.props` | Réglages communs à `Honest` et `Extreme` : les leviers MSBuild retenus (`SizeProfile=final`), `PathMap`, `NativeNames`. |
| `global.json` | Fixe le SDK 11.0.100. |
| `build.sh` | La recette finale : publication, passe Cecil, stubs natifs, `wasm-opt`, terser, bundle (`Extreme`), fichiers `.br`/`.gz`. |
| `measure.sh` | Vérification fonctionnelle, puis tailles des fichiers téléchargés par le navigateur. |
| `scripts/build-env.sh` | `PATH` / `DOTNET_ROOT` facultatifs pour un SDK local ; ne fait rien quand les outils sont dans le `PATH`. |
| `tools/check.mjs` | La vérification fonctionnelle (Playwright) et le journal réseau. |
| `tools/measure.mjs` | Tailles brutes, brotli et gzip des fichiers téléchargés. |
| `tools/serve.mjs` | Serveur statique pour la vérification (mode SPA, mode proche de Pages, `SERVE_ENCODED`). |
| `tools/postprocess.mjs`, `tools/MetaStrip/`, `tools/wasmstub.mjs`, `tools/bundle.mjs`, `tools/compress.mjs` | Les étapes de post-traitement utilisées par `build.sh`. |
| `tools/stress/`, `tools/make-stress.sh`, `tools/stress.mjs` | La page de stress pour les stubs natifs (copie de test uniquement, jamais publiée). |
| `tools/step.sh`, `tools/matrix.sh`, `tools/run-steps.sh`, `steps/` | Une expérience mesurée, plusieurs en parallèle, et les listes d'expériences. |
| `tools/collect.mjs`, `tools/result.mjs` | Écrivent les exécutions mesurées dans `results/experiments.jsonl`. |
| `tools/assemble-site.mjs`, `tools/pages-deeplink.mjs`, `tools/final.sh` | Construisent le site de démo et le vérifient sous un sous-chemin. |
| `tools/build-report.mjs` | La page de rapport détaillé, construite à partir du journal. |
| `tools/levers.mjs` | La liste commune des 14 moyens affichés sur la page d'accueil et la page de rapport ; elle lit les chiffres dans le journal. |
| `tools/AsmSize/`, `tools/why.py`, `tools/grep-props.sh`, `tools/native-symbols.sh`, `tools/native-stub-estimate.sh` | Outils d'analyse (taille IL, pourquoi ILLink a gardé un type, quelles propriétés le SDK lit, tailles des fonctions natives). |
| `RESULTS.md` | Le journal écrit complet des deux tours. |
| `results/` | `experiments.jsonl` (une ligne par exécution). Les petits fichiers d'entrée `meta-*.json` dont il est tiré, les dossiers de traces par exécution (`runs/<id>/`) et le build d'analyse natif avec noms (`native-symbols/`) sont gardés en local, non publiés. |
| `.github/workflows/pages.yml` | Le build et le déploiement GitHub Pages. |
| `Host/` | L'hôte App Service : une petite application ASP.NET Core qui sert les fichiers `.br`/`.gz` (`Program.cs`), son `web.config` pour Windows, et `iis-static/web.config` (option IIS seul, non testée). |
| `docs/hosting.md`, `docs/hosting.ru.md` | Comment la démo est mise en ligne : GitHub Pages et Azure App Service. |
| `.github/workflows/azure.yml` | Le build et le déploiement manuels vers Azure App Service (hôte Native AOT). |
| `tools/host-gate.sh`, `tools/site-check.mjs`, `tools/aot-toolchain.sh` | Le contrôle de l'hôte (les deux applications via l'hôte, vérifications curl et de sécurité, ressources au repos) et un clang local pour Native AOT sur une machine sans chaîne de compilation C. |

`artifacts/` et `out/` sont des sorties de build et ne sont pas dans git. Certains scripts de `tools/` (exécutions parallèles, contrôles) ont servi
aux expériences sur la machine de build Linux ; ils n'ont besoin que des outils listés plus haut.

## Journal complet et page de rapport

- [`RESULTS.md`](RESULTS.md) : le journal écrit des deux tours, avec chaque texte d'erreur.
- [`results/experiments.jsonl`](results/experiments.jsonl) : une ligne JSON par exécution mesurée (plus de 160 exécutions), avec les réglages, les tailles,
  les tailles par fichier, le résultat de la vérification, la décision et la raison. Les fichiers de traces bruts de chaque exécution ont été gardés en local et ne sont pas publiés.

La page de rapport détaillé (graphiques, toutes les exécutions avec filtres, tableaux par fichier) est construite à partir du journal :

```bash
node tools/build-report.mjs report.html
```

Le site de démo propose cette page sous le nom `report.html` à côté de la page d'accueil (`tools/assemble-site.mjs` appelle le même script).
`--standalone` est toujours accepté et ne fait rien.
