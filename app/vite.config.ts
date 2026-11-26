import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT || "9600";
  const backendHost = env.VITE_BACKEND_HOST || "localhost";
  const backendTarget = `http://${backendHost}:${backendPort}`;

  return {
    base: mode === "production" ? "./" : "/",
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/ws": {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
        },
        "/v1": {
          target: backendTarget,
          changeOrigin: true,
          timeout: 30000,
        },
        "/health": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: {
      include: ["i18next", "react-i18next"],
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
