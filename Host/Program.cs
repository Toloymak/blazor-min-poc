// Static host for the Blazor WebAssembly minification demo (.NET 11): serves the exact precompressed files made by build.sh (no SDK static assets, no
// on-the-fly compression). Built once at startup: a table path -> file (+ .br / .gz), so no per-request disk scans.
// No logging, no config reload, no background work.
using System.Net;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Net.Http.Headers;

var root = Path.GetFullPath(Environment.GetEnvironmentVariable("SITE_ROOT") ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"));
var site = SiteTable.Build(root);

var builder = WebApplication.CreateEmptyBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
builder.WebHost.UseKestrelCore().ConfigureKestrel(k =>
{
    k.AddServerHeader = false;
    k.Limits.MaxRequestBodySize = 0;
    foreach (var ep in Listen.Endpoints()) k.Listen(ep, o => o.Protocols = HttpProtocols.Http1AndHttp2);
});
var app = builder.Build();
app.Run(ctx => site.Serve(ctx));
app.Run();

static class Listen
{
    // App Service Windows (ASP.NET Core Module, out-of-process): ASPNETCORE_PORT, localhost only.
    // App Service Linux / containers: PORT, WEBSITES_PORT, ASPNETCORE_HTTP_PORTS or ASPNETCORE_URLS; default 8080.
    public static IEnumerable<IPEndPoint> Endpoints()
    {
        Func<string, string?> env = Environment.GetEnvironmentVariable;
        if (int.TryParse(env("ASPNETCORE_PORT"), out var ancm)) { yield return new IPEndPoint(IPAddress.Loopback, ancm); yield break; }
        var urls = env("ASPNETCORE_URLS");
        if (!string.IsNullOrEmpty(urls))
        {
            foreach (var u in urls.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                var s = u.Replace("://+", "://0.0.0.0").Replace("://*", "://0.0.0.0").Replace("://localhost", "://127.0.0.1");
                var uri = new Uri(s);
                yield return new IPEndPoint(IPAddress.Parse(uri.Host == "[::]" ? "::" : uri.Host.Trim('[', ']')), uri.Port);
            }
            yield break;
        }
        var port = env("PORT") ?? env("WEBSITES_PORT") ?? env("ASPNETCORE_HTTP_PORTS")?.Split(';')[0] ?? "8080";
        yield return new IPEndPoint(IPAddress.Any, int.Parse(port));
    }
}

sealed record Entry(string Path, string ContentType, string Cache, long Length, string? Br, long BrLength, string? Gz, long GzLength, string LastModified, string Csp);

sealed class SiteTable(Dictionary<string, Entry> files, Dictionary<string, Entry> fallbacks)
{
    static readonly string[] Apps = ["honest", "extreme"];
    const string Robots = "User-agent: *\nDisallow: /\n";
    // for non-HTML responses and pages without an entry in .csp.json
    const string DefaultCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

    // tiny reader for {"/path": "policy", ...} written by tools/assemble-site.mjs (no JSON serializer: AOT-friendly, no reflection)
    static Dictionary<string, string> ReadCsp(string file)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(file)) return d;
        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(file));
        foreach (var p in doc.RootElement.EnumerateObject()) d[p.Name] = p.Value.GetString() ?? DefaultCsp;
        return d;
    }

    public static SiteTable Build(string root)
    {
        var map = new Dictionary<string, Entry>(StringComparer.Ordinal);
        var csp = ReadCsp(Path.Combine(root, ".csp.json"));
        foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            if (f.EndsWith(".br") || f.EndsWith(".gz")) continue;
            var rel = "/" + Path.GetRelativePath(root, f).Replace('\\', '/');
            // never serve dot files (.csp.json, .gitignore, ...) or server config
            if (rel.Split('/').Any(seg => seg.StartsWith('.')) || rel.EndsWith("/web.config", StringComparison.OrdinalIgnoreCase)) continue;
            var fi = new FileInfo(f);
            string? br = File.Exists(f + ".br") ? f + ".br" : null, gz = File.Exists(f + ".gz") ? f + ".gz" : null;
            map[rel] = new Entry(f, ContentType(f), CacheControl(rel), fi.Length, br, br is null ? 0 : new FileInfo(br).Length,
                gz, gz is null ? 0 : new FileInfo(gz).Length, fi.LastWriteTimeUtc.ToString("R"),
                csp.TryGetValue(rel, out var c) ? c : DefaultCsp);
        }
        foreach (var a in Apps.ToArray()) if (map.TryGetValue($"/{a}/index.html", out var i)) map[$"/{a}/"] = i;
        if (map.TryGetValue("/index.html", out var top)) map["/"] = top;
        var fb = Apps.Where(a => map.ContainsKey($"/{a}/index.html")).ToDictionary(a => a, a => map[$"/{a}/index.html"]);
        return new SiteTable(map, fb);
    }

    // Fingerprinted names (name.<10 chars>.ext) never change: cache for a year. Everything else (index.html,
    // dotnet.js, blazor.webassembly.js, the bundle b.bin, data.json) must be revalidated, because a new build reuses the name;
    // the bundle is still safe from mixing versions because index.html carries its integrity value.
    static string CacheControl(string rel) =>
        System.Text.RegularExpressions.Regex.IsMatch(rel, @"\.[a-z0-9]{10}\.(js|wasm|dll|dat)$") ? "public, max-age=31536000, immutable" : "no-cache";

    static string ContentType(string f) => Path.GetExtension(f).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8", ".js" or ".mjs" => "text/javascript", ".wasm" => "application/wasm",
        ".json" => "application/json", ".css" => "text/css", ".txt" => "text/plain; charset=utf-8", ".svg" => "image/svg+xml",
        ".png" => "image/png", ".ico" => "image/x-icon", ".bin" or ".dat" or ".dll" or ".blat" => "application/octet-stream",
        _ => "application/octet-stream",
    };

    public Task Serve(HttpContext ctx)
    {
        var req = ctx.Request; var res = ctx.Response;
        var h = res.Headers;
        h["X-Robots-Tag"] = "noindex, nofollow";
        h["X-Content-Type-Options"] = "nosniff";
        h["Referrer-Policy"] = "no-referrer";
        h["X-Frame-Options"] = "DENY";
        h["Content-Security-Policy"] = DefaultCsp;
        if (!HttpMethods.IsGet(req.Method) && !HttpMethods.IsHead(req.Method)) { res.StatusCode = 405; return Task.CompletedTask; }
        var path = req.Path.Value ?? "/";
        if (path == "/robots.txt" && !files.ContainsKey(path))
        {
            res.ContentType = "text/plain; charset=utf-8"; res.ContentLength = Robots.Length;
            return HttpMethods.IsHead(req.Method) ? Task.CompletedTask : res.WriteAsync(Robots);
        }
        if (path == "/honest" || path == "/extreme") { res.StatusCode = 301; res.Headers.Location = path + "/"; return Task.CompletedTask; }
        if (!files.TryGetValue(path, out var e))
        {
            // SPA fallback: any unknown path inside an app gets that app's index.html (status 200)
            var seg = path.Length > 1 ? path[1..].Split('/')[0] : "";
            if (path.Length > seg.Length + 1 && fallbacks.TryGetValue(seg, out var idx) && Path.GetExtension(path) == "") e = idx;
            else { res.StatusCode = 404; return Task.CompletedTask; }
        }
        h["Content-Security-Policy"] = e.Csp;
        res.Headers.CacheControl = e.Cache;
        res.Headers.LastModified = e.LastModified;
        if (req.Headers.IfModifiedSince.ToString() == e.LastModified) { res.StatusCode = 304; return Task.CompletedTask; }
        string file = e.Path; long len = e.Length;
        if (e.Br is not null || e.Gz is not null) res.Headers.Vary = "Accept-Encoding";
        var accept = req.Headers.AcceptEncoding.ToString();
        if (e.Br is not null && Accepts(accept, "br")) { file = e.Br; len = e.BrLength; res.Headers.ContentEncoding = "br"; }
        else if (e.Gz is not null && Accepts(accept, "gzip")) { file = e.Gz; len = e.GzLength; res.Headers.ContentEncoding = "gzip"; }
        res.ContentType = e.ContentType;
        res.ContentLength = len;
        return HttpMethods.IsHead(req.Method) ? Task.CompletedTask : res.SendFileAsync(file, 0, len, ctx.RequestAborted);
    }

    static bool Accepts(string header, string coding)
    {
        foreach (var part in header.Split(','))
        {
            var p = part.Trim();
            var semi = p.IndexOf(';');
            var name = semi < 0 ? p : p[..semi].Trim();
            if (!name.Equals(coding, StringComparison.OrdinalIgnoreCase)) continue;
            return semi < 0 || !p[semi..].Replace(" ", "").StartsWith(";q=0") || p[semi..].Replace(" ", "").StartsWith(";q=0.");
        }
        return false;
    }
}
