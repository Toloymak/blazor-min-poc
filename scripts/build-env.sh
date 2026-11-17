# Optional environment for the build scripts (sourced by build.sh and tools/step.sh; safe to source more than once).
# If the tools are simply on PATH (dotnet 11.0.100 with wasm-tools, node 24), this file changes nothing.
# It only adds user-local installs when they exist:
#   ~/.dotnet-wasm             .NET SDK 11.0.100 + wasm-tools installed with dotnet-install.sh --install-dir
#   ~/.local/binaryen/bin      binaryen release (only used by tools/native-symbols.sh and tools/native-stub-estimate.sh)
#   ~/.local/node/bin          node, unpacked from a nodejs.org tarball
#   ~/.local/libatomic/...     libatomic1 unpacked without root (emsdk's bundled node needs libatomic.so.1)
if [ -x "$HOME/.dotnet-wasm/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet-wasm"
  case ":$PATH:" in *":$DOTNET_ROOT:"*) ;; *) export PATH="$DOTNET_ROOT:$PATH" ;; esac
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
for d in "$HOME/.local/binaryen/bin" "$HOME/.local/node/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) export PATH="$d:$PATH" ;; esac
done
if [ -d "$HOME/.local/libatomic/usr/lib/x86_64-linux-gnu" ]; then
  case ":${LD_LIBRARY_PATH:-}:" in *":$HOME/.local/libatomic/usr/lib/x86_64-linux-gnu:"*) ;;
    *) export LD_LIBRARY_PATH="$HOME/.local/libatomic/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ;; esac
fi
