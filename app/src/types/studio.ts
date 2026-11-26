export type LayoutMode = "chat" | "split" | "full";
export type WorkspaceView = "code" | "browser";
export type PopupSize = "collapsed" | "expanded" | "minimized";
export type ThemeMode = "light" | "dark";

export type Destination =
  | "chat"
  | "files"
  | "browser"
  | "models"
  | "tools"
  | "knowledge"
  | "terminal"
  | "settings";

export type ComposerMode = "agent" | "ask" | "plan";

export interface ToolCallItem {
  id: string;
  tool: string;
  summary: string;
  durationMs: number;
  status: "done" | "running" | "error";
  input?: string;
  output?: string;
  detail?: string;
}

export interface EditedFilePill {
  path: string;
  filename: string;
  added: number;
  removed: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: ToolCallItem[];
  editedFiles?: EditedFilePill[];
  hasPreviewAction?: boolean;
  isStreaming?: boolean;
  feedback?: "like" | "dislike" | null;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  model: string;
  messages: ChatMessage[];
}

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  changed?: boolean;
  added?: number;
  removed?: number;
  content?: string;
  previousContent?: string;
  children?: FileNode[];
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  isSecure: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  visitedAt: string;
  dayGroup: "Today" | "Yesterday" | "Earlier";
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  folder?: string;
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  size: string;
  progress: number;
  status: "completed" | "downloading" | "paused";
  timestamp: string;
}

export interface StudioModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: string;
  speed: string;
  local: boolean;
}

export interface StudioTool {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: "filesystem" | "runtime" | "web" | "knowledge";
}

export interface KnowledgeItem {
  id: string;
  title: string;
  type: "docs" | "repo" | "api";
  chunks: number;
  enabled: boolean;
}

export interface BrowserSettings {
  homepage: string;
  searchEngine: "duckduckgo" | "google" | "kagi" | "brave";
  cookiesEnabled: boolean;
  defaultZoom: number;
  userAgent: string;
  devToolsEnabled: boolean;
  showBookmarksBar: boolean;
}

export interface EditorSettings {
  tabSize: 2 | 4;
  minimapDefault: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  fontSize: number;
}

