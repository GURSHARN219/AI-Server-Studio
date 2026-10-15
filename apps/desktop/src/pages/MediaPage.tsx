import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Clapperboard, Copy, Download, Image as ImageIcon, Loader2, Mic, Play, RefreshCcw, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ApiProvider } from "@/types";
import { fetchBackendProviderModels, sendBackendProviderImageGeneration, type FetchedModel } from "@/lib/api";
import { getProviderModelPref } from "@/lib/providerModelPrefs";

type MediaType = "image" | "video";
type Quality = "standard" | "hd";
type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";
type VideoDuration = "2" | "4" | "8";

type GeneratedResult = {
  kind: MediaType;
  prompt: string;
  createdAt: number;
  aspectRatio: AspectRatio;
  quality: Quality;
  videoDuration?: VideoDuration;
  outputUrl?: string;
};

type MediaPageProps = {
  providers: ApiProvider[];
};

const STORAGE_MEDIA_PROVIDER = "ai-server-media-provider";
const STORAGE_MEDIA_MODEL_IMAGE = "ai-server-media-model-image";
const STORAGE_MEDIA_MODEL_VIDEO = "ai-server-media-model-video";

const IMAGE_MODEL_HINTS = ["image", "img", "flux", "sd", "dall", "recraft", "imagen", "playground"];
const VIDEO_MODEL_HINTS = ["video", "veo", "sora", "kling", "runway", "gen-3", "luma", "pika", "wan", "img2vid", "vid2vid"];
const IMAGE_PARAM_HINTS = ["image", "images", "size", "quality", "background"];
const VIDEO_PARAM_HINTS = ["video", "duration", "fps", "frames", "motion", "frame_rate", "image_to_video", "video_to_video"];

function getDefaultModelId(options: string[], providerId: string, mediaType: MediaType): string {
  const pref = getProviderModelPref(providerId);
  const selection = pref?.selections?.find((s) => s.modelType === mediaType);
  const fromPref = selection?.modelId || pref?.defaultModel;
  if (fromPref && options.includes(fromPref)) return fromPref;

  const fromStorageKey = mediaType === "image" ? STORAGE_MEDIA_MODEL_IMAGE : STORAGE_MEDIA_MODEL_VIDEO;
  const fromStorage = getAccountSetting(fromStorageKey, "");
  if (fromStorage && options.includes(fromStorage)) return fromStorage;

  return options[0] || "";
}

function sizeFromAspect(aspect: AspectRatio): string {
  // OpenAI-compatible sizes; other providers may ignore or map differently.
  switch (aspect) {
    case "16:9":
      return "1792x1024";
    case "9:16":
      return "1024x1792";
    case "1:1":
      return "1024x1024";
    case "4:3":
    default:
      return "1024x1024";
  }
}

function modelMatchesAny(value: string, hints: string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}

function detectModelCapability(model: FetchedModel): "image" | "video" | "both" | "unknown" {
  const id = String(model.id || "").toLowerCase();
  const supported = (model.supported_parameters || []).map((p) => String(p || "").toLowerCase());
  const joined = `${id} ${supported.join(" ")}`;

  const hasImage = modelMatchesAny(joined, IMAGE_MODEL_HINTS) || supported.some((p) => modelMatchesAny(p, IMAGE_PARAM_HINTS));
  const hasVideo = modelMatchesAny(joined, VIDEO_MODEL_HINTS) || supported.some((p) => modelMatchesAny(p, VIDEO_PARAM_HINTS));

  if (hasImage && hasVideo) return "both";
  if (hasImage) return "image";
  if (hasVideo) return "video";
  return "unknown";
}

function hasDraggedImage(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const items = Array.from(dataTransfer.items || []);
  if (items.length > 0) {
    return items.some((item) => item.kind === "file" && item.type.startsWith("image/"));
  }
  if (Array.from(dataTransfer.files || []).some((file) => file.type.startsWith("image/"))) return true;
  return false;
}

export default function MediaPage({ providers }: MediaPageProps) {
  const [mode, setMode] = useState<MediaType>("image");
  const mediaType: MediaType = mode;
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [recent, setRecent] = useState<GeneratedResult[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [isDraggingReference, setIsDraggingReference] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [quality, setQuality] = useState<Quality>("standard");
  const [videoDuration, setVideoDuration] = useState<VideoDuration>("4");
  const [style, setStyle] = useState<string>("default");

  const availableProviders = useMemo(() => {
    return providers.filter((p) => p.enabled && Boolean(p.baseUrl));
  }, [providers]);

  const [providerId, setProviderId] = useState<string>(() => {
    try {
      return getAccountSetting(STORAGE_MEDIA_PROVIDER, "");
    } catch {
      return "";
    }
  });

  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [modelId, setModelId] = useState<string>("");

  useEffect(() => {
    if (!availableProviders.length) return;
    if (providerId && availableProviders.some((p) => p.id === providerId)) return;
    setProviderId(availableProviders[0].id);
  }, [availableProviders, providerId]);

  useEffect(() => {
    if (!providerId) return;
    try {
      setAccountSetting(STORAGE_MEDIA_PROVIDER, providerId);
    } catch {
      // ignore
    }
  }, [providerId]);

  useEffect(() => {
    if (!providerId) {
      setFetchedModels([]);
      return;
    }
    const controller = new AbortController();
    fetchBackendProviderModels(providerId, controller.signal)
      .then((models) => setFetchedModels(models))
      .catch(() => setFetchedModels([]));
    return () => controller.abort();
  }, [providerId]);

  const modelOptions = useMemo(() => {
    if (!providerId) return [] as string[];
    const pref = getProviderModelPref(providerId);
    const allowed = (pref?.allowedModels || []).filter(Boolean);
    const selectionByType = (pref?.selections || [])
      .filter((s) => s.modelType === mediaType)
      .map((s) => String(s.modelId || "").trim())
      .filter(Boolean);

    const allModels = (fetchedModels || []).filter((m) => {
      const id = String(m.id || "");
      return Boolean(id) && (!allowed.length || allowed.includes(id));
    });

    if (selectionByType.length) {
      const availableIds = new Set(allModels.map((m) => String(m.id || "")));
      return Array.from(new Set(selectionByType.filter((id) => availableIds.has(id))));
    }

    const filteredByCapability = allModels
      .filter((m) => {
        const capability = detectModelCapability(m);
        if (mediaType === "image") return capability === "image" || capability === "both";
        return capability === "video" || capability === "both";
      })
      .map((m) => String(m.id || ""))
      .filter(Boolean);

    return Array.from(new Set(filteredByCapability));
  }, [providerId, mediaType, fetchedModels]);

  useEffect(() => {
    if (!providerId) {
      setModelId("");
      return;
    }
    if (!modelOptions.length) {
      setModelId("");
      return;
    }
    if (modelId && modelOptions.includes(modelId)) return;
    setModelId(getDefaultModelId(modelOptions, providerId, mediaType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, mediaType, modelOptions.join("|")]);

  useEffect(() => {
    if (!modelId) return;
    const key = mediaType === "image" ? STORAGE_MEDIA_MODEL_IMAGE : STORAGE_MEDIA_MODEL_VIDEO;
    try {
      setAccountSetting(key, modelId);
    } catch {
      // ignore
    }
  }, [mediaType, modelId]);

  const promptPlaceholder = useMemo(() => {
    return mediaType === "image"
      ? "A minimal, modern product photo of a matte black smartwatch on a clean desk, soft studio lighting"
      : "A smooth cinematic pan across a neon-lit city street at night, shallow depth of field";
  }, [mediaType]);

  const generationModeLabel = useMemo(() => {
    if (!referenceUrl) return "Reference: Off";
    return "Reference: On (auto)";
  }, [referenceUrl]);

  const status = useMemo<"idle" | "generating" | "complete" | "error">(() => {
    if (isGenerating) return "generating";
    if (errorMessage) return "error";
    if (result) return "complete";
    return "idle";
  }, [isGenerating, errorMessage, result]);

  const statusBadge = useMemo(() => {
    switch (status) {
      case "generating":
        return { label: "Generating", variant: "secondary" as const };
      case "complete":
        return { label: "Complete", variant: "default" as const };
      case "error":
        return { label: "Error", variant: "destructive" as const };
      default:
        return { label: "Idle", variant: "secondary" as const };
    }
  }, [status]);

  const timelineProgress = useMemo(() => {
    if (status === "complete") return 100;
    if (status === "generating") return 55;
    if (status === "error") return 15;
    return 0;
  }, [status]);

  const onGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;

    setIsGenerating(true);
    setResult(null);
    setErrorMessage(null);

    if (!providerId) {
      setIsGenerating(false);
      setErrorMessage("Select a provider first.");
      return;
    }
    if (!modelId) {
      setIsGenerating(false);
      setErrorMessage("Select a model first (Settings > Providers can restrict allowed models).");
      return;
    }

    if (mediaType === "image") {
      try {
        const url = await sendBackendProviderImageGeneration(
          providerId,
          modelId,
          trimmed,
          sizeFromAspect(aspectRatio),
        );
        if (!url) throw new Error("Provider returned no image data");
        const next: GeneratedResult = {
          kind: "image",
          prompt: trimmed,
          createdAt: Date.now(),
          aspectRatio,
          quality,
          outputUrl: url,
        };
        setResult(next);
        setRecent((prev) => [next, ...prev].slice(0, 12));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image generation failed";
        setErrorMessage(msg);
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    window.setTimeout(() => {
      const next: GeneratedResult = {
        kind: mediaType,
        prompt: trimmed,
        createdAt: Date.now(),
        aspectRatio,
        quality,
        videoDuration: mediaType === "video" ? videoDuration : undefined,
      };
      setResult(next);
      setRecent((prev) => [next, ...prev].slice(0, 12));
      setIsGenerating(false);
    }, 900);
  };

  const onCopyResultPrompt = async () => {
    if (!result?.prompt) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
    } catch {
      // ignore
    }
  };

  const onPickReference = () => {
    fileInputRef.current?.click();
  };

  const onReferenceFileChange = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  const onPageDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingReference(true);
  };

  const onPageDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDraggingReference) setIsDraggingReference(true);
  };

  const onPageDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingReference(false);
  };

  const onPageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedImage(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingReference(false);
    const imageFile = Array.from(e.dataTransfer.files || []).find((file) => file.type.startsWith("image/")) || null;
    onReferenceFileChange(imageFile);
  };

  const onDownload = () => {
    if (!result) return;

    if (result.kind === "image" && result.outputUrl) {
      if (result.outputUrl.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = result.outputUrl;
        a.download = `open-studio-image-${result.createdAt}.png`;
        a.click();
        return;
      }
      window.open(result.outputUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const payload = {
      kind: result.kind,
      prompt: result.prompt,
      aspectRatio: result.aspectRatio,
      quality: result.quality,
      ...(result.kind === "video" ? { durationSeconds: result.videoDuration } : {}),
      createdAt: new Date(result.createdAt).toISOString(),
      providerId,
      modelId,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `open-studio-${result.kind}-request-${result.createdAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {isDraggingReference && (
        <div className="pointer-events-none fixed inset-0 z-50 bg-primary/10 backdrop-blur-[1px] flex items-center justify-center p-6">
          <div className="rounded-2xl border border-primary/30 bg-background/90 px-6 py-4 text-center shadow-lg">
            <div className="text-sm font-medium text-foreground">Drop image to add reference</div>
            <div className="text-xs text-muted-foreground mt-1">You can drop anywhere on this page.</div>
          </div>
        </div>
      )}

      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-secondary/30">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Clapperboard className="w-3 h-3 text-primary" />
          </div>
          <span className="text-xs font-semibold text-foreground">Media Studio</span>
          <span className="text-[10px] text-muted-foreground">Image / Video</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-styled min-h-0">
        <div className="mx-auto w-full max-w-7xl px-4 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* Left / Main */}
            <main className="lg:col-span-7 flex flex-col gap-3">
              {/* Prompt */}
              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-foreground">Prompt</div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 pt-0 space-y-3">
                  {/* Reference */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onReferenceFileChange(e.target.files?.[0] || null)}
                    />
                    {referenceUrl ? (
                      <div className="group relative w-[76px] h-[76px] rounded-xl overflow-hidden border border-border bg-secondary/20 cursor-pointer" onClick={onPickReference}>
                        <img src={referenceUrl} alt="Reference" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-white/95" />
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceUrl(null);
                          }}
                          title="Remove reference"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onPickReference}
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Add reference"
                      >
                        <ImageIcon className="h-3.5 w-3.5 mr-1" />
                        Add reference
                      </Button>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-background/30 p-3">
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={promptPlaceholder}
                      className="min-h-[132px] resize-none bg-transparent text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/80 scrollbar-styled border-0 px-0 py-0 focus-visible:ring-0"
                    />

                    <div className="mt-3">
                      <Input
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="Negative prompt (optional)"
                        className="h-9 bg-transparent"
                      />
                    </div>

                    <div className="mt-3 flex items-center gap-2 flex-wrap md:flex-nowrap">
                      <Select
                        value={mode}
                        onValueChange={(v) => {
                          setMode(v as MediaType);
                          setResult(null);
                          setErrorMessage(null);
                        }}
                      >
                        <SelectTrigger className="h-9 w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="image">Image</SelectItem>
                          <SelectItem value="video">Video</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={modelId} onValueChange={(v) => { setModelId(v); setResult(null); setErrorMessage(null); }}>
                        <SelectTrigger className="h-9 min-w-[220px] flex-1">
                          <SelectValue placeholder={modelOptions.length ? "Model" : mediaType === "image" ? "No image models" : "No video models"} />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex items-center gap-2 ml-auto">
                        <Button type="button" variant="secondary" size="icon" title="Voice input (coming soon)" disabled>
                          <Mic className="h-4 w-4" />
                        </Button>
                        <Button onClick={onGenerate} disabled={!prompt.trim() || isGenerating} className="min-w-[132px]">
                          {isGenerating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating
                            </>
                          ) : (
                            <>Generate</>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {errorMessage && <div className="text-xs text-destructive">{errorMessage}</div>}
                </CardContent>
              </Card>

              {/* Settings */}
              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div className="text-xs font-semibold text-foreground">Settings</div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Style</Label>
                      <Select value={style} onValueChange={setStyle}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="cinematic">Cinematic</SelectItem>
                          <SelectItem value="product">Product</SelectItem>
                          <SelectItem value="anime">Anime</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Aspect</Label>
                      <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as AspectRatio)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1:1">1:1</SelectItem>
                          <SelectItem value="16:9">16:9</SelectItem>
                          <SelectItem value="9:16">9:16</SelectItem>
                          <SelectItem value="4:3">4:3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Quality</Label>
                      <Select value={quality} onValueChange={(v) => setQuality(v as Quality)}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="hd">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Duration</Label>
                      <Select value={videoDuration} onValueChange={(v) => setVideoDuration(v as VideoDuration)} disabled={mediaType !== "video"}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2s</SelectItem>
                          <SelectItem value="4">5s</SelectItem>
                          <SelectItem value="8">8s</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent */}
              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">Recent</div>
                    <div className="text-[11px] text-muted-foreground">Latest generations</div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex gap-2 flex-wrap">
                    {recent.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground">No recent items yet.</div>
                    ) : (
                      recent.map((item) => (
                        <button
                          key={item.createdAt}
                          className="w-[132px] rounded-xl overflow-hidden border border-border bg-background/20 text-left hover:bg-surface-hover transition-colors"
                          onClick={() => {
                            setResult(item);
                            setPrompt(item.prompt);
                            setAspectRatio(item.aspectRatio);
                            setQuality(item.quality);
                            if (item.videoDuration) setVideoDuration(item.videoDuration);
                          }}
                        >
                          <div className="h-[96px] bg-secondary/30 flex items-center justify-center">
                            {item.kind === "image" && item.outputUrl ? (
                              <img src={item.outputUrl} alt="thumb" className="w-full h-full object-cover" />
                            ) : (
                              <div className="text-[11px] text-muted-foreground">{item.kind.toUpperCase()}</div>
                            )}
                          </div>
                          <div className="p-2 text-[11px] text-muted-foreground line-clamp-2">{item.prompt}</div>
                        </button>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </main>

            {/* Right / Preview */}
            <aside className="lg:col-span-5 flex flex-col gap-3">
              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-foreground">Preview</div>
                      <div className="text-[11px] text-muted-foreground">Current output</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusBadge.variant} className="text-[10px]">
                        {statusBadge.label}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {quality === "hd" ? "1080p" : "Standard"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary/20">
                    <div className="aspect-[16/11] w-full">
                      {!result && !isGenerating && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
                          <div className="w-12 h-12 rounded-xl bg-secondary/30 border border-border flex items-center justify-center mb-3">
                            {mediaType === "image" ? <ImageIcon className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                          </div>
                          <div className="text-sm font-medium text-foreground">No output yet</div>
                          <div className="text-xs mt-1">Generate to see preview here.</div>
                        </div>
                      )}

                      {isGenerating && (
                        <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-xs">Rendering…</span>
                        </div>
                      )}

                      {result && !isGenerating && result.kind === "image" && result.outputUrl && (
                        <img src={result.outputUrl} alt="Generated" className="w-full h-full object-cover" />
                      )}

                      {result && !isGenerating && !(result.kind === "image" && result.outputUrl) && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-14 h-14 rounded-full bg-background/40 backdrop-blur border border-border flex items-center justify-center">
                            <Play className="h-6 w-6 text-foreground" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">Output Actions</div>
                    <div className="text-[11px] text-muted-foreground">Minimal quick tools</div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="icon" onClick={onDownload} disabled={!result} title="Download">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => {
                        if (!result) return;
                        setPrompt(result.prompt);
                        setResult(null);
                        setErrorMessage(null);
                      }}
                      disabled={!result}
                      title="Remix"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" size="icon" onClick={() => setQuality("hd")} title="Upscale">
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    <Button variant="secondary" size="icon" onClick={onCopyResultPrompt} disabled={!result} title="Copy prompt">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div>
                    <div className="text-xs font-semibold text-foreground">Timeline</div>
                    <div className="text-[11px] text-muted-foreground">Render status</div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                    <div className="text-[11px] text-muted-foreground">{generationModeLabel}</div>
                  <div className="text-[11px] text-muted-foreground">Queued → Rendering → Complete</div>
                  <Progress value={timelineProgress} className="h-2" />
                  {mediaType === "video" && (
                    <div className="text-[11px] text-muted-foreground">
                      Video generation is UI-only right now (no backend route wired).
                    </div>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
import { getAccountSetting, setAccountSetting } from "@/stores/accountState";
