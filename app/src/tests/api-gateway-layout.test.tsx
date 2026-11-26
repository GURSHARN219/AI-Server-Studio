import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ApiGatewayPage from "@/pages/ApiGatewayPage";

vi.mock("@/lib/api", () => ({
  listBackendApiKeys: vi.fn().mockResolvedValue([]),
  listBackendUsageLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/api/client", () => ({
  engineApiBase: () => "http://localhost:4000/v1",
}));

vi.mock("@/components/api-gateway/ProvidersTab", () => ({
  default: () => <div data-testid="api-providers-tab">providers-tab</div>,
}));
vi.mock("@/components/api-gateway/StatsRow", () => ({
  default: () => <div data-testid="gateway-stats">stats</div>,
}));
vi.mock("@/components/api-gateway/ApiKeysTab", () => ({
  default: () => <div data-testid="api-keys-tab">api-keys</div>,
}));
vi.mock("@/components/api-gateway/UsageTab", () => ({
  default: () => <div data-testid="usage-tab">usage</div>,
}));
vi.mock("@/components/api-gateway/LogsTab", () => ({
  default: () => <div data-testid="logs-tab">logs</div>,
}));
vi.mock("@/components/api-gateway/DocsTab", () => ({
  default: () => <div data-testid="docs-tab">docs</div>,
}));

describe("API Gateway page layout", () => {
  it("switches between API Providers and the BYOK Gateway from the sidebar", async () => {
    render(<ApiGatewayPage />);

    expect(screen.getByRole("button", { name: "API Providers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("api-providers-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("api-keys-tab")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "BYOK Gateway" }));

    expect(screen.getByRole("button", { name: "BYOK Gateway" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("BYOK Gateway", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("api-keys-tab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "API Providers" }));

    await waitFor(() => expect(screen.getByTestId("api-providers-tab")).toBeInTheDocument());
    expect(screen.queryByTestId("api-keys-tab")).not.toBeInTheDocument();
  });
});
