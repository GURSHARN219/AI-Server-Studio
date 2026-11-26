import { Layers, RefreshCw } from "lucide-react";
import { type FetchedModel } from "@/lib/api";

type Props = {
  models: FetchedModel[];
  isFetching: boolean;
  onRefresh: () => void;
};

export function LoadedModelsPanel({ models, isFetching, onRefresh }: Props) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between bg-secondary/20 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-accent/30 flex items-center justify-center">
            <Layers className="w-3 h-3 text-accent-foreground" />
          </div>
          <span className="text-[11px] font-semibold text-foreground">Loaded Models</span>
          <span className="text-[9px] text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">{models.length}</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={isFetching}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-surface-hover disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      {models.length === 0 ? (
        <div className="px-3 py-5 text-center">
          <Layers className="w-4 h-4 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-[11px] text-muted-foreground">No models loaded</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">Load a model from My Models</p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {models.map((m) => (
            <div key={m.id} className="px-3 py-1.5 flex items-center justify-between hover:bg-surface-hover/50 transition-colors">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground font-mono truncate">{m.id}</p>
                {m.owned_by && <p className="text-[9px] text-muted-foreground leading-tight">by {m.owned_by}</p>}
              </div>
              {m.supported_parameters && m.supported_parameters.length > 0 && (
                <div className="flex gap-0.5 shrink-0 ml-2">
                  {m.supported_parameters.slice(0, 3).map(p => (
                    <span key={p} className="text-[8px] px-1 py-px rounded border border-border/60 bg-secondary/40 text-muted-foreground font-mono">{p}</span>
                  ))}
                  {m.supported_parameters.length > 3 && (
                    <span className="text-[8px] px-1 py-px rounded border border-border/60 bg-secondary/40 text-muted-foreground">
                      +{m.supported_parameters.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
