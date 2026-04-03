# AI Server Studio – Refactoring, Bug Fixes & llama.cpp Plan

## Phase 1: Performance – Decompose Monolith Files
- [/] Split [ChatPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx) (2129 lines) into focused components + hooks
- [ ] Split [SettingsPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx) (1544 lines) into tab components
- [ ] Split [api.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts) (888 lines) into domain modules
- [ ] Memoize expensive components (MessageBubble, model list, etc.)

## Phase 2: Bug Fixes ✅
- [x] Fix stale closure in handleSend (messagesMapRef)
- [x] Fix selectedModel declared before useEffect
- [x] Fix missing useEffect dependencies
- [x] Fix MCP enabled missing on new servers
- [x] Fix toggleMcpStatus → toggleMcpEnabled
- [x] Fix regenerate button (was no-op)
- [x] Fix session search input (was dead)
- [x] Fix calculator injection (safe math evaluator)

## Phase 3: llama.cpp Local Integration Plan
- [ ] Design llama.cpp integration architecture
- [ ] Document the plan for real local inference
