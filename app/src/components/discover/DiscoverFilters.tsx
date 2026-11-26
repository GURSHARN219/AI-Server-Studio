import { Search, RefreshCw } from "lucide-react";
import { CAPABILITY_FILTERS, KIND_FILTERS, type CapabilityFilter, type KindFilter } from "@/pages/discover/discoverData";

type Props = {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  capFilter: CapabilityFilter;
  onCapFilterChange: (v: CapabilityFilter) => void;
  kindFilter: KindFilter;
  onKindFilterChange: (v: KindFilter) => void;
  isLoading: boolean;
  onRefresh: () => void;
};

export default function DiscoverFilters({
  searchQuery, onSearchChange,
  capFilter, onCapFilterChange,
  kindFilter, onKindFilterChange,
  isLoading, onRefresh,
}: Props) {
  return (
    <div className="px-3 pt-4 pb-2 shrink-0 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-foreground mb-0.5">Discover Models</h1>
          <p className="text-[10px] text-muted-foreground leading-snug">Browse and select a model for details</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-secondary border border-border rounded-md pl-7 pr-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
        />
      </div>

      <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin overscroll-x-contain py-0.5 scroll-pl-3 pl-0.5 -mx-0.5">
        {KIND_FILTERS.map((k) => (
          <button key={`kind-${k}`} type="button" onClick={() => onKindFilterChange(k)}
            className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors ${kindFilter === k ? "bg-muted text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
            {k}
          </button>
        ))}
        <span className="shrink-0 w-px h-3.5 bg-border/70 mx-1" aria-hidden />
        {CAPABILITY_FILTERS.map((cat) => (
          <button key={`cap-${cat}`} type="button" onClick={() => onCapFilterChange(cat)}
            className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors ${capFilter === cat ? "bg-muted text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
            {cat}
          </button>
        ))}
      </div>
    </div>
  );
}
