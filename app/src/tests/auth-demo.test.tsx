import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthPage from "@/pages/AuthPage";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/api/auth";
import { authBackendSignIn } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  authBackendResetPassword: vi.fn(),
  authBackendSignIn: vi.fn().mockResolvedValue({ id: "demo-user", email: "demo@aiserver.studio", created_at: "demo" }),
  authBackendSignUp: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("demo login", () => {
  it("logs into the UI preview using the visible demo action", async () => {
    const onAuth = vi.fn();
    render(<AuthPage onAuth={onAuth} embeddedInAppShell />);

    fireEvent.click(screen.getByRole("button", { name: "Enter demo mode" }));

    await waitFor(() => expect(authBackendSignIn).toHaveBeenCalledWith(DEMO_EMAIL, DEMO_PASSWORD));
    expect(onAuth).toHaveBeenCalledOnce();
  });
});
