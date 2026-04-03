import { useSettingsStore } from "@/stores/settingsStore";
import { SelectField, ToggleField, SliderField, SegmentField, SectionHeader } from "./Primitives";

export default function AppearanceTab() {
  const { appearance: s, setAppearance: set } = useSettingsStore();

  return (
    <div className="space-y-1">
      <SelectField label="Color Theme" value={s.colorTheme} onChange={v => set("colorTheme", v as any)} options={[
        { value: "auto",  label: "Auto" },
        { value: "dark",  label: "Dark" },
        { value: "light", label: "Light" },
      ]} />
      <SelectField label="Navigation Bar position" value={s.navBarPosition} onChange={v => set("navBarPosition", v as any)} options={[
        { value: "left",   label: "Left" },
        { value: "right",  label: "Right" },
        { value: "bottom", label: "Bottom" },
      ]} />

      <SectionHeader>Chat Style</SectionHeader>

      <SelectField label="View Mode" value={s.viewMode} onChange={v => set("viewMode", v as any)} options={[
        { value: "markdown", label: "Markdown" },
        { value: "plain",    label: "Plain text" },
      ]} />
      <ToggleField label="Show tab strip scrollbar" value={s.showTabStripScrollbar} onChange={v => set("showTabStripScrollbar", v)} />
      <SliderField label="Font Size" value={s.fontSize} onChange={v => set("fontSize", v)} min={10} max={22} reset={() => set("fontSize", 14)} />
      <SelectField label="Font Weight" value={s.fontWeight} onChange={v => set("fontWeight", v as any)} options={[
        { value: "light",  label: "Light" },
        { value: "normal", label: "Normal" },
        { value: "medium", label: "Medium" },
        { value: "bold",   label: "Bold" },
      ]} />
      <SelectField label="Show Gen Info" value={s.showGenInfo} onChange={v => set("showGenInfo", v as any)} options={[
        { value: "last", label: "Last message only" },
        { value: "all",  label: "All messages" },
        { value: "none", label: "Never" },
      ]} />
      <ToggleField label="Scroll message to top on send" value={s.scrollToTopOnSend} onChange={v => set("scrollToTopOnSend", v)} />
      <ToggleField label="Auto-latch onto generating message" value={s.autoLatchGenerating} onChange={v => set("autoLatchGenerating", v)} indent />
      <SegmentField label="Chat messages style" value={s.chatMessagesStyle} onChange={v => set("chatMessagesStyle", v as any)} options={[
        { value: "bubble", label: "Bubble" },
        { value: "block",  label: "Block" },
      ]} />
      <ToggleField label="Expand chat container to window width" value={s.expandChatToWindowWidth} onChange={v => set("expandChatToWindowWidth", v)} />

      <SectionHeader>Reasoning</SectionHeader>

      <ToggleField label="Expand reasoning blocks by default" value={s.expandReasoningByDefault} onChange={v => set("expandReasoningByDefault", v)} />
      <ToggleField label="Show reasoning block vignette" value={s.showReasoningVignette} onChange={v => set("showReasoningVignette", v)} />
    </div>
  );
}
