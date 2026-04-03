import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@aistclaw/components/layout/app-layout";
import { RequireAuth } from "@aistclaw/components/shared/require-auth";
import { RequireAdmin, RequireCrossTenant } from "@aistclaw/components/shared/require-role";
import { RequireSetup } from "@aistclaw/components/shared/require-setup";
import { ErrorBoundary } from "@aistclaw/components/shared/error-boundary";
import { AISTCLAW_ROUTE_PATHS, ROUTES } from "@aistclaw/lib/constants";
import { lazyWithRetry } from "@aistclaw/lib/lazy-with-retry";

const LoginPage = lazyWithRetry(() =>
  import("@aistclaw/pages/login/login-page").then((m) => ({ default: m.LoginPage })),
);
const OverviewPage = lazyWithRetry(() =>
  import("@aistclaw/pages/overview/overview-page").then((m) => ({ default: m.OverviewPage })),
);
const ChatPage = lazyWithRetry(() =>
  import("@aistclaw/pages/chat/chat-page").then((m) => ({ default: m.ChatPage })),
);
const AgentsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/agents/agents-page").then((m) => ({ default: m.AgentsPage })),
);
const AgentCodexPoolPage = lazyWithRetry(() =>
  import("@aistclaw/pages/agents/agent-detail/agent-codex-pool-page").then((m) => ({ default: m.AgentCodexPoolPage })),
);
const ImportExportPage = lazyWithRetry(() =>
  import("@aistclaw/pages/import-export/import-export-page").then((m) => ({ default: m.ImportExportPage })),
);
const SessionsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/sessions/sessions-page").then((m) => ({ default: m.SessionsPage })),
);
const SkillsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/skills/skills-page").then((m) => ({ default: m.SkillsPage })),
);
const CronPage = lazyWithRetry(() =>
  import("@aistclaw/pages/cron/cron-page").then((m) => ({ default: m.CronPage })),
);
const ConfigPage = lazyWithRetry(() =>
  import("@aistclaw/pages/config/config-page").then((m) => ({ default: m.ConfigPage })),
);
const TracesPage = lazyWithRetry(() =>
  import("@aistclaw/pages/traces/traces-page").then((m) => ({ default: m.TracesPage })),
);
const ChannelsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/channels/channels-page").then((m) => ({ default: m.ChannelsPage })),
);
const ApprovalsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/approvals/approvals-page").then((m) => ({ default: m.ApprovalsPage })),
);
const NodesPage = lazyWithRetry(() =>
  import("@aistclaw/pages/nodes/nodes-page").then((m) => ({ default: m.NodesPage })),
);
const LogsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/logs/logs-page").then((m) => ({ default: m.LogsPage })),
);
const ProvidersPage = lazyWithRetry(() =>
  import("@aistclaw/pages/providers/providers-page").then((m) => ({ default: m.ProvidersPage })),
);
const MCPPage = lazyWithRetry(() =>
  import("@aistclaw/pages/mcp/mcp-page").then((m) => ({ default: m.MCPPage })),
);
const TeamsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/teams/teams-page").then((m) => ({ default: m.TeamsPage })),
);
const BuiltinToolsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/builtin-tools/builtin-tools-page").then((m) => ({ default: m.BuiltinToolsPage })),
);
const TtsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/tts/tts-page").then((m) => ({ default: m.TtsPage })),
);
const EventsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/events/events-page").then((m) => ({ default: m.EventsPage })),
);
const StoragePage = lazyWithRetry(() =>
  import("@aistclaw/pages/storage/storage-page").then((m) => ({ default: m.StoragePage })),
);
const SetupPage = lazyWithRetry(() =>
  import("@aistclaw/pages/setup/setup-page").then((m) => ({ default: m.SetupPage })),
);
const PendingMessagesPage = lazyWithRetry(() =>
  import("@aistclaw/pages/pending-messages/pending-messages-page").then((m) => ({ default: m.PendingMessagesPage })),
);
const MemoryPage = lazyWithRetry(() =>
  import("@aistclaw/pages/memory/memory-page").then((m) => ({ default: m.MemoryPage })),
);
const KnowledgeGraphPage = lazyWithRetry(() =>
  import("@aistclaw/pages/knowledge-graph/knowledge-graph-page").then((m) => ({ default: m.KnowledgeGraphPage })),
);
const ContactsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/contacts/contacts-page").then((m) => ({ default: m.ContactsPage })),
);
const ActivityPage = lazyWithRetry(() =>
  import("@aistclaw/pages/activity/activity-page").then((m) => ({ default: m.ActivityPage })),
);
const CliCredentialsPage = lazyWithRetry(() =>
  import("@aistclaw/pages/cli-credentials/cli-credentials-page").then((m) => ({ default: m.CliCredentialsPage })),
);
const ApiKeysPage = lazyWithRetry(() =>
  import("@aistclaw/pages/api-keys/api-keys-page").then((m) => ({ default: m.ApiKeysPage })),
);
const PackagesPage = lazyWithRetry(() =>
  import("@aistclaw/pages/packages/packages-page").then((m) => ({ default: m.PackagesPage })),
);
const TenantsAdminPage = lazyWithRetry(() =>
  import("@aistclaw/pages/tenants-admin/tenants-admin-page").then((m) => ({ default: m.TenantsAdminPage })),
);
const TenantDetailPage = lazyWithRetry(() =>
  import("@aistclaw/pages/tenants-admin/tenant-detail-page").then((m) => ({ default: m.TenantDetailPage })),
);
const TenantSelectorPage = lazyWithRetry(() =>
  import("@aistclaw/pages/login/tenant-selector").then((m) => ({ default: m.TenantSelectorPage })),
);

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

export function AppRoutes() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path={AISTCLAW_ROUTE_PATHS.LOGIN} element={<LoginPage />} />

          <Route path={AISTCLAW_ROUTE_PATHS.SELECT_TENANT} element={<TenantSelectorPage />} />

          <Route
            path={AISTCLAW_ROUTE_PATHS.SETUP}
            element={
              <RequireAuth>
                <SetupPage />
              </RequireAuth>
            }
          />

          <Route
            element={
              <RequireAuth>
                <RequireSetup>
                  <AppLayout />
                </RequireSetup>
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to={ROUTES.OVERVIEW} replace />} />
            <Route path={AISTCLAW_ROUTE_PATHS.OVERVIEW} element={<OverviewPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.CHAT_PATTERN} element={<ChatPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.AGENTS} element={<AgentsPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.IMPORT_EXPORT} element={<RequireAdmin><ImportExportPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.AGENT_CODEX_POOL} element={<RequireAdmin><AgentCodexPoolPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.AGENT_DETAIL} element={<AgentsPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.TEAMS} element={<TeamsPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.TEAM_DETAIL} element={<TeamsPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.SESSIONS} element={<SessionsPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.SESSION_DETAIL} element={<SessionsPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.SKILLS} element={<SkillsPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.SKILL_DETAIL} element={<SkillsPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.CRON} element={<CronPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.CRON_DETAIL} element={<CronPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.CONFIG} element={<RequireCrossTenant><ConfigPage /></RequireCrossTenant>} />
            <Route path={AISTCLAW_ROUTE_PATHS.PROVIDERS} element={<RequireAdmin><ProvidersPage key="list" /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.PROVIDER_DETAIL} element={<RequireAdmin><ProvidersPage key="detail" /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.CLI_CREDENTIALS} element={<RequireAdmin><CliCredentialsPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.API_KEYS} element={<RequireAdmin><ApiKeysPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.CHANNELS} element={<RequireAdmin><ChannelsPage key="list" /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.CHANNEL_DETAIL} element={<RequireAdmin><ChannelsPage key="detail" /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.NODES} element={<RequireAdmin><NodesPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.LOGS} element={<RequireAdmin><LogsPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.BUILTIN_TOOLS} element={<RequireAdmin><BuiltinToolsPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.MCP} element={<RequireAdmin><MCPPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.TTS} element={<RequireCrossTenant><TtsPage /></RequireCrossTenant>} />
            <Route path={AISTCLAW_ROUTE_PATHS.STORAGE} element={<RequireAdmin><StoragePage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.PACKAGES} element={<RequireAdmin><PackagesPage /></RequireAdmin>} />
            <Route path={AISTCLAW_ROUTE_PATHS.TENANTS} element={<RequireCrossTenant><TenantsAdminPage /></RequireCrossTenant>} />
            <Route path={AISTCLAW_ROUTE_PATHS.TENANT_DETAIL} element={<RequireCrossTenant><TenantDetailPage /></RequireCrossTenant>} />
            <Route path={AISTCLAW_ROUTE_PATHS.TRACES} element={<TracesPage key="list" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.TRACE_DETAIL} element={<TracesPage key="detail" />} />
            <Route path={AISTCLAW_ROUTE_PATHS.EVENTS} element={<EventsPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.USAGE} element={<Navigate to={ROUTES.OVERVIEW} replace />} />
            <Route path={AISTCLAW_ROUTE_PATHS.ACTIVITY} element={<ActivityPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.CONTACTS} element={<ContactsPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.APPROVALS} element={<ApprovalsPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.PENDING_MESSAGES} element={<PendingMessagesPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.MEMORY} element={<MemoryPage />} />
            <Route path={AISTCLAW_ROUTE_PATHS.KNOWLEDGE_GRAPH} element={<KnowledgeGraphPage />} />
          </Route>

          <Route path="*" element={<Navigate to={ROUTES.OVERVIEW} replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
