import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const { tool, args } = await req.json();

    let result: unknown;

    switch (tool) {
      case "web-search": {
        const query = String(args?.query || "");
        if (!query) {
          result = { error: "Query is required" };
          break;
        }

        // Use DuckDuckGo HTML search (no API key needed)
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const resp = await fetch(ddgUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AIServer/1.0)",
          },
        });
        const html = await resp.text();

        // Parse results from HTML
        const results: { title: string; url: string; snippet: string }[] = [];
        const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
          const url = match[1].replace(/.*uddg=([^&]*).*/, (_, u) => decodeURIComponent(u));
          const title = match[2].replace(/<[^>]*>/g, "").trim();
          const snippet = match[3].replace(/<[^>]*>/g, "").trim();
          if (title && url) results.push({ title, url, snippet });
        }

        // Fallback: simpler regex if the above didn't match
        if (results.length === 0) {
          const linkRegex = /<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>/gi;
          const titleRegex = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;
          const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
          const links: string[] = [];
          const titles: string[] = [];
          const snippets: string[] = [];
          let m;
          while ((m = linkRegex.exec(html)) !== null) links.push(m[1]);
          while ((m = titleRegex.exec(html)) !== null) titles.push(m[1].replace(/<[^>]*>/g, "").trim());
          while ((m = snippetRegex.exec(html)) !== null) snippets.push(m[1].replace(/<[^>]*>/g, "").trim());
          for (let i = 0; i < Math.min(titles.length, 8); i++) {
            results.push({
              title: titles[i] || "",
              url: links[i] || "",
              snippet: snippets[i] || "",
            });
          }
        }

        result = { query, results, resultCount: results.length };
        break;
      }

      case "url-fetch": {
        const url = String(args?.url || "");
        if (!url) {
          result = { error: "URL is required" };
          break;
        }

        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; AIServer/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
        });

        if (!resp.ok) {
          result = { error: `HTTP ${resp.status} ${resp.statusText}`, url };
          break;
        }

        const contentType = resp.headers.get("content-type") || "";
        const isHtml = contentType.includes("text/html");
        const text = await resp.text();

        if (isHtml) {
          // Strip HTML tags, scripts, styles for cleaner text
          let clean = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          // Extract title
          const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : "";

          // Truncate
          if (clean.length > 8000) clean = clean.slice(0, 8000) + "\n... (truncated)";

          result = { url, title, content: clean, contentType: "text/html", length: clean.length };
        } else {
          const content = text.length > 8000 ? text.slice(0, 8000) + "\n... (truncated)" : text;
          result = { url, content, contentType, length: content.length };
        }
        break;
      }

      case "js-sandbox": {
        // JS execution happens client-side for security; this is a fallback
        result = { error: "JS sandbox should be executed client-side" };
        break;
      }

      default:
        result = { error: `Unknown tool: ${tool}` };
    }

    return new Response(JSON.stringify(result), {
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
