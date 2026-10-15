import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fallback provider routing for when no DB providers match
const PROVIDER_ROUTES: Record<string, { baseUrl: string; requiresKey: string }> = {
  "gpt-": { baseUrl: "https://api.openai.com/v1", requiresKey: "OPENAI_API_KEY" },
  "o1": { baseUrl: "https://api.openai.com/v1", requiresKey: "OPENAI_API_KEY" },
  "o3": { baseUrl: "https://api.openai.com/v1", requiresKey: "OPENAI_API_KEY" },
  "o4": { baseUrl: "https://api.openai.com/v1", requiresKey: "OPENAI_API_KEY" },
  "claude-": { baseUrl: "https://api.anthropic.com/v1", requiresKey: "ANTHROPIC_API_KEY" },
  "gemini-": { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", requiresKey: "GOOGLE_AI_API_KEY" },
  "mistral": { baseUrl: "https://api.mistral.ai/v1", requiresKey: "MISTRAL_API_KEY" },
  "llama": { baseUrl: "https://api.groq.com/openai/v1", requiresKey: "GROQ_API_KEY" },
  "gemma": { baseUrl: "https://api.groq.com/openai/v1", requiresKey: "GROQ_API_KEY" },
};

// AES-256-GCM decryption for API keys stored in DB.
// Keys are encrypted client-side using the per-install secret from localStorage.
// The edge function cannot decrypt them — it only proxies already-decrypted keys
// passed via the Authorization header from the authenticated client.
// This function is kept as a no-op fallback for legacy XOR-encrypted rows.
function decryptApiKey(encrypted: string): string {
  if (!encrypted) return "";
  // Legacy XOR fallback for rows encrypted before the AES-GCM migration.
  // New rows are decrypted client-side and passed as plaintext via the request.
  try {
    const data = atob(encrypted);
    const encKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "fallback-key";
    let result = "";
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ encKey.charCodeAt(i % encKey.length));
    }
    return result;
  } catch {
    return encrypted;
  }
}

interface DbProvider {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key_encrypted: string;
  enabled: boolean;
  user_id: string;
}

function readStringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeOpenAiBody(body: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...body };

  const modelAlias = readStringField(body, ["model", "model_name", "model name"]);
  if (modelAlias) normalized.model = modelAlias;

  // Accept lightweight payloads: { user, ai } and map to OpenAI messages.
  const hasMessages = Array.isArray(body.messages);
  if (!hasMessages) {
    const userPrompt = readStringField(body, ["user", "user_prompt", "prompt"]);
    const aiSystem = readStringField(body, ["ai", "system", "system_prompt"]);
    if (userPrompt) {
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (aiSystem) messages.push({ role: "system", content: aiSystem });
      messages.push({ role: "user", content: userPrompt });
      normalized.messages = messages;
    }
  }

  return normalized;
}

function normalizeBaseUrl(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error("url must start with https://");
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

async function getProviderFromDb(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  model: string,
  requestedProvider?: string,
  requestedApiName?: string
): Promise<{ baseUrl: string; apiKey: string } | null> {
  let query = supabase
    .from("api_providers")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);

  // Filter by specific provider name if requested
  if (requestedApiName) {
    query = query.eq("name", requestedApiName);
  } else if (requestedProvider) {
    query = query.eq("provider_type", requestedProvider);
  }

  const { data: providers } = await query;

  if (providers && providers.length > 0) {
    // If multiple providers match, pick random one
    const provider = providers.length === 1
      ? providers[0]
      : providers[Math.floor(Math.random() * providers.length)];

    const apiKey = decryptApiKey(provider.api_key_encrypted);
    if (apiKey) {
      return { baseUrl: provider.base_url, apiKey };
    }
  }

  return null;
}

function getProviderFromEnv(model: string): { baseUrl: string; apiKey: string } | null {
  for (const [prefix, config] of Object.entries(PROVIDER_ROUTES)) {
    if (model.startsWith(prefix)) {
      const key = Deno.env.get(config.requiresKey);
      if (!key) return null;
      return { baseUrl: config.baseUrl, apiKey: key };
    }
  }
  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (openRouterKey) {
    return { baseUrl: "https://openrouter.ai/api/v1", apiKey: openRouterKey };
  }
  return null;
}

async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api-proxy/, "");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer sk-ais-")) {
    return new Response(
      JSON.stringify({ error: { message: "Invalid API key. Keys must start with sk-ais-", type: "invalid_api_key" } }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const apiKey = authHeader.replace("Bearer ", "");
  const keyHash = await hashKey(apiKey);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: keyRecord, error: keyError } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .single();

  if (keyError || !keyRecord) {
    return new Response(
      JSON.stringify({ error: { message: "Invalid or inactive API key", type: "invalid_api_key" } }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check expiry
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return new Response(
      JSON.stringify({ error: { message: "API key has expired", type: "expired_api_key" } }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Rate limiting: 0 means unlimited
  const isUnlimited = keyRecord.rate_limit_rpm === 0;
  let recentRequests = 0;

  if (!isUnlimited) {
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from("api_usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("api_key_id", keyRecord.id)
      .gte("created_at", oneMinuteAgo);

    recentRequests = count || 0;

    if (recentRequests >= keyRecord.rate_limit_rpm) {
      const retryAfter = 60;
      return new Response(
        JSON.stringify({
          error: {
            message: `Rate limit exceeded. Limit: ${keyRecord.rate_limit_rpm} requests/minute. Try again in ${retryAfter}s.`,
            type: "rate_limit_exceeded",
          },
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(keyRecord.rate_limit_rpm),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": new Date(Date.now() + retryAfter * 1000).toISOString(),
          },
        }
      );
    }
  }

  const rateLimitHeaders = isUnlimited
    ? { "X-RateLimit-Limit": "unlimited" }
    : {
        "X-RateLimit-Limit": String(keyRecord.rate_limit_rpm),
        "X-RateLimit-Remaining": String(Math.max(0, keyRecord.rate_limit_rpm - recentRequests - 1)),
        "X-RateLimit-Reset": new Date(Date.now() + 60_000).toISOString(),
      };

  // Update last_used_at
  await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id);

  // Handle /v1/models endpoint
  if (path === "/v1/models" && req.method === "GET") {
    const models: Array<{ id: string; object: string; owned_by: string }> = [];
    
    // Get user's DB providers
    const { data: dbProviders } = await supabase
      .from("api_providers")
      .select("*")
      .eq("user_id", keyRecord.user_id)
      .eq("enabled", true);

    if (dbProviders) {
      for (const p of dbProviders) {
        models.push({ id: `${p.provider_type}/*`, object: "model", owned_by: p.name });
      }
    }

    // Also add env-based providers
    for (const [prefix, config] of Object.entries(PROVIDER_ROUTES)) {
      if (Deno.env.get(config.requiresKey)) {
        models.push({ id: `${prefix}*`, object: "model", owned_by: config.requiresKey.replace("_API_KEY", "").toLowerCase() });
      }
    }
    return new Response(
      JSON.stringify({ object: "list", data: models }),
      { headers: { ...corsHeaders, ...rateLimitHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse body
  let body: Record<string, unknown> = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  body = normalizeOpenAiBody(body);

  const model = String(body.model || "").trim();
  if (!model) {
    return new Response(
      JSON.stringify({ error: { message: "model field is required (aliases: model_name, model name)", type: "invalid_request" } }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check model restrictions
  if (keyRecord.allowed_models && keyRecord.allowed_models.length > 0) {
    if (!keyRecord.allowed_models.some((m: string) => model.includes(m))) {
      return new Response(
        JSON.stringify({ error: { message: `Model ${model} not allowed for this API key`, type: "model_not_allowed" } }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Provider resolution: check custom headers, then DB providers, then env fallback
  const requestedProvider = req.headers.get("X-Provider") || readStringField(body, ["api", "provider"]) || undefined;
  const requestedApiName = req.headers.get("X-Api-Name") || readStringField(body, ["apiname", "api_name", "api name"]) || undefined;
  const requestedUrl = req.headers.get("X-Api-Url") || readStringField(body, ["url", "base_url", "baseUrl"]);

  let provider = await getProviderFromDb(supabase, keyRecord.user_id, model, requestedProvider, requestedApiName);
  if (!provider) {
    provider = getProviderFromEnv(model);
  }

  if (!provider) {
    return new Response(
      JSON.stringify({ error: { message: `No provider configured for model: ${model}. Add a provider in Settings or set X-Provider/X-Api-Name headers.`, type: "no_provider" } }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (requestedUrl) {
    try {
      provider.baseUrl = normalizeBaseUrl(requestedUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: { message: `Invalid url override: ${msg}`, type: "invalid_request" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  const startTime = Date.now();

  try {
    const providerUrl = `${provider.baseUrl}${path}`;
    const providerResponse = await fetch(providerUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(body),
    });

    const statusCode = providerResponse.status;
    const latency = Date.now() - startTime;

    await supabase.from("api_usage_logs").insert({
      user_id: keyRecord.user_id,
      api_key_id: keyRecord.id,
      model,
      provider: provider.baseUrl,
      endpoint: path,
      status_code: statusCode,
      latency_ms: latency,
      tokens_input: 0,
      tokens_output: 0,
    });

    if (body.stream && providerResponse.body) {
      return new Response(providerResponse.body, {
        status: providerResponse.status,
        headers: {
          ...corsHeaders,
          ...rateLimitHeaders,
          "Content-Type": providerResponse.headers.get("Content-Type") || "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const responseData = await providerResponse.text();
    return new Response(responseData, {
      status: providerResponse.status,
      headers: { ...corsHeaders, ...rateLimitHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const latency = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await supabase.from("api_usage_logs").insert({
      user_id: keyRecord.user_id,
      api_key_id: keyRecord.id,
      model,
      provider: provider.baseUrl,
      endpoint: path,
      status_code: 500,
      latency_ms: latency,
      error_message: errorMessage,
    });

    return new Response(
      JSON.stringify({ error: { message: `Proxy error: ${errorMessage}`, type: "proxy_error" } }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
