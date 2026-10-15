import { useState, useEffect } from "react";
import { Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  matchesDiscoverKind, matchesDiscoverCapability,
  type ModelInfo, type CapabilityFilter, type KindFilter,
} from "@/pages/discover/discoverData";
import DiscoverFilters from "@/components/discover/DiscoverFilters";
import ModelList from "@/components/discover/ModelList";
import ModelDetail from "@/components/discover/ModelDetail";
import type { DownloadItem } from "@/hooks/useDownloadManager";

type Props = {
  onStartDownload?: (item: Omit<DownloadItem, "status" | "progress" | "bytesReceived" | "totalBytes" | "speedBps">) => void;
};

export default function DiscoverPage({ onStartDownload }: Props) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [capFilter, setCapFilter] = useState<CapabilityFilter>("All");
  const [kindFilter, setKindFilter] = useState<KindFilter>("All");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchTick, setFetchTick] = useState(0);
  const [detailModel, setDetailModel] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchModels() {
      setIsLoading(true);
      try {
        const res = await fetch(
          "https://huggingface.co/api/models?filter=gguf&sort=downloads&limit=30&full=true",
          { signal: AbortSignal.timeout(10000) }
        );
        if (!res.ok) throw new Error(`HF API ${res.status}`);
        const data: Array<{
          modelId?: string;
          tags?: string[];
          downloads?: number;
          description?: string;
          likes?: number;
          lastModified?: string;
        }> = await res.json();
        if (cancelled) return;
        const mapped: ModelInfo[] = data.map((m) => {
          const parts = (m.modelId as string).split("/");
          const author = parts.length > 1 ? parts[0] : "Unknown";
          const name = parts.length > 1 ? parts[1] : parts[0];
          const tags: string[] = m.tags ?? [];
          const abilities: ModelInfo["abilities"] = [];
          if (tags.some((t: string) => /vision|image|multimodal/i.test(t))) abilities.push("vision");
          if (tags.some((t: string) => /tool|function/i.test(t))) abilities.push("tool");
          if (tags.some((t: string) => /reasoning|think/i.test(t))) abilities.push("reasoning");
          if (tags.some((t: string) => /code|coding/i.test(t))) abilities.push("code");
          abilities.push("chat");
          const isEmbedding = tags.some((t: string) => /embed/i.test(t));
          return {
            id: m.modelId as string,
            name: name.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
            author,
            params: "-",
            size: "-",
            quant: "GGUF",
            downloads: m.downloads != null ? Number(m.downloads).toLocaleString() : "—",
            description: m.description ?? `${name} — GGUF quantized model available for local inference.`,
            tags,
            abilities,
            source: "local" as ModelInfo["source"],
            slug: m.modelId as string,
            stars: m.likes ?? undefined,
            lastUpdated: m.lastModified ? new Date(m.lastModified).toLocaleDateString() : undefined,
            format: "GGUF",
            kind: isEmbedding ? "embedding" : "llm",
          };
        });
        setModels(mapped);
      } catch {
        if (!cancelled) {
          toast({ title: "Could not load models", description: "Check your internet connection.", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchModels();
    return () => { cancelled = true; };
  }, [fetchTick]);

  const filteredModels = models.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.author.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch && matchesDiscoverKind(m, kindFilter) && matchesDiscoverCapability(m, capFilter);
  });

  const liveDetail = detailModel ? models.find((m) => m.id === detailModel.id) ?? detailModel : null;

  const handleDownloadFromList = (model: ModelInfo) => {
    setDetailModel(model);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-row">
        {/* List column */}
        <div className="w-[min(42vw,420px)] min-w-[260px] max-w-[480px] shrink-0 border-r border-border flex flex-col bg-background">
          <DiscoverFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            capFilter={capFilter}
            onCapFilterChange={setCapFilter}
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            isLoading={isLoading}
            onRefresh={() => setFetchTick(t => t + 1)}
          />
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-4">
            <ModelList
              models={filteredModels}
              isLoading={isLoading}
              selectedId={detailModel?.id ?? null}
              onSelect={setDetailModel}
              onDownload={handleDownloadFromList}
            />
          </div>
        </div>

        {/* Detail column */}
        <div className="flex-1 min-w-0 flex flex-col bg-background min-h-0 border-l border-border/60">
          {liveDetail ? (
            <ModelDetail
              model={liveDetail}
              onStartDownload={onStartDownload ?? (() => toast({ title: "Download manager not available" }))}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 min-h-0">
              <Cpu className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">Model details</p>
              <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">Choose a model from the list to see metadata, capabilities, downloads, and README.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
