import { useState, useEffect } from "react";

/**
 * Returns the current app theme ("dark" | "light") by watching the
 * <html> element's class list.  This is the single source of truth that
 * Index.tsx already maintains – it avoids the stale studioStore default
 * of "light" that caused Monaco to render with the wrong theme.
 */
export function useAppTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  useEffect(() => {
    const root = document.documentElement;

    const observer = new MutationObserver(() => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
