
-- API providers table to store user's provider configs encrypted
CREATE TABLE public.api_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'custom',
  base_url text NOT NULL,
  api_key_encrypted text DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own providers" ON public.api_providers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own providers" ON public.api_providers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own providers" ON public.api_providers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own providers" ON public.api_providers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_api_providers_updated_at
  BEFORE UPDATE ON public.api_providers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Allow service role to read providers for the proxy
CREATE POLICY "Service role can read all providers" ON public.api_providers
  FOR SELECT TO service_role USING (true);
