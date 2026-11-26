export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserNavigationState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  isSecure: boolean;
}

export interface BrowserEngineListener {
  onStateChange?: (tabId: string, state: Partial<BrowserNavigationState>) => void;
  onHistoryVisit?: (title: string, url: string) => void;
}

/**
 * Abstraction over the embedded browser surface.
 * Implemented by CefBrowserEngine (native desktop CEF) and MockBrowserEngine (web/dev preview).
 */
export interface BrowserEngine {
  readonly kind: "cef" | "mock";
  mount(tabId: string, container: HTMLElement | null): void;
  unmount(tabId: string): void;
  resize(tabId: string, bounds: BrowserBounds): void;
  navigate(tabId: string, url: string): void;
  back(tabId: string): void;
  forward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  getTitle(tabId: string): string;
  getUrl(tabId: string): string;
  getHistory(tabId: string): string[];
  setZoom(tabId: string, zoomPercent: number): void;
  getZoom(tabId: string): number;
  openDevTools(tabId: string): void;
  closeDevTools(tabId: string): void;
  viewSource(tabId: string): Promise<string>;
  subscribe(listener: BrowserEngineListener): () => void;
}
