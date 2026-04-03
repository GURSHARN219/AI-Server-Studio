
-- MCP Servers table for storing user's MCP server configurations
CREATE TABLE public.mcp_servers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  headers JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'disconnected',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own MCP servers" ON public.mcp_servers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own MCP servers" ON public.mcp_servers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own MCP servers" ON public.mcp_servers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own MCP servers" ON public.mcp_servers FOR DELETE USING (auth.uid() = user_id);

-- Updated_at trigger
CREATE TRIGGER update_mcp_servers_updated_at BEFORE UPDATE ON public.mcp_servers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
