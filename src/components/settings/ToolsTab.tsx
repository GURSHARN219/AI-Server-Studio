import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Check, X, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loadToolConfigs, saveToolConfigs, type ToolConfig } from "@/lib/api";
import { Toggle } from "@/components/settings/Primitives";

export default function ToolsTab() {
  const { toast } = useToast();
  const [toolConfigs, setToolConfigs] = useState<ToolConfig[]>(() => loadToolConfigs());
  const [showAddTool, setShowAddTool] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolDesc, setNewToolDesc] = useState("");
  const [newToolSchema, setNewToolSchema] = useState('{\n  "type": "object",\n  "properties": {},\n  "required": []\n}');
  const [editingTool, setEditingTool] = useState<string | null>(null);
  const [editToolValues, setEditToolValues] = useState<{ name?: string; description?: string; schema?: string }>({});

  useEffect(() => { saveToolConfigs(toolConfigs); }, [toolConfigs]);

  const handleToggleTool = (id: string) => {
    setToolConfigs(prev => prev.map(t => t.id === id ? { ...t, enabled: !t.enabled } : t));
  };

  const handleAddCustomTool = () => {
    if (!newToolName.trim()) return;
    let schema: Record<string, unknown> = { type: "object", properties: {}, required: [] };
    if (newToolSchema.trim()) {
      try { schema = JSON.parse(newToolSchema); } catch { toast({ title: "Invalid schema JSON", variant: "destructive" }); return; }
    }
    const id = newToolName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setToolConfigs(prev => [...prev, {
      id, name: newToolName.trim(), source: "custom", enabled: true,
      description: newToolDesc.trim() || newToolName.trim(),
      inputSchema: schema,
      capabilities: [],
      layer: "api",
    }]);
    setNewToolName(""); setNewToolDesc(""); setNewToolSchema('{\n  "type": "object",\n  "properties": {},\n  "required": []\n}');
    setShowAddTool(false);
    toast({ title: "Tool added" });
  };

  const handleDeleteTool = (id: string) => {
    setToolConfigs(prev => prev.filter(t => t.id !== id));
    toast({ title: "Tool removed" });
  };

  const saveToolEdit = (id: string) => {
    setToolConfigs(prev => prev.map(t => {
      if (t.id !== id) return t;
      const updated = { ...t };
      if (editToolValues.name) updated.name = editToolValues.name;
      if (editToolValues.description) updated.description = editToolValues.description;
      if (editToolValues.schema) {
        try { updated.inputSchema = JSON.parse(editToolValues.schema); } catch { /* keep existing */ }
      }
      return updated;
    }));
    setEditingTool(null); setEditToolValues({});
    toast({ title: "Tool updated" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Tools</h2>
        <button
          onClick={() => setShowAddTool(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Custom Tool
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Manage built-in and custom tools available for AI models. Enabled tools are injected into chat completions when the model supports tool calling.
      </p>

      {showAddTool && (
        <div className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">New Custom Tool</p>
          <input
            value={newToolName}
            onChange={(e) => setNewToolName(e.target.value)}
            placeholder="Tool name (e.g. Weather Lookup)"
            className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <input
            value={newToolDesc}
            onChange={(e) => setNewToolDesc(e.target.value)}
            placeholder="Description (e.g. Get weather for a city)"
            className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Input Schema (JSON Schema)</p>
            <textarea
              value={newToolSchema}
              onChange={(e) => setNewToolSchema(e.target.value)}
              className="w-full h-28 bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAddCustomTool} className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors">Create</button>
            <button onClick={() => setShowAddTool(false)} className="px-3 py-1 rounded bg-surface-hover text-foreground text-xs hover:bg-surface-active transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {toolConfigs.map((tool) => (
          <div key={tool.id} className="bg-surface-hover border border-border rounded-lg p-3 space-y-1.5">
            {editingTool === tool.id ? (
              <div className="space-y-2">
                <input
                  value={editToolValues.name || ""}
                  onChange={(e) => setEditToolValues(v => ({ ...v, name: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
                />
                <input
                  value={editToolValues.description || ""}
                  onChange={(e) => setEditToolValues(v => ({ ...v, description: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
                />
                <textarea
                  value={editToolValues.schema || ""}
                  onChange={(e) => setEditToolValues(v => ({ ...v, schema: e.target.value }))}
                  className="w-full h-20 bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground font-mono focus:outline-none focus:border-primary/50 resize-none"
                />
                <div className="flex items-center gap-1.5">
                  <button onClick={() => saveToolEdit(tool.id)} className="p-1 text-status-online hover:bg-status-online/10 rounded transition-colors">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingTool(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">{tool.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${tool.source === "built-in" ? "bg-primary/10 text-primary" : "bg-status-downloading/10 text-status-downloading"}`}>
                      {tool.source}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setEditingTool(tool.id); setEditToolValues({ name: tool.name, description: tool.description || "", schema: JSON.stringify(tool.inputSchema || {}, null, 2) }); }}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <Toggle value={tool.enabled} onChange={() => handleToggleTool(tool.id)} />
                    {tool.source !== "built-in" && (
                      <button onClick={() => handleDeleteTool(tool.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">{tool.description}</p>
                {tool.capabilities && tool.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tool.capabilities.map((cap) => {
                      const isLocal = cap.startsWith("local:");
                      const isNet = cap.startsWith("net:");
                      const isCloud = cap.startsWith("cloud:");
                      const bgClass = isLocal
                        ? "bg-status-online/10 text-status-online border border-status-online/20"
                        : isNet
                          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                          : isCloud
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : "bg-muted text-muted-foreground border border-border";
                      return (
                        <span key={cap} className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${bgClass}`}>
                          {cap}
                        </span>
                      );
                    })}
                  </div>
                )}
                {tool.inputSchema && Object.keys((tool.inputSchema as any).properties || {}).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries((tool.inputSchema as any).properties || {}).map(([key, val]: [string, any]) => (
                      <span key={key} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        {key}: {val.type || "any"}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
