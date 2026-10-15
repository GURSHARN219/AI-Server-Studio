// Shared application types — single source of truth
// Previously scattered across src/pages/Index.tsx

export type Page = "chat" | "discover" | "models" | "search" | "server" | "settings" | "api" | "voice" | "media";

export type UserRole = "user" | "power-user" | "developer";

export type ToolItem = {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  tagLabel: string;
  tagColor: string;
};

export type ApiProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  hasKey?: boolean;
  enabled: boolean;
  providerType?: string;
};
