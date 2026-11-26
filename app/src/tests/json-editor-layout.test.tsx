import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JsonEditorTab from "@/components/JsonEditorTab";

describe("JsonEditorTab layout", () => {
  it("keeps the line-number gutter aligned with the scrolling editor", () => {
    render(
      <JsonEditorTab
        configType="tools"
        initialJson={"[\n  {\n    \"id\": \"tool\"\n  }\n]"}
        onSave={vi.fn()}
      />,
    );

    const textarea = screen.getByRole("textbox");
    const gutter = screen.getByTestId("json-editor-gutter");

    Object.defineProperty(textarea, "scrollTop", { configurable: true, value: 40 });
    fireEvent.scroll(textarea);

    expect(gutter).toHaveStyle({ transform: "translateY(-40px)" });
  });
});
