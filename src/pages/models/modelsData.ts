import { Eye, Wrench, Brain, Code, MessageSquare } from "lucide-react";

export type ModelSource = "local" | "cloud" | "api";
export type ModelAbility = "vision" | "tool" | "reasoning" | "code" | "chat";
export type ModelKind = "llm" | "embedding";

export type LocalModel = {
  id: string;
  name: string;
  author: string;
  params: string;
  size: string;
  quant: string;
  source: ModelSource;
  isLoaded: boolean;
  abilities: ModelAbility[];
  kind: ModelKind;
  trending?: boolean;
};

export const ABILITY_CONFIG: Record<ModelAbility, { icon: typeof Eye; label: string; className: string }> = {
  vision: { icon: Eye, label: "Vision", className: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  tool: { icon: Wrench, label: "Tool Use", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  reasoning: { icon: Brain, label: "Reasoning", className: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  code: { icon: Code, label: "Code", className: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
  chat: { icon: MessageSquare, label: "Chat", className: "text-muted-foreground bg-muted/50 border-border" },
};

export const CAPABILITY_FILTERS = ["All", "Reasoning", "Trending", "Vision", "Code", "Tool"] as const;
export const KIND_FILTERS = ["All", "LLMs", "Text Embedding"] as const;
export type CapabilityFilter = (typeof CAPABILITY_FILTERS)[number];
export type KindFilter = (typeof KIND_FILTERS)[number];

export const sourceLabel = (source: ModelSource) => {
  switch (source) {
    case "local": return { text: "Local", className: "bg-status-online/10 text-status-online" };
    case "cloud": return { text: "Cloud", className: "bg-primary/10 text-primary" };
    case "api": return { text: "API", className: "bg-status-downloading/10 text-status-downloading" };
  }
};

export function matchesCapabilityFilter(m: LocalModel, f: CapabilityFilter): boolean {
  if (f === "All") return true;
  if (f === "Trending") return !!m.trending;
  if (f === "Code") return m.abilities.includes("code");
  if (f === "Reasoning") return m.abilities.includes("reasoning");
  if (f === "Vision") return m.abilities.includes("vision");
  if (f === "Tool") return m.abilities.includes("tool");
  return true;
}

export function matchesKindFilter(m: LocalModel, f: KindFilter): boolean {
  if (f === "All") return true;
  if (f === "LLMs") return m.kind === "llm";
  if (f === "Text Embedding") return m.kind === "embedding";
  return true;
}
