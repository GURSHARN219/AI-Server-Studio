import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import "@goclaw/i18n";
import { AppProviders } from "@goclaw/components/providers/app-providers";
import { AppRoutes } from "@goclaw/routes";
import { setGoClawPort } from "@goclaw/lib/runtime";

export default function EmbeddedGoClawApp() {
  useEffect(() => {
    window.electron?.onGoClawPort?.((port: number) => {
      setGoClawPort(port);
    });
  }, []);

  return (
    <MemoryRouter initialEntries={["/overview"]}>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>
  );
}
