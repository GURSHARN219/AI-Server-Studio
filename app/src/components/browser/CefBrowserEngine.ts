import type {
  BrowserBounds,
  BrowserEngine,
  BrowserEngineListener,
} from "@/components/browser/BrowserEngine";

interface NativeCefBridge {
  createView?: (tabId: string, url: string, bounds: BrowserBounds) => void;
  destroyView?: (tabId: string) => void;
  setBounds?: (tabId: string, bounds: BrowserBounds) => void;
  navigate?: (tabId: string, url: string) => void;
  goBack?: (tabId: string) => void;
  goForward?: (tabId: string) => void;
  reload?: (tabId: string) => void;
  stop?: (tabId: string) => void;
  setZoom?: (tabId: string, zoomFactor: number) => void;
  openDevTools?: (tabId: string) => void;
  closeDevTools?: (tabId: string) => void;
  getSource?: (tabId: string) => Promise<string>;
}

declare global {
  interface Window {
    __AI_STUDIO_CEF__?: NativeCefBridge;
  }
}

/**
 * Native Chromium Embedded Framework (CEF) engine implementation.
 * Places a native CEF view into the panel content area and resizes it with the panel.
 */
export class CefBrowserEngine implements BrowserEngine {
  readonly kind = "cef" as const;
  private listeners = new Set<BrowserEngineListener>();
  private histories = new Map<string, string[]>();
  private indices = new Map<string, number>();
  private titles = new Map<string, string>();
  private zooms = new Map<string, number>();

  private get bridge(): NativeCefBridge | undefined {
    return typeof window !== "undefined" ? window.__AI_STUDIO_CEF__ : undefined;
  }

  private emit(tabId: string, state: Parameters<NonNullable<BrowserEngineListener["onStateChange"]>>[1]) {
    this.listeners.forEach((l) => l.onStateChange?.(tabId, state));
  }

  mount(tabId: string, container: HTMLElement | null): void {
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const url = this.getUrl(tabId) || "http://localhost:5173";
    this.bridge?.createView?.(tabId, url, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  unmount(tabId: string): void {
    this.bridge?.destroyView?.(tabId);
  }

  resize(tabId: string, bounds: BrowserBounds): void {
    this.bridge?.setBounds?.(tabId, bounds);
  }

  navigate(tabId: string, url: string): void {
    const stack = this.histories.get(tabId) ?? [];
    const idx = this.indices.get(tabId) ?? -1;
    const nextStack = [...stack.slice(0, idx + 1), url];
    this.histories.set(tabId, nextStack);
    this.indices.set(tabId, nextStack.length - 1);
    const title = url.replace(/^https?:\/\//, "");
    this.titles.set(tabId, title);

    this.emit(tabId, {
      url,
      title,
      isLoading: true,
      canGoBack: nextStack.length > 1,
      canGoForward: false,
      isSecure: url.startsWith("https://") || url.includes("localhost"),
    });

    this.bridge?.navigate?.(tabId, url);
    window.setTimeout(() => {
      this.emit(tabId, { isLoading: false });
      this.listeners.forEach((l) => l.onHistoryVisit?.(title, url));
    }, 240);
  }

  back(tabId: string): void {
    const idx = this.indices.get(tabId) ?? 0;
    const stack = this.histories.get(tabId) ?? [];
    if (idx <= 0) return;
    const nextIdx = idx - 1;
    this.indices.set(tabId, nextIdx);
    const url = stack[nextIdx];
    this.bridge?.goBack?.(tabId);
    this.emit(tabId, {
      url,
      canGoBack: nextIdx > 0,
      canGoForward: nextIdx < stack.length - 1,
    });
  }

  forward(tabId: string): void {
    const idx = this.indices.get(tabId) ?? 0;
    const stack = this.histories.get(tabId) ?? [];
    if (idx >= stack.length - 1) return;
    const nextIdx = idx + 1;
    this.indices.set(tabId, nextIdx);
    const url = stack[nextIdx];
    this.bridge?.goForward?.(tabId);
    this.emit(tabId, {
      url,
      canGoBack: nextIdx > 0,
      canGoForward: nextIdx < stack.length - 1,
    });
  }

  reload(tabId: string): void {
    this.emit(tabId, { isLoading: true });
    this.bridge?.reload?.(tabId);
    window.setTimeout(() => this.emit(tabId, { isLoading: false }), 220);
  }

  stop(tabId: string): void {
    this.bridge?.stop?.(tabId);
    this.emit(tabId, { isLoading: false });
  }

  getTitle(tabId: string): string {
    return this.titles.get(tabId) ?? "CEF Browser";
  }

  getUrl(tabId: string): string {
    const stack = this.histories.get(tabId) ?? [];
    const idx = this.indices.get(tabId) ?? 0;
    return stack[idx] ?? "";
  }

  getHistory(tabId: string): string[] {
    return this.histories.get(tabId) ?? [];
  }

  setZoom(tabId: string, zoomPercent: number): void {
    const clamped = Math.min(200, Math.max(50, zoomPercent));
    this.zooms.set(tabId, clamped);
    this.bridge?.setZoom?.(tabId, clamped / 100);
    this.emit(tabId, { zoom: clamped });
  }

  getZoom(tabId: string): number {
    return this.zooms.get(tabId) ?? 100;
  }

  openDevTools(tabId: string): void {
    this.bridge?.openDevTools?.(tabId);
  }

  closeDevTools(tabId: string): void {
    this.bridge?.closeDevTools?.(tabId);
  }

  async viewSource(tabId: string): Promise<string> {
    if (this.bridge?.getSource) {
      return this.bridge.getSource(tabId);
    }
    return `<!-- CEF View Source: ${this.getUrl(tabId)} -->\n<html><body>Native CEF source</body></html>`;
  }

  subscribe(listener: BrowserEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
