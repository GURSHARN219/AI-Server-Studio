import * as React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DEFAULT_APP_PATH } from "@/lib/app-routes";
import WindowTitleBar from "@/components/WindowTitleBar";
import Index from "./pages/Index";

const queryClient = new QueryClient();

type AppErrorBoundaryState = { error: Error | null };

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("AI Server Studio frontend initialization failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <WindowTitleBar />
        <main className="flex flex-1 min-h-0 items-center justify-center p-8">
          <section className="max-w-xl rounded-lg border border-destructive/40 bg-card p-6 shadow-xl" role="alert">
            <h1 className="text-base font-semibold">AI Server Studio could not start the interface</h1>
            <p className="mt-2 text-sm text-muted-foreground">The backend is still running, but the React interface hit an initialization error.</p>
            <pre className="mt-4 max-h-40 overflow-auto rounded bg-background p-3 text-xs text-destructive">{this.state.error.message}</pre>
            <button type="button" className="mt-4 rounded bg-primary px-3 py-2 text-xs text-primary-foreground" onClick={() => window.location.reload()}>
              Reload interface
            </button>
          </section>
        </main>
      </div>
    );
  }
}

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to={DEFAULT_APP_PATH} replace />} />
            <Route path="*" element={<Index />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
