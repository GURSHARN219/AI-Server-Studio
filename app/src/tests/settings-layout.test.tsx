import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppContentModal from "@/components/AppContentModal";
import SettingsPage from "@/pages/SettingsPage";
import { useHardwareInfo } from "@/hooks/useHardwareInfo";
import { getEngineStatus } from "@/lib/localEngine";

vi.mock("@/hooks/useHardwareInfo", () => ({
  useHardwareInfo: vi.fn(),
}));

vi.mock("@/lib/localEngine", () => ({
  getEngineStatus: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/settings/ProfileTab", () => ({ default: () => <div data-testid="profile-tab">profile-tab</div> }));
vi.mock("@/components/settings/AppearanceTab", () => ({ default: () => <div data-testid="appearance-tab">appearance-tab</div> }));
vi.mock("@/components/settings/ChatTab", () => ({ default: () => <div data-testid="chat-tab">chat-tab</div> }));
vi.mock("@/components/settings/McpServersTab", () => ({ default: () => <div data-testid="mcp-tab">mcp-tab</div> }));
vi.mock("@/components/settings/ToolsTab", () => ({ default: () => <div data-testid="tools-tab">tools-tab</div> }));
vi.mock("@/components/settings/ApiTab", () => ({ default: () => <div data-testid="api-tab">api-tab</div> }));
vi.mock("@/components/settings/PathsTab", () => ({ default: () => <div data-testid="paths-tab">paths-tab</div> }));
vi.mock("@/components/settings/AdvancedTab", () => ({ default: () => <div data-testid="advanced-tab">advanced-tab</div> }));
vi.mock("@/components/settings/RuntimeTab", () => ({ default: () => <div data-testid="runtime-tab">runtime-tab</div> }));
vi.mock("@/components/settings/AboutTab", () => ({ default: () => <div data-testid="about-tab">about-tab</div> }));

vi.mock("@/components/settings/HardwareTab", () => ({
  default: () => <div data-testid="hardware-tab">hardware-tab</div>,
}));

const hardwareState = {
  hardware: null,
  usage: null,
  loading: false,
  error: null,
  refresh: vi.fn(),
  formatBytes: (bytes: number) => `${bytes} B`,
};

describe("settings modal layout", () => {
  beforeEach(() => {
    vi.mocked(useHardwareInfo).mockReset();
    vi.mocked(useHardwareInfo).mockReturnValue(hardwareState);
    vi.mocked(getEngineStatus).mockResolvedValue({
      available: true,
      loaded: false,
      model: null,
      runtimeMode: "embedded",
      inferenceReady: false,
    });
  });

  it("keeps the overlay inside the content region and handles only backdrop clicks", () => {
    const onBackdropClick = vi.fn();
    render(
      <AppContentModal onBackdropClick={onBackdropClick}>
        <div>dialog content</div>
      </AppContentModal>,
    );

    const overlay = screen.getByRole("presentation");
    expect(overlay.className).toContain("absolute");
    expect(overlay.className).not.toContain("fixed");

    fireEvent.click(screen.getByText("dialog content"));
    expect(onBackdropClick).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(onBackdropClick).toHaveBeenCalledOnce();
  });

  it("mounts one settings tab at a time and defers hardware polling until selected", () => {
    render(<SettingsPage />);

    expect(screen.getByTestId("profile-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("providers-tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "API Providers" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("runtime-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hardware-tab")).not.toBeInTheDocument();
    expect(useHardwareInfo).toHaveBeenCalledWith(3000, false);

    fireEvent.click(screen.getByRole("button", { name: /Hardware/ }));
    expect(screen.getByTestId("hardware-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-tab")).not.toBeInTheDocument();
    expect(useHardwareInfo).toHaveBeenLastCalledWith(3000, true);
  });
});
