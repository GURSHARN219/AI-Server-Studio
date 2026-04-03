import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

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
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@goclaw/api": path.resolve(__dirname, "./src/api/goclaw"),
      "@goclaw/components": path.resolve(__dirname, "./src/components/goclaw"),
      "@goclaw/constants": path.resolve(__dirname, "./src/constants/goclaw"),
      "@goclaw/hooks": path.resolve(__dirname, "./src/hooks/goclaw"),
      "@goclaw/i18n": path.resolve(__dirname, "./src/i18n/goclaw"),
      "@goclaw/lib": path.resolve(__dirname, "./src/lib/goclaw"),
      "@goclaw/pages": path.resolve(__dirname, "./src/pages/goclaw"),
      "@goclaw/stores": path.resolve(__dirname, "./src/stores/goclaw"),
      "@goclaw/types": path.resolve(__dirname, "./src/types/goclaw"),
      "@goclaw": path.resolve(__dirname, "./src/goclaw"),
    },
  },
}));
