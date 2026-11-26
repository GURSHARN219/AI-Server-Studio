import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Copy,
  Trash2,
  Upload,
  Languages,
  Sparkles,
  CheckCircle2,
  FileText,
  Info,
  Share2,
} from "lucide-react";
import { motion } from "framer-motion";
import type { ApiProvider } from "@/types";
import { getProviderModelPref } from "@/lib/providerModelPrefs";
import { sendBackendProviderTranscription } from "@/lib/api";

type VoiceMode = "offline" | "online";

type STTPanelProps = {
  mode: VoiceMode;
  providers: ApiProvider[];
};

type STTConfig = {
  translate: boolean;
  timestamps: boolean;
  speakerSeparation: boolean;
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionLikeEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  }
}

const OFFLINE_MODELS = ["whisper-local-base", "whisper-local-small", "whisper-local-medium"];
const ONLINE_MODELS = ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"];
const LANG_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
];

export const STTPanel: React.FC<STTPanelProps> = ({ mode, providers }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [sttTranscript, setSTTTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [selectedModel, setSelectedModel] = useState(OFFLINE_MODELS[0]);
  const [selectedLang, setSelectedLang] = useState("auto");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [statusText, setStatusText] = useState("Ready");
  const [sttConfig, setSTTConfig] = useState<STTConfig>({
    translate: false,
    timestamps: true,
    speakerSeparation: false,
  });

  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  const onlineProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.baseUrl),
    [providers],
  );

  const selectedProvider = useMemo(() => onlineProviders[0] ?? null, [onlineProviders]);

  const onlineModels = useMemo(() => {
    if (!selectedProvider) return ONLINE_MODELS;
    const pref = getProviderModelPref(selectedProvider.id);
    const sttModels = (pref?.selections || [])
      .filter((s) => s.modelType === "stt")
      .map((s) => s.modelId)
      .filter(Boolean);
    // Strictly use STT-tagged models from Settings when provider prefs exist.
    if (pref) {
      return Array.from(new Set(sttModels));
    }
    return ONLINE_MODELS;
  }, [selectedProvider]);

  useEffect(() => {
    const models = mode === "offline" ? OFFLINE_MODELS : onlineModels;
    setSelectedModel(models[0] ?? "");
  }, [mode, onlineModels]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const waveBars = useMemo(() => Array.from({ length: 28 }), []);

  const getRecognitionCtor = () => {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  };

  const startOfflineRecording = () => {
    const RecognitionCtor = getRecognitionCtor();
    if (!RecognitionCtor) {
      setStatusText("Speech recognition is not available in this browser.");
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.lang = selectedLang === "auto" ? "en-US" : `${selectedLang}-${selectedLang.toUpperCase()}`;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionLikeEvent) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalChunk += result[0].transcript;
        }
      }
      if (finalChunk.trim()) {
        setSTTTranscript((prev) => `${prev}${prev ? " " : ""}${finalChunk.trim()}`);
      }
    };

    recognition.onerror = () => {
      setStatusText("Microphone permission denied or recognition error.");
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setStatusText("Recording from microphone");
  };

  const stopOfflineRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
    setStatusText("Recording stopped");
  };

  const runOnlineTranscription = async () => {
    if (!audioFile) {
      setStatusText("Upload an audio file first for online transcription.");
      return;
    }

    if (!selectedProvider) {
      setStatusText("Enable an API provider in Settings > Providers.");
      return;
    }

    setIsTranscribing(true);
    setStatusText("Sending to online API...");

    try {
      const text = await sendBackendProviderTranscription(
        selectedProvider.id,
        selectedModel,
        audioFile,
        {
          language: selectedLang !== "auto" ? selectedLang : undefined,
          translate: sttConfig.translate,
        },
      );
      setSTTTranscript(text);
      setStatusText("Transcription complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatusText(`Transcription failed: ${message}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleRecord = () => {
    if (mode === "online") {
      void runOnlineTranscription();
      return;
    }

    if (isRecording) {
      stopOfflineRecording();
    } else {
      startOfflineRecording();
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-surface-canvas">
      <div className="mx-auto w-full max-w-6xl p-4 md:p-5 min-h-full flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-[1.55fr_0.72fr] gap-4 items-center">
          <section className="rounded-xl border border-edge-subtle bg-surface-card p-4 md:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <DropdownField
                label="Model"
                value={selectedModel}
                onChange={setSelectedModel}
                options={(mode === "offline" ? OFFLINE_MODELS : onlineModels).map((model) => ({
                  value: model,
                  label: model,
                })).concat(mode === "online" && onlineModels.length === 0
                  ? [{ value: "", label: "No STT models assigned" }]
                  : [])}
              />
              <DropdownField
                label="Language"
                value={selectedLang}
                onChange={setSelectedLang}
                options={LANG_OPTIONS}
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 p-4">
              <div className="h-16 flex items-end justify-center gap-1">
                {waveBars.map((_, i) => (
                  <motion.div
                    key={i}
                    animate={isRecording ? { height: [9, Math.random() * 30 + 9, 9] } : { height: 9 }}
                    transition={{ duration: 0.45, repeat: Infinity, delay: i * 0.03 }}
                    className={`w-1 rounded-full ${isRecording ? "bg-indigo-400" : "bg-zinc-700"}`}
                  />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={handleRecord}
                  disabled={isTranscribing}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                    isRecording
                      ? "bg-red-500/15 text-red-300 border border-red-500/30"
                      : "bg-indigo-500/20 text-indigo-200 border border-indigo-400/30 hover:bg-indigo-500/30"
                  } ${isTranscribing ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  {isTranscribing ? <Loader2 size={13} className="animate-spin" /> : null}
                  {!isTranscribing && isRecording ? <Square size={13} fill="currentColor" /> : null}
                  {!isTranscribing && !isRecording ? <Mic size={13} /> : null}
                  {mode === "online"
                    ? isTranscribing
                      ? "Transcribing"
                      : "Transcribe"
                    : isRecording
                      ? "Stop"
                      : "Record"}
                </button>
                <div className="flex items-center gap-1.5">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-white/[0.06] transition-colors">
                    <Upload size={12} />
                    Upload
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <button className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-300">
                    <Languages size={12} />
                    {selectedLang === "auto" ? "Auto" : selectedLang.toUpperCase()}
                  </button>
                </div>
              </div>
              {audioFile ? (
                <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  {audioFile.name}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Transcript</span>
                <div className="flex items-center gap-1">
                  <IconButton icon={<Copy size={13} />} onClick={() => navigator.clipboard.writeText(sttTranscript)} />
                  <IconButton icon={<Trash2 size={13} />} danger onClick={() => setSTTTranscript("")} />
                </div>
              </div>
              <div className="relative">
                <textarea
                  value={sttTranscript}
                  onChange={(e) => setSTTTranscript(e.target.value)}
                  placeholder="Transcript will appear here"
                  className="w-full h-44 rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-400/40 resize-none"
                />
                {isTranscribing && (
                  <div className="absolute inset-0 rounded-lg bg-black/70 flex items-center justify-center gap-2 text-zinc-200 text-xs">
                    <Loader2 size={15} className="animate-spin text-indigo-400" />
                    Processing audio
                  </div>
                )}
              </div>
              <div className="text-[11px] text-zinc-500">{statusText}</div>
            </div>
          </section>

          <aside className="w-full max-w-[340px] justify-self-center flex h-full flex-col justify-center gap-3">
            <section className="rounded-xl border border-edge-subtle bg-surface-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-zinc-200">
                <Sparkles size={14} className="text-indigo-400" />
                <span className="text-xs font-medium">Features</span>
              </div>

              {mode === "online" && onlineProviders.length === 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                  No online provider available. Add and enable one in Settings, then assign STT models in Providers.
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-2">
                <ToggleItem
                  label="Translate"
                  isActive={sttConfig.translate}
                  onClick={() => setSTTConfig((prev) => ({ ...prev, translate: !prev.translate }))}
                />
                <ToggleItem
                  label="Timestamps"
                  isActive={sttConfig.timestamps}
                  onClick={() => setSTTConfig((prev) => ({ ...prev, timestamps: !prev.timestamps }))}
                />
                <ToggleItem
                  label="Speaker Split"
                  isActive={sttConfig.speakerSeparation}
                  onClick={() => setSTTConfig((prev) => ({ ...prev, speakerSeparation: !prev.speakerSeparation }))}
                />
              </div>
            </section>

            <section className="rounded-xl border border-edge-subtle bg-surface-card p-4 space-y-3">
              <div className="flex items-center gap-2 text-zinc-200">
                <FileText size={14} className="text-indigo-400" />
                <span className="text-xs font-medium">Export</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "TXT", ext: "txt" },
                  { label: "SRT", ext: "srt" },
                  { label: "JSON", ext: "json" },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => exportTranscript(sttTranscript, item.ext)}
                    className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-zinc-300 hover:bg-white/[0.06] transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-edge-subtle bg-surface-card p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Words</div>
                  <div className="text-sm font-medium text-zinc-200">{countWords(sttTranscript)}</div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Chars</div>
                  <div className="text-sm font-medium text-zinc-200">{sttTranscript.length}</div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Info size={12} />
                  <span>Quick Actions</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => navigator.clipboard.writeText(sttTranscript)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.06]"
                  >
                    <Copy size={11} />
                    Copy
                  </button>
                  <button
                    onClick={() => shareTranscript(sttTranscript)}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.06]"
                  >
                    <Share2 size={11} />
                    Share
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function exportTranscript(content: string, ext: string): void {
  if (!content.trim()) return;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcript.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function shareTranscript(content: string): void {
  if (!content.trim()) return;
  if (navigator.share) {
    void navigator.share({ title: "Transcript", text: content });
    return;
  }
  void navigator.clipboard.writeText(content);
}

const IconButton = ({
  icon,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`rounded-md border px-2 py-1.5 transition-colors ${
      danger
        ? "border-red-500/30 text-red-300 hover:bg-red-500/10"
        : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
    }`}
  >
    {icon}
  </button>
);

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
        <option key={opt.value} value={opt.value} className="bg-surface-canvas">
          {opt.label}
        </option>
      ))}
    </select>
  </label>
);

const ToggleItem = ({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) => (
  <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2">
    <span className="text-[11px] text-zinc-300">{label}</span>
    <button
      onClick={onClick}
      className={`w-9 h-5 rounded-full transition-all duration-300 relative ${isActive ? "bg-indigo-500" : "bg-white/10"}`}
    >
      <motion.div animate={{ x: isActive ? 18 : 2 }} className="w-4 h-4 bg-white rounded-full absolute top-0.5" />
    </button>
  </div>
);
