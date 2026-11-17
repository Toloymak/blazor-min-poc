#!/usr/bin/env bash
# Which size-related MSBuild property names are actually read by the .NET 11 SDK / wasm packs.
D="$HOME/.dotnet-wasm"
dirs="$D/sdk/11.0.100 $D/packs/Microsoft.NET.Runtime.WebAssembly.Sdk $D/packs/Microsoft.NETCore.App.Runtime.Mono.browser-wasm $D/packs/Microsoft.NET.Sdk.WebAssembly.Pack $(ls -d $HOME/.nuget/packages/microsoft.aspnetcore.components.webassembly* $HOME/.nuget/packages/microsoft.net.illink.tasks 2>/dev/null)"
for p in PublishTrimmed TrimMode TrimmerRemoveSymbols DebuggerSupport EventSourceSupport UseSystemResourceKeys InvariantGlobalization InvariantTimezone BlazorEnableTimeZoneSupport HttpActivityPropagationSupport MetadataUpdaterSupport EnableUnsafeBinaryFormatterSerialization UseNativeHttpHandler JsonSerializerIsReflectionEnabledByDefault StackTraceSupport _AggressiveAttributeTrimming AutoreleasePoolSupport NullabilityInfoContextSupport BlazorWebAssemblyPreserveCollationData SatelliteResourceLanguages MetricsSupport UseSizeOptimizedLinq Http3Support TrimmerDefaultAction BlazorIcuDataFileName WasmBuildNative RunAOTCompilation WasmNativeStrip WasmEnableSIMD WasmEnableExceptionHandling WasmEnableThreads BlazorWebAssemblyJiterpreter WasmEmitSymbolMap EmccCompileOptimizationFlag EmccLinkOptimizationFlag WasmNativeCompileOptimizationFlag WasmNativeLinkOptimizationFlag WasmInitialHeapSize EmccExtraLDFlags EmccExtraCFlags WasmEnableWebcil WasmFingerprintAssets WasmFingerprintDotnetJs WasmFingerprintBootConfig BlazorCacheBootResources CompressionEnabled UseMonoRuntime WasmIcuDataFileName WasmIncludeFullIcuData WasmEnableLegacyJsInterop WasmEnableJsInteropByValue WasmProfilers WasmDebugLevel WasmEmitSourceMap WasmBuildNativeOnlyForPublish WasmStripILAfterAOT WasmSingleFileBundle WasmBundlerFriendlyBootConfig WasmEnableStreamingResources WasmRuntimeAssetsLocation _WasmRuntimePackIncludeTimezones WasmNativeDebugSymbols EmccEnableAssertions WasmAllowUndefinedSymbols BlazorWebAssemblyLoadAllGlobalizationData HybridGlobalization WasmEnableEventPipe WasmPerfTracing WasmPerfInstrumentation; do
  n=$(grep -rIl --include='*.targets' --include='*.props' -- "$p\b" $dirs 2>/dev/null | wc -l)
  printf '%-48s %s\n' "$p" "$n"
done
echo "=== RuntimeHostConfigurationOption / feature switch names in SDK targets ==="
grep -rhoI --include='*.targets' 'RuntimeHostConfigurationOption Include="[^"]*"' $dirs | sort -u
echo "=== Emcc opt flag usage ==="
grep -rnI --include='*.targets' -E 'OptimizationFlag' $D/packs/Microsoft.NET.Runtime.WebAssembly.Sdk | head -30
echo "=== properties mentioning Wasm in WebAssembly.Sdk (defined) ==="
grep -rhoI --include='*.targets' --include='*.props' -E '<(Wasm|Emcc|Blazor)[A-Za-z]+' $D/packs/Microsoft.NET.Runtime.WebAssembly.Sdk $D/packs/Microsoft.NET.Sdk.WebAssembly.Pack $D/sdk/11.0.100/Sdks/Microsoft.NET.Sdk.BlazorWebAssembly 2>/dev/null | sort | uniq -c | sort -rn | awk '{print $2}' | tr '\n' ' '
echo; ls $D/packs
