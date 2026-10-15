
-- Fix the permissive RLS policy on api_usage_logs
-- Drop the overly permissive policy and replace with a proper one
DROP POLICY "Service role can insert usage logs" ON public.api_usage_logs;

-- Only authenticated users can insert their own logs (edge function sets user_id)
CREATE POLICY "Users can insert their own usage logs" ON public.api_usage_logs 
  FOR INSERT WITH CHECK (auth.uid() = user_id);
