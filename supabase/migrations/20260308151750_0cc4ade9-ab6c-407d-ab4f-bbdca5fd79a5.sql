
-- Disable MCP servers that require auth tokens or are unreachable from cloud
UPDATE public.mcp_servers SET enabled = false WHERE name IN ('Brave Search', 'GitHub', 'Filesystem (Local)') AND enabled = true;

-- Fix Brave Search URL
UPDATE public.mcp_servers SET url = 'https://api.search.brave.com/mcp' WHERE name = 'Brave Search';
