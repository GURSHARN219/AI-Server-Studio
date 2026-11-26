/**
 * settingsStore.ts
 * Central Zustand store for all app settings.
 * Account state is hydrated/saved through the local engine; applies UI and engine side effects.
 */
import { create } from "zustand";
import { engineFetch as fetch } from "@/api/client";
import { engineAuthHeaders, engineBase } from "@/lib/localEngine";
import type { BrowserSettings, EditorSettings } from "@/types/studio";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppearanceSettings {
  colorTheme: "auto" | "dark" | "light";
  navBarPosition: "left" | "right" | "bottom";
  viewMode: "markdown" | "plain";
  showTabStripScrollbar: boolean;
  fontSize: number;
  fontWeight: "light" | "normal" | "medium" | "bold";
  showGenInfo: "last" | "all" | "none";
  scrollToTopOnSend: boolean;
  autoLatchGenerating: boolean;
  chatMessagesStyle: "bubble" | "block";
  expandChatToWindowWidth: boolean;
  expandReasoningByDefault: boolean;
  showReasoningVignette: boolean;
}

export interface ChatSettings {
  allowOnlyOneNewChat: boolean;
  unloadOnModelSelect: boolean;
  moveDeletedToTrash: boolean;
  doubleClickToEdit: boolean;
  showTokenCountInList: boolean;
  alwaysShowPromptTemplate: boolean;
  doubleClickRename: boolean;
  sidebarSort: "recent" | "alphabetical" | "created";
  sttModelKey: string;
  shiftEnterToSend: boolean;
  ctrlRToRegenerate: boolean;
  autoNaming: "never" | "auto" | "always";
  searchFindOnboarding: boolean;
  lmLinkSidebarPopover: boolean;
  trashDeletionOnboarding: boolean;
}

export interface AdvancedSettings {
  gpuAccel: boolean;
  maxConcurrent: string;
  contextDefault: string;
  debugMode: boolean;
  verboseLogs: boolean;
  keepAlive: boolean;
  requestTimeout: string;
  maxRetries: string;
  developerMode: boolean;
  jitAutoEvict: boolean;
  maxIdleTtl: string;
  enableLocalLlmService: boolean;
  runtimeUpdateChannel: "stable" | "beta";
  autoUpdateRuntimePacks: boolean;
  autoDeleteLruPacks: boolean;
  showDebugInfoBlocks: boolean;
  showResourceWidget: boolean;
  enableModelLoadInPresets: boolean;
  separateReasoningContent: boolean;
}

export interface AboutSettings {
  autoUpdate: boolean;
  telemetry: boolean;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  homepage: "http://localhost:5173",
  searchEngine: "duckduckgo",
  cookiesEnabled: true,
  defaultZoom: 100,
  userAgent: "AI-Server-Studio/1.4.2 CEF/130.0",
  devToolsEnabled: true,
  showBookmarksBar: true,
};

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  tabSize: 2,
  minimapDefault: true,
  wordWrap: false,
  lineNumbers: true,
  fontSize: 12,
};

export interface SettingsState {
  appearance: AppearanceSettings;
  chat: ChatSettings;
  advanced: AdvancedSettings;
  about: AboutSettings;
  browser: BrowserSettings;
  editor: EditorSettings;
  setAppearance: <K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]) => void;
  setChat: <K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) => void;
  setAdvanced: <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) => void;
  setAbout: <K extends keyof AboutSettings>(key: K, value: AboutSettings[K]) => void;
  setBrowser: <K extends keyof BrowserSettings>(key: K, value: BrowserSettings[K]) => void;
  setEditor: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  resetOnboarding: () => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorTheme: "auto",
  navBarPosition: "left",
  viewMode: "markdown",
  showTabStripScrollbar: true,
  fontSize: 14,
  fontWeight: "normal",
  showGenInfo: "last",
  scrollToTopOnSend: true,
  autoLatchGenerating: false,
  chatMessagesStyle: "bubble",
  expandChatToWindowWidth: false,
  expandReasoningByDefault: false,
  showReasoningVignette: true,
};

const DEFAULT_CHAT: ChatSettings = {
  allowOnlyOneNewChat: false,
  unloadOnModelSelect: false,
  moveDeletedToTrash: true,
  doubleClickToEdit: true,
  showTokenCountInList: false,
  alwaysShowPromptTemplate: false,
  doubleClickRename: true,
  sidebarSort: "recent",
  sttModelKey: "",
  shiftEnterToSend: false,
  ctrlRToRegenerate: true,
  autoNaming: "auto",
  searchFindOnboarding: true,
  lmLinkSidebarPopover: true,
  trashDeletionOnboarding: true,
};

const DEFAULT_ADVANCED: AdvancedSettings = {
  gpuAccel: true,
  maxConcurrent: "2",
  contextDefault: "4096",
  debugMode: false,
  verboseLogs: false,
  keepAlive: true,
  requestTimeout: "120",
  maxRetries: "3",
  developerMode: false,
  jitAutoEvict: true,
  maxIdleTtl: "5",
  enableLocalLlmService: false,
  runtimeUpdateChannel: "stable",
  autoUpdateRuntimePacks: true,
  autoDeleteLruPacks: false,
  showDebugInfoBlocks: false,
  showResourceWidget: false,
  enableModelLoadInPresets: false,
  separateReasoningContent: false,
};

const DEFAULT_ABOUT: AboutSettings = {
  autoUpdate: true,
  telemetry: false,
};

// ── Side-effects ──────────────────────────────────────────────────────────────

export function applyAppearance(s: AppearanceSettings) {
  const root = document.documentElement;

  // Theme
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = s.colorTheme === "dark" || (s.colorTheme === "auto" && prefersDark);
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);

  // Font size & weight
  root.style.setProperty("--chat-font-size", `${s.fontSize}px`);
  root.style.setProperty("--chat-font-weight", s.fontWeight === "light" ? "300"
    : s.fontWeight === "medium" ? "500"
    : s.fontWeight === "bold" ? "700"
    : "400");

  // Chat container width
  root.style.setProperty("--chat-max-width", s.expandChatToWindowWidth ? "100%" : "48rem");

  // Data attributes for CSS selectors
  root.setAttribute("data-chat-style", s.chatMessagesStyle);
  root.setAttribute("data-nav-position", s.navBarPosition);
  root.setAttribute("data-view-mode", s.viewMode);
}

async function syncEngineConfig(s: AdvancedSettings) {
  try {
    await fetch(`${engineBase()}/config`, {
      method: "POST",
      headers: engineAuthHeaders(true),
      body: JSON.stringify({
        gpu_accel: s.gpuAccel,
        max_concurrent: parseInt(s.maxConcurrent) || 2,
        default_context: parseInt(s.contextDefault) || 4096,
        keep_alive: s.keepAlive,
        request_timeout: parseInt(s.requestTimeout) || 120,
        max_retries: parseInt(s.maxRetries) || 3,
        debug_mode: s.debugMode,
        verbose_logs: s.verboseLogs,
        jit_auto_evict: s.jitAutoEvict,
        max_idle_ttl: parseInt(s.maxIdleTtl) || 5,
        enable_local_llm_service: s.enableLocalLlmService,
        separate_reasoning_content: s.separateReasoningContent,
      }),
    });
  } catch {
    // engine offline — will apply on next connect
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
    (set, get) => ({
      appearance: DEFAULT_APPEARANCE,
      chat: DEFAULT_CHAT,
      advanced: DEFAULT_ADVANCED,
      about: DEFAULT_ABOUT,
      browser: DEFAULT_BROWSER_SETTINGS,
      editor: DEFAULT_EDITOR_SETTINGS,

      setAppearance: (key, value) => {
        set(state => {
          const next = { ...state.appearance, [key]: value };
          applyAppearance(next);
          return { appearance: next };
        });
      },

      setChat: (key, value) => {
        set(state => ({ chat: { ...state.chat, [key]: value } }));
      },

      setAdvanced: (key, value) => {
        set(state => {
          const next = { ...state.advanced, [key]: value };
          syncEngineConfig(next);
          return { advanced: next };
        });
      },

      setAbout: (key, value) => {
        set(state => ({ about: { ...state.about, [key]: value } }));
      },

      setBrowser: (key, value) => {
        set(state => ({ browser: { ...state.browser, [key]: value } }));
      },

      setEditor: (key, value) => {
        set(state => ({ editor: { ...state.editor, [key]: value } }));
      },

      resetOnboarding: () => {
        set(state => ({
          chat: {
            ...state.chat,
            searchFindOnboarding: true,
            lmLinkSidebarPopover: true,
            trashDeletionOnboarding: true,
          },
        }));
      },
    })
);

export type PersistedSettings = Pick<SettingsState, "appearance" | "chat" | "advanced" | "about" | "browser" | "editor">;
export function hydrateSettings(data: Partial<PersistedSettings> = {}): void {
  let legacyBrowser: Partial<BrowserSettings> = {};
  let legacyEditor: Partial<EditorSettings> = {};
  if (typeof localStorage !== "undefined") {
    try {
      const legacy = JSON.parse(localStorage.getItem("ai-server-studio-ui-v2") || "null")?.state;
      legacyBrowser = legacy?.browserSettings ?? {};
      legacyEditor = legacy?.editorSettings ?? {};
    } catch { /* ignore malformed legacy workspace preferences */ }
  }
  useSettingsStore.setState({
    appearance: { ...DEFAULT_APPEARANCE, ...data.appearance },
    chat: { ...DEFAULT_CHAT, ...data.chat },
    advanced: { ...DEFAULT_ADVANCED, ...data.advanced },
    about: { ...DEFAULT_ABOUT, ...data.about },
    browser: { ...DEFAULT_BROWSER_SETTINGS, ...legacyBrowser, ...data.browser },
    editor: { ...DEFAULT_EDITOR_SETTINGS, ...legacyEditor, ...data.editor },
  });
  applyAppearance(useSettingsStore.getState().appearance);
}

// Apply appearance on initial load
if (typeof window !== "undefined") {
  const stored = useSettingsStore.getState();
  applyAppearance(stored.appearance);
  // Listen for system theme changes when colorTheme is "auto"
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { appearance } = useSettingsStore.getState();
    if (appearance.colorTheme === "auto") applyAppearance(appearance);
  });
}
