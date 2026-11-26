import React from "react";

const KEYWORDS = new Set([
  "import",
  "from",
  "export",
  "interface",
  "type",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "of",
  "in",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "new",
  "describe",
  "it",
  "expect",
]);

const TYPES = new Set([
  "React",
  "MetricsSnapshot",
  "RouteConfig",
  "string",
  "number",
  "boolean",
  "void",
]);

export function highlightCodeLine(line: string): React.ReactNode[] {
  const commentIdx = line.indexOf("//");
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";

  const tokens = codePart.split(
    /('[^']*'|"[^"]*"|`[^`]*`|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b|<\/?[A-Za-z][A-Za-z0-9]*)/g,
  );

  const nodes: React.ReactNode[] = tokens.map((tok, i) => {
    if (!tok) return null;
    if (
      (tok.startsWith("'") && tok.endsWith("'")) ||
      (tok.startsWith('"') && tok.endsWith('"')) ||
      (tok.startsWith("`") && tok.endsWith("`"))
    ) {
      return (
        <span key={i} className="text-syntax-string">
          {tok}
        </span>
      );
    }
    if (tok.startsWith("<")) {
      return (
        <span key={i} className="text-syntax-tag">
          {tok}
        </span>
      );
    }
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      return (
        <span key={i} className="text-syntax-number">
          {tok}
        </span>
      );
    }
    if (KEYWORDS.has(tok)) {
      return (
        <span key={i} className="text-syntax-keyword font-medium">
          {tok}
        </span>
      );
    }
    if (TYPES.has(tok) || /^[A-Z][A-Za-z0-9_]*$/.test(tok)) {
      return (
        <span key={i} className="text-syntax-type">
          {tok}
        </span>
      );
    }
    if (tokens[i + 1]?.startsWith("(")) {
      return (
        <span key={i} className="text-syntax-function">
          {tok}
        </span>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });

  if (commentPart) {
    nodes.push(
      <span key="comment" className="text-syntax-comment italic">
        {commentPart}
      </span>,
    );
  }
  return nodes;
}
