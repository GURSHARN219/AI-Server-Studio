import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "./" : "/",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  optimizeDeps: {
    include: ["i18next", "react-i18next"],
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@aistclaw/api": path.resolve(__dirname, "./src/api/aistclaw"),
      "@aistclaw/components": path.resolve(__dirname, "./src/components/aistclaw"),
      "@aistclaw/constants": path.resolve(__dirname, "./src/constants/aistclaw"),
      "@aistclaw/hooks": path.resolve(__dirname, "./src/hooks/aistclaw"),
      "@aistclaw/i18n": path.resolve(__dirname, "./src/i18n/aistclaw"),
      "@aistclaw/lib": path.resolve(__dirname, "./src/lib/aistclaw"),
      "@aistclaw/pages": path.resolve(__dirname, "./src/pages/aistclaw"),
      "@aistclaw/routes": path.resolve(__dirname, "./src/aistclaw-routes.tsx"),
      "@aistclaw/stores": path.resolve(__dirname, "./src/stores/aistclaw"),
      "@aistclaw/types": path.resolve(__dirname, "./src/types/aistclaw"),
    },
  },
}));
