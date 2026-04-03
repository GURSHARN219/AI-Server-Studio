import type { Page } from "@/types";
import { AISTCLAW_BASE_PATH } from "@aistclaw/lib/constants";

export type RoutablePage = Exclude<Page, "settings">;
export type StudioPage = Exclude<RoutablePage, "clawui">;

export const STUDIO_PAGE_PATHS: Record<StudioPage, string> = {
  chat: "/chat",
  discover: "/discover",
  models: "/models",
  search: "/search",
  server: "/server",
  api: "/api",
  voice: "/voice",
  media: "/media",
};

export const APP_PAGE_PATHS: Record<RoutablePage, string> = {
  ...STUDIO_PAGE_PATHS,
  clawui: AISTCLAW_BASE_PATH,
};

export const DEFAULT_APP_PATH = STUDIO_PAGE_PATHS.chat;

function normalizePathname(pathname: string): string {
  if (!pathname) return DEFAULT_APP_PATH;
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function getAppPagePath(page: RoutablePage): string {
  return APP_PAGE_PATHS[page];
}

export function getStudioPageFromPath(pathname: string): StudioPage | null {
  const normalized = normalizePathname(pathname);
  if (normalized === "/") return "chat";

  const match = Object.entries(STUDIO_PAGE_PATHS).find(([, path]) => path === normalized);
  return (match?.[0] as StudioPage | undefined) ?? null;
}
