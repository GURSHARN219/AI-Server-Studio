import { useState } from "react";
import { useEffect, useMemo } from "react";
import { Mic, Volume2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { STTPanel } from "@/components/voice/STTPanel";
import { TTSPanel } from "@/components/voice/TTSPanel";
import type { ApiProvider } from "@/types";

type VoiceTab = "stt" | "tts";
type VoiceMode = "offline" | "online";

type VoicePageProps = {
  mode: VoiceMode;
  providers: ApiProvider[];
};

export default function VoicePage({ mode, providers }: VoicePageProps) {
  const [activeTab, setActiveTab] = useState<VoiceTab>("stt");
  const [panelMode, setPanelMode] = useState<VoiceMode>(mode);

  useEffect(() => {
    setPanelMode(mode);
  }, [mode]);

  const onlineProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.baseUrl),
    [providers],
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-surface-canvas">
      <div className="h-12 shrink-0 border-b border-edge-subtle px-4 md:px-5 flex items-center justify-between bg-surface-canvas">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight text-white">Voice</h1>
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Studio</span>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg border border-white/10 bg-white/[0.03]">
          <button
            onClick={() => setActiveTab("stt")}
            className={`relative px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              activeTab === "stt" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {activeTab === "stt" && <motion.div layoutId="voice-tab-active" className="absolute inset-0 rounded-md bg-indigo-500/20 border border-indigo-400/40" />}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Mic size={13} />
              STT
            </span>
          </button>

          <button
            onClick={() => setActiveTab("tts")}
            className={`relative px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              activeTab === "tts" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {activeTab === "tts" && <motion.div layoutId="voice-tab-active" className="absolute inset-0 rounded-md bg-indigo-500/20 border border-indigo-400/40" />}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Volume2 size={13} />
              TTS
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg border border-white/10 bg-white/[0.03]">
          <button
            onClick={() => setPanelMode("offline")}
            className={`relative px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              panelMode === "offline" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {panelMode === "offline" && (
              <motion.div
                layoutId="voice-mode-active"
                className="absolute inset-0 rounded-md bg-emerald-500/15 border border-emerald-400/40"
              />
            )}
            <span className="relative z-10">Offline</span>
          </button>
          <button
            onClick={() => setPanelMode("online")}
            className={`relative px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              panelMode === "online" ? "text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {panelMode === "online" && (
              <motion.div
                layoutId="voice-mode-active"
                className="absolute inset-0 rounded-md bg-sky-500/15 border border-sky-400/40"
              />
            )}
            <span className="relative z-10">Online APIs</span>
          </button>
        </div>

        <div className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">
          Online Providers: <span className="text-zinc-300">{onlineProviders.length}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false}>
          {activeTab === "stt" ? (
            <motion.div
              key="voice-stt"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              <STTPanel mode={panelMode} providers={providers} />
            </motion.div>
          ) : (
            <motion.div
              key="voice-tts"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              <TTSPanel mode={panelMode} providers={providers} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
