import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { useHttp } from "@aistclaw/hooks/use-ws";
import { useAuthStore } from "@aistclaw/stores/use-auth-store";
import type { AgentData } from "@aistclaw/types/agent";

interface AgentPickerPromptProps {
  onSelect: (agentId: string) => void;
  compact?: boolean;
}

function agentEmoji(agent: AgentData): string | undefined {
  return (agent.other_config?.emoji as string) || undefined;
}

export function AgentPickerPrompt({ onSelect, compact = false }: AgentPickerPromptProps) {
  const { t } = useTranslation("chat");
  const http = useHttp();
  const connected = useAuthStore((s) => s.connected);
  const [agents, setAgents] = useState<AgentData[]>([]);

  useEffect(() => {
    if (!connected) return;
    http
      .get<{ agents: AgentData[] }>("/v1/agents")
      .then((res) => {
        setAgents((res.agents ?? []).filter((a) => a.status === "active"));
      })
      .catch(() => {});
  }, [http, connected]);

  if (compact) {
    return (
      <div className="mx-3 mb-2">
        <div className="rounded-lg border bg-background/80 px-3 py-2 backdrop-blur-sm">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("selectAgent.title")}
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {agents.map((agent) => {
              const emoji = agentEmoji(agent);
              return (
                <button
                  key={agent.agent_key}
                  type="button"
                  onClick={() => onSelect(agent.agent_key)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  {emoji ? <span className="text-sm">{emoji}</span> : <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="max-w-[140px] truncate font-medium">{agent.display_name || agent.agent_key}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-3 safe-bottom">
      <div className="rounded-xl border bg-background/95 backdrop-blur-sm shadow-sm p-4">
        <p className="text-sm font-medium mb-1">{t("selectAgent.title")}</p>
        <p className="text-xs text-muted-foreground mb-3">{t("selectAgent.description")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
          {agents.map((agent) => {
            const emoji = agentEmoji(agent);
            return (
              <button
                key={agent.agent_key}
                type="button"
                onClick={() => onSelect(agent.agent_key)}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors cursor-pointer"
              >
                {emoji ? (
                  <span className="text-lg shrink-0">{emoji}</span>
                ) : (
                  <Bot className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-medium truncate block">
                    {agent.display_name || agent.agent_key}
                  </span>
                  {agent.is_default && (
                    <span className="text-xs text-muted-foreground">Default</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
