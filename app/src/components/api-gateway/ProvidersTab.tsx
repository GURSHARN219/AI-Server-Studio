import React, { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Check, X, Globe, AlertTriangle, Loader2, ChevronsUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Toggle } from "@/components/settings/Primitives";
import {
  createBackendProvider,
  deleteBackendProvider,
  fetchBackendProviderModels,
  listBackendProviders,
  type BackendProvider,
  updateBackendProvider,
} from "@/lib/api";
import {
  getProviderModelPref,
  loadProviderModelPrefs,
  persistProviderModelPrefsToBackend,
  saveProviderModelPrefs,
  syncProviderModelPrefsFromBackend,
  type ModelCapability,
} from "@/lib/providerModelPrefs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

type DbProvider = BackendProvider;
type ModelSelectionRow = {
  id: string;
  providerId: string;
  modelId: string;
  modelType: ModelCapability;
};

const PROVIDER_PRESETS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
};

const MODEL_TYPES: ModelCapability[] = ["chat", "image", "stt", "tts", "video"];

function dedupeModelSelections(rows: ModelSelectionRow[]): ModelSelectionRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.providerId}::${row.modelId}::${row.modelType}`;
    if (!row.providerId || !row.modelId) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ProvidersTab() {
  const { toast } = useToast();
  const [dbProviders, setDbProviders] = useState<DbProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [brokenKeyIds, setBrokenKeyIds] = useState<Set<string>>(new Set());
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderType, setNewProviderType] = useState("openai");
  const [newProviderUrl, setNewProviderUrl] = useState("https://api.openai.com/v1");
  const [newProviderKey, setNewProviderKey] = useState("");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<DbProvider> & { rawKey?: string }>({});
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [loadingModelsFor, setLoadingModelsFor] = useState<string | null>(null);
  const [modelSelections, setModelSelections] = useState<ModelSelectionRow[]>([]);
  const [openProviderPicker, setOpenProviderPicker] = useState(false);
  const [openModelPicker, setOpenModelPicker] = useState(false);
  const [draftProviderId, setDraftProviderId] = useState("");
  const [draftModelId, setDraftModelId] = useState("");
  const [draftModelType, setDraftModelType] = useState<ModelCapability>("chat");

  const hydrateModelPrefs = useCallback((providers: DbProvider[]) => {
    const nextSelections: ModelSelectionRow[] = [];
    for (const p of providers) {
      const pref = getProviderModelPref(p.id);
      const rows = (pref?.selections && pref.selections.length > 0)
        ? pref.selections
        : (pref?.allowedModels ?? []).map((modelId) => ({ modelId, modelType: "chat" as const }));

      for (const row of rows) {
        nextSelections.push({
          id: `${p.id}:${row.modelId}:${row.modelType}`,
          providerId: p.id,
          modelId: row.modelId,
          modelType: row.modelType,
        });
      }
    }
    setModelSelections(dedupeModelSelections(nextSelections));
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      await syncProviderModelPrefsFromBackend();
      const data = await listBackendProviders();
      setDbProviders(data as DbProvider[]);
      hydrateModelPrefs(data as DbProvider[]);
      const broken = new Set<string>();
      setBrokenKeyIds(broken);
    } catch (error) {
      toast({ title: "Failed to load providers", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    }
    setLoadingProviders(false);
  }, [hydrateModelPrefs, toast]);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const handleAddProvider = async () => {
    if (!newProviderName.trim()) return;
    const baseUrl = newProviderUrl.trim() || PROVIDER_PRESETS[newProviderType] || "";
    if (!baseUrl) {
      toast({ title: "Base URL required", description: "Enter the API base URL for this provider.", variant: "destructive" });
      return;
    }
    try {
      await createBackendProvider({
        name: newProviderName.trim(),
        provider_type: newProviderType,
        base_url: baseUrl,
        api_key: newProviderKey,
        enabled: true,
      });
      toast({ title: "Provider added" });
      setNewProviderName("");
      setNewProviderUrl("https://api.openai.com/v1");
      setNewProviderKey("");
      setNewProviderType("openai");
      setShowAddProvider(false);
      await fetchProviders();
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Unable to add provider", variant: "destructive" });
    }
  };

  const handleDeleteProvider = async (id: string) => {
    await deleteBackendProvider(id);
    await fetchProviders();
    toast({ title: "Provider deleted" });
  };
  const handleToggleProvider = async (id: string, enabled: boolean) => {
    await updateBackendProvider(id, { enabled: !enabled });
    await fetchProviders();
  };
  const startEdit = (provider: DbProvider) => { setEditingProvider(provider.id); setEditValues({ name: provider.name, base_url: provider.base_url, provider_type: provider.provider_type, rawKey: "" }); };

  const saveEdit = async (id: string) => {
    const updates: Partial<Pick<BackendProvider, "name" | "provider_type" | "base_url" | "api_key" | "enabled">> = {};
    if (editValues.name) updates.name = editValues.name;
    if (editValues.base_url) updates.base_url = editValues.base_url;
    if (editValues.provider_type) updates.provider_type = editValues.provider_type;
    if (editValues.rawKey) updates.api_key = editValues.rawKey;
    await updateBackendProvider(id, updates);
    setEditingProvider(null); setEditValues({}); await fetchProviders(); toast({ title: "Provider updated" });
  };

  const fetchProviderModels = useCallback(async (provider: DbProvider, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setLoadingModelsFor(provider.id);
    try {
      const models = await fetchBackendProviderModels(provider.id);
      const names = models.map((m) => m.id).filter(Boolean);
      setProviderModels((prev) => ({ ...prev, [provider.id]: names }));
      if (!silent) {
        toast({ title: "Models loaded", description: `${names.length} model(s) from ${provider.name}` });
      }
    } catch (err) {
      if (!silent) {
        toast({
          title: "Model fetch failed",
          description: err instanceof Error ? err.message : "Unable to fetch models from provider API.",
          variant: "destructive",
        });
      }
    } finally {
      setLoadingModelsFor(null);
    }
  }, [toast]);

  const fetchModelsForProviderId = useCallback(async (providerId: string, options?: { silent?: boolean }) => {
    const provider = dbProviders.find((p) => p.id === providerId);
    if (!provider) return;
    await fetchProviderModels(provider, options);
  }, [dbProviders, fetchProviderModels]);

  useEffect(() => {
    const firstEnabled = dbProviders.find((p) => p.enabled) ?? dbProviders[0];
    if (!firstEnabled) return;
    if (!draftProviderId || !dbProviders.some((p) => p.id === draftProviderId)) {
      setDraftProviderId(firstEnabled.id);
      setDraftModelId("");
    }
  }, [dbProviders, draftProviderId]);

  useEffect(() => {
    if (!draftProviderId) return;
    if ((providerModels[draftProviderId] || []).length > 0) return;
    if (loadingModelsFor === draftProviderId) return;
    void fetchModelsForProviderId(draftProviderId, { silent: true });
  }, [draftProviderId, providerModels, loadingModelsFor, fetchModelsForProviderId]);

  const persistModelSelections = useCallback((rows: ModelSelectionRow[]) => {
    const grouped: Record<string, Array<{ modelId: string; modelType: ModelCapability }>> = {};
    for (const row of rows) {
      const providerId = row.providerId.trim();
      const modelId = row.modelId.trim();
      if (!providerId || !modelId) continue;
      if (!grouped[providerId]) grouped[providerId] = [];
      const exists = grouped[providerId].some((entry) => entry.modelId === modelId && entry.modelType === row.modelType);
      if (!exists) grouped[providerId].push({ modelId, modelType: row.modelType });
    }

    const nextPrefs = { ...loadProviderModelPrefs() };

    for (const provider of dbProviders) {
      const existing = getProviderModelPref(provider.id);
      const selections = grouped[provider.id] || [];
      const allowedModels = Array.from(new Set(selections.map((s) => s.modelId)));
      const keepDefault = existing?.defaultModel && allowedModels.includes(existing.defaultModel);
      const preferredDefault = selections.find((s) => s.modelType === "chat")?.modelId || allowedModels[0];

      nextPrefs[provider.id] = {
        allowedModels,
        defaultModel: keepDefault ? existing.defaultModel : preferredDefault,
        selections,
      };
    }

    // Save once to avoid racing backend writes that can overwrite newer rows.
    saveProviderModelPrefs(nextPrefs);
    persistProviderModelPrefsToBackend(nextPrefs);

  }, [dbProviders]);

  const saveCurrentModelSelection = () => {
    const providerId = draftProviderId.trim();
    const modelId = draftModelId.trim();
    if (!providerId || !modelId) {
      toast({ title: "Missing fields", description: "Select API name, model, and type.", variant: "destructive" });
      return;
    }

    const exists = modelSelections.some(
      (row) => row.providerId === providerId && row.modelId === modelId && row.modelType === draftModelType
    );
    if (exists) {
      toast({ title: "Already saved", description: "This model selection already exists." });
      return;
    }

    const next = dedupeModelSelections([
      ...modelSelections,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        providerId,
        modelId,
        modelType: draftModelType,
      },
    ]);
    setModelSelections(next);
    persistModelSelections(next);
    toast({ title: "Model saved", description: "Saved model to API settings." });
  };

  const removeSavedModelSelection = (rowId: string) => {
    const next = modelSelections.filter((row) => row.id !== rowId);
    setModelSelections(next);
    persistModelSelections(next);
    toast({ title: "Model removed" });
  };

  const selectedProviderOptions = dbProviders.filter((p) => p.enabled);
  const draftModelOptions = providerModels[draftProviderId] || [];
  const draftProvider = dbProviders.find((p) => p.id === draftProviderId);

  const selectedModelCount = modelSelections.reduce((acc, row) => {
    return row.providerId && row.modelId ? acc + 1 : acc;
  }, 0);

  const dedupedRows = useCallback(() => {
    return dedupeModelSelections(modelSelections);
  }, [modelSelections]);

  const selectedModelCards = dedupedRows().filter((row) => row.providerId && row.modelId);

  const providerNameById = useCallback((id: string) => {
    return dbProviders.find((p) => p.id === id)?.name || "Provider";
  }, [dbProviders]);

  const providerTypeById = useCallback((id: string) => {
    return dbProviders.find((p) => p.id === id)?.provider_type || "custom";
  }, [dbProviders]);

  useEffect(() => {
    const next = dedupedRows();
    if (next.length !== modelSelections.length) {
      setModelSelections(next);
    }
  }, [dedupedRows, modelSelections.length]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">API Provider</h2>
        <button onClick={() => setShowAddProvider(true)} className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors">
          <Plus className="w-3 h-3" /> Save API
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">Configure API providers. Keys are encrypted and saved to your account.</p>

      {showAddProvider && (
        <div className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">New Provider</p>
          <input value={newProviderName} onChange={(e) => setNewProviderName(e.target.value)} placeholder="API name (e.g. My OpenAI Key)" className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <select value={newProviderType} onChange={(e) => { setNewProviderType(e.target.value); setNewProviderUrl(PROVIDER_PRESETS[e.target.value] || ""); }} className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50 appearance-none cursor-pointer">
            <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google AI</option><option value="mistral">Mistral AI</option><option value="groq">Groq</option><option value="together">Together AI</option><option value="openrouter">OpenRouter</option><option value="custom">Custom</option>
          </select>
          <input value={newProviderUrl} onChange={(e) => setNewProviderUrl(e.target.value)} placeholder="Base URL" className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <input value={newProviderKey} onChange={(e) => setNewProviderKey(e.target.value)} placeholder="API Key (optional)" type="password" className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAddProvider} className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors">Save API</button>
            <button onClick={() => setShowAddProvider(false)} className="px-3 py-1 rounded bg-surface-hover text-foreground text-xs hover:bg-surface-active transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loadingProviders && <p className="text-[10px] text-muted-foreground">Loading...</p>}
        {!loadingProviders && dbProviders.length === 0 && (
          <div className="border border-border rounded-lg p-6 text-center">
            <Globe className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No providers configured</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Add a provider to connect to cloud LLMs</p>
          </div>
        )}
        {dbProviders.map((provider) => (
          <div key={provider.id} className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
            {editingProvider === provider.id ? (
              <div className="space-y-2">
                <input value={editValues.name || ""} onChange={(e) => setEditValues(v => ({ ...v, name: e.target.value }))} className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50" />
                <input value={editValues.base_url || ""} onChange={(e) => setEditValues(v => ({ ...v, base_url: e.target.value }))} className="w-full bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground font-mono focus:outline-none focus:border-primary/50" />
                <input value={editValues.rawKey || ""} onChange={(e) => setEditValues(v => ({ ...v, rawKey: e.target.value }))} type="password" placeholder="New API Key (leave empty to keep current)" className="w-full bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" />
                <div className="flex items-center gap-1.5">
                  <button onClick={() => saveEdit(provider.id)} className="p-1 text-status-online hover:bg-status-online/10 rounded transition-colors"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEditingProvider(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">{provider.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{provider.provider_type}</span>
                      {provider.has_key && !brokenKeyIds.has(provider.id) && <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-online/10 text-status-online font-medium">Key Set</span>}
                    {brokenKeyIds.has(provider.id) && (
                      <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium" title="API key can't be decrypted — re-enter it in edit mode">
                        <AlertTriangle className="w-2.5 h-2.5" /> Key Lost
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => startEdit(provider)} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3 h-3" /></button>
                    <Toggle value={provider.enabled} onChange={() => handleToggleProvider(provider.id, provider.enabled)} />
                    <button onClick={() => handleDeleteProvider(provider.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{provider.base_url}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-border/60 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Model Selection</h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Choose API name, model, and type, then save in one line.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_.9fr_auto] gap-2 items-center rounded-lg border border-border/60 bg-background/60 p-2">
          <Popover open={openProviderPicker} onOpenChange={setOpenProviderPicker}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "h-9 w-full rounded border border-border bg-background px-2 text-xs",
                  "text-foreground flex items-center justify-between",
                  "focus:outline-none focus:ring-1 focus:ring-primary/40"
                )}
              >
                <span className="truncate text-left">{draftProvider?.name || "API Name"}</span>
                <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-[var(--radix-popover-trigger-width)] p-0">
              <Command>
                <CommandInput placeholder="Search API name..." className="h-9 text-xs" />
                <CommandList className="max-h-56 scrollbar-styled pr-1">
                  <CommandEmpty>No API provider found.</CommandEmpty>
                  {selectedProviderOptions.map((provider) => (
                    <CommandItem
                      key={provider.id}
                      value={`${provider.name} ${provider.provider_type}`}
                      onSelect={() => {
                        setDraftProviderId(provider.id);
                        setDraftModelId("");
                        setOpenProviderPicker(false);
                        void fetchModelsForProviderId(provider.id, { silent: true });
                      }}
                      className="text-xs"
                    >
                      <Globe className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate">{provider.name}</span>
                      <Check className={cn("h-3.5 w-3.5", draftProviderId === provider.id ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Popover open={openModelPicker} onOpenChange={setOpenModelPicker}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={!draftProviderId}
                className={cn(
                  "h-9 w-full rounded border border-border bg-background px-2 text-xs",
                  "text-foreground flex items-center justify-between font-mono",
                  "focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
                )}
              >
                <span className="truncate text-left">
                  {loadingModelsFor === draftProviderId ? "Loading models..." : (draftModelId || "Model")}
                </span>
                {loadingModelsFor === draftProviderId
                  ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
                  : <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-[var(--radix-popover-trigger-width)] p-0">
              <Command>
                <CommandInput placeholder="Search model..." className="h-9 text-xs" />
                <CommandList className="max-h-64 scrollbar-styled pr-1">
                  <CommandEmpty>No models found.</CommandEmpty>
                  {draftModelOptions.map((model) => (
                    <CommandItem
                      key={`${draftProviderId}-${model}`}
                      value={model}
                      onSelect={() => {
                        setDraftModelId(model);
                        setOpenModelPicker(false);
                      }}
                      className="text-xs"
                    >
                      <Globe className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                      <span className="flex-1 truncate font-mono">{model}</span>
                      <Check className={cn("h-3.5 w-3.5", draftModelId === model ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <select
            value={draftModelType}
            onChange={(e) => setDraftModelType(e.target.value as ModelCapability)}
            className="h-9 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            {MODEL_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={saveCurrentModelSelection}
            className="h-9 px-3 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            Save Model
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Saved Models</p>
          {selectedModelCards.length === 0 && (
            <div className="rounded border border-border/60 bg-background/70 p-2.5 text-[11px] text-muted-foreground">
              No saved models yet.
            </div>
          )}
          {selectedModelCards.map((row) => (
            <div key={`saved-${row.id}`} className="flex items-center gap-2 rounded border border-border/60 bg-background/70 p-2">
              <span className="inline-flex items-center rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-foreground shrink-0">
                {providerTypeById(row.providerId)}
              </span>
              <span className="inline-flex items-center rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] text-foreground shrink-0">
                {providerNameById(row.providerId)}
              </span>
              <span className="inline-flex min-w-0 items-center rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-mono text-foreground truncate flex-1">
                {row.modelId}
              </span>
              <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                {row.modelType}
              </span>
              <button
                type="button"
                onClick={() => removeSavedModelSelection(row.id)}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                aria-label="Remove saved model"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end">
          <p className="text-[10px] text-muted-foreground">Saved: {selectedModelCount} model(s)</p>
        </div>
      </div>
    </div>
  );
}
