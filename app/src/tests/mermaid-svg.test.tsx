import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const { renderMermaid } = vi.hoisted(() => ({ renderMermaid: vi.fn() }));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderMermaid,
  },
}));

import CodeBlock from "@/components/chat/CodeBlock";
import { validateMermaidSvg } from "@/lib/mermaidSvg";

describe("Mermaid SVG validation", () => {
  it("rejects a path with a command that has no coordinate data", () => {
    expect(() => validateMermaidSvg('<svg><path d="M0 0tc0.2,0,0.4-0.2,0" /></svg>')).toThrow("invalid SVG path data");
  });

  it("keeps valid Mermaid path data renderable", () => {
    const svg = '<svg><path d="M0 0 C0.2,0 0.4,0.2 1,1" /></svg>';
    expect(validateMermaidSvg(svg)).toBe(svg);
  });

  it("shows the error state instead of injecting malformed SVG", async () => {
    renderMermaid.mockResolvedValueOnce({ svg: '<svg><path d="M0 0tc0.2,0,0.4-0.2,0" /></svg>' });
    render(<CodeBlock className="language-mermaid">graph TD; A--&gt;B</CodeBlock>);

    await waitFor(() => expect(screen.getByText("Mermaid generated invalid SVG path data")).toBeInTheDocument());
    expect(screen.queryByText("Rendering diagram...")).not.toBeInTheDocument();
  });
});
