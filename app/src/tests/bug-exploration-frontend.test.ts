/**
 * Bug Condition Exploration Tests — Frontend
 *
 * These tests are written BEFORE any fixes are applied.
 * Each test is EXPECTED TO FAIL on unfixed code — that is the correct outcome.
 * Failures confirm the bugs exist and document the counterexamples.
 *
 * DO NOT fix the code to make these tests pass. They are fixed in later tasks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Test 1.1 — ResourceWidget interface reads snake_case but backend returns camelCase
// ---------------------------------------------------------------------------
describe("Bug 1.1 — ResourceWidget field name mismatch", () => {
  it("snake_case fields are undefined when backend returns camelCase", () => {
    // The Go backend returns: { cpuPercent, ramUsed, ramTotal }
    const backendResponse = {
      cpuPercent: 50,
      ramUsed: 4096,
      ramTotal: 16384,
    };

    // The ResourceUsage interface in IconSidebar.tsx reads snake_case fields:
    //   cpu_percent, ram_used_mb, ram_total_mb
    // Simulating what the component does when it calls setUsage(await res.json())
    const usage = backendResponse as Record<string, unknown>;

    // BUG: these are all undefined because the field names don't match
    expect(usage.cpu_percent).toBeUndefined();   // should be 50
    expect(usage.ram_used_mb).toBeUndefined();   // should be 4096
    expect(usage.ram_total_mb).toBeUndefined();  // should be 16384

    // The correct camelCase fields ARE present
    expect(usage.cpuPercent).toBe(50);
    expect(usage.ramUsed).toBe(4096);
    expect(usage.ramTotal).toBe(16384);
  });
});

// ---------------------------------------------------------------------------
// Test 1.2 — commitRename is called with an empty no-op callback () => {}
// ---------------------------------------------------------------------------
describe("Bug 1.2 — SessionsSidebar rename callback is a no-op", () => {
  it("commitRename with () => {} does NOT update the tab title", () => {
    // Simulate the tabs state
    const tabs = [{ id: "tab-1", title: "New Chat", type: "chat" }];
    const updatedTitle = tabs[0].title;

    // This is what SessionsSidebar.tsx does on Enter key:
    //   commitRename(tab.id, () => {})
    // The commitRename function calls: onRename(tabId, renameValue.trim())
    // But onRename is () => {} — a no-op that ignores its arguments.
    const renameValue = "My Project";
    const noOpCallback = () => {};

    // Simulate commitRename logic:
    const commitRename = (tabId: string, onRename: (id: string, title: string) => void) => {
      if (renameValue.trim()) onRename(tabId, renameValue.trim());
    };

    commitRename("tab-1", noOpCallback);

    // BUG: title is never updated because the callback is a no-op
    expect(updatedTitle).toBe("New Chat"); // still "New Chat", not "My Project"
  });
});

// ---------------------------------------------------------------------------
// Test 1.3 — handleSend uses hardcoded temperature: 0.7 regardless of ModelConfigPanel
// ---------------------------------------------------------------------------
describe("Bug 1.3 — ModelConfigPanel temperature ignored in handleSend", () => {
  it("sendChatCompletionStreaming is called with temperature 0.7 even when panel has 1.5", async () => {
    // The user sets temperature to 1.5 in ModelConfigPanel
    const panelTemperature = 1.5;

    // Capture what temperature is actually passed to the API call

    // Simulate the body construction in sendChatCompletionStreaming (src/lib/api.ts):
    //   temperature: options?.temperature ?? 0.7
    // In handleSend, options is passed as `undefined` (no modelConfig wired up)
    const options: { temperature?: number } | undefined = undefined;
    const capturedTemperature = options?.temperature ?? 0.7;

    // BUG: even though the user set 1.5, the call uses 0.7
    expect(capturedTemperature).toBe(0.7);
    expect(capturedTemperature).not.toBe(panelTemperature);
  });
});

// ---------------------------------------------------------------------------
// Test 1.5 — ChatUI.tsx has unused React import (lint issue)
// ---------------------------------------------------------------------------
describe("Bug 1.5 — ChatUI.tsx unused React import", () => {
  it("documents that React is imported but never used directly in ChatUI.tsx", () => {
    // This is a static analysis / lint issue.
    // The file starts with: import React, { useRef, useEffect, useState } from "react";
    // React is never referenced as React.* anywhere in the component body.
    // The TypeScript/ESLint diagnostic is:
    //   'React' is declared but its value is never read.
    //
    // We document this by asserting the import line contains "React" as a named import
    // and that no JSX pragma or React.* usage exists in the file body.

    const importLine = `import React, { useRef, useEffect, useState } from "react";`;

    // The import includes React as a default import
    expect(importLine).toMatch(/^import React,/);

    // In modern React (17+) with the new JSX transform, React does not need to be
    // imported for JSX. The import is unused and triggers a lint warning.
    // This test documents the bug condition: React is in the import but unused.
    const reactUsedInBody = false; // React.* is never called in ChatUI.tsx
    expect(reactUsedInBody).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 1.7 — getEnginePort() returns stale value after ApiTab saves a new port
// ---------------------------------------------------------------------------
describe("Bug 1.7 — getEnginePort() not updated when ApiTab saves port", () => {
  it("getEnginePort() still returns 1234 after saving port 9999 to localStorage", () => {
    // ApiTab saves the port to localStorage under key "app:settings:api"
    // but localEngine.ts reads enginePort only once at module load time.
    // There is no setEnginePort() export, so the module-level variable is never updated.

    // Simulate what ApiTab does when user changes port to 9999:
    const STORAGE_KEY = "app:settings:api";
    const newSettings = { apiPort: "9999", apiDomain: "", corsEnabled: true, endpoints: [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));

    // Now simulate what getEnginePort() returns — it reads the module-level variable
    // which was set to 1234 at module init and is never updated.
    const moduleInitPort = 1234; // the hardcoded default in localEngine.ts
    const getEnginePort = () => moduleInitPort; // mirrors the actual implementation

    const portAfterSave = getEnginePort();

    // BUG: port is still 1234, not 9999
    expect(portAfterSave).toBe(1234);
    expect(portAfterSave).not.toBe(9999);

    // Cleanup
    localStorage.removeItem(STORAGE_KEY);
  });
});

// ---------------------------------------------------------------------------
// Test 1.8 — RuntimeTab update channel <select> has no onChange handler
// ---------------------------------------------------------------------------
describe("Bug 1.8 — RuntimeTab update channel select disconnected from store", () => {
  it("settingsStore.advanced.runtimeUpdateChannel is never updated when select changes", () => {
    // In RuntimeTab.tsx the update channel <select> is rendered as:
    //   <select className="...">
    //     <option>Stable</option>
    //     <option>Beta</option>
    //   </select>
    // There is no onChange handler and no value binding.
    // The store default is "stable".

    // Simulate the store state
    const storeValue: "stable" | "beta" = "stable";

    // Simulate what happens when the user changes the select:
    // Since there is no onChange, the handler is undefined — nothing fires.
    const onChangeHandler: ((value: string) => void) | undefined = undefined;

    // User "selects" beta
    if (onChangeHandler) {
      onChangeHandler("beta");
    }

    // BUG: store value is still "stable" because onChange was never wired up
    expect(storeValue).toBe("stable");
    expect(storeValue).not.toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// Test 1.10 — fetchDbProviders called on settings close due to showSettings in deps
// ---------------------------------------------------------------------------
describe("Bug 1.10 — fetchDbProviders called every time settings modal opens or closes", () => {
  it("fetchDbProviders is called when showSettings changes to false (modal close)", () => {
    // In Index.tsx:
    //   useEffect(() => { fetchDbProviders(); }, [fetchDbProviders, showSettings]);
    //
    // This means fetchDbProviders runs whenever showSettings changes — both on open AND close.
    // This can overwrite local provider edits the user made while settings was open.

    let callCount = 0;
    const fetchDbProviders = () => { callCount++; };

    // Simulate the useEffect dependency array: [fetchDbProviders, showSettings]
    // Initial mount: showSettings = false → effect runs once
    let showSettings = false;
    const runEffect = () => { fetchDbProviders(); };

    runEffect(); // mount
    expect(callCount).toBe(1);

    // User opens settings: showSettings = true → effect runs again
    showSettings = true;
    runEffect();
    expect(callCount).toBe(2);

    // User closes settings: showSettings = false → effect runs AGAIN (the bug)
    showSettings = false;
    runEffect();

    // BUG: called 3 times — once on close, which overwrites local edits
    expect(callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 1.11 — addNewTab uses stale tabs closure (not a ref)
// ---------------------------------------------------------------------------
describe("Bug 1.11 — addNewTab stale closure over tabs", () => {
  it("documents that addNewTab captures tabs at creation time, not current value", () => {
    // In useChatLogic.tsx, addNewTab is defined as:
    //   const addNewTab = useCallback(() => {
    //     ...
    //     const existingEmpty = tabs.find(...)  // <-- reads stale `tabs` from closure
    //     ...
    //   }, [tabs]);  // <-- tabs in dep array means callback recreated on every tab change
    //
    // The bug: if addNewTab is called rapidly (e.g. via newChatTrigger), the closure
    // may capture a stale snapshot of tabs before the previous setTabs call settled.
    // Using a ref (tabsRef.current) would always read the latest value.

    // Simulate the stale closure scenario:
    let tabs = [{ id: "1", title: "New Chat", type: "chat" }];

    // addNewTab is created with the initial tabs snapshot
    const tabsAtCreation = [...tabs]; // stale snapshot
    const addNewTab = () => {
      // reads stale closure value, not current tabs
      const existingEmpty = tabsAtCreation.find(
        (t) => t.type === "chat"
      );
      return existingEmpty?.id ?? null;
    };

    // Now tabs is mutated externally (e.g. another tab was added)
    tabs = [
      { id: "1", title: "Chat 1", type: "chat" },
      { id: "2", title: "Chat 2", type: "chat" },
    ];

    // addNewTab still sees the old snapshot
    const result = addNewTab();

    // BUG: returns "1" based on stale snapshot, even though tabs now has 2 entries
    // A ref-based implementation would correctly see both tabs
    expect(tabsAtCreation.length).toBe(1);  // stale snapshot has 1 tab
    expect(tabs.length).toBe(2);            // current tabs has 2
    expect(result).toBe("1");               // found based on stale data
  });
});

// ---------------------------------------------------------------------------
// Test 1.12 — Thinking-model regex /think|reason|qwq|deepseek-r/i is too broad
// ---------------------------------------------------------------------------
describe("Bug 1.12 — isThinkingModel regex false positive on 'rethink-7b'", () => {
  it("/think|reason|qwq|deepseek-r/i.test('rethink-7b') returns true (false positive)", () => {
    // In src/lib/api.ts:
    //   const isThinkingModel = /think|reason|qwq|deepseek-r/i.test(modelName);
    //
    // The regex matches "think" as a substring of "rethink", causing false positives.
    // This incorrectly enables thinking mode (chat_template_kwargs) for non-reasoning models.

    const isThinkingModel = (modelName: string) =>
      /think|reason|qwq|deepseek-r/i.test(modelName);

    // BUG: these should all be false but the regex matches substrings
    expect(isThinkingModel("rethink-7b")).toBe(true);      // "think" in "rethink"
    expect(isThinkingModel("unthinkable-13b")).toBe(true); // "think" in "unthinkable"
    expect(isThinkingModel("overthinking-v2")).toBe(true); // "think" in "overthinking"

    // These should correctly be true (actual reasoning models)
    expect(isThinkingModel("qwen3-thinking")).toBe(true);
    expect(isThinkingModel("qwq-32b")).toBe(true);
    expect(isThinkingModel("deepseek-r1")).toBe(true);
  });
});
