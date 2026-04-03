import { Shield } from "lucide-react";

type Props = { apiBaseUrl: string };

export default function DocsTab({ apiBaseUrl }: Props) {
  const base = apiBaseUrl || "https://your-project.supabase.co/functions/v1/api-proxy";
  return (
    <div className="space-y-3">
      <span className="text-[11px] font-semibold text-foreground">API Documentation</span>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">Base URL</span>
        </div>
        <div className="px-3 py-2">
          <code className="text-[11px] font-mono text-primary bg-primary/5 px-2 py-1 rounded">{base}</code>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">OpenAI SDK (Python)</span>
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono text-foreground overflow-x-auto scrollbar-styled">{`from openai import OpenAI

client = OpenAI(
    api_key="sk-ais-your-key-here",
    base_url="${base}/v1"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)`}</pre>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">OpenAI SDK (JavaScript/TypeScript)</span>
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono text-foreground overflow-x-auto scrollbar-styled">{`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-ais-your-key-here",
  baseURL: "${base}/v1",
});

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);`}</pre>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">cURL</span>
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono text-foreground overflow-x-auto scrollbar-styled">{`curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-ais-your-key-here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}</pre>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">Routing Payload Aliases</span>
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono text-foreground overflow-x-auto scrollbar-styled">{`curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-ais-your-key-here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://api.openai.com/v1",
    "api": "openai",
    "apiname": "My OpenAI",
    "model_name": "gpt-4o-mini",
    "user": "Write a short summary",
    "ai": "You are a concise assistant"
  }'`}</pre>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-secondary/20 border-b border-border/50">
          <span className="text-[10px] font-semibold text-foreground">Supported Endpoints</span>
        </div>
        <div className="divide-y divide-border/30">
          {[
            { method: "POST", path: "/v1/chat/completions", desc: "Chat completion (streaming supported)" },
            { method: "POST", path: "/v1/completions", desc: "Text completion" },
            { method: "POST", path: "/v1/embeddings", desc: "Generate embeddings" },
            { method: "GET",  path: "/v1/models",     desc: "List available models" },
          ].map((ep) => (
            <div key={ep.path} className="px-3 py-1.5 flex items-center gap-2">
              <span className={`text-[9px] font-mono font-bold px-1 py-px rounded ${ep.method === "GET" ? "bg-status-online/10 text-status-online" : "bg-status-downloading/10 text-status-downloading"}`}>{ep.method}</span>
              <span className="text-[11px] font-mono text-foreground">{ep.path}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-lg p-3 bg-primary/5">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-semibold text-foreground">Authentication</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          All requests require an API key in the <code className="text-primary bg-primary/10 px-1 rounded">Authorization</code> header as a Bearer token.
          Your API key starts with <code className="text-primary bg-primary/10 px-1 rounded">sk-ais-</code>.
        </p>
      </div>
    </div>
  );
}
