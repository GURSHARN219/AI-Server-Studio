import type { BrowserEngine } from "@/components/browser/BrowserEngine";
import { CefBrowserEngine } from "@/components/browser/CefBrowserEngine";
import { MockBrowserEngine } from "@/components/browser/MockBrowserEngine";

/**
 * Single flag to switch between native CEF (desktop) and MockBrowserEngine (web/dev preview).
 */
export const USE_CEF_ENGINE =
  typeof window !== "undefined" && Boolean(window.__AI_STUDIO_CEF__);

export function createBrowserEngine(useCef: boolean = USE_CEF_ENGINE): BrowserEngine {
  return useCef ? new CefBrowserEngine() : new MockBrowserEngine();
}

export const browserEngine: BrowserEngine = createBrowserEngine();
