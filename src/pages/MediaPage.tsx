import { useState } from "react";
import { Copy, Download, Image as ImageIcon, Loader2, Sparkles, Video, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function MediaPage() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // Settings
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [quality, setQuality] = useState("standard");
  const [style, setStyle] = useState("realistic");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setResultUrl(null);
    
    // Simulate generation delay
    setTimeout(() => {
      setIsGenerating(false);
      // Placeholder based on type
      if (mediaType === "image") {
        setResultUrl("https://images.unsplash.com/photo-1707343843437-caacff5cfa74?q=80&w=1080&auto=format&fit=crop");
      } else {
        // Placeholder for video (could just be a poster image or simple video link)
        setResultUrl("https://images.unsplash.com/photo-1707344088636-3607e6e580a5?q=80&w=1080&auto=format&fit=crop");
      }
    }, 3000);
  };

  return (
    <div className="flex h-full w-full flex-col p-6 max-w-5xl mx-auto overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Media Studio</h1>
        <p className="text-muted-foreground">
          Generate stunning images and videos using advanced AI models.
        </p>
      </div>

      <Tabs 
        defaultValue="image" 
        className="w-full"
        onValueChange={(v) => {
          setMediaType(v as "image" | "video");
          setResultUrl(null);
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <TabsList className="grid w-full max-w-md grid-cols-2 h-11">
            <TabsTrigger value="image" className="gap-2 text-sm">
              <ImageIcon className="h-4 w-4" />
              Image
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-2 text-sm">
              <Video className="h-4 w-4" />
              Video
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full h-full">
          {/* Controls Section */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <Card className="p-4 border shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Prompt</Label>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
                      <Sparkles className="h-3 w-3" />
                      Auto-enhance
                    </div>
                  </div>
                  <Textarea
                    placeholder={`Describe the ${mediaType} you want to create in detail...`}
                    className="min-h-[160px] resize-none focus-visible:ring-primary/20 text-md leading-relaxed"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </div>

                <div className="space-y-4 pt-2 border-t mt-2">
                  <div className="flex items-center gap-2 text-sm font-medium mb-3">
                    <Settings2 className="h-4 w-4" />
                    Generation Settings
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Aspect Ratio</Label>
                      <Select value={aspectRatio} onValueChange={setAspectRatio}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1:1">Square (1:1)</SelectItem>
                          <SelectItem value="16:9">Landscape (16:9)</SelectItem>
                          <SelectItem value="9:16">Portrait (9:16)</SelectItem>
                          <SelectItem value="4:3">Standard (4:3)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Style</Label>
                      <Select value={style} onValueChange={setStyle}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="realistic">Realistic</SelectItem>
                          <SelectItem value="cinematic">Cinematic</SelectItem>
                          <SelectItem value="anime">Anime</SelectItem>
                          <SelectItem value="3d-render">3D Render</SelectItem>
                          <SelectItem value="digital-art">Digital Art</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2 col-span-2">
                      <Label className="text-xs text-muted-foreground">Quality</Label>
                      <Select value={quality} onValueChange={setQuality}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard (Faster)</SelectItem>
                          <SelectItem value="hd">HD (Better Details)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <Button 
                  className="w-full h-12 mt-2 font-medium" 
                  size="lg"
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Generating {mediaType}...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate {mediaType === "image" ? "Image" : "Video"}
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </div>

          {/* Result Section */}
          <div className="lg:col-span-7 h-full min-h-[500px]">
            <Card className="h-full w-full border bg-muted/20 overflow-hidden relative flex flex-col shadow-sm">
              {!isGenerating && !resultUrl && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    {mediaType === "image" ? (
                      <ImageIcon className="h-8 w-8 opacity-50" />
                    ) : (
                      <Video className="h-8 w-8 opacity-50" />
                    )}
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">No {mediaType} generated yet</h3>
                  <p className="text-sm max-w-sm">
                    Write a descriptive prompt and hit generate to see your ideas come to life.
                  </p>
                </div>
              )}

              {isGenerating && (
                <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-primary/5 animate-pulse" />
                  <div className="w-16 h-16 relative">
                    <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
                    <div className="absolute inset-2 rounded-full border-r-2 border-primary/50 animate-spin-reverse" />
                  </div>
                  <p className="mt-6 font-medium text-primary animate-pulse">
                    Crafting your {mediaType}...
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    This usually takes 10-20 seconds
                  </p>
                </div>
              )}

              {resultUrl && !isGenerating && (
                <div className="flex-1 relative group bg-black/5 flex items-center justify-center">
                  <img 
                    src={resultUrl} 
                    alt="Generated output" 
                    className="max-w-full max-h-full object-contain rounded-md animate-in fade-in duration-500"
                  />
                  
                  {/* Action overlay */}
                  <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="secondary" className="h-9 w-9 rounded-full shadow-md hover:scale-105 transition-transform">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="default" className="h-9 w-9 rounded-full shadow-md hover:scale-105 transition-transform">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      </Tabs>
      
      {/* Global styles for this component */}
      <style dangerouslySetInnerHTML={{__html: `
        .animate-spin-reverse {
          animation: spin-reverse 1s linear infinite;
        }
        @keyframes spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
      `}} />
    </div>
  );
}
