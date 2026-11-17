// Where do the bytes of trimmed assemblies go? IL body bytes per namespace / type (top N).
// Usage: dotnet run -- <dll-or-dir> [topN] [filter]
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

if (args[0] == "--features")
{
    // List feature switches from the ILLink.Substitutions.xml / ILLink.Descriptors.xml resources embedded in assemblies.
    var seen = new SortedDictionary<string, SortedSet<string>>();
    foreach (var dir in args.Skip(1))
    foreach (var file in Directory.GetFiles(dir, "*.dll", SearchOption.AllDirectories))
    {
        try
        {
            using var pe = new PEReader(File.OpenRead(file));
            if (!pe.HasMetadata) continue;
            var md = pe.GetMetadataReader();
            foreach (var rh in md.ManifestResources)
            {
                var r = md.GetManifestResource(rh);
                var name = md.GetString(r.Name);
                if (!name.StartsWith("ILLink.")) continue;
                var sec = pe.PEHeaders.CorHeader!.ResourcesDirectory;
                var data = pe.GetSectionData(sec.RelativeVirtualAddress).GetReader();
                data.Offset = (int)r.Offset;
                var len = data.ReadInt32();
                var xml = System.Text.Encoding.UTF8.GetString(data.ReadBytes(len));
                foreach (System.Text.RegularExpressions.Match el in System.Text.RegularExpressions.Regex.Matches(xml, "<[a-z]+[^>]*\\bfeature=\"[^>]*>"))
                {
                    var m = System.Text.RegularExpressions.Regex.Match(el.Value, "\\bfeature=\"([^\"]+)\"");
                    var fv = System.Text.RegularExpressions.Regex.Match(el.Value, "featurevalue=\"([^\"]+)\"");
                    var key = m.Groups[1].Value;
                    if (!seen.TryGetValue(key, out var set)) seen[key] = set = new();
                    set.Add($"{Path.GetFileNameWithoutExtension(file)}({name.Replace("ILLink.", "").Replace(".xml", "")},{fv.Groups[1].Value})");
                }
            }
        }
        catch { }
    }
    // .NET 9+: [FeatureSwitchDefinition("name")] on feature-check properties (ILLink treats them like substitutions)
    foreach (var dir in args.Skip(1))
    foreach (var file in Directory.GetFiles(dir, "*.dll", SearchOption.AllDirectories))
    {
        try
        {
            using var pe = new PEReader(File.OpenRead(file));
            if (!pe.HasMetadata) continue;
            var md = pe.GetMetadataReader();
            foreach (var ah in md.CustomAttributes)
            {
                var a = md.GetCustomAttribute(ah);
                string tn = "";
                if (a.Constructor.Kind == HandleKind.MemberReference)
                {
                    var mr = md.GetMemberReference((MemberReferenceHandle)a.Constructor);
                    if (mr.Parent.Kind == HandleKind.TypeReference) tn = md.GetString(md.GetTypeReference((TypeReferenceHandle)mr.Parent).Name);
                }
                else if (a.Constructor.Kind == HandleKind.MethodDefinition)
                    tn = md.GetString(md.GetTypeDefinition(md.GetMethodDefinition((MethodDefinitionHandle)a.Constructor).GetDeclaringType()).Name);
                if (tn != "FeatureSwitchDefinitionAttribute") continue;
                var br = md.GetBlobReader(a.Value); br.ReadUInt16();
                var key = br.ReadSerializedString() ?? "?";
                if (!seen.TryGetValue(key, out var set)) seen[key] = set = new();
                set.Add($"{Path.GetFileNameWithoutExtension(file)}(FeatureSwitchDefinition)");
            }
        }
        catch { }
    }
    foreach (var (k, v) in seen) Console.WriteLine($"{k}\t{string.Join(" ", v)}");
    return;
}
if (args[0] == "--attrs")
{
    // Which custom attributes / metadata are left after ILLink + Bit.Minifier, over all dlls in a dir.
    var count = new Dictionary<string, (int n, long blob)>();
    long props = 0, events = 0, consts = 0, res = 0, paramNames = 0, nfiles = 0;
    foreach (var file in Directory.GetFiles(args[1], "*.dll"))
    {
        nfiles++;
        using var pe = new PEReader(File.OpenRead(file));
        var md = pe.GetMetadataReader();
        foreach (var ah in md.CustomAttributes)
        {
            var a = md.GetCustomAttribute(ah);
            string tn = "?";
            if (a.Constructor.Kind == HandleKind.MemberReference)
            {
                var mr = md.GetMemberReference((MemberReferenceHandle)a.Constructor);
                if (mr.Parent.Kind == HandleKind.TypeReference) { var tr = md.GetTypeReference((TypeReferenceHandle)mr.Parent); tn = md.GetString(tr.Namespace) + "." + md.GetString(tr.Name); }
            }
            else if (a.Constructor.Kind == HandleKind.MethodDefinition)
            {
                var m = md.GetMethodDefinition((MethodDefinitionHandle)a.Constructor);
                var td = md.GetTypeDefinition(m.GetDeclaringType()); tn = md.GetString(td.Namespace) + "." + md.GetString(td.Name);
            }
            var c = count.GetValueOrDefault(tn); count[tn] = (c.n + 1, c.blob + md.GetBlobReader(a.Value).Length);
        }
        props += md.PropertyDefinitions.Count; events += md.EventDefinitions.Count;
        foreach (var fh in md.FieldDefinitions) if ((md.GetFieldDefinition(fh).Attributes & System.Reflection.FieldAttributes.Literal) != 0) consts++;
        foreach (var rh in md.ManifestResources) { res++; }
        foreach (var ph in Enumerable.Range(1, md.GetTableRowCount(TableIndex.Param)).Select(i => MetadataTokens.ParameterHandle(i))) { if (!md.GetParameter(ph).Name.IsNil) paramNames++; }
    }
    Console.WriteLine($"files={nfiles} properties={props} events={events} literalFields={consts} manifestResources={res} namedParams={paramNames}");
    foreach (var (k, v) in count.OrderByDescending(x => x.Value.n).Take(60)) Console.WriteLine($"  {v.n,6} {v.blob,7}  {k}");
    return;
}
var target = args[0];
var top = args.Length > 1 ? int.Parse(args[1]) : 25;
var files = Directory.Exists(target) ? Directory.GetFiles(target, "*.dll") : [target];
foreach (var file in files.OrderByDescending(f => new FileInfo(f).Length))
{
    using var pe = new PEReader(File.OpenRead(file));
    var md = pe.GetMetadataReader();
    var byNs = new Dictionary<string, (long il, int methods)>();
    var byType = new Dictionary<string, (long il, int methods)>();
    long total = 0;
    foreach (var th in md.TypeDefinitions)
    {
        var t = md.GetTypeDefinition(th);
        var outer = t; var nsH = t.Namespace;
        var dt = t.GetDeclaringType();
        while (!dt.IsNil) { outer = md.GetTypeDefinition(dt); nsH = outer.Namespace; dt = outer.GetDeclaringType(); }
        var ns = md.GetString(nsH);
        var tn = ns + "." + md.GetString(outer.Name);
        foreach (var mh in t.GetMethods())
        {
            var m = md.GetMethodDefinition(mh);
            if (m.RelativeVirtualAddress == 0) continue;
            var size = pe.GetMethodBody(m.RelativeVirtualAddress).Size;
            total += size;
            var a = byNs.GetValueOrDefault(ns); byNs[ns] = (a.il + size, a.methods + 1);
            var b = byType.GetValueOrDefault(tn); byType[tn] = (b.il + size, b.methods + 1);
        }
    }
    Console.WriteLine($"## {Path.GetFileName(file)} file={new FileInfo(file).Length} IL={total} types={md.TypeDefinitions.Count} methods={md.MethodDefinitions.Count} strings(#US)={md.GetHeapSize(HeapIndex.UserString)} blobs={md.GetHeapSize(HeapIndex.Blob)}");
    if (args.Length > 2 && !Path.GetFileName(file).Contains(args[2])) continue;
    Console.WriteLine("  namespaces:");
    foreach (var (k, v) in byNs.OrderByDescending(x => x.Value.il).Take(top)) Console.WriteLine($"    {v.il,8} {v.methods,5}  {k}");
    Console.WriteLine("  types:");
    foreach (var (k, v) in byType.OrderByDescending(x => x.Value.il).Take(top)) Console.WriteLine($"    {v.il,8} {v.methods,5}  {k}");
}
