import type {
  BrowserBounds,
  BrowserEngine,
  BrowserEngineListener,
} from "@/components/browser/BrowserEngine";

/**
 * Web/dev preview BrowserEngine implementation (iframe + simulated localhost surface).
 */
export class MockBrowserEngine implements BrowserEngine {
  readonly kind = "mock" as const;
  private listeners = new Set<BrowserEngineListener>();
  private histories = new Map<string, string[]>();
  private indices = new Map<string, number>();
  private titles = new Map<string, string>();
  private zooms = new Map<string, number>();

  private emit(tabId: string, state: Parameters<NonNullable<BrowserEngineListener["onStateChange"]>>[1]) {
    this.listeners.forEach((l) => l.onStateChange?.(tabId, state));
  }

  mount(tabId: string): void {
    if (!this.histories.has(tabId)) {
      this.histories.set(tabId, ["http://localhost:5173"]);
      this.indices.set(tabId, 0);
      this.titles.set(tabId, "AI Gateway Health — localhost:5173");
    }
  }

  unmount(tabId: string): void {
    this.histories.delete(tabId);
    this.indices.delete(tabId);
    this.titles.delete(tabId);
  }

  resize(_tabId: string, _bounds: BrowserBounds): void {
    // Handled natively by CSS flex container in MockBrowserEngine
  }

  navigate(tabId: string, url: string): void {
    const stack = this.histories.get(tabId) ?? [];
    const idx = this.indices.get(tabId) ?? -1;
    const nextStack = [...stack.slice(0, idx + 1), url];
    this.histories.set(tabId, nextStack);
    this.indices.set(tabId, nextStack.length - 1);

    const title = url.includes("localhost:5173/health")
      ? "Gateway Health Endpoint"
      : url.includes("localhost:5173")
        ? "AI Gateway Health — localhost:5173"
        : url.replace(/^https?:\/\//, "");
    this.titles.set(tabId, title);

    this.emit(tabId, {
      url,
      title,
      isLoading: true,
      canGoBack: nextStack.length > 1,
      canGoForward: false,
      isSecure: url.startsWith("https://") || url.includes("localhost"),
    });

    window.setTimeout(() => {
      this.emit(tabId, { isLoading: false, title });
      this.listeners.forEach((l) => l.onHistoryVisit?.(title, url));
    }, 260);
  }

  back(tabId: string): void {
    const idx = this.indices.get(tabId) ?? 0;
    const stack = this.histories.get(tabId) ?? [];
    if (idx <= 0) return;
    const nextIdx = idx - 1;
    this.indices.set(tabId, nextIdx);
    const url = stack[nextIdx];
    this.emit(tabId, {
      url,
      title: url.replace(/^https?:\/\//, ""),
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
    this.emit(tabId, {
      url,
      title: url.replace(/^https?:\/\//, ""),
      canGoBack: nextIdx > 0,
      canGoForward: nextIdx < stack.length - 1,
    });
  }

  reload(tabId: string): void {
    this.emit(tabId, { isLoading: true });
    window.setTimeout(() => this.emit(tabId, { isLoading: false }), 220);
  }

  stop(tabId: string): void {
    this.emit(tabId, { isLoading: false });
  }

  getTitle(tabId: string): string {
    return this.titles.get(tabId) ?? "New Tab";
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
    this.emit(tabId, { zoom: clamped });
  }

  getZoom(tabId: string): number {
    return this.zooms.get(tabId) ?? 100;
  }

  openDevTools(): void {}
  closeDevTools(): void {}

  async viewSource(tabId: string): Promise<string> {
    const url = this.getUrl(tabId) || "http://localhost:5173";
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${this.getTitle(tabId)}</title>
  </head>
  <body>
    <div id="root" data-source="${url}">
      <!-- Rendered by AI Gateway Studio (${url}) -->
      <main class="mx-auto max-w-4xl p-6">
        <h1>AI Gateway Health</h1>
        <section aria-label="Gateway throughput metrics">
          <article>Requests / min: 14,820</article>
          <article>P95 First Token: 38 ms</article>
          <article>Active Workers: 6 / 8</article>
        </section>
      </main>
    </div>
  </body>
</html>`;
  }

  subscribe(listener: BrowserEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
