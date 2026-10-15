package server

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"ai-server-studio-backend/tools"
)

func (s *Server) registerToolRoutes() {
	s.mux.HandleFunc("GET /v1/tools", s.handleListTools)
	s.mux.HandleFunc("POST /v1/tools/execute", s.handleToolExecute)
}

func (s *Server) toolDefinitions() *tools.Registry {
	if s.toolRegistry == nil {
		return tools.DefaultRegistry()
	}
	return s.toolRegistry
}

func (s *Server) handleListTools(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]interface{}{"data": s.toolDefinitions().List()})
}

// POST /v1/tools/execute
// Body: { "tool": "web-search"|"url-fetch", "args": { ... } }
// Replaces Supabase edge function calls so tools work offline.
func (s *Server) handleToolExecute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Tool string                 `json:"tool"`
		Args map[string]interface{} `json:"args"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	canonical := req.Tool
	if canonical == "web-search" {
		canonical = "web.search"
	}
	if canonical == "url-fetch" {
		canonical = "web.fetch"
	}
	definition, ok := s.toolDefinitions().Get(canonical)
	if !ok || !definition.Enabled {
		writeError(w, 400, fmt.Sprintf("unknown or disabled tool: %s", req.Tool), "invalid_request")
		return
	}

	switch canonical {
	case "web-search", "web.search":
		query, _ := req.Args["query"].(string)
		if query == "" {
			writeError(w, 400, "args.query is required", "invalid_request")
			return
		}
		result, err := webSearch(query)
		if err != nil {
			writeError(w, 502, err.Error(), "tool_error")
			return
		}
		writeJSON(w, result)

	case "url-fetch", "web.fetch":
		rawURL, _ := req.Args["url"].(string)
		if rawURL == "" {
			writeError(w, 400, "args.url is required", "invalid_request")
			return
		}
		if err := assertPublicURL(rawURL); err != nil {
			writeError(w, 400, err.Error(), "invalid_request")
			return
		}
		result, err := urlFetch(rawURL)
		if err != nil {
			writeError(w, 502, err.Error(), "tool_error")
			return
		}
		writeJSON(w, result)

	default:
		writeError(w, 400, fmt.Sprintf("unknown tool: %s", req.Tool), "invalid_request")
	}
}

// ── web search via DuckDuckGo HTML (no API key) ───────────────────────────────

func webSearch(query string) (map[string]interface{}, error) {
	ddgURL := "https://html.duckduckgo.com/html/?q=" + url.QueryEscape(query)
	resp, err := outboundHTTPClient.Get(ddgURL)
	if err != nil {
		return nil, fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	html, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	results := parseDDGResults(string(html))
	return map[string]interface{}{
		"query":       query,
		"results":     results,
		"resultCount": len(results),
	}, nil
}

var (
	reDDGResult  = regexp.MustCompile(`(?i)<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)</a>`)
	reHTMLTag    = regexp.MustCompile(`<[^>]+>`)
	reWhitespace = regexp.MustCompile(`\s+`)
)

func parseDDGResults(html string) []map[string]interface{} {
	var results []map[string]interface{}
	matches := reDDGResult.FindAllStringSubmatch(html, 8)
	for _, m := range matches {
		rawURL := m[1]
		// DuckDuckGo wraps URLs in redirect — extract uddg= param
		if parsed, err := url.Parse(rawURL); err == nil {
			if u := parsed.Query().Get("uddg"); u != "" {
				if decoded, err := url.QueryUnescape(u); err == nil {
					rawURL = decoded
				}
			}
		}
		title := strings.TrimSpace(reHTMLTag.ReplaceAllString(m[2], ""))
		snippet := strings.TrimSpace(reHTMLTag.ReplaceAllString(m[3], ""))
		title = reWhitespace.ReplaceAllString(title, " ")
		snippet = reWhitespace.ReplaceAllString(snippet, " ")
		if title != "" && rawURL != "" {
			results = append(results, map[string]interface{}{
				"title":   title,
				"url":     rawURL,
				"snippet": snippet,
			})
		}
	}
	return results
}

// ── URL fetch ─────────────────────────────────────────────────────────────────

func urlFetch(rawURL string) (map[string]interface{}, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AIServer/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")

	resp, err := outboundHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d %s", resp.StatusCode, resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, fmt.Errorf("reading body: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	text := string(body)

	var title string
	if strings.Contains(contentType, "text/html") {
		title = extractHTMLTitle(text)
		text = stripHTML(text)
	}
	if len(text) > 8000 {
		text = text[:8000] + "\n... (truncated)"
	}

	return map[string]interface{}{
		"url":         rawURL,
		"title":       title,
		"content":     text,
		"contentType": contentType,
		"length":      len(text),
	}, nil
}

var (
	reScript = regexp.MustCompile(`(?is)<script[\s\S]*?</script>`)
	reStyle  = regexp.MustCompile(`(?is)<style[\s\S]*?</style>`)
	reNav    = regexp.MustCompile(`(?is)<nav[\s\S]*?</nav>`)
	reFooter = regexp.MustCompile(`(?is)<footer[\s\S]*?</footer>`)
	reHeader = regexp.MustCompile(`(?is)<header[\s\S]*?</header>`)
	reTag    = regexp.MustCompile(`<[^>]+>`)
	reSpaces = regexp.MustCompile(`\s+`)
	reTitle  = regexp.MustCompile(`(?i)<title[^>]*>([\s\S]*?)</title>`)
)

func stripHTML(html string) string {
	html = reScript.ReplaceAllString(html, "")
	html = reStyle.ReplaceAllString(html, "")
	html = reNav.ReplaceAllString(html, "")
	html = reFooter.ReplaceAllString(html, "")
	html = reHeader.ReplaceAllString(html, "")
	html = reTag.ReplaceAllString(html, " ")
	return strings.TrimSpace(reSpaces.ReplaceAllString(html, " "))
}

func extractHTMLTitle(html string) string {
	m := reTitle.FindStringSubmatch(html)
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(reTag.ReplaceAllString(m[1], ""))
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

func assertPublicURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return fmt.Errorf("only HTTPS URLs are allowed")
	}
	ips, err := net.LookupIP(parsed.Hostname())
	if err != nil {
		return fmt.Errorf("could not resolve destination")
	}
	for _, ip := range ips {
		if isPrivateOrLocalIP(ip) {
			return fmt.Errorf("blocked: %q resolves to a private/internal address", parsed.Hostname())
		}
	}
	return nil
}

func isPrivateOrLocalIP(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}
