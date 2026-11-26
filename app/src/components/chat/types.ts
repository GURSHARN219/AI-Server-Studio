import type React from "react";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool-status";
  content: string;
  images?: string[];
  modelName?: string;
  thinkingTime?: number;
  thinkingContent?: string;
  tokensCount?: number;
  generationTime?: number;
  speed?: number;
  llamaSpeed?: number;
  toolCalls?: {
    id: string;
    name: string;
    args: string;
    result?: string;
    error?: string;
    duration?: number;
    status: "pending" | "running" | "done" | "error";
  }[];
  timestamp: number;
  error?: string;
};

export type AgentMode = {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
};

export type TabType = "chat" | "json-editor";

export type ChatTab = {
  id: string;
  title: string;
  type: TabType;
  editorConfig?: {
    configType: "mcp" | "tools";
    json: string;
  };
};

export type ModelSource = "local" | "cloud" | "api";

export type ModelDef = {
  id: string;
  name: string;
  params: string;
  quant: string;
  source: ModelSource;
  provider: string;
  providerId?: string;
  providerType?: string;
  modelType?: "chat" | "image" | "stt" | "tts" | "video";
  supportsTools?: boolean;
  path?: string;
};
