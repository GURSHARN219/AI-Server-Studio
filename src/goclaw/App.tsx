import { BrowserRouter } from "react-router";
import { AppProviders } from "@goclaw/components/providers/app-providers";
import { AppRoutes } from "@goclaw/routes";

export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </BrowserRouter>
  );
}
