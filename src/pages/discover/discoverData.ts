import { Eye, Wrench, Brain, Code, MessageSquare, HardDrive, Cloud, Globe } from "lucide-react";

export type ModelSource = "local" | "cloud" | "api";
export type ModelAbility = "vision" | "tool" | "reasoning" | "code" | "chat";

export type DownloadVariant = {
  id: string;
  label: string;
  size: string;
};

export type ModelInfo = {
  id: string;
  name: string;
  author: string;
  params: string;
  size: string;
  quant: string;
  downloads: string;
  description: string;
  tags: string[];
  abilities: ModelAbility[];
  source: ModelSource;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  downloadProgress?: number;
  slug?: string;
  stars?: number;
  lastUpdated?: string;
  staffPick?: boolean;
  arch?: string;
  domain?: string;
  format?: string;
  readmeTitle?: string;
  readmePreview?: string;
  variants?: DownloadVariant[];
  gpuOffload?: boolean;
  kind?: "llm" | "embedding";
};

export const ABILITY_CONFIG: Record<ModelAbility, { icon: typeof Eye; label: string; className: string }> = {
  vision: { icon: Eye, label: "Vision", className: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  tool: { icon: Wrench, label: "Tool Use", className: "text-sky-400 bg-sky-400/10 border-sky-400/30" },
  reasoning: { icon: Brain, label: "Reasoning", className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
  code: { icon: Code, label: "Code", className: "text-sky-400 bg-sky-400/10 border-sky-400/20" },
  chat: { icon: MessageSquare, label: "Chat", className: "text-muted-foreground bg-muted/50 border-border" },
};

export const MODELS: ModelInfo[] = [
  {
    id: "nemotron-3-nano-4b", name: "Nemotron 3 Nano 4B", author: "NVIDIA", params: "4B", size: "2.84 GB", quant: "Q4_K_M", downloads: "31,708",
    description: "General purpose reasoning and chat model trained by NVIDIA.", tags: ["chat", "trending", "reasoning"], abilities: ["chat", "tool", "reasoning"], source: "local",
    slug: "nvidia/nemotron-3-nano-4b", stars: 6, lastUpdated: "5 days ago", staffPick: true, arch: "nemotron_h", domain: "llm", format: "GGUF",
    readmeTitle: "Nemotron 3 Nano 4B", readmePreview: "NVIDIA Nemotron 3 Nano is a compact instruction-tuned model optimized for reasoning, tool use, and efficient on-device deployment. This README covers installation, quantization options, and hardware requirements.",
    variants: [{ id: "q4", label: "GGUF NVIDIA Nemotron 3 Nano 4B Q4_K_M", size: "2.84 GB" }, { id: "q8", label: "GGUF NVIDIA Nemotron 3 Nano 4B Q8_0", size: "4.12 GB" }], gpuOffload: true, kind: "llm",
  },
  { id: "llama-3.3-8b", name: "Llama 3.3 8B Instruct", author: "Meta", params: "8B", size: "4.9 GB", quant: "Q4_K_M", downloads: "2.1M", description: "Meta's latest Llama model with improved instruction following.", tags: ["chat", "instruct", "popular"], abilities: ["chat", "tool", "code"], source: "local", isDownloaded: true, slug: "meta/llama-3.3-8b-instruct", stars: 4200, lastUpdated: "2 weeks ago", arch: "llama", domain: "llm", format: "GGUF", readmeTitle: "Llama 3.3 8B Instruct", readmePreview: "Llama 3.3 is a text-only instruction-tuned model.", variants: [{ id: "q4", label: "Meta Llama 3.3 8B Q4_K_M", size: "4.9 GB" }], gpuOffload: true, kind: "llm" },
  { id: "mistral-7b", name: "Mistral 7B Instruct v0.3", author: "Mistral AI", params: "7B", size: "4.4 GB", quant: "Q4_K_M", downloads: "1.8M", description: "Efficient instruction-tuned model with strong reasoning.", tags: ["chat", "instruct", "fast"], abilities: ["chat", "code", "reasoning"], source: "local", slug: "mistralai/mistral-7b-instruct-v0.3", stars: 890, lastUpdated: "1 month ago", arch: "mistral", domain: "llm", format: "GGUF", readmeTitle: "Mistral 7B Instruct v0.3", readmePreview: "The Mistral 7B Instruct model outperforms Llama 2 13B on many benchmarks.", variants: [{ id: "q4", label: "Mistral 7B Instruct Q4_K_M", size: "4.4 GB" }], gpuOffload: true, kind: "llm" },
  { id: "phi-4-mini", name: "Phi-4 Mini Instruct", author: "Microsoft", params: "3.8B", size: "2.2 GB", quant: "Q6_K", downloads: "890K", description: "Small but powerful model for code and math.", tags: ["code", "math", "compact"], abilities: ["chat", "code", "reasoning"], source: "local", slug: "microsoft/phi-4-mini-instruct", stars: 312, lastUpdated: "3 days ago", arch: "phi", domain: "llm", format: "GGUF", variants: [{ id: "q6", label: "Phi-4 Mini Q6_K", size: "2.2 GB" }], gpuOffload: true, kind: "llm" },
  { id: "gpt-4o", name: "GPT-4o", author: "OpenAI", params: "-", size: "-", quant: "-", downloads: "—", description: "OpenAI's flagship multimodal model via API.", tags: ["chat", "trending"], abilities: ["chat", "vision", "tool", "reasoning", "code"], source: "api", slug: "openai/gpt-4o", stars: 12000, lastUpdated: "1 week ago", domain: "llm", format: "API", readmeTitle: "GPT-4o", readmePreview: "GPT-4o is our flagship multimodal model, available through the OpenAI API.", kind: "llm" },
  { id: "claude-3.5", name: "Claude 3.5 Sonnet", author: "Anthropic", params: "-", size: "-", quant: "-", downloads: "—", description: "Anthropic's advanced reasoning model via API.", tags: ["reasoning", "chat"], abilities: ["chat", "vision", "tool", "reasoning", "code"], source: "api", slug: "anthropic/claude-3-5-sonnet", stars: 5600, lastUpdated: "4 days ago", domain: "llm", format: "API", readmeTitle: "Claude 3.5 Sonnet", readmePreview: "Claude 3.5 Sonnet raises the bar for intelligence and speed.", kind: "llm" },
  { id: "gemma-3-4b", name: "Gemma 3 4B Instruct", author: "Google", params: "4B", size: "2.8 GB", quant: "Q5_K_M", downloads: "750K", description: "Lightweight capable model from Google.", tags: ["chat", "compact"], abilities: ["chat", "vision"], source: "cloud", slug: "google/gemma-3-4b-it", stars: 210, lastUpdated: "6 days ago", arch: "gemma3", domain: "llm", format: "GGUF", variants: [{ id: "q5", label: "Gemma 3 4B Q5_K_M", size: "2.8 GB" }], gpuOffload: true, kind: "llm" },
  { id: "bge-m3", name: "BGE M3", author: "BAAI", params: "568M", size: "1.1 GB", quant: "F16", downloads: "18.2K", description: "Multi-functional, multi-lingual embedding model.", tags: ["embedding", "compact"], abilities: ["chat"], source: "local", slug: "baai/bge-m3", stars: 412, lastUpdated: "1 week ago", arch: "bert", domain: "embedding", format: "GGUF", readmeTitle: "BGE M3", readmePreview: "BGE-M3 is a multi-lingual embedding model supporting dense, sparse, and multi-vector retrieval.", variants: [{ id: "f16", label: "BGE M3 F16", size: "1.1 GB" }], gpuOffload: true, kind: "embedding" },
];

export const CAPABILITY_FILTERS = ["All", "Reasoning", "Trending", "Vision", "Code", "Tool"] as const;
export const KIND_FILTERS = ["All", "LLMs", "Text Embedding"] as const;
export type CapabilityFilter = (typeof CAPABILITY_FILTERS)[number];
export type KindFilter = (typeof KIND_FILTERS)[number];

export function modelKind(m: ModelInfo): "llm" | "embedding" {
  return m.kind ?? "llm";
}

export function matchesDiscoverKind(m: ModelInfo, f: KindFilter): boolean {
  if (f === "All") return true;
  if (f === "LLMs") return modelKind(m) === "llm";
  if (f === "Text Embedding") return modelKind(m) === "embedding";
  return true;
}

export function matchesDiscoverCapability(m: ModelInfo, f: CapabilityFilter): boolean {
  if (f === "All") return true;
  if (f === "Trending") return m.tags.some((t) => t.toLowerCase() === "trending");
  if (f === "Code") return m.abilities.includes("code") || m.tags.some((t) => t.toLowerCase() === "code");
  if (f === "Reasoning") return m.abilities.includes("reasoning");
  if (f === "Vision") return m.abilities.includes("vision");
  if (f === "Tool") return m.abilities.includes("tool");
  return true;
}

export function parseSizeInGB(size: string): number | null {
  if (!size || size === "-" || size.trim() === "") return null;
  const match = size.match(/([\d.]+)\s*(GB|MB|TB)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (Number.isNaN(value)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "GB") return value;
  if (unit === "MB") return value / 1024;
  if (unit === "TB") return value * 1024;
  return null;
}

export function supportsGpuOffloadBySize(size: string): boolean {
  const gb = parseSizeInGB(size);
  if (gb === null) return false;
  return gb <= 4.0;
}

export const sourceIcon = (source: ModelSource) => {
  switch (source) {
    case "local": return HardDrive;
    case "cloud": return Cloud;
    case "api": return Globe;
  }
};

export const sourceLabel = (source: ModelSource) => {
  switch (source) {
    case "local": return { text: "Local", className: "bg-status-online/10 text-status-online" };
    case "cloud": return { text: "Cloud", className: "bg-primary/10 text-primary" };
    case "api": return { text: "API", className: "bg-status-downloading/10 text-status-downloading" };
  }
};

export function detailHeaderName(m: ModelInfo): string {
  return m.slug ?? `${m.author.toLowerCase().replace(/\s+/g, "")}/${m.id}`;
}
