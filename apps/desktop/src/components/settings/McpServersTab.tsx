import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Globe, Pencil, Check, X, Server, Upload, Download, Loader2, Wifi, WifiOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  loadMcpServersFromDb,
  saveMcpServerToDb,
  updateMcpServerInDb,
  deleteMcpServerFromDb,
  discoverMcpTools,
  seedDefaultMcpServers,
  type McpServerConfig,
} from "@/lib/api";
import { Toggle } from "@/components/settings/Primitives";

export default function McpServersTab() {
  const { toast } = useToast();
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(true);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpHeaders, setNewMcpHeaders] = useState("");
  const [editingMcp, setEditingMcp] = useState<string | null>(null);
  const [editMcpValues, setEditMcpValues] = useState<{ name?: string; url?: string; headers?: string }>({});
  const [connectingMcp, setConnectingMcp] = useState<string | null>(null);
  const [showMcpImport, setShowMcpImport] = useState(false);
  const [mcpImportJson, setMcpImportJson] = useState("");

  const fetchMcpServers = useCallback(async () => {
    setLoadingMcp(true);
    await seedDefaultMcpServers();
    const servers = await loadMcpServersFromDb();
    setMcpServers(servers);
    setLoadingMcp(false);
  }, []);

  useEffect(() => { fetchMcpServers(); }, [fetchMcpServers]);

  const handleAddMcp = async () => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;
    let headers: Record<string, string> = {};
    if (newMcpHeaders.trim()) {
      try { headers = JSON.parse(newMcpHeaders); } catch { toast({ title: "Invalid headers JSON", variant: "destructive" }); return; }
    }
    const server = await saveMcpServerToDb({ name: newMcpName.trim(), url: newMcpUrl.trim(), headers, enabled: true });
    if (server) {
      toast({ title: "MCP server added" });
      setNewMcpName(""); setNewMcpUrl(""); setNewMcpHeaders(""); setShowAddMcp(false);
      await fetchMcpServers();
    } else {
      toast({ title: "Error adding server", variant: "destructive" });
    }
  };

  const handleDeleteMcp = async (id: string) => {
    await deleteMcpServerFromDb(id);
    await fetchMcpServers();
    toast({ title: "MCP server deleted" });
  };

  const handleToggleMcp = async (id: string, enabled: boolean) => {
    await updateMcpServerInDb(id, { enabled: !enabled });
    await fetchMcpServers();
  };

  const handleConnectMcp = async (server: McpServerConfig) => {
    setConnectingMcp(server.id);
    try {
      const tools = await discoverMcpTools(server);
      if (tools.length > 0) {
        await updateMcpServerInDb(server.id, { status: "connected" });
        toast({ title: `Connected! Found ${tools.length} tools`, description: tools.map(t => t.name).join(", ") });
      } else {
        await updateMcpServerInDb(server.id, { status: "disconnected" });
        toast({ title: "Connected but no tools found", description: "Server responded but returned no tools" });
      }
      await fetchMcpServers();
    } catch {
      toast({ title: "Connection failed", variant: "destructive" });
    }
    setConnectingMcp(null);
  };

  const saveMcpEdit = async (id: string) => {
    const updates: Partial<McpServerConfig> = {};
    if (editMcpValues.name) updates.name = editMcpValues.name;
    if (editMcpValues.url) updates.url = editMcpValues.url;
    if (editMcpValues.headers) {
      try { updates.headers = JSON.parse(editMcpValues.headers); } catch { toast({ title: "Invalid headers JSON", variant: "destructive" }); return; }
    }
    await updateMcpServerInDb(id, updates);
    setEditingMcp(null); setEditMcpValues({});
    await fetchMcpServers();
    toast({ title: "MCP server updated" });
  };

  const handleMcpExport = () => {
    const json = JSON.stringify(mcpServers.map(s => ({ name: s.name, url: s.url, headers: s.headers, enabled: s.enabled })), null, 2);
    navigator.clipboard.writeText(json);
    toast({ title: "Copied to clipboard" });
  };

  const handleMcpImport = async () => {
    try {
      const parsed = JSON.parse(mcpImportJson);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let added = 0;
      for (const item of items) {
        if (item.name && item.url) {
          await saveMcpServerToDb({ name: item.name, url: item.url, headers: item.headers || {}, enabled: item.enabled ?? true });
          added++;
        }
      }
      toast({ title: `Imported ${added} server(s)` });
      setMcpImportJson(""); setShowMcpImport(false);
      await fetchMcpServers();
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">MCP Servers</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleMcpExport}
            className="flex items-center gap-1 px-2 py-1 rounded bg-surface-hover text-muted-foreground text-[10px] hover:text-foreground transition-colors"
            title="Export JSON"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
          <button
            onClick={() => setShowMcpImport(!showMcpImport)}
            className="flex items-center gap-1 px-2 py-1 rounded bg-surface-hover text-muted-foreground text-[10px] hover:text-foreground transition-colors"
            title="Import JSON"
          >
            <Upload className="w-3 h-3" />
            Import
          </button>
          <button
            onClick={() => setShowAddMcp(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Server
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Connect to Model Context Protocol servers for external tool integration. Local servers connect directly; remote servers are proxied for security.
      </p>

      {showMcpImport && (
        <div className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Import from JSON</p>
          <textarea
            value={mcpImportJson}
            onChange={(e) => setMcpImportJson(e.target.value)}
            placeholder={'[\n  { "name": "My Server", "url": "http://localhost:3001/mcp" }\n]'}
            className="w-full h-24 bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
          />
          <div className="flex items-center gap-2">
            <button onClick={handleMcpImport} className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors">Import</button>
            <button onClick={() => { setShowMcpImport(false); setMcpImportJson(""); }} className="px-3 py-1 rounded bg-surface-hover text-foreground text-xs hover:bg-surface-active transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {showAddMcp && (
        <div className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">New MCP Server</p>
          <input
            value={newMcpName}
            onChange={(e) => setNewMcpName(e.target.value)}
            placeholder="Server name"
            className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <input
            value={newMcpUrl}
            onChange={(e) => setNewMcpUrl(e.target.value)}
            placeholder="URL (e.g. http://localhost:3001/mcp)"
            className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <input
            value={newMcpHeaders}
            onChange={(e) => setNewMcpHeaders(e.target.value)}
            placeholder='Custom headers JSON (optional): {"Authorization": "Bearer ..."}'
            className="w-full bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAddMcp} className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors">Save</button>
            <button onClick={() => setShowAddMcp(false)} className="px-3 py-1 rounded bg-surface-hover text-foreground text-xs hover:bg-surface-active transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loadingMcp && <p className="text-[10px] text-muted-foreground">Loading...</p>}
        {!loadingMcp && mcpServers.length === 0 && (
          <div className="border border-border rounded-lg p-6 text-center">
            <Server className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No MCP servers configured</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Add a server or import from JSON</p>
          </div>
        )}
        {mcpServers.map((server) => (
          <div key={server.id} className="bg-surface-hover border border-border rounded-lg p-3 space-y-2">
            {editingMcp === server.id ? (
              <div className="space-y-2">
                <input
                  value={editMcpValues.name || ""}
                  onChange={(e) => setEditMcpValues(v => ({ ...v, name: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-primary/50"
                />
                <input
                  value={editMcpValues.url || ""}
                  onChange={(e) => setEditMcpValues(v => ({ ...v, url: e.target.value }))}
                  className="w-full bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground font-mono focus:outline-none focus:border-primary/50"
                />
                <input
                  value={editMcpValues.headers || ""}
                  onChange={(e) => setEditMcpValues(v => ({ ...v, headers: e.target.value }))}
                  placeholder="Headers JSON"
                  className="w-full bg-background border border-border rounded px-2.5 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
                <div className="flex items-center gap-1.5">
                  <button onClick={() => saveMcpEdit(server.id)} className="p-1 text-status-online hover:bg-status-online/10 rounded transition-colors">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingMcp(null)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {server.status === "connected" ? (
                      <Wifi className="w-3.5 h-3.5 text-status-online" />
                    ) : (
                      <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium text-foreground">{server.name}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${server.status === "connected" ? "bg-status-online/10 text-status-online" : "bg-muted text-muted-foreground"}`}>
                      {server.status}
                    </span>
                    {server.url.includes("localhost") || server.url.includes("127.0.0.1") ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">local</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-status-downloading/10 text-status-downloading font-medium">remote</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleConnectMcp(server)}
                      disabled={connectingMcp === server.id}
                      className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {connectingMcp === server.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                    </button>
                    <button onClick={() => { setEditingMcp(server.id); setEditMcpValues({ name: server.name, url: server.url, headers: JSON.stringify(server.headers || {}) }); }} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <Toggle value={server.enabled ?? true} onChange={() => handleToggleMcp(server.id, server.enabled ?? true)} />
                    <button onClick={() => handleDeleteMcp(server.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">{server.url}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
