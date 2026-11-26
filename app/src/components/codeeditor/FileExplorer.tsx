import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import { useStudioStore } from "@/stores/studioStore";
import type { FileNode } from "@/types/studio";

function getFileIcon(name: string) {
  if (name.endsWith(".json")) return FileJson;
  if (name.endsWith(".md")) return FileText;
  return FileCode2;
}

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  const out: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
        out.push(node);
      }
    } else if (node.children) {
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0) {
        out.push({ ...node, children: filteredChildren });
      }
    }
  }
  return out;
}

const TreeNode: React.FC<{
  node: FileNode;
  depth: number;
  forceExpand: boolean;
}> = ({ node, depth, forceExpand }) => {
  const [expanded, setExpanded] = useState(true);
  const activeFilePath = useStudioStore((s) => s.activeFilePath);
  const openFile = useStudioStore((s) => s.openFile);

  const isExpanded = forceExpand || expanded;

  if (node.type === "folder") {
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          )}
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <span className="truncate">{node.path}</span>
        </button>
        {isExpanded && node.children && (
          <div className="relative">
            <div
              style={{ left: `${depth * 12 + 14}px` }}
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-edge-subtle"
            />
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                forceExpand={forceExpand}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const Icon = getFileIcon(node.name);
  const isActive = activeFilePath === node.path;

  return (
    <button
      type="button"
      onClick={() => openFile(node.path)}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
      className={`flex w-full items-center justify-between gap-2 rounded-md py-1 pr-2 text-left text-xs transition-colors ${
        isActive
          ? "bg-accent-soft font-medium text-accent-fg"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-accent-fg" : "text-ink-muted"}`} />
        <span className="truncate">{node.name}</span>
      </div>
      {node.changed && (
        <span className="shrink-0 font-mono text-[10px] font-semibold text-state-warning">
          M
        </span>
      )}
    </button>
  );
};

export const FileExplorer: React.FC = () => {
  const [query, setQuery] = useState("");
  const files = useStudioStore((s) => s.files);

  const filtered = useMemo(() => filterTree(files, query), [files, query]);

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-edge-subtle bg-surface-card">
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files..."
            className="h-7 w-full rounded-md border border-edge-subtle bg-surface-subtle pl-8 pr-2 text-xs text-ink-primary placeholder:text-ink-muted focus:border-edge-default focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-ink-muted">No matching files</div>
        ) : (
          filtered.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              forceExpand={Boolean(query.trim())}
            />
          ))
        )}
      </div>
    </div>
  );
};
