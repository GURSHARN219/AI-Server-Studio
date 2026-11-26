import React, { useState, useEffect, useRef } from "react";
import { Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import mermaid from "mermaid";
import { validateMermaidSvg } from "@/lib/mermaidSvg";

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

let mermaidCounter = 0;

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++mermaidCounter}`);

  useEffect(() => {
    setSvg(null);
    setError(null);
    mermaid.render(idRef.current, code)
      .then(({ svg: rendered }) => setSvg(validateMermaidSvg(rendered)))
      .catch((err) => setError(err?.message ?? "Failed to render diagram"));
  }, [code]);

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
        <span className="text-xs text-destructive font-mono">{error}</span>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      className="my-3 rounded-lg border border-border bg-thinking-bg p-4 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function CodeBlockInner({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const codeStr = String(children).replace(/\n$/, "");
  const isInline = !className;

  if (isInline) {
    return (
      <code className="bg-thinking-bg px-1.5 py-0.5 rounded text-text-code text-xs font-mono">
        {children}
      </code>
    );
  }

  // Render mermaid blocks as live diagrams
  if (lang === "mermaid") {
    return <MermaidBlock code={codeStr} />;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code my-3 rounded-lg overflow-hidden border border-border">
      <div className="flex items-center justify-between bg-secondary/80 px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-mono text-muted-foreground uppercase">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-status-online" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="bg-thinking-bg p-3 overflow-x-auto">
        <code className="text-xs font-mono text-foreground leading-relaxed">
          {children}
        </code>
      </pre>
    </div>
  );
}

const CodeBlock = React.memo(CodeBlockInner);
export default CodeBlock;
