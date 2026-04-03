import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { server_id, server_url, method, params, headers: customHeaders } = body;

    // If server_id provided, look up from DB
    let targetUrl = server_url;
    let serverHeaders: Record<string, string> = customHeaders || {};

    if (server_id && !server_url) {
      const serviceClient = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: server, error: serverError } = await serviceClient
        .from("mcp_servers")
        .select("*")
        .eq("id", server_id)
        .eq("user_id", user.id)
        .single();

      if (serverError || !server) {
        return new Response(JSON.stringify({ error: "MCP server not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      targetUrl = server.url;
      serverHeaders = (server.headers as Record<string, string>) || {};
    }

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "No server URL provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward the MCP JSON-RPC request
    const mcpRequest = {
      jsonrpc: "2.0",
      id: body.id || Date.now(),
      method: method || body.method,
      params: params || body.params,
    };

    const mcpResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...serverHeaders,
      },
      body: JSON.stringify(mcpRequest),
    });

    if (!mcpResponse.ok) {
      const errorText = await mcpResponse.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: `MCP server returned ${mcpResponse.status}`,
          details: errorText,
        }),
        {
          status: mcpResponse.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const contentType = mcpResponse.headers.get("content-type") || "";

    // Handle SSE responses
    if (contentType.includes("text/event-stream") && mcpResponse.body) {
      return new Response(mcpResponse.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Regular JSON response
    const data = await mcpResponse.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
