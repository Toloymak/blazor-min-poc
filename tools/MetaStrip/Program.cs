// Metadata post-processing of the published, trimmed (and Bit.Minifier'd) assemblies with Mono.Cecil.
// Usage: MetaStrip <_framework dir> [--attrs] [--consts] [--props] [--only a,b]
//   --attrs  : remove custom attributes that only compilers, analyzers, ILLink or tooling read (allow-list below)
//   --consts : remove literal (const) fields of non-enum types; their values are already inlined by the compiler
//   --props  : remove property/event metadata (accessor methods stay) in assemblies nothing reflects on (see NoReflect)
// The app's own assembly is never touched.
using Mono.Cecil;

var dir = args[0];
bool attrs = args.Contains("--attrs"), consts = args.Contains("--consts"), props = args.Contains("--props");
var removable = new HashSet<string>
{
    "System.Runtime.CompilerServices.CompilerGeneratedAttribute",
    "System.Runtime.CompilerServices.NullableAttribute",
    "System.Runtime.CompilerServices.NullableContextAttribute",
    "System.Runtime.CompilerServices.NullablePublicOnlyAttribute",
    "System.Runtime.CompilerServices.TypeForwardedFromAttribute",
    "System.Runtime.CompilerServices.InternalsVisibleToAttribute",
    "System.Runtime.CompilerServices.AsyncStateMachineAttribute",
    "System.Runtime.CompilerServices.IteratorStateMachineAttribute",
    "System.Runtime.CompilerServices.AsyncIteratorStateMachineAttribute",
    "System.Runtime.CompilerServices.CompilationRelaxationsAttribute",
    "System.Runtime.CompilerServices.RequiredMemberAttribute",
    "System.Runtime.CompilerServices.CompilerLoweringPreserveAttribute",
    "System.Runtime.Versioning.NonVersionableAttribute",
    "System.Runtime.Versioning.TargetFrameworkAttribute",
    "System.Reflection.AssemblyMetadataAttribute",
    "System.Resources.NeutralResourcesLanguageAttribute",
    "System.Runtime.InteropServices.LibraryImportAttribute",
    "System.Runtime.InteropServices.DefaultDllImportSearchPathsAttribute",
    "System.Runtime.InteropServices.Marshalling.CustomMarshallerAttribute",
    "System.Runtime.InteropServices.Marshalling.MarshalUsingAttribute",
    "System.Runtime.InteropServices.Marshalling.NativeMarshallingAttribute",
    "System.Runtime.InteropServices.Marshalling.ContiguousCollectionMarshallerAttribute",
    "System.Diagnostics.CodeAnalysis.DynamicallyAccessedMembersAttribute",
    "Microsoft.Extensions.Logging.LoggerMessageAttribute",
    "System.Text.RegularExpressions.GeneratedRegexAttribute",
    "System.Text.Json.Serialization.JsonSerializableAttribute",
    "System.Text.Json.Serialization.JsonSourceGenerationOptionsAttribute",
    "System.Runtime.BypassReadyToRunAttribute",
};
// assemblies where no code reflects over properties/events (Blazor and STJ do, so they and their callers' types stay)
var noReflect = new HashSet<string> { "System.Private.CoreLib", "System.Private.Uri", "System.Collections", "System.Collections.Concurrent",
    "System.Collections.Immutable", "System.Linq", "System.Memory", "System.Text.Encodings.Web", "System.IO.Pipelines",
    "System.Runtime.InteropServices.JavaScript", "System.Security.Cryptography", "System.Text.RegularExpressions", "System.ComponentModel",
    "System.Diagnostics.DiagnosticSource", "Microsoft.Extensions.Primitives" };
var app = args.SkipWhile(a => a != "--app").Skip(1).FirstOrDefault() ?? "";
var resolver = new DirResolver(dir);
long before = 0, after = 0; int nAttr = 0, nConst = 0, nProp = 0;
foreach (var file in Directory.GetFiles(dir, "*.dll"))
{
    var name = Path.GetFileNameWithoutExtension(file).Split('.') is var parts && parts.Length > 1 && parts[^1].Length == 10 ? string.Join('.', parts[..^1]) : Path.GetFileNameWithoutExtension(file);
    if (name == app) continue;
    var bytes = File.ReadAllBytes(file); before += bytes.Length;
    using var asm = AssemblyDefinition.ReadAssembly(new MemoryStream(bytes), new ReaderParameters { AssemblyResolver = resolver, ReadingMode = ReadingMode.Immediate });
    if (attrs)
    {
        void Strip(Mono.Cecil.ICustomAttributeProvider p) { if (!p.HasCustomAttributes) return; for (int i = p.CustomAttributes.Count - 1; i >= 0; i--) if (removable.Contains(p.CustomAttributes[i].AttributeType.FullName)) { p.CustomAttributes.RemoveAt(i); nAttr++; } }
        Strip(asm); foreach (var m in asm.Modules) Strip(m);
        foreach (var t in asm.MainModule.GetTypes())
        {
            Strip(t);
            foreach (var m in t.Methods) { Strip(m); Strip(m.MethodReturnType); foreach (var p in m.Parameters) Strip(p); foreach (var g in m.GenericParameters) Strip(g); }
            foreach (var f in t.Fields) Strip(f);
            foreach (var p in t.Properties) Strip(p);
            foreach (var e in t.Events) Strip(e);
            foreach (var g in t.GenericParameters) Strip(g);
        }
    }
    if (consts)
        foreach (var t in asm.MainModule.GetTypes())
            if (!t.IsEnum)
                for (int i = t.Fields.Count - 1; i >= 0; i--)
                    if (t.Fields[i].IsLiteral && !t.Fields[i].HasCustomAttributes) { t.Fields.RemoveAt(i); nConst++; }
    var keepCoreLibProps = Environment.GetEnvironmentVariable("METASTRIP_PROPS_CORELIB") switch { "none" => true, _ => false };
    if (props && noReflect.Contains(name) && !(name == "System.Private.CoreLib" && keepCoreLibProps))
        foreach (var t in asm.MainModule.GetTypes())
        {
            // the runtime and JSInterop look up some CoreLib properties by name (Task<T>.Result and others)
            if (name == "System.Private.CoreLib" && Environment.GetEnvironmentVariable("METASTRIP_PROPS_CORELIB") == "notasks" && (t.Namespace.StartsWith("System.Threading") || t.Namespace.StartsWith("System.Runtime") || t.Namespace == "System" )) continue;
            nProp += t.Properties.Count + t.Events.Count;
            t.Properties.Clear(); t.Events.Clear();
        }
    var ms = new MemoryStream();
    asm.Write(ms);
    File.WriteAllBytes(file, ms.ToArray()); after += ms.Length;
}
Console.WriteLine($"MetaStrip: attrs={nAttr} consts={nConst} props+events={nProp}; dll bytes {before} -> {after} ({after - before})");

// Published files are fingerprinted (Name.hash.dll), so resolve references by assembly name, not file name.
sealed class DirResolver : DefaultAssemblyResolver
{
    readonly Dictionary<string, string> _byName = new();
    readonly Dictionary<string, AssemblyDefinition> _cache = new();
    public DirResolver(string dir)
    {
        foreach (var f in Directory.GetFiles(dir, "*.dll"))
            using (var a = AssemblyDefinition.ReadAssembly(f)) _byName[a.Name.Name] = f;
    }
    public override AssemblyDefinition Resolve(AssemblyNameReference name)
    {
        if (_cache.TryGetValue(name.Name, out var c)) return c;
        if (_byName.TryGetValue(name.Name, out var f))
            return _cache[name.Name] = AssemblyDefinition.ReadAssembly(new MemoryStream(File.ReadAllBytes(f)), new ReaderParameters { AssemblyResolver = this });
        return base.Resolve(name);
    }
}
