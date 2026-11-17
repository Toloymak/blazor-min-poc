using System.Text.Json.Serialization;

namespace Honest;

public sealed class Data
{
    public string Message { get; set; } = "";
    public string[] Items { get; set; } = [];
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(Data))]
public partial class AppJsonContext : JsonSerializerContext;
