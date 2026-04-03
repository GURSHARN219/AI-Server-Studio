import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Copy, Download, Image as ImageIcon, Loader2, Play, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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

function getDefaultModelId(options: string[], providerId: string, mediaType: MediaType): string {
  const pref = getProviderModelPref(providerId);
  const selection = pref?.selections?.find((s) => s.modelType === mediaType);
  const fromPref = selection?.modelId || pref?.defaultModel;
  if (fromPref && options.includes(fromPref)) return fromPref;

  const fromStorageKey = mediaType === "image" ? STORAGE_MEDIA_MODEL_IMAGE : STORAGE_MEDIA_MODEL_VIDEO;
  const fromStorage = localStorage.getItem(fromStorageKey) || "";
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

export default function MediaPage({ providers }: MediaPageProps) {
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [quality, setQuality] = useState<Quality>("standard");
  const [videoDuration, setVideoDuration] = useState<VideoDuration>("4");

  const availableProviders = useMemo(() => {
    return providers.filter((p) => p.enabled && Boolean(p.baseUrl) && (p.id === "local" || Boolean(p.apiKey)));
  }, [providers]);

  const [providerId, setProviderId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_MEDIA_PROVIDER) || "";
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
      localStorage.setItem(STORAGE_MEDIA_PROVIDER, providerId);
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
    if (allowed.length) return allowed;
    return (fetchedModels || []).map((m) => String(m.id || "")).filter(Boolean);
  }, [providerId, fetchedModels]);

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
      localStorage.setItem(key, modelId);
    } catch {
      // ignore
    }
  }, [mediaType, modelId]);

  const promptPlaceholder = useMemo(() => {
    return mediaType === "image"
      ? "A minimal, modern product photo of a matte black smartwatch on a clean desk, soft studio lighting"
      : "A smooth cinematic pan across a neon-lit city street at night, shallow depth of field";
  }, [mediaType]);

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
        setResult({
          kind: "image",
          prompt: trimmed,
          createdAt: Date.now(),
          aspectRatio,
          quality,
          outputUrl: url,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image generation failed";
        setErrorMessage(msg);
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    window.setTimeout(() => {
      setResult({
        kind: mediaType,
        prompt: trimmed,
        createdAt: Date.now(),
        aspectRatio,
        quality,
        videoDuration: mediaType === "video" ? videoDuration : undefined,
      });
      setIsGenerating(false);
    }, 900);
  };

  const onCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt.trim());
    } catch {
      // best-effort; no UI noise for now
    }
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
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-secondary/30">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Clapperboard className="w-3 h-3 text-primary" />
          </div>
          <span className="text-xs font-semibold text-foreground">Media Studio</span>
          <span className="text-[10px] text-muted-foreground">Image / Video</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setMediaType("image");
              setResult(null);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              mediaType === "image"
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
            }`}
          >
            <ImageIcon className="w-3 h-3" />
            Image
          </button>
          <button
            onClick={() => {
              setMediaType("video");
              setResult(null);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              mediaType === "video"
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
            }`}
          >
            <Video className="w-3 h-3" />
            Video
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-styled min-h-0">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5">
              <Card className="bg-card/60">
                <CardHeader className="p-4 pb-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-foreground">Prompt</Label>
                    <span className="text-[10px] text-muted-foreground">Be specific. Mention lighting, lens, motion.</span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Provider</Label>
                      <Select value={providerId} onValueChange={(v) => { setProviderId(v); setResult(null); setErrorMessage(null); }}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={availableProviders.length ? "Select" : "No providers"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableProviders.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Model</Label>
                      <Select value={modelId} onValueChange={(v) => { setModelId(v); setResult(null); setErrorMessage(null); }}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder={modelOptions.length ? "Select" : "No models"} />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={promptPlaceholder}
                    className="min-h-[140px] resize-none bg-transparent text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/80 scrollbar-styled"
                  />

                  <div className="grid grid-cols-2 gap-3">
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
                          <SelectItem value="hd">HD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {mediaType === "video" && (
                      <div className="space-y-1.5 col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Duration</Label>
                        <Select value={videoDuration} onValueChange={(v) => setVideoDuration(v as VideoDuration)}>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2s</SelectItem>
                            <SelectItem value="4">4s</SelectItem>
                            <SelectItem value="8">8s</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 flex gap-2">
                  <Button className="flex-1" onClick={onGenerate} disabled={!prompt.trim() || isGenerating}>
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        Generate {mediaType === "image" ? "Image" : "Video"}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={onCopyPrompt}
                    disabled={!prompt.trim()}
                    title="Copy prompt"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </CardFooter>

                {errorMessage && (
                  <div className="px-4 pb-4 -mt-2 text-xs text-destructive">
                    {errorMessage}
                  </div>
                )}
              </Card>
            </div>

            <div className="lg:col-span-7">
              <Card className="overflow-hidden">
                <CardHeader className="p-4 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">Preview</span>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={onDownload} disabled={!result}>
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Download
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="relative w-full min-h-[360px] rounded-md border border-border bg-secondary/10 overflow-hidden">
                    {!result && !isGenerating && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
                        <div className="w-11 h-11 rounded-md bg-secondary/30 flex items-center justify-center mb-3">
                          {mediaType === "image" ? <ImageIcon className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                        </div>
                        <div className="text-sm font-medium text-foreground">Nothing generated yet</div>
                        <div className="text-xs mt-1">Your output will appear here.</div>
                      </div>
                    )}

                    {isGenerating && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-xs">Generating preview…</span>
                      </div>
                    )}

                    {result && !isGenerating && result.kind === "image" && result.outputUrl && (
                      <div className="relative">
                        <img
                          src={result.outputUrl}
                          alt="Generated image"
                          className="w-full h-[360px] object-contain bg-background"
                        />
                      </div>
                    )}

                    {result && !isGenerating && !(result.kind === "image" && result.outputUrl) && (
                      <div className="relative">
                        <div className="w-full h-[360px] flex items-center justify-center bg-secondary/10">
                          <div className="flex flex-col items-center gap-2 text-center px-6">
                            <div className="w-12 h-12 rounded-md bg-secondary/40 flex items-center justify-center border border-border">
                              {result.kind === "image" ? (
                                <ImageIcon className="h-5 w-5 text-foreground" />
                              ) : (
                                <Video className="h-5 w-5 text-foreground" />
                              )}
                            </div>
                            <div className="text-sm font-medium text-foreground">
                              {result.kind === "image" ? "Image request ready" : "Video request ready"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {result.aspectRatio} • {result.quality === "hd" ? "HD" : "Standard"}
                              {result.kind === "video" && result.videoDuration ? ` • ${result.videoDuration}s` : ""}
                            </div>
                          </div>

                          {result.kind === "video" && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-11 h-11 rounded-full bg-background/40 backdrop-blur flex items-center justify-center border border-border">
                                <Play className="h-5 w-5 text-foreground" />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {result && !isGenerating && (
                    <div className="mt-3 text-[11px] text-muted-foreground line-clamp-2">
                      <span className="text-foreground/80">Prompt:</span> {result.prompt}
                    </div>
                  )}

                  {mediaType === "video" && (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Video generation is UI-only right now (no backend route wired). Export the request JSON or hook up a provider endpoint.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
