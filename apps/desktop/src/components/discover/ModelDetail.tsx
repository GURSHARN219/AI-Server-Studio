import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Download, Star, Sparkles, ExternalLink, Package, FileText,
  Rocket, ChevronDown, Bot, Copy, Check, Cpu, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ABILITY_CONFIG, supportsGpuOffloadBySize, detailHeaderName,
  type ModelInfo, type DownloadVariant,
} from "@/pages/discover/discoverData";
import { fetchHfGgufFiles, hfDownloadUrl, type DownloadItem } from "@/hooks/useDownloadManager";

type Props = {
  model: ModelInfo;
  onStartDownload: (item: Omit<DownloadItem, "status" | "progress" | "bytesReceived" | "totalBytes" | "speedBps">) => void;
};

export default function ModelDetail({ model, onStartDownload }: Props) {
  const { toast } = useToast();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [ggufFiles, setGgufFiles] = useState<{ filename: string; size: number }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch real GGUF files from HF when model changes
  useEffect(() => {
    if (!model.slug || model.source !== "local") return;
    let cancelled = false;
    setLoadingFiles(true);
    setGgufFiles([]);
    setVariantId(null);
    fetchHfGgufFiles(model.slug).then((files) => {
      if (cancelled) return;
      setGgufFiles(files);
      if (files.length > 0) setVariantId(files[0].filename);
      setLoadingFiles(false);
    });
    return () => { cancelled = true; };
  }, [model.slug, model.source]);

  const selectedFile = ggufFiles.find(f => f.filename === variantId) ?? ggufFiles[0];

  // Fall back to static variants if HF fetch returned nothing
  const hasRealFiles = ggufFiles.length > 0;
  const staticVariants: DownloadVariant[] = model.variants ?? [];
  const selectedStaticVariant = staticVariants.find(v => v.id === variantId) ?? staticVariants[0];

  const displaySize = hasRealFiles
    ? (selectedFile ? formatBytes(selectedFile.size) : "—")
    : (selectedStaticVariant?.size ?? model.size ?? "—");

  const modelsPath = (() => {
    try {
      const paths = getAccountSetting<{ modelsPath?: string }>("app:settings:paths", {});
      return paths.modelsPath ?? "";
    } catch { return ""; }
  })();

  const handleDownload = () => {
    if (!model.slug) return;
    if (hasRealFiles && selectedFile) {
      onStartDownload({
        id: `${model.slug}::${selectedFile.filename}`,
        modelId: model.slug,
        filename: selectedFile.filename,
        displayName: `${model.name} — ${selectedFile.filename}`,
        url: hfDownloadUrl(model.slug, selectedFile.filename),
        destDir: modelsPath,
      });
    } else if (staticVariants.length > 0 && selectedStaticVariant) {
      const filename = `${selectedStaticVariant.label}.gguf`;
      onStartDownload({
        id: `${model.slug}::${selectedStaticVariant.id}`,
        modelId: model.slug,
        filename,
        displayName: `${model.name} — ${selectedStaticVariant.label}`,
        url: hfDownloadUrl(model.slug, filename),
        destDir: modelsPath,
      });
    } else {
      toast({ title: "No downloadable file found", variant: "destructive" });
      return;
    }
    toast({ title: "Download started", description: "Check the downloads panel for progress." });
  };

  const copySlug = async () => {
    const t = detailHeaderName(model);
    try {
      await navigator.clipboard.writeText(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Copied", description: t });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const gpuOffload = supportsGpuOffloadBySize(displaySize) || !!model.gpuOffload;

  return (
    <>
      <div className="shrink-0 px-4 py-3 flex items-start gap-3 border-b border-border/80 bg-background">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Bot className="w-[18px] h-[18px] text-foreground/80" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-1 min-w-0">
            <h2 className="text-[13px] font-semibold text-foreground font-mono truncate tracking-tight">{detailHeaderName(model)}</h2>
            <button type="button" onClick={copySlug} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0" title="Copy id">
              {copied ? <Check className="w-3.5 h-3.5 text-status-online" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{model.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Download className="w-3 h-3 opacity-70" />{model.downloads} downloads</span>
            {model.stars != null && (<><span className="text-border">·</span><span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3 text-amber-500/80" />{model.stars}</span></>)}
            {model.lastUpdated && (<><span className="text-border">·</span><span>Updated {model.lastUpdated}</span></>)}
            {model.staffPick && (<><span className="text-border">·</span><span className="inline-flex items-center gap-0.5 text-violet-400"><Sparkles className="w-3 h-3" />Staff pick<ExternalLink className="w-2.5 h-2.5 opacity-60" /></span></>)}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-5 min-h-0">
        <p className="text-[12px] text-muted-foreground leading-relaxed pl-3 border-l-2 border-primary/35">{model.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {model.params !== "-" && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-foreground/80">{model.params}</span>}
          {model.arch && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground">{model.arch}</span>}
          {model.domain && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{model.domain}</span>}
          {model.format && <span className="text-[10px] px-2 py-0.5 rounded-full ring-1 ring-primary/25 text-primary font-medium">{model.format}</span>}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/90 font-medium mb-2">Capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            {model.abilities.map((ability) => {
              const cfg = ABILITY_CONFIG[ability];
              const Icon = cfg.icon;
              return (
                <span key={ability} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium ${cfg.className}`}>
                  <Icon className="w-3 h-3 shrink-0 opacity-90" />{cfg.label}
                </span>
              );
            })}
          </div>
        </div>

        {model.source === "local" && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <Package className="w-3.5 h-3.5 text-foreground/60" /> Download
            </div>

            {model.isDownloaded && (
              <div className="flex items-start gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>A build is already installed. Pick another quantization below to download an additional variant.</span>
              </div>
            )}

            {loadingFiles ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Fetching available files from HuggingFace...
              </div>
            ) : hasRealFiles ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <select
                    value={variantId ?? ggufFiles[0]?.filename ?? ""}
                    onChange={(e) => setVariantId(e.target.value)}
                    className="w-full appearance-none bg-secondary border border-border rounded-md pl-2.5 pr-9 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring/40"
                  >
                    {ggufFiles.map((f) => (
                      <option key={f.filename} value={f.filename}>
                        {f.filename} — {formatBytes(f.size)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </div>
                <button type="button" onClick={handleDownload}
                  className="flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border bg-muted/60 text-foreground text-[11px] font-medium hover:bg-muted transition-colors">
                  <Download className="w-3.5 h-3.5 opacity-80" /> Download
                </button>
              </div>
            ) : staticVariants.length > 0 ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <select
                    value={variantId ?? staticVariants[0].id}
                    onChange={(e) => setVariantId(e.target.value)}
                    className="w-full appearance-none bg-secondary border border-border rounded-md pl-2.5 pr-9 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring/40"
                  >
                    {staticVariants.map((v) => (
                      <option key={v.id} value={v.id}>{v.label} — {v.size}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </div>
                <button type="button" onClick={handleDownload}
                  className="flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border bg-muted/60 text-foreground text-[11px] font-medium hover:bg-muted transition-colors">
                  <Download className="w-3.5 h-3.5 opacity-80" /> Download
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-muted-foreground truncate min-w-0">{model.quant} · {model.size}</p>
                <button type="button" onClick={handleDownload}
                  className="flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border bg-muted/60 text-foreground text-[11px] font-medium hover:bg-muted transition-colors">
                  <Download className="w-3.5 h-3.5 opacity-80" /> Download ({displaySize})
                </button>
              </div>
            )}

            {gpuOffload && (
              <p className="text-[10px] text-emerald-500/90 flex items-center gap-1 justify-center">
                <Rocket className="w-3 h-3 shrink-0" /> GPU offload possible for selected variant
              </p>
            )}

            {model.isDownloading && (
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <motion.div className="h-full bg-foreground/35" style={{ width: `${model.downloadProgress || 0}%` }} />
              </div>
            )}
          </div>
        )}

        {(model.readmeTitle || model.readmePreview) && (
          <div className="rounded-md border border-border/60 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/25">
              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium text-foreground">README</span>
              {model.readmeTitle && <span className="text-[11px] text-muted-foreground truncate">· {model.readmeTitle}</span>}
            </div>
            {model.readmePreview && (
              <p className="px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed border-t border-border/40">{model.readmePreview}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
import { getAccountSetting } from "@/stores/accountState";
