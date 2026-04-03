import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Download,
  RefreshCw,
  CheckCircle2,
  WandSparkles,
  Pause,
  Volume2,
  Save,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ApiProvider } from "@/types";
import { getProviderModelPref } from "@/lib/providerModelPrefs";
import { sendBackendProviderSpeech } from "@/lib/api";

type VoiceMode = "offline" | "online";

type TTSPanelProps = {
  mode: VoiceMode;
  providers: ApiProvider[];
};

type Voice = {
  id: string;
  name: string;
  language: string;
  tags: string[];
  isLocal: boolean;
};

type TTSConfig = {
  stability: number;
  clarity: number;
  speed: number;
  pitch: number;
  emotion: string;
};

const OFFLINE_MODELS = ["browser-neural", "browser-standard"];
const ONLINE_MODELS = ["gpt-4o-mini-tts", "gpt-4o-audio-preview", "tts-1", "tts-1-hd"];
const LANG_OPTIONS = ["en-US", "en-GB", "hi-IN", "es-ES", "fr-FR"];

const ONLINE_VOICES = ["alloy", "verse", "aria", "nova", "echo", "fable", "onyx", "shimmer"];

const VoiceCard: React.FC<{
  voice: Voice;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ voice, isSelected, onSelect }) => (
  <button
    onClick={onSelect}
    className={`w-full p-2.5 rounded-lg border transition-all duration-200 text-left group relative overflow-hidden ${
      isSelected
        ? "bg-indigo-500/12 border-indigo-400/40"
        : "bg-white/[0.03] border-white/10 hover:bg-white/[0.05]"
    }`}
  >
    <div className="flex items-center justify-between mb-1.5">
      <div className="flex items-center gap-2">
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-semibold ${
            isSelected ? "bg-indigo-500 text-white" : "bg-white/10 text-zinc-400"
          }`}
        >
          {voice.name.substring(0, 2).toUpperCase()}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-white tracking-tight">{voice.name}</h4>
          <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{voice.language}</p>
        </div>
      </div>
      {voice.isLocal && (
        <div className="p-1 bg-emerald-500/10 rounded text-emerald-500">
          <CheckCircle2 size={10} />
        </div>
      )}
    </div>

    <div className="flex flex-wrap gap-1 mt-2">
      {voice.tags.map((tag) => (
        <span key={tag} className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] text-zinc-500 uppercase tracking-wider">
          {tag}
        </span>
      ))}
    </div>

    {isSelected && (
      <motion.div
        layoutId="voice-active-glow"
        className="absolute -bottom-3 -right-3 w-10 h-10 bg-indigo-500/20 blur-xl rounded-full"
      />
    )}
  </button>
);

export const TTSPanel: React.FC<TTSPanelProps> = ({ mode, providers }) => {
  const [ttsText, setTTSText] = useState("");
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>({
    stability: 0.65,
    clarity: 0.78,
    speed: 1,
    pitch: 1,
    emotion: "Balanced",
  });
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState(OFFLINE_MODELS[0]);
  const [selectedLang, setSelectedLang] = useState(LANG_OPTIONS[0]);
  const [onlineVoice, setOnlineVoice] = useState(ONLINE_VOICES[0]);
  const [statusText, setStatusText] = useState("Ready");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [savedCount, setSavedCount] = useState(0);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const onlineProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.baseUrl && p.apiKey),
    [providers],
  );

  const selectedProvider = useMemo(() => onlineProviders[0] ?? null, [onlineProviders]);

  const onlineModels = useMemo(() => {
    if (!selectedProvider) return ONLINE_MODELS;
    const pref = getProviderModelPref(selectedProvider.id);
    const ttsModels = (pref?.selections || [])
      .filter((s) => s.modelType === "tts")
      .map((s) => s.modelId)
      .filter(Boolean);
    // Strictly use TTS-tagged models from Settings when provider prefs exist.
    if (pref) {
      return Array.from(new Set(ttsModels));
    }
    return ONLINE_MODELS;
  }, [selectedProvider]);

  useEffect(() => {
    const models = mode === "offline" ? OFFLINE_MODELS : onlineModels;
    setSelectedModel(models[0] ?? "");
  }, [mode, onlineModels]);

  const offlineVoices = useMemo(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return [];
    const browserVoices = window.speechSynthesis.getVoices();
    return browserVoices.map((v, i) => ({
      id: `${v.name}-${i}`,
      name: v.name,
      language: v.lang,
      tags: [v.default ? "Default" : "Alt", v.localService ? "Local" : "Remote"],
      isLocal: v.localService,
    }));
  }, []);

  const voices = useMemo<Voice[]>(() => {
    if (mode === "offline") {
      if (offlineVoices.length > 0) return offlineVoices;
      return [
        { id: "fallback-1", name: "System Voice", language: "en-US", tags: ["Local", "Fallback"], isLocal: true },
      ];
    }

    return ONLINE_VOICES.map((name, idx) => ({
      id: `api-${name}-${idx}`,
      name,
      language: "API",
      tags: ["Cloud", "Low Latency"],
      isLocal: false,
    }));
  }, [mode, offlineVoices]);

  useEffect(() => {
    setSelectedVoice((prev) => {
      if (prev && voices.some((v) => v.id === prev.id)) return prev;
      return voices[0] ?? null;
    });
  }, [voices]);

  const filteredVoices = voices.filter(
    (v) =>
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const speakOffline = () => {
    if (!window.speechSynthesis) {
      setStatusText("Speech synthesis is not available in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(ttsText);
    const browserVoices = window.speechSynthesis.getVoices();
    const matched = browserVoices.find((v) => v.name === selectedVoice?.name);

    if (matched) {
      utterance.voice = matched;
      utterance.lang = matched.lang;
    } else {
      utterance.lang = selectedLang;
    }

    utterance.rate = ttsConfig.speed;
    utterance.pitch = ttsConfig.pitch;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setStatusText("Speaking via local engine");
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setStatusText("Playback complete");
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const speakOnline = async () => {
    if (!selectedProvider) {
      setStatusText("Enable an API provider in Settings > Providers.");
      return;
    }

    setIsGenerating(true);
    setStatusText("Generating from API...");

    try {
      const blob = await sendBackendProviderSpeech(
        selectedProvider.id,
        selectedModel,
        selectedVoice?.name || onlineVoice,
        ttsText,
        "mp3",
      );
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStatusText("Online audio ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatusText(`Generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (!ttsText.trim()) {
      setStatusText("Type text first");
      return;
    }

    if (mode === "offline") {
      speakOffline();
      return;
    }

    void speakOnline();
  };

  const stopSpeaking = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setStatusText("Stopped");
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `tts-output-${Date.now()}.mp3`;
    a.click();
  };

  const savePreset = () => {
    const payload = {
      model: selectedModel,
      language: selectedLang,
      voice: selectedVoice?.name || onlineVoice,
      config: ttsConfig,
    };
    localStorage.setItem("voice-lab-tts-preset", JSON.stringify(payload));
    setSavedCount((prev) => prev + 1);
    setStatusText("Preset saved");
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-[rgb(16,18,24)]">
      <div className="mx-auto w-full max-w-6xl p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
            <WandSparkles size={14} className="text-indigo-400" />
            <span className="text-[11px] font-medium text-zinc-200">Text to Speech</span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1">
            {ttsText.length} / 5000
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-4">
          <section className="rounded-xl border border-white/10 bg-[rgb(18,21,29)] p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <DropdownField
                label="Model"
                value={selectedModel}
                onChange={setSelectedModel}
                options={(mode === "offline" ? OFFLINE_MODELS : onlineModels).map((model) => ({
                  value: model,
                  label: model,
                })).concat(mode === "online" && onlineModels.length === 0
                  ? [{ value: "", label: "No TTS models assigned" }]
                  : [])}
              />
              <DropdownField
                label="Language"
                value={selectedLang}
                onChange={setSelectedLang}
                options={LANG_OPTIONS.map((lang) => ({ value: lang, label: lang }))}
              />
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Engine</div>
                <div className="text-[11px] text-zinc-300 mt-1">
                  {mode === "offline" ? "Local Browser Voice" : "Settings Provider Auto"}
                </div>
              </div>
            </div>

            <textarea
              value={ttsText}
              onChange={(e) => setTTSText(e.target.value)}
              placeholder="Write text to generate speech"
              className="w-full h-40 rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400/40 resize-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !ttsText.trim()}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    isGenerating || !ttsText.trim()
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : "bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                  }`}
                >
                  {isGenerating ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  {isGenerating ? "Generating" : mode === "offline" ? "Speak" : "Generate"}
                </button>

                {mode === "offline" && isSpeaking ? (
                  <button
                    onClick={stopSpeaking}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300"
                  >
                    <Pause size={12} />
                    Stop
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <button className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-colors">
                  <Download size={14} />
                </button>
                <button
                  onClick={handleGenerate}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-300 hover:bg-white/[0.06] transition-colors"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
              <div className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                <span>Preview</span>
                <span>{selectedVoice?.name || "None"}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-400/70" style={{ width: isSpeaking ? "74%" : "18%" }} />
              </div>
              <div className="text-[11px] text-zinc-500">{statusText}</div>
              {audioUrl ? <audio controls src={audioUrl} className="w-full h-8" /> : null}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-xl border border-white/10 bg-[rgb(18,21,29)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Voices</span>
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-24 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400/40"
                />
              </div>
              {mode === "online" ? (
                <DropdownField
                  label="API Voice"
                  value={onlineVoice}
                  onChange={setOnlineVoice}
                  options={ONLINE_VOICES.map((v) => ({ value: v, label: v }))}
                />
              ) : null}
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {filteredVoices.map((voice) => (
                  <VoiceCard
                    key={voice.id}
                    voice={voice}
                    isSelected={selectedVoice?.id === voice.id}
                    onSelect={() => {
                      setSelectedVoice(voice);
                      if (mode === "online") setOnlineVoice(voice.name);
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-[rgb(18,21,29)] p-4 space-y-3">
              <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Settings</span>
              <ControlSlider
                label="Stability"
                value={ttsConfig.stability}
                onChange={(v) => setTTSConfig((prev) => ({ ...prev, stability: v }))}
              />
              <ControlSlider
                label="Clarity"
                value={ttsConfig.clarity}
                onChange={(v) => setTTSConfig((prev) => ({ ...prev, clarity: v }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <ControlSlider
                  label="Speed"
                  value={ttsConfig.speed}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onChange={(v) => setTTSConfig((prev) => ({ ...prev, speed: v }))}
                />
                <ControlSlider
                  label="Pitch"
                  value={ttsConfig.pitch}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onChange={(v) => setTTSConfig((prev) => ({ ...prev, pitch: v }))}
                />
              </div>
              <button className="w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-300 flex items-center justify-between">
                <span>{ttsConfig.emotion}</span>
                <Volume2 size={13} className="text-zinc-500" />
              </button>
            </section>

            {mode === "online" && onlineProviders.length === 0 ? (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[11px] text-amber-200">
                No online provider available. Add and enable one in Settings, then assign TTS models in Providers.
              </section>
            ) : null}
          </aside>
        </div>

        <section className="rounded-xl border border-white/10 bg-[rgb(18,21,29)] p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-[220px]">
              <button
                onClick={handleGenerate}
                disabled={!ttsText.trim() || isGenerating}
                className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                <Play size={16} fill="currentColor" />
              </button>
              <div className="flex-1 space-y-1.5">
                <div className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                  <span>Output</span>
                  <span>{selectedVoice?.name || onlineVoice || "Voice"}</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-400/70" style={{ width: audioUrl || isSpeaking ? "68%" : "8%" }} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={downloadAudio}
                disabled={!audioUrl}
                className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors disabled:opacity-40"
              >
                <Download size={15} />
              </button>
              <button
                onClick={savePreset}
                className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
              >
                <Save size={15} />
              </button>
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-300 hover:bg-white/[0.06] transition-colors"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            </div>
          </div>
          {savedCount > 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500">Presets saved: {savedCount}</div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

const DropdownField = ({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) => (
  <label className="space-y-1.5 block">
    <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-400/40"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-[rgb(16,18,24)]">
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);

const ControlSlider = ({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center">
      <label className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">{label}</label>
      <span className="text-[10px] font-mono text-indigo-300">{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-400"
    />
  </div>
);
