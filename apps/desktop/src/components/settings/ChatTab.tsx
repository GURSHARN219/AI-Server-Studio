import { useMemo } from "react";
import { useSettingsStore, type ChatSettings } from "@/stores/settingsStore";
import { ToggleField, SelectField, SectionHeader } from "./Primitives";
import { useToast } from "@/hooks/use-toast";
import { loadProviderModelPrefs } from "@/lib/providerModelPrefs";
import { importLegacyChats } from "@/stores/accountState";

type ProviderNameMap = Record<string, string>;

export default function ChatTab() {
  const { toast } = useToast();
  const { chat: s, setChat: set, resetOnboarding } = useSettingsStore();

  const sttOptions = useMemo(() => {
    const prefs = loadProviderModelPrefs();
    const providerNames: ProviderNameMap = {};

    const options = [{ value: "", label: "Auto (first STT model)" }];
    Object.entries(prefs).forEach(([providerId, pref]) => {
      const selections = pref.selections || [];
      selections
        .filter((sel) => sel.modelType === "stt")
        .forEach((sel) => {
          const providerLabel = providerNames[providerId] || providerId;
          options.push({
            value: `${providerId}::${sel.modelId}`,
            label: `${providerLabel} · ${sel.modelId}`,
          });
        });
    });

    return options;
  }, []);

  function handleReset() {
    resetOnboarding();
    toast({ title: "Onboarding dialogs reset" });
  }

  return (
    <div className="space-y-1">
      <SectionHeader>Chat Settings</SectionHeader>
      <div className="py-2">
        <button className="text-xs text-primary" onClick={async () => {
          if (!window.confirm("Import shared legacy chats into your currently signed-in account? Only continue if these chats belong to you. Existing chats will be preserved.")) return;
          try { await importLegacyChats(); toast({ title: "Legacy chats imported" }); }
          catch (error) { toast({ title: "Import failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" }); }
        }}>Import legacy chats into this account…</button>
      </div>

      <ToggleField label="Allow only one new empty chat" desc="Allow at most one unsaved new chat tab at a time" value={s.allowOnlyOneNewChat} onChange={v => set("allowOnlyOneNewChat", v)} />
      <ToggleField label="When selecting a model, first unload any currently loaded ones" value={s.unloadOnModelSelect} onChange={v => set("unloadOnModelSelect", v)} />
      <ToggleField label="Move deleted chats and folders to Trash" desc="Chats and folders you delete will be force deleted and cannot be recovered." value={s.moveDeletedToTrash} onChange={v => set("moveDeletedToTrash", v)} />
      <ToggleField label="Double click on a chat message to edit" value={s.doubleClickToEdit} onChange={v => set("doubleClickToEdit", v)} />
      <ToggleField label="Show token count in chat listings" value={s.showTokenCountInList} onChange={v => set("showTokenCountInList", v)} />
      <ToggleField label="Always show prompt template in Chat sidebar" value={s.alwaysShowPromptTemplate} onChange={v => set("alwaysShowPromptTemplate", v)} />
      <ToggleField label="Double click chat/folder renames" value={s.doubleClickRename} onChange={v => set("doubleClickRename", v)} />
      <SelectField label="Sidebar sort" value={s.sidebarSort} onChange={v => set("sidebarSort", v as ChatSettings["sidebarSort"])} options={[
        { value: "recent",       label: "Most recent" },
        { value: "alphabetical", label: "Alphabetical" },
        { value: "created",      label: "Date created" },
      ]} />

      <SelectField
        label="STT model"
        value={s.sttModelKey}
        onChange={v => set("sttModelKey", v)}
        options={sttOptions}
        desc="Used by the mic button for speech-to-text in chat"
      />

      <SectionHeader>Keyboard Shortcuts</SectionHeader>

      <ToggleField label="Use ⇧+Enter to send message" value={s.shiftEnterToSend} onChange={v => set("shiftEnterToSend", v)} />
      <ToggleField label="Use Ctrl+R to regenerate the last message in chat" value={s.ctrlRToRegenerate} onChange={v => set("ctrlRToRegenerate", v)} />

      <SectionHeader>Conversation Auto-Naming</SectionHeader>

      <SelectField
        label="AI-generated Chat Names"
        value={s.autoNaming}
        onChange={v => set("autoNaming", v as ChatSettings["autoNaming"])}
        options={[
          { value: "never",  label: "Never" },
          { value: "auto",   label: "Auto" },
          { value: "always", label: "Always" },
        ]}
        desc="Never: don't create names · Auto: decides based on speed · Always: always create names"
      />

      <SectionHeader>Onboarding Hints</SectionHeader>

      <ToggleField label="Search & Find Onboarding" value={s.searchFindOnboarding} onChange={v => set("searchFindOnboarding", v)} />
      <ToggleField label="LM Link Sidebar Button Popover" value={s.lmLinkSidebarPopover} onChange={v => set("lmLinkSidebarPopover", v)} />
      <ToggleField label="Trash Deletion Onboarding" value={s.trashDeletionOnboarding} onChange={v => set("trashDeletionOnboarding", v)} />
      <div className="py-2">
        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded bg-surface-hover hover:bg-surface-active border border-border/50 text-xs text-foreground transition-colors"
        >
          Reset onboarding dialogs
        </button>
      </div>
    </div>
  );
}
