-- Allow service role to insert into api_usage_logs
-- The edge function runs with service role context where auth.uid() = null,
-- so the default RLS policy blocks all inserts. This policy fixes that.

CREATE POLICY "service_role_insert_api_usage_logs"
  ON api_usage_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);
