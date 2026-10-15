import { motion } from "framer-motion";
import { Cpu, Check, Download, ChevronRight, RefreshCw } from "lucide-react";
import { ABILITY_CONFIG, type ModelInfo } from "@/pages/discover/discoverData";

const sourceLabel = (source: ModelInfo["source"]) => {
  switch (source) {
    case "local": return { text: "Local", className: "bg-status-online/10 text-status-online" };
    case "cloud": return { text: "Cloud", className: "bg-primary/10 text-primary" };
    case "api":   return { text: "API",   className: "bg-status-downloading/10 text-status-downloading" };
  }
};

type Props = {
  models: ModelInfo[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (m: ModelInfo) => void;
  onDownload: (m: ModelInfo) => void;
};

export default function ModelList({ models, isLoading, selectedId, onSelect, onDownload }: Props) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <RefreshCw className="w-5 h-5 text-muted-foreground/50 animate-spin" />
        <p className="text-[11px] text-muted-foreground">Loading models...</p>
      </div>
    );
  }

  if (models.length === 0) {
    return <p className="text-[11px] text-muted-foreground text-center py-8 px-2">No models match these filters.</p>;
  }

  return (
    <div className="space-y-1">
      {models.map((model, i) => {
        const sl = sourceLabel(model.source);
        const selected = selectedId === model.id;
        return (
          <motion.div
            key={model.id}
            role="button"
            tabIndex={0}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => onSelect(model)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(model); } }}
            className={`w-full text-left bg-model-card border rounded-lg px-2.5 py-2 transition-colors group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selected ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/25"}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Cpu className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-xs font-semibold text-foreground group-hover:text-primary/90 transition-colors">{model.name}</h3>
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 ${sl.className}`}>
                    {sl.text}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-1 line-clamp-1">{model.description}</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {model.abilities.map((ability) => {
                    const cfg = ABILITY_CONFIG[ability];
                    const Icon = cfg.icon;
                    return (
                      <span key={ability} className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[8px] font-medium ${cfg.className}`} title={cfg.label}>
                        <Icon className="w-2.5 h-2.5" />
                        {cfg.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {model.isDownloaded ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary text-[10px] font-medium" onClick={(e) => e.stopPropagation()}>
                    <Check className="w-3 h-3" /> Done
                  </div>
                ) : model.isDownloading ? (
                  <div className="w-20" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-0.5">
                      <span>{Math.round(model.downloadProgress || 0)}%</span>
                    </div>
                    <div className="h-1 bg-secondary rounded-full overflow-hidden">
                      <motion.div className="h-full bg-primary rounded-full" style={{ width: `${model.downloadProgress || 0}%` }} />
                    </div>
                  </div>
                ) : model.source === "local" ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onDownload(model); }}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:opacity-90 transition-opacity">
                    <Download className="w-3 h-3" /> Get
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground">API</span>
                )}
                <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground/50 group-hover:text-muted-foreground"}`} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
